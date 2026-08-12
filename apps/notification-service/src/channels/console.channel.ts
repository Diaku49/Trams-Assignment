// Development channel that logs instead of sending. Swap for email later.

import type { MessagingLogger } from "@app/messaging";
import type {
  NotificationChannel,
  NotificationDeliveryOptions,
  WelcomeNotification,
} from "./channel.interface";

export class ConsoleNotificationChannel implements NotificationChannel {
  constructor(private readonly logger: MessagingLogger) {}

  async sendWelcome(
    notification: WelcomeNotification,
    options: NotificationDeliveryOptions,
  ): Promise<void> {
    this.logger.info(
      {
        eventId: notification.eventId,
        idempotencyKey: options.idempotencyKey,
        userId: notification.userId,
        recipient: notification.email,
      },
      `Welcome notification sent to ${notification.name ?? notification.email}`,
    );
  }
}
