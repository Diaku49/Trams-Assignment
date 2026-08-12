// Persistent idempotency and leases for Notification Service side effects.

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";

export interface NotificationDeliveryInput {
  eventId: string;
  userId: string;
  recipient: string;
  channel: string;
  leaseDurationMs: number;
}

export type NotificationDeliveryClaim =
  | { state: "claimed"; claimToken: string }
  | { state: "already-sent" }
  | { state: "in-progress" };

export interface NotificationDeliveryStore {
  claim(
    input: NotificationDeliveryInput,
  ): Promise<NotificationDeliveryClaim>;
  markSent(eventId: string, claimToken: string): Promise<void>;
  markFailed(
    eventId: string,
    claimToken: string,
    error: string,
  ): Promise<void>;
}

export class NotificationDeliveryRepository
  implements NotificationDeliveryStore
{
  constructor(private readonly database: PrismaClient) {}

  async claim(
    input: NotificationDeliveryInput,
  ): Promise<NotificationDeliveryClaim> {
    const now = new Date();
    const claimToken = randomUUID();

    try {
      await this.database.notificationDelivery.create({
        data: {
          eventId: input.eventId,
          userId: input.userId,
          recipient: input.recipient,
          channel: input.channel,
          attempts: 1,
          claimedAt: now,
          claimToken,
        },
      });
      return { state: "claimed", claimToken };
    } catch (error) {
      if (!isUniqueEventIdError(error)) {
        throw error;
      }
    }

    const existing = await this.database.notificationDelivery.findUnique({
      where: { eventId: input.eventId },
      select: { sentAt: true },
    });

    if (existing?.sentAt) {
      return { state: "already-sent" };
    }

    const staleBefore = new Date(now.getTime() - input.leaseDurationMs);
    const claimed = await this.database.notificationDelivery.updateMany({
      where: {
        eventId: input.eventId,
        sentAt: null,
        OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
      },
      data: {
        attempts: { increment: 1 },
        claimedAt: now,
        claimToken,
        lastError: null,
      },
    });

    if (claimed.count === 1) {
      return { state: "claimed", claimToken };
    }

    const current = await this.database.notificationDelivery.findUnique({
      where: { eventId: input.eventId },
      select: { sentAt: true },
    });

    return current?.sentAt
      ? { state: "already-sent" }
      : { state: "in-progress" };
  }

  async markSent(eventId: string, claimToken: string): Promise<void> {
    const updated = await this.database.notificationDelivery.updateMany({
      where: { eventId, claimToken, sentAt: null },
      data: {
        sentAt: new Date(),
        claimedAt: null,
        claimToken: null,
        lastError: null,
      },
    });

    assertClaimWasOwned(updated.count, eventId);
  }

  async markFailed(
    eventId: string,
    claimToken: string,
    error: string,
  ): Promise<void> {
    const updated = await this.database.notificationDelivery.updateMany({
      where: { eventId, claimToken, sentAt: null },
      data: {
        claimedAt: null,
        claimToken: null,
        lastError: error.slice(0, 2_000),
      },
    });

    assertClaimWasOwned(updated.count, eventId);
  }
}

function isUniqueEventIdError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function assertClaimWasOwned(updatedRows: number, eventId: string): void {
  if (updatedRows !== 1) {
    throw new Error(`Notification delivery claim was lost for event ${eventId}`);
  }
}
