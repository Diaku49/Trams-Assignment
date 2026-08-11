// User Service lifecycle: one NATS connection and long-lived RPC subscriptions.

import {
  connectNats,
  type MessagingClient,
  type MessagingLogger,
} from '@app/messaging';
import type { Subscription } from 'nats';
import {
  registerUserRpcRoutes,
  type UserRpcOperations,
} from './handlers/user.handlers';

export interface UserServiceStartupConfig {
  nats: {
    url: string;
    user: string;
    password: string;
  };
}

export interface RunningUserService {
  messaging: MessagingClient;
  subscriptions: Subscription[];
  shutdown(): Promise<void>;
}

export async function startUserService(
  config: UserServiceStartupConfig,
  users: UserRpcOperations,
  logger?: MessagingLogger,
): Promise<RunningUserService> {
  const messaging = await connectNats({
    servers: config.nats.url,
    name: 'user-service',
    user: config.nats.user,
    password: config.nats.password,
    logger,
  });

  const subscriptions = registerUserRpcRoutes(messaging, users, logger);
  let shutdownPromise: Promise<void> | undefined;

  return {
    messaging,
    subscriptions,
    shutdown(): Promise<void> {
      shutdownPromise ??= drainUserService(subscriptions, messaging, logger);
      return shutdownPromise;
    },
  };
}

async function drainUserService(
  subscriptions: Subscription[],
  messaging: MessagingClient,
  logger?: MessagingLogger,
): Promise<void> {
  logger?.info({}, 'Draining User Service RPC subscriptions');
  await Promise.all(subscriptions.map((subscription) => subscription.drain()));
  await messaging.drain();
}
