// Reliably relays committed outbox rows to JetStream with bounded backoff.

import { randomUUID } from "node:crypto";
import type { JetStreamPublisher, MessagingLogger } from "@app/messaging";
import type { ClaimedOutboxEvent, OutboxStore } from "./outbox.repository";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60_000;

export interface OutboxRelayConfig {
  pollIntervalMs?: number;
  batchSize?: number;
  lockTimeoutMs?: number;
}

export class OutboxRelay {
  private readonly workerId = randomUUID();
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly lockTimeoutMs: number;
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
  }

  start(): void {
    if (this.task) {
      throw new Error("Outbox relay is already running");
    }

    this.abortController = new AbortController();
    this.task = this.run(this.abortController.signal);
    this.logger?.info({ workerId: this.workerId }, "Started outbox relay");
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

  private async publish(event: ClaimedOutboxEvent): Promise<void> {
    try {
      await this.publisher.publish({
        subject: event.subject,
        eventId: event.id,
        payload: event.payload,
      });
      await this.store.markPublished(event.id, this.workerId);
      this.logger?.info(
        { eventId: event.id, subject: event.subject },
        "Published outbox event",
      );
    } catch (error) {
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
