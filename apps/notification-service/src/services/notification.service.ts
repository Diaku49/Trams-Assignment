// Turns user.created events into durable, idempotent notification deliveries.

import type { UserCreatedEvent } from "@app/contracts";
import type { MessagingLogger } from "@app/messaging";
import type { NotificationChannel } from "../channels/channel.interface";
import { NotificationDeliveryInProgressError } from "../errors/notification-delivery.error";
import type { NotificationDeliveryStore } from "../repositories/notification-delivery.repository";

const WELCOME_CHANNEL = "welcome";

export interface NotificationServiceOptions {
  leaseDurationMs: number;
}

export class NotificationService {
  constructor(
    private readonly channel: NotificationChannel,
    private readonly deliveries: NotificationDeliveryStore,
    private readonly logger?: MessagingLogger,
    private readonly options?: NotificationServiceOptions,
  ) {}

  async handleUserCreated(event: UserCreatedEvent): Promise<void> {
    const claim = await this.deliveries.claim({
      eventId: event.eventId,
      userId: event.payload.id,
      recipient: event.payload.email,
      channel: WELCOME_CHANNEL,
      leaseDurationMs: this.leaseDurationMs,
    });

    if (claim.state === "already-sent") {
      this.logger?.info(
        { eventId: event.eventId },
        "Skipped already-sent user.created notification",
      );
      return;
    }

    if (claim.state === "in-progress") {
      throw new NotificationDeliveryInProgressError(event.eventId);
    }

    try {
      await this.channel.sendWelcome(
        {
          eventId: event.eventId,
          userId: event.payload.id,
          email: event.payload.email,
          name: event.payload.name,
        },
        // A real email provider must use this key too: if a process dies after
        // the provider accepts the email but before markSent(), its retry is
        // deduplicated by the provider as well as this database.
        { idempotencyKey: event.eventId },
      );
    } catch (error) {
      await this.deliveries.markFailed(
        event.eventId,
        claim.claimToken,
        errorMessage(error),
      );
      throw error;
    }

    await this.deliveries.markSent(event.eventId, claim.claimToken);
  }

  private get leaseDurationMs(): number {
    const value = this.options?.leaseDurationMs ?? 60_000;

    if (!Number.isSafeInteger(value) || value < 1_000) {
      throw new Error("deliveryLeaseMs must be an integer of at least 1000ms");
    }

    return value;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
