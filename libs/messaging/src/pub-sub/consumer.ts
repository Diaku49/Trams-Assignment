// Pull-consumer lifecycle: explicit ack, retry, and dead-lettering.

import {
  AckPolicy,
  DeliverPolicy,
  nanos,
  type Consumer,
  type ConsumerMessages,
  type JsMsg,
  type NatsConnection,
} from 'nats';
import type { MessagingLogger } from '../types';
import { JetStreamPublisher } from './publisher';

const DEFAULT_MAX_DELIVER = 5;
const DEFAULT_ACK_WAIT_MS = 30_000;
const DEFAULT_MAX_ACK_PENDING = 10;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 5 * 60_000, 15 * 60_000];

export interface DurableConsumerConfig<TEvent> {
  stream: string;
  durableName: string;
  filterSubject: string;
  deadLetterSubject: string;
  /** Converts and validates the raw JetStream message for this domain event. */
  decode(data: Uint8Array): TEvent;
  getEventId(event: TEvent): string;
  handleEvent(event: TEvent): Promise<void>;
  maxDeliver?: number;
  ackWaitMs?: number;
  maxAckPending?: number;
  retryDelaysMs?: number[];
}

export interface StartedDurableConsumer {
  /** Close this during the consuming service's graceful shutdown. */
  messages: ConsumerMessages;
  durableName: string;
}

/**
 * Starts a generic, durable JetStream consumer. The returned handle can close
 * the pull iterator; the durable acknowledgement position remains in JetStream.
 */
export class JetStreamConsumer {
  constructor(
    private readonly connection: NatsConnection,
    private readonly logger?: MessagingLogger,
  ) {}

  async start<TEvent>(
    config: DurableConsumerConfig<TEvent>,
  ): Promise<StartedDurableConsumer> {
    const resolved = resolveConfig(config);
    const consumer = await ensureDurableConsumer(this.connection, resolved);
    const messages = await consumer.consume({
      max_messages: resolved.maxAckPending,
    });

    // This processor waits asynchronously and does not block the Node.js thread.
    void processMessages(this.connection, messages, resolved, this.logger);

    this.logger?.info(
      { stream: resolved.stream, durable: resolved.durableName },
      'Started durable JetStream consumer',
    );

    return { messages, durableName: resolved.durableName };
  }
}

async function ensureDurableConsumer<TEvent>(
  connection: NatsConnection,
  config: ResolvedConsumerConfig<TEvent>,
): Promise<Consumer> {
  const manager = await connection.jetstreamManager();

  try {
    const existing = await manager.consumers.info(
      config.stream,
      config.durableName,
    );

    if (
      existing.config.ack_policy !== AckPolicy.Explicit ||
      existing.config.filter_subject !== config.filterSubject
    ) {
      throw new Error(
        `Durable consumer ${config.durableName} has an incompatible configuration`,
      );
    }
  } catch (error) {
    if (!isConsumerNotFound(error)) {
      throw error;
    }

    try {
      await manager.consumers.add(config.stream, {
        durable_name: config.durableName,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        filter_subject: config.filterSubject,
        ack_wait: nanos(config.ackWaitMs),
        max_deliver: config.maxDeliver,
        max_ack_pending: config.maxAckPending,
        backoff: config.retryDelaysMs.map(nanos),
      });
    } catch (createError) {
      // Another consumer replica may have created this durable between info()
      // and add(). In that case, bind to its existing durable state below.
      try {
        await manager.consumers.info(config.stream, config.durableName);
      } catch {
        throw createError;
      }
    }
  }

  return connection.jetstream().consumers.get(config.stream, config.durableName);
}

