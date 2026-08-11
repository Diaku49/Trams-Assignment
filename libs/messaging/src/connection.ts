// NATS connection lifecycle: connect with credentials, reconnect, graceful drain.

import {
  connect,
  Events,
  type ConnectionOptions,
  type NatsConnection,
} from 'nats';

export interface MessagingLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

export interface NatsConnectionConfig {
  servers: string | string[];
  name: string;
  user: string;
  password: string;
  tls?: ConnectionOptions['tls'];
  connectTimeoutMs?: number;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  logger?: MessagingLogger;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

export async function connectNats(
  config: NatsConnectionConfig,
): Promise<NatsConnection> {
  const connection = await connect({
    servers: config.servers,
    name: config.name,
    user: config.user,
    pass: config.password,
    tls: config.tls,
    reconnect: true,
    maxReconnectAttempts: config.maxReconnectAttempts ?? -1,
    reconnectTimeWait:
      config.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
    reconnectJitter: 250,
    timeout: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  });

  config.logger?.info(
    { name: config.name, servers: config.servers },
    'Connected to NATS',
  );

  void watchNatsStatus(connection, config.name, config.logger);

  void connection.closed().then((error) => {
    if (error) {
      config.logger?.error(
        { name: config.name, error: error.message },
        'NATS connection closed with an error',
      );
      return;
    }

    config.logger?.info({ name: config.name }, 'NATS connection closed');
  });

  return connection;
}

async function watchNatsStatus(
  connection: NatsConnection,
  name: string,
  logger?: MessagingLogger,
): Promise<void> {
  try {
    for await (const status of connection.status()) {
      const context = {
        name,
        event: status.type,
        data: status.data,
        permissionContext: status.permissionContext,
      };

      if (status.type === Events.Disconnect) {
        logger?.warn(context, 'Disconnected from NATS; reconnecting');
      } else if (status.type === Events.Reconnect) {
        logger?.info(context, 'Reconnected to NATS');
      } else if (status.type === Events.Error) {
        logger?.error(context, 'NATS reported a connection error');
      }
    }
  } catch (error) {
    logger?.error(
      {
        name,
        error: error instanceof Error ? error.message : String(error),
      },
      'NATS status observer stopped unexpectedly',
    );
  }
}

export async function drainNats(
  connection: NatsConnection,
  name: string,
  logger?: MessagingLogger,
): Promise<void> {
  if (connection.isClosed()) {
    return;
  }

  logger?.info({ name }, 'Draining NATS connection');
  await connection.drain();
}
