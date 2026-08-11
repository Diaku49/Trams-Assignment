// Generic Core-NATS request/reply client.

import {
  ErrorCode,
  JSONCodec,
  NatsError,
  type NatsConnection,
  type Subscription,
} from "nats";

const codec = JSONCodec<unknown>();
const DEFAULT_RPC_TIMEOUT_MS = 3_000;

export type RpcErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "NO_RESPONDERS"
  | "TIMEOUT"
  | "REMOTE_ERROR"
  | "TRANSPORT_ERROR";

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: RpcErrorCode,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface RpcOptions {
  timeoutMs?: number;
}

export type RpcHandler = (payload: unknown) => Promise<unknown> | unknown;

export interface RpcResponderOptions {
  /** May return a protocol-level failure reply for the current request. */
  onError?: (error: unknown) => unknown;
}

export class RpcClient {
  constructor(private readonly connection: NatsConnection) {}

  async request(
    subject: string,
    payload: unknown,
    options: RpcOptions = {},
  ): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;

    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new RpcError(
        "RPC timeout must be a positive integer in milliseconds",
        "INVALID_REQUEST",
      );
    }

    try {
      const reply = await this.connection.request(
        subject,
        codec.encode(payload),
        {
          timeout: timeoutMs,
        },
      );

      try {
        return codec.decode(reply.data);
      } catch (error) {
        throw new RpcError(
          "RPC reply is not valid JSON",
          "INVALID_RESPONSE",
          error instanceof Error ? error.message : null,
        );
      }
    } catch (error) {
      if (error instanceof RpcError) {
        throw error;
      }

      if (error instanceof NatsError) {
        if (error.code === ErrorCode.NoResponders) {
          throw new RpcError(
            "No service is currently handling this RPC subject",
            "NO_RESPONDERS",
          );
        }

        if (error.code === ErrorCode.Timeout) {
          throw new RpcError(
            "The service did not respond before the RPC timeout",
            "TIMEOUT",
          );
        }
      }

      throw new RpcError(
        "NATS RPC request failed",
        "TRANSPORT_ERROR",
        error instanceof Error ? error.message : null,
      );
    }
  }

  respond(
    subject: string,
    handler: RpcHandler,
    options: RpcResponderOptions = {},
  ): Subscription {
    return this.connection.subscribe(subject, {
      callback: (subscriptionError, message) => {
        if (subscriptionError) {
          options.onError?.(subscriptionError);
          return;
        }

        void this.respondToMessage(message, handler, options.onError);
      },
    });
  }

  private async respondToMessage(
    message: { data: Uint8Array; respond(payload?: Uint8Array): boolean },
    handler: RpcHandler,
    onError?: (error: unknown) => void,
  ): Promise<void> {
    try {
      const response = await handler(codec.decode(message.data));
      message.respond(codec.encode(response));
    } catch (error) {
      const failureReply = onError?.(error);

      if (failureReply !== undefined) {
        message.respond(codec.encode(failureReply));
      }
    }
  }
}
