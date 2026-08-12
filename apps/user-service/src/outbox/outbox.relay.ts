// Reliably relays committed outbox rows to JetStream with bounded backoff.

import { randomUUID } from "node:crypto";
import type { JetStreamPublisher, MessagingLogger } from "@app/messaging";
import type { ClaimedOutboxEvent, OutboxStore } from "./outbox.repository";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_PUBLISHED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
const DEFAULT_CLEANUP_BATCH_SIZE = 500;
const DEFAULT_CLEANUP_MAX_BATCHES = 20;
const DEFAULT_METRICS_INTERVAL_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60_000;

export interface OutboxRelayConfig {
  pollIntervalMs?: number;
  batchSize?: number;
  lockTimeoutMs?: number;
  publishedRetentionMs?: number;
  cleanupIntervalMs?: number;
  cleanupBatchSize?: number;
  cleanupMaxBatches?: number;
  metricsIntervalMs?: number;
}

interface OutboxRelayCounters {
  claimed: number;
  published: number;
  publishFailures: number;
  cleanupRuns: number;
  cleanupDeleted: number;
  cleanupFailures: number;
}

export class OutboxRelay {
  private readonly workerId = randomUUID();
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly lockTimeoutMs: number;
  private readonly publishedRetentionMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly cleanupBatchSize: number;
  private readonly cleanupMaxBatches: number;
  private readonly metricsIntervalMs: number;
  private readonly counters: OutboxRelayCounters = {
    claimed: 0,
    published: 0,
    publishFailures: 0,
    cleanupRuns: 0,
    cleanupDeleted: 0,
    cleanupFailures: 0,
  };
  private abortController?: AbortController;
  private task?: Promise<void>;

  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: JetStreamPublisher,
    private readonly logger?: MessagingLogger,
    config: OutboxRelayConfig = {},
  ) {
    this.pollIntervalMs = positiveInteger(
      config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      "pollIntervalMs",
    );
    this.batchSize = positiveInteger(
      config.batchSize ?? DEFAULT_BATCH_SIZE,
      "batchSize",
    );
    this.lockTimeoutMs = positiveInteger(
      config.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
      "lockTimeoutMs",
    );
    this.publishedRetentionMs = positiveInteger(
      config.publishedRetentionMs ?? DEFAULT_PUBLISHED_RETENTION_MS,
      "publishedRetentionMs",
    );
    this.cleanupIntervalMs = positiveInteger(
      config.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
      "cleanupIntervalMs",
    );
    this.cleanupBatchSize = positiveInteger(
      config.cleanupBatchSize ?? DEFAULT_CLEANUP_BATCH_SIZE,
      "cleanupBatchSize",
    );
    this.cleanupMaxBatches = positiveInteger(
      config.cleanupMaxBatches ?? DEFAULT_CLEANUP_MAX_BATCHES,
      "cleanupMaxBatches",
    );
    this.metricsIntervalMs = positiveInteger(
      config.metricsIntervalMs ?? DEFAULT_METRICS_INTERVAL_MS,
      "metricsIntervalMs",
    );
  }

  start(): void {
    if (this.task) {
      throw new Error("Outbox relay is already running");
    }

    this.abortController = new AbortController();
    this.task = Promise.all([
      this.run(this.abortController.signal),
      this.runCleanup(this.abortController.signal),
      this.reportMetrics(this.abortController.signal),
    ]).then(() => undefined);
    this.logger?.info(
      {
        workerId: this.workerId,
        publishedRetentionMs: this.publishedRetentionMs,
        cleanupIntervalMs: this.cleanupIntervalMs,
        cleanupBatchSize: this.cleanupBatchSize,
        cleanupMaxBatches: this.cleanupMaxBatches,
        metricsIntervalMs: this.metricsIntervalMs,
      },
      "Started outbox relay",
    );
  }

  async stop(): Promise<void> {
    if (!this.task) {
      return;
    }

    this.abortController?.abort();
    await this.task;
    this.task = undefined;
    this.abortController = undefined;
    this.logger?.info({ workerId: this.workerId }, "Stopped outbox relay");
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const events = await this.store.claimBatch(
          this.workerId,
          this.batchSize,
          this.lockTimeoutMs,
        );
        this.counters.claimed += events.length;

        if (events.length === 0) {
          await wait(this.pollIntervalMs, signal);
          continue;
        }

        // Finish an already-claimed batch during graceful shutdown. Otherwise
        // those rows would remain leased until lockTimeoutMs expires.
        for (const event of events) {
          await this.publish(event);
        }
      } catch (error) {
        this.logger?.error(
          { workerId: this.workerId, error: errorMessage(error) },
          "Outbox relay iteration failed",
        );
        await wait(this.pollIntervalMs, signal);
      }
    }
  }

  private async runCleanup(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const cutoff = new Date(Date.now() - this.publishedRetentionMs);
      try {
        let deleted = 0;
        let batches = 0;

        while (batches < this.cleanupMaxBatches) {
          const batchDeleted = await this.store.deletePublishedBefore(
            cutoff,
            this.cleanupBatchSize,
          );
          deleted += batchDeleted;
          batches += 1;

          if (batchDeleted < this.cleanupBatchSize) {
            break;
          }
        }

        this.counters.cleanupRuns += 1;
        this.counters.cleanupDeleted += deleted;
        this.logger?.info(
          {
            workerId: this.workerId,
            cutoff,
            deleted,
            batches,
            batchLimitReached: batches === this.cleanupMaxBatches,
          },
          "Completed published outbox cleanup",
        );
      } catch (error) {
        this.counters.cleanupFailures += 1;
        this.logger?.error(
          { workerId: this.workerId, cutoff, error: errorMessage(error) },
          "Published outbox cleanup failed",
        );
      }

      await wait(this.cleanupIntervalMs, signal);
    }
  }

  private async reportMetrics(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const snapshot = await this.store.getOperationalSnapshot();
        this.logger?.info(
          {
            metric: "outbox",
            workerId: this.workerId,
            counters: { ...this.counters },
            gauges: {
              pending: snapshot.pending,
              retrying: snapshot.retrying,
              publishedRetained: snapshot.publishedRetained,
              oldestPendingAgeMs: snapshot.oldestPendingAt
                ? Math.max(0, Date.now() - snapshot.oldestPendingAt.getTime())
                : 0,
            },
          },
          "Outbox operational metrics",
        );
      } catch (error) {
        this.logger?.error(
          {
            metric: "outbox",
            workerId: this.workerId,
            error: errorMessage(error),
          },
          "Unable to collect outbox operational metrics",
        );
      }

      await wait(this.metricsIntervalMs, signal);
    }
  }

  private async publish(event: ClaimedOutboxEvent): Promise<void> {
    try {
      await this.publisher.publish({
        subject: event.subject,
        eventId: event.id,
        payload: event.payload,
      });
      await this.store.markPublished(event.id, this.workerId);
      this.counters.published += 1;
      this.logger?.info(
        { eventId: event.id, subject: event.subject },
        "Published outbox event",
      );
    } catch (error) {
      this.counters.publishFailures += 1;
      const retryDelayMs = retryDelay(event.attempts + 1);
      await this.store.markFailed(
        event.id,
        this.workerId,
        new Date(Date.now() + retryDelayMs),
        errorMessage(error),
      );
      this.logger?.warn(
        {
          eventId: event.id,
          subject: event.subject,
          attempt: event.attempts + 1,
          retryDelayMs,
          error: errorMessage(error),
        },
        "Outbox publish failed; scheduled retry",
      );
    }
  }
}

function retryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.min(attempt - 1, 10), MAX_RETRY_DELAY_MS);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(finish, milliseconds);

    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }

    signal.addEventListener("abort", finish, { once: true });
  });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
