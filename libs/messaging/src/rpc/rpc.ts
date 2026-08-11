// Core-NATS request/reply helpers for the Gateway-to-User-Service hop.

import {
  ErrorCode,
  JSONCodec,
  NatsError,
  type NatsConnection,
} from 'nats';
import type { ZodTypeAny } from 'zod';

const codec = JSONCodec<unknown>();
const DEFAULT_RPC_TIMEOUT_MS = 3_000;

export type RpcErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'NO_RESPONDERS'
  | 'TIMEOUT'
  | 'TRANSPORT_ERROR';

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: RpcErrorCode,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface RpcOptions {
  /** Maximum time to wait for the User Service reply. Defaults to 3 seconds. */
  timeoutMs?: number;
}

export function validate<TSchema extends ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  errorCode: 'INVALID_REQUEST' | 'INVALID_RESPONSE',
): TSchema['_output'] {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new RpcError(
      errorCode === 'INVALID_REQUEST'
        ? 'RPC request does not match its contract'
        : 'User Service RPC reply does not match its contract',
      errorCode,
      result.error.flatten(),
    );
  }

  return result.data;
}

function timeoutFrom(options: RpcOptions): number {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RpcError(
      'RPC timeout must be a positive integer in milliseconds',
      'INVALID_REQUEST',
    );
  }

  return timeoutMs;
}

export async function requestUserService(
  connection: NatsConnection,
  subject: string,
  payload: unknown,
  options: RpcOptions,
): Promise<unknown> {
  try {
    // NATS creates a private reply inbox and resolves with the first response.
    const reply = await connection.request(subject, codec.encode(payload), {
      timeout: timeoutFrom(options),
    });

    try {
      return codec.decode(reply.data);
    } catch (error) {
      throw new RpcError(
        'User Service RPC reply is not valid JSON',
        'INVALID_RESPONSE',
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
          'User Service has no active handler for this request',
          'NO_RESPONDERS',
        );
      }

      if (error.code === ErrorCode.Timeout) {
        throw new RpcError(
          'User Service did not respond before the RPC timeout',
          'TIMEOUT',
        );
      }
    }

    throw new RpcError(
      'NATS request to User Service failed',
      'TRANSPORT_ERROR',
      error instanceof Error ? error.message : null,
    );
  }
}
