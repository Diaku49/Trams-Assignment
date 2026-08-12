// Contract every notification delivery channel implements.

export interface WelcomeNotification {
  eventId: string;
  userId: string;
  email: string;
  name: string | null;
}

export interface NotificationDeliveryOptions {
  /** Forward this value to a real provider's idempotency-key mechanism. */
  idempotencyKey: string;
}

export interface NotificationChannel {
  sendWelcome(
    notification: WelcomeNotification,
    options: NotificationDeliveryOptions,
  ): Promise<void>;
}
