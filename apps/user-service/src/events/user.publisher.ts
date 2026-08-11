// Publishes User Service domain events to JetStream after a successful write.

import {
  subjects,
  userCreatedEventSchema,
  type UserCreatedEvent,
} from '@app/contracts';
import type { MessagingClient } from '@app/messaging';
import type { PubAck } from 'nats';

export class UserPublisher {
  constructor(private readonly messaging: MessagingClient) {}

  async created(event: UserCreatedEvent): Promise<PubAck> {
    const parsed = userCreatedEventSchema.safeParse(event);

    if (!parsed.success) {
      throw new Error(
        `Cannot publish an invalid user.created event: ${parsed.error.message}`,
      );
    }

    return this.messaging.publisher.publish({
      subject: subjects.userCreated,
      eventId: parsed.data.eventId,
      payload: parsed.data,
    });
  }
}
