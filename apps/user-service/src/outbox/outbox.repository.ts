// PostgreSQL-backed outbox leasing. A lease prevents service replicas from
// normally publishing the same row concurrently; expired leases are recoverable.

import type { Prisma, PrismaClient } from "../generated/prisma/client";

export interface ClaimedOutboxEvent {
  id: string;
  subject: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

export interface OutboxOperationalSnapshot {
  pending: number;
  retrying: number;
  publishedRetained: number;
  oldestPendingAt: Date | null;
}

export interface OutboxStore {
  claimBatch(
    workerId: string,
    batchSize: number,
    lockTimeoutMs: number,
  ): Promise<ClaimedOutboxEvent[]>;
  markPublished(eventId: string, workerId: string): Promise<void>;
  markFailed(
    eventId: string,
    workerId: string,
    retryAt: Date,
    error: string,
  ): Promise<void>;
  deletePublishedBefore(cutoff: Date, batchSize: number): Promise<number>;
  getOperationalSnapshot(): Promise<OutboxOperationalSnapshot>;
}

const outboxSelect = {
  id: true,
  subject: true,
  payload: true,
  attempts: true,
} as const;

export class OutboxRepository implements OutboxStore {
  constructor(private readonly database: PrismaClient) {}

  async claimBatch(
    workerId: string,
    batchSize: number,
    lockTimeoutMs: number,
  ): Promise<ClaimedOutboxEvent[]> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - lockTimeoutMs);
    const availableLease: Prisma.OutboxEventWhereInput = {
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    };
    const candidates = await this.database.outboxEvent.findMany({
      where: {
        publishedAt: null,
        nextAttemptAt: { lte: now },
        ...availableLease,
      },
      orderBy: { createdAt: "asc" },
      take: batchSize,
      select: outboxSelect,
    });
    const claimed: ClaimedOutboxEvent[] = [];

    for (const candidate of candidates) {
      const result = await this.database.outboxEvent.updateMany({
        where: {
          id: candidate.id,
          publishedAt: null,
          nextAttemptAt: { lte: now },
          ...availableLease,
        },
        data: { lockedAt: now, lockedBy: workerId },
      });

      if (result.count === 1) {
        claimed.push(candidate);
      }
    }

    return claimed;
  }

  async markPublished(eventId: string, workerId: string): Promise<void> {
    const result = await this.database.outboxEvent.updateMany({
      where: { id: eventId, lockedBy: workerId, publishedAt: null },
      data: {
        publishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });

    assertLeaseWasOwned(result.count, eventId);
  }

  async markFailed(
    eventId: string,
    workerId: string,
    retryAt: Date,
    error: string,
  ): Promise<void> {
    const result = await this.database.outboxEvent.updateMany({
      where: { id: eventId, lockedBy: workerId, publishedAt: null },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: retryAt,
        lockedAt: null,
        lockedBy: null,
        lastError: error.slice(0, 2_000),
      },
    });

    assertLeaseWasOwned(result.count, eventId);
  }

  async deletePublishedBefore(
    cutoff: Date,
    batchSize: number,
  ): Promise<number> {
    const expired = await this.database.outboxEvent.findMany({
      where: { publishedAt: { lt: cutoff } },
      orderBy: { publishedAt: "asc" },
      take: batchSize,
      select: { id: true },
    });

    if (expired.length === 0) {
      return 0;
    }

    const result = await this.database.outboxEvent.deleteMany({
      where: {
        id: { in: expired.map(({ id }) => id) },
        publishedAt: { lt: cutoff },
      },
    });
    return result.count;
  }

  async getOperationalSnapshot(): Promise<OutboxOperationalSnapshot> {
    const [pending, retrying, publishedRetained, oldestPending] =
      await Promise.all([
        this.database.outboxEvent.count({ where: { publishedAt: null } }),
        this.database.outboxEvent.count({
          where: { publishedAt: null, attempts: { gt: 0 } },
        }),
        this.database.outboxEvent.count({
          where: { publishedAt: { not: null } },
        }),
        this.database.outboxEvent.findFirst({
          where: { publishedAt: null },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
      ]);

    return {
      pending,
      retrying,
      publishedRetained,
      oldestPendingAt: oldestPending?.createdAt ?? null,
    };
  }
}

function assertLeaseWasOwned(updatedRows: number, eventId: string): void {
  if (updatedRows !== 1) {
    throw new Error(`Outbox lease was lost for event ${eventId}`);
  }
}
