// Contract every notification delivery channel implements.

export interface WelcomeNotification {
  eventId: string;
  userId: string;
  email: string;
  name: string | null;
}

export interface NotificationChannel {
  sendWelcome(notification: WelcomeNotification): Promise<void>;
}
