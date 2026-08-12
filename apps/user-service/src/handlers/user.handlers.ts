// Concrete User Service request/reply subscriptions. The messaging library
// supplies the NATS connection; this service owns its subjects and contracts.

import {
  authenticatedUserSchema,
  createRpcFailure,
  createRpcSuccess,
  createUserDtoSchema,
  getUserRequestSchema,
  loginDtoSchema,
  natsHeaders,
  subjects,
  updateUserRequestSchema,
  userResponseDtoSchema,
  type AuthenticatedUser,
  type CreateUserDto,
  type LoginDto,
  type RpcFailure,
  type UpdateUserRequest,
  type UserResponseDto,
} from "@app/contracts";
import type { MessagingLogger } from "@app/messaging";
import {
  JSONCodec,
  type Msg,
  type NatsConnection,
  type Subscription,
} from "nats";
import { UserServiceError } from "../errors/user-service.error";

const codec = JSONCodec<unknown>();

export interface UserRpcOperations {
  signUp(input: CreateUserDto): Promise<UserResponseDto>;
  login(input: LoginDto): Promise<AuthenticatedUser>;
  getUser(id: string): Promise<UserResponseDto>;
  updateUser(
    id: string,
    input: Omit<UpdateUserRequest, "id">,
  ): Promise<UserResponseDto>;
}

export function registerUserRpcRoutes(
  connection: NatsConnection,
  users: UserRpcOperations,
  queueGroup: string,
  logger?: MessagingLogger,
): Subscription[] {
  return [
    connection.subscribe(subjects.userRpcHealth, {
      queue: queueGroup,
      callback: (error, message) => {
        if (error) {
          logSubscriptionError(logger, subjects.userRpcHealth, error);
          return;
        }
        respond(message, createRpcSuccess({ status: "ok" }));
        logRouteSuccess(logger, subjects.userRpcHealth, message);
      },
    }),
    connection.subscribe(subjects.userRpcCreate, {
      queue: queueGroup,
      callback: (error, message) => {
        if (error) {
          logSubscriptionError(logger, subjects.userRpcCreate, error);
          return;
        }
        void handleSignUp(message, users, logger);
      },
    }),
    connection.subscribe(subjects.userRpcAuthenticate, {
      queue: queueGroup,
      callback: (error, message) => {
        if (error) {
          logSubscriptionError(logger, subjects.userRpcAuthenticate, error);
          return;
        }
        void handleLogin(message, users, logger);
      },
    }),
    connection.subscribe(subjects.userRpcGetById, {
      queue: queueGroup,
      callback: (error, message) => {
        if (error) {
          logSubscriptionError(logger, subjects.userRpcGetById, error);
          return;
        }
        void handleGetUser(message, users, logger);
      },
    }),
    connection.subscribe(subjects.userRpcUpdate, {
      queue: queueGroup,
      callback: (error, message) => {
        if (error) {
          logSubscriptionError(logger, subjects.userRpcUpdate, error);
          return;
        }
        void handleUpdateUser(message, users, logger);
      },
    }),
  ];
}

async function handleSignUp(
  message: Msg,
  users: UserRpcOperations,
  logger?: MessagingLogger,
): Promise<void> {
  const input = createUserDtoSchema.safeParse(decode(message));

  if (!input.success) {
    respondInvalidRequest(
      message,
      subjects.userRpcCreate,
      input.error.flatten(),
      logger,
    );
    return;
  }

  try {
    const user = userResponseDtoSchema.parse(await users.signUp(input.data));
    respond(message, createRpcSuccess(user));
    logRouteSuccess(logger, subjects.userRpcCreate, message);
  } catch (error) {
    respondWithError(message, subjects.userRpcCreate, error, logger);
  }
}

