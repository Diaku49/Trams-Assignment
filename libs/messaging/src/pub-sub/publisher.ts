// JetStream publisher

import {
  JSONCodec,
  type MsgHdrs,
  type NatsConnection,
  type PubAck,
} from "nats";

const codec = JSONCodec<unknown>();
const DEFAULT_PUBLISH_TIMEOUT_MS = 5_000;

export interface PublishEventOptions {
  subject: string;
  eventId: string;
  payload: unknown;
  timeoutMs?: number;
}

export interface PublishRawOptions {
  subject: string;
  messageId: string;
  data: Uint8Array;
  headers?: MsgHdrs;
  timeoutMs?: number;
}

export class JetStreamPublisher {
  constructor(private readonly connection: NatsConnection) {}

  /** Persists an event and waits for the JetStream publish acknowledgement. */
  async publish(options: PublishEventOptions): Promise<PubAck> {
    if (!options.subject) {
      throw new Error("A JetStream subject is required");
    }

    if (!options.eventId) {
      throw new Error("A stable event ID is required for JetStream publishing");
    }

    return this.publishRaw({
      subject: options.subject,
      messageId: options.eventId,
      data: codec.encode(options.payload),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
  }

  /** Persists exact bytes, used when a DLQ must preserve an invalid payload. */
  async publishRaw(options: PublishRawOptions): Promise<PubAck> {
    if (!options.subject) {
      throw new Error("A JetStream subject is required");
    }

    if (!options.messageId) {
      throw new Error(
        "A stable message ID is required for JetStream publishing",
      );
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;

    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        "Publish timeout must be a positive integer in milliseconds",
      );
    }

    return this.connection.jetstream().publish(options.subject, options.data, {
      msgID: options.messageId,
      timeout: timeoutMs,
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    });
  }
}
