// Converts NATS RPC failures into client-safe HTTP errors.

import { RpcError } from "@app/messaging";
import { AppError } from "./app-error";

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return new AppError("Internal server error", 500);
  }

  if (error.code === "REMOTE_ERROR") {
    return remoteErrorToAppError(error.details);
  }

  if (error.code === "NO_RESPONDERS" || error.code === "TRANSPORT_ERROR") {
    return new AppError("User Service is temporarily unavailable", 503);
  }

  if (error.code === "TIMEOUT") {
    return new AppError("User Service did not respond in time", 504);
  }

  if (error.code === "INVALID_RESPONSE") {
    return new AppError("User Service returned an invalid response", 502);
  }

  return new AppError(error.message, 400, error.details);
}

function remoteErrorToAppError(details: unknown): AppError {
  const remote = asRemoteError(details);

  if (!remote) {
    return new AppError("User Service returned an invalid error response", 502);
  }

  switch (remote.code) {
    case "INVALID_REQUEST":
      return new AppError(remote.message, 400, remote.details ?? null);
    case "INVALID_CREDENTIALS":
      return new AppError(remote.message, 401);
    case "USER_NOT_FOUND":
      return new AppError(remote.message, 404);
    case "EMAIL_ALREADY_IN_USE":
      return new AppError(remote.message, 409);
    case "INTERNAL_ERROR":
      return new AppError("User Service could not process the request", 502);
  }
}

interface RemoteError {
  code:
    | "INVALID_REQUEST"
    | "INVALID_CREDENTIALS"
    | "USER_NOT_FOUND"
    | "EMAIL_ALREADY_IN_USE"
    | "INTERNAL_ERROR";
  message: string;
  details?: unknown;
}

function asRemoteError(value: unknown): RemoteError | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const { code, message, details } = value as Record<string, unknown>;

  if (
    ![
      "INVALID_REQUEST",
      "INVALID_CREDENTIALS",
      "USER_NOT_FOUND",
      "EMAIL_ALREADY_IN_USE",
      "INTERNAL_ERROR",
    ].includes(String(code)) ||
    typeof message !== "string"
  ) {
    return undefined;
  }

  return { code: code as RemoteError["code"], message, details };
}