async function handleLogin(
  message: Msg,
  users: UserRpcOperations,
  logger?: MessagingLogger,
): Promise<void> {
  const input = loginDtoSchema.safeParse(decode(message));

  if (!input.success) {
    respondInvalidRequest(
      message,
      subjects.userRpcAuthenticate,
      input.error.flatten(),
      logger,
    );
    return;
  }

  try {
    const user = authenticatedUserSchema.parse(await users.login(input.data));
    respond(message, createRpcSuccess(user));
    logRouteSuccess(logger, subjects.userRpcAuthenticate, message);
  } catch (error) {
    respondWithError(message, subjects.userRpcAuthenticate, error, logger);
  }
}

async function handleGetUser(
  message: Msg,
  users: UserRpcOperations,
  logger?: MessagingLogger,
): Promise<void> {
  const input = getUserRequestSchema.safeParse(decode(message));

  if (!input.success) {
    respondInvalidRequest(
      message,
      subjects.userRpcGetById,
      input.error.flatten(),
      logger,
    );
    return;
  }

  try {
    const user = userResponseDtoSchema.parse(
      await users.getUser(input.data.id),
    );
    respond(message, createRpcSuccess(user));
    logRouteSuccess(logger, subjects.userRpcGetById, message);
  } catch (error) {
    respondWithError(message, subjects.userRpcGetById, error, logger);
  }
}

async function handleUpdateUser(
  message: Msg,
  users: UserRpcOperations,
  logger?: MessagingLogger,
): Promise<void> {
  const input = updateUserRequestSchema.safeParse(decode(message));

  if (!input.success) {
    respondInvalidRequest(
      message,
      subjects.userRpcUpdate,
      input.error.flatten(),
      logger,
    );
    return;
  }

  try {
    const { id, ...update } = input.data;
    const user = userResponseDtoSchema.parse(
      await users.updateUser(id, update),
    );
    respond(message, createRpcSuccess(user));
    logRouteSuccess(logger, subjects.userRpcUpdate, message);
  } catch (error) {
    respondWithError(message, subjects.userRpcUpdate, error, logger);
  }
}

function decode(message: Msg): unknown {
  try {
    return codec.decode(message.data);
  } catch {
    return undefined;
  }
}

function respond(message: Msg, payload: unknown): void {
  message.respond(codec.encode(payload));
}

function respondInvalidRequest(
  message: Msg,
  subject: string,
  details: unknown,
  logger?: MessagingLogger,
): void {
  const failure = createRpcFailure({
    code: "INVALID_REQUEST",
    message: "RPC request does not match its contract",
    details,
  });
  logRouteError(logger, subject, failure, message);
  respond(message, failure);
}

function respondWithError(
  message: Msg,
  subject: string,
  error: unknown,
  logger?: MessagingLogger,
): void {
  const failure = toRpcFailure(error);
  logRouteError(logger, subject, failure, message, error);
  respond(message, failure);
}

function toRpcFailure(error: unknown): RpcFailure {
  if (error instanceof UserServiceError) {
    return createRpcFailure({ code: error.code, message: error.message });
  }

  return createRpcFailure({
    code: "INTERNAL_ERROR",
    message: "Unable to process User Service request",
  });
}

function logSubscriptionError(
  logger: MessagingLogger | undefined,
  subject: string,
  error: Error,
): void {
  logger?.error(
    { subject, error: error.message },
    "User RPC subscription failed",
  );
}

function logRouteError(
  logger: MessagingLogger | undefined,
  subject: string,
  failure: RpcFailure,
  message: Msg,
  error?: unknown,
): void {
  logger?.warn(
    {
      subject,
      requestId: requestIdFrom(message),
      code: failure.error.code,
      error: error instanceof Error ? error.message : undefined,
    },
    failure.error.message,
  );
}

function logRouteSuccess(
  logger: MessagingLogger | undefined,
  subject: string,
  message: Msg,
): void {
  logger?.info(
    { subject, requestId: requestIdFrom(message) },
    "Handled User Service RPC request",
  );
}

function requestIdFrom(message: Msg): string | undefined {
  return message.headers?.get(natsHeaders.requestId) || undefined;
}
