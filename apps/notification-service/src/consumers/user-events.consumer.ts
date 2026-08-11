// Notification Service's durable consumer for user.created events.

import {
  USER_EVENTS_STREAM,
  subjects,
  userCreatedEventSchema,
  type UserCreatedEvent,
} from '@app/contracts';
import {
  type DurableConsumerConfig,
  type MessagingClient,
  type StartedDurableConsumer,
} from '@app/messaging';
import { JSONCodec } from 'nats';

const codec = JSONCodec<unknown>();

export type UserCreatedConsumerConfig = Pick<
  DurableConsumerConfig<UserCreatedEvent>,
  'durableName' | 'maxDeliver' | 'ackWaitMs' | 'maxAckPending' | 'retryDelaysMs'
>;

export type UserCreatedHandler = (event: UserCreatedEvent) => Promise<void>;

/**
 * Notification Service owns this wrapper and supplies its notification handler.
 * The messaging library only manages durable delivery, acknowledgements, and
 * retries; it has no knowledge of users or notifications.
 */
export class UserEventsConsumer {
  constructor(private readonly messaging: MessagingClient) {}

  startCreated(
    config: UserCreatedConsumerConfig,
    handleEvent: UserCreatedHandler,
  ): Promise<StartedDurableConsumer> {
    return this.messaging.consumer.start({
      ...config,
      stream: USER_EVENTS_STREAM,
      filterSubject: subjects.userCreated,
      deadLetterSubject: subjects.userEventsDeadLetter,
      decode: decodeUserCreatedEvent,
      getEventId: (event) => event.eventId,
      handleEvent,
    });
  }
}

function decodeUserCreatedEvent(data: Uint8Array): UserCreatedEvent {
  const parsed = userCreatedEventSchema.safeParse(codec.decode(data));

  if (!parsed.success) {
    throw new Error(`Invalid user.created event: ${parsed.error.message}`);
  }

  return parsed.data;
}
