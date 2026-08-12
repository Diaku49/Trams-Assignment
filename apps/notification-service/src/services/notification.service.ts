// Converts user events into notifications and avoids duplicate sends in-process.

import type { UserCreatedEvent } from "@app/contracts";
import type { MessagingLogger } from "@app/messaging";
import type { NotificationChannel } from "../channels/channel.interface";

const DEFAULT_IDEMPOTENCY_CACHE_SIZE = 10_000;

export class NotificationService {
  private readonly processedEventIds = new Map<string, true>();
  private readonly processing = new Map<string, Promise<void>>();

  constructor(
    private readonly channel: NotificationChannel,
    private readonly logger?: MessagingLogger,
    private readonly idempotencyCacheSize = DEFAULT_IDEMPOTENCY_CACHE_SIZE,
  ) {
    if (
      !Number.isSafeInteger(idempotencyCacheSize) ||
      idempotencyCacheSize < 1
    ) {
      throw new Error("idempotencyCacheSize must be a positive integer");
    }
  }

  handleUserCreated(event: UserCreatedEvent): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      this.logger?.info(
        { eventId: event.eventId },
        "Skipped duplicate user.created event",
      );
      return Promise.resolve();
    }

    const inProgress = this.processing.get(event.eventId);
    if (inProgress) {
      return inProgress;
    }

    const task = this.sendWelcome(event).finally(() => {
      this.processing.delete(event.eventId);
    });
    this.processing.set(event.eventId, task);
    return task;
  }

  private async sendWelcome(event: UserCreatedEvent): Promise<void> {
    await this.channel.sendWelcome({
      eventId: event.eventId,
      userId: event.payload.id,
      email: event.payload.email,
      name: event.payload.name,
    });
    this.rememberProcessed(event.eventId);
  }

  private rememberProcessed(eventId: string): void {
    this.processedEventIds.set(eventId, true);

    if (this.processedEventIds.size > this.idempotencyCacheSize) {
      const oldestEventId = this.processedEventIds.keys().next().value as
        string | undefined;
      if (oldestEventId) {
        this.processedEventIds.delete(oldestEventId);
      }
    }
  }
}
