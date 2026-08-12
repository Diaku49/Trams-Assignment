// One connection plus SDK-style resource clients for each service process.

import {
  connect,
  Events,
  type ConnectionOptions,
  type NatsConnection,
} from 'nats';
import { JetStreamConsumer } from './pub-sub/consumer';
import { JetStreamPublisher } from './pub-sub/publisher';
import { JetStreamStreams } from './pub-sub/stream-bootstrap';
import { RpcClient } from './rpc/rpc';
import type { MessagingLogger } from './types';

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

/** Transport-only facade. All namespaces share exactly one underlying NATS socket. */
export class MessagingClient {
  readonly rpc: RpcClient;
  readonly publisher: JetStreamPublisher;
  readonly consumer: JetStreamConsumer;
  readonly streams: JetStreamStreams;

  constructor(
    private readonly connection: NatsConnection,
    private readonly name: string,
    private readonly logger?: MessagingLogger,
  ) {
    this.rpc = new RpcClient(connection);
    this.publisher = new JetStreamPublisher(connection);
    this.consumer = new JetStreamConsumer(connection, logger);
    this.streams = new JetStreamStreams(connection, logger);
  }

  isClosed(): boolean {
    return this.connection.isClosed();
  }

  async drain(): Promise<void> {
    if (this.connection.isClosed()) {
      return;
    }

    this.logger?.info({ name: this.name }, 'Draining NATS connection');
    await this.connection.drain();
  }
}

/** Opens one long-lived connection and returns its SDK-style client facade. */
export async function connectNats(
  config: NatsConnectionConfig,
): Promise<MessagingClient> {
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

  return new MessagingClient(connection, config.name, config.logger);
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
