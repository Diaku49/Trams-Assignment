// User Service's JetStream stream definition.

import { USER_EVENTS_STREAM, subjects } from '@app/contracts';
import {
  type DurableStreamConfig,
} from '@app/messaging';

const DAYS = 24 * 60 * 60 * 1_000;

export const userEventsStream: DurableStreamConfig = {
  name: USER_EVENTS_STREAM,
  description: 'User Service domain events and failed-event copies',
  subjects: [subjects.userCreated, subjects.userEventsDeadLetter],
  maxMessages: -1,
  maxBytes: 512 * 1024 * 1024,
  maxMessageSize: 1 * 1024 * 1024,
  maxAgeMs: 7 * DAYS,
  duplicateWindowMs: 2 * 60 * 1_000,
  replicas: 1,
};
