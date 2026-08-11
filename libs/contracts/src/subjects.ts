// NATS subjects + JetStream stream name. Single source of truth for the wire.

export const USER_EVENTS_STREAM = 'USER_EVENTS';

export const subjects = {
  userRpcCreate: 'user.rpc.create',
  userRpcGetById: 'user.rpc.get-by-id',
  userRpcUpdate: 'user.rpc.update',
  userRpcAuthenticate: 'user.rpc.authenticate',
  
  userEvents: 'user.events',
  userCreated: 'user.created',
  userEventsDeadLetter: 'user.events.dlq',
} as const;

export type Subject = (typeof subjects)[keyof typeof subjects];
