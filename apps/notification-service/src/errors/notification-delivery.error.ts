export class NotificationDeliveryInProgressError extends Error {
  constructor(eventId: string) {
    super(`Notification delivery for event ${eventId} is already in progress`);
    this.name = "NotificationDeliveryInProgressError";
  }
}