async function processMessages<TEvent>(
  connection: NatsConnection,
  messages: ConsumerMessages,
  config: ResolvedConsumerConfig<TEvent>,
  logger?: MessagingLogger,
): Promise<void> {
  try {
    for await (const message of messages) {
      let event: TEvent;

      try {
        event = config.decode(message.data);
      } catch (error) {
        logger?.error(
          {
            stream: config.stream,
            durable: config.durableName,
            streamSequence: message.info.streamSequence,
            error: error instanceof Error ? error.message : String(error),
          },
          'Terminated malformed event',
        );
        message.term();
        continue;
      }

      try {
        await config.handleEvent(event);
        message.ack();
      } catch (error) {
        await handleFailure(connection, message, event, config, error, logger);
      }
    }
  } catch (error) {
    logger?.error(
      {
        stream: config.stream,
        durable: config.durableName,
        error: error instanceof Error ? error.message : String(error),
      },
      'Durable consumer stopped unexpectedly',
    );
  }
}

async function handleFailure<TEvent>(
  connection: NatsConnection,
  message: JsMsg,
  event: TEvent,
  config: ResolvedConsumerConfig<TEvent>,
  error: unknown,
  logger?: MessagingLogger,
): Promise<void> {
  const eventId = config.getEventId(event);

  if (message.info.deliveryCount >= config.maxDeliver) {
    try {
      await new JetStreamPublisher(connection).publish({
        subject: config.deadLetterSubject,
        eventId: `dlq:${eventId}`,
        payload: event,
      });
      message.term();
      logger?.error(
        {
          stream: config.stream,
          durable: config.durableName,
          eventId,
          deliveryCount: message.info.deliveryCount,
          error: error instanceof Error ? error.message : String(error),
        },
        'Moved event to the dead-letter subject',
      );
      return;
    } catch (deadLetterError) {
      logger?.error(
        {
          stream: config.stream,
          durable: config.durableName,
          eventId,
          error:
            deadLetterError instanceof Error
              ? deadLetterError.message
              : String(deadLetterError),
        },
        'Unable to publish event to the dead-letter subject',
      );
    }
  }

  const retryDelay = config.retryDelaysMs[
    Math.min(message.info.deliveryCount - 1, config.retryDelaysMs.length - 1)
  ];
  message.nak(retryDelay);
  logger?.warn(
    {
      stream: config.stream,
      durable: config.durableName,
      eventId,
      deliveryCount: message.info.deliveryCount,
      retryDelay,
      error: error instanceof Error ? error.message : String(error),
    },
    'Failed to process event; scheduled redelivery',
  );
}

interface ResolvedConsumerConfig<TEvent>
  extends Required<
    Pick<
      DurableConsumerConfig<TEvent>,
      'maxDeliver' | 'ackWaitMs' | 'maxAckPending' | 'retryDelaysMs'
    >
  >,
    Omit<
      DurableConsumerConfig<TEvent>,
      'maxDeliver' | 'ackWaitMs' | 'maxAckPending' | 'retryDelaysMs'
    > {}

function resolveConfig<TEvent>(
  config: DurableConsumerConfig<TEvent>,
): ResolvedConsumerConfig<TEvent> {
  const maxDeliver = config.maxDeliver ?? DEFAULT_MAX_DELIVER;
  const retryDelaysMs =
    config.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS.slice(0, maxDeliver);

  if (!config.stream || !config.durableName || !config.filterSubject || !config.deadLetterSubject) {
    throw new Error('Stream, durable name, filter subject, and dead-letter subject are required');
  }

  if (!Number.isSafeInteger(maxDeliver) || maxDeliver < 1) {
    throw new Error('maxDeliver must be a positive integer');
  }

  if (retryDelaysMs.length === 0 || retryDelaysMs.length > maxDeliver) {
    throw new Error('retryDelaysMs must contain between 1 and maxDeliver delays');
  }

  for (const delay of retryDelaysMs) {
    if (!Number.isSafeInteger(delay) || delay <= 0) {
      throw new Error('Each retry delay must be a positive integer in milliseconds');
    }
  }

  return {
    ...config,
    maxDeliver,
    ackWaitMs: positiveInteger(config.ackWaitMs ?? DEFAULT_ACK_WAIT_MS, 'ackWaitMs'),
    maxAckPending: positiveInteger(
      config.maxAckPending ?? DEFAULT_MAX_ACK_PENDING,
      'maxAckPending',
    ),
    retryDelaysMs,
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function isConsumerNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === 'consumer not found';
}
