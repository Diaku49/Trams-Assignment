// Shared request/reply response envelope for NATS RPC operations.

import { z } from "zod";

export const rpcRemoteErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "EMAIL_ALREADY_IN_USE",
  "INVALID_CREDENTIALS",
  "USER_NOT_FOUND",
  "INTERNAL_ERROR",
]);

export type RpcRemoteErrorCode = z.infer<typeof rpcRemoteErrorCodeSchema>;

export interface RpcFailure {
  ok: false;
  error: {
    code: RpcRemoteErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface RpcSuccess<T> {
  ok: true;
  data: T;
}

export const rpcFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: rpcRemoteErrorCodeSchema,
        message: z.string().min(1),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

export function rpcResponseSchema<TSchema extends z.ZodTypeAny>(
  dataSchema: TSchema,
) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data: dataSchema }).strict(),
    rpcFailureSchema,
  ]);
}

export function createRpcSuccess<T>(data: T): RpcSuccess<T> {
  return { ok: true, data };
}

export function createRpcFailure(error: RpcFailure["error"]): RpcFailure {
  return { ok: false, error };
}
