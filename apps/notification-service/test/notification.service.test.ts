import assert from "node:assert/strict";
import test from "node:test";
import type { UserCreatedEvent } from "@app/contracts";
import type {
  NotificationDeliveryInput,
  NotificationDeliveryStore,
} from "../src/repositories/notification-delivery.repository";
import { NotificationService } from "../src/services/notification.service";
import type {
  NotificationChannel,
  NotificationDeliveryOptions,
  WelcomeNotification,
} from "../src/channels/channel.interface";

test("a redelivered user.created event does not send a second notification", async () => {
  let sent = false;
  let sendCount = 0;
  const deliveries: NotificationDeliveryStore = {
    async claim(_input: NotificationDeliveryInput) {
      return sent
        ? ({ state: "already-sent" } as const)
        : ({ state: "claimed", claimToken: "claim-1" } as const);
    },
    async markSent(eventId, claimToken): Promise<void> {
      assert.equal(eventId, event.eventId);
      assert.equal(claimToken, "claim-1");
      sent = true;
    },
    async markFailed(): Promise<void> {
      assert.fail("delivery should not fail");
    },
  };
  const channel: NotificationChannel = {
    async sendWelcome(
      notification: WelcomeNotification,
      options: NotificationDeliveryOptions,
    ): Promise<void> {
      sendCount += 1;
      assert.equal(notification.email, event.payload.email);
      assert.equal(options.idempotencyKey, event.eventId);
    },
  };
  const notifications = new NotificationService(channel, deliveries);

  await notifications.handleUserCreated(event);
  await notifications.handleUserCreated(event);

  assert.equal(sendCount, 1);
});

const event: UserCreatedEvent = {
  eventId: "08c84135-288d-4c15-bddb-f4175a2fd686",
  occurredAt: "2026-08-12T00:00:00.000Z",
  type: "user.created",
  payload: {
    id: "78217e61-4d24-4b9d-8bb5-d19f4d550c97",
    email: "ada@example.com",
    name: "Ada",
    createdAt: "2026-08-12T00:00:00.000Z",
  },
};
