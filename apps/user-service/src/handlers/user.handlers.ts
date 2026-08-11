// Subscribes to User Service RPC subjects and dispatches validated input.

import {
  authenticatedUserSchema,
  createRpcFailure,
  createRpcSuccess,
  createUserDtoSchema,
  getUserRequestSchema,
  loginDtoSchema,
  subjects,
  updateUserRequestSchema,
  userResponseDtoSchema,
  type AuthenticatedUser,
  type CreateUserDto,
  type RpcFailure,
  type LoginDto,
  type UpdateUserRequest,
  type UserResponseDto,
} from "@app/contracts";
import type { MessagingClient, MessagingLogger } from "@app/messaging";
import type { Subscription } from "nats";
import type { ZodType } from "zod";
import { UserServiceError } from "../errors/user-service.error";

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
  messaging: MessagingClient,
  users: UserRpcOperations,
  logger?: MessagingLogger,
): Subscription[] {
  return [
    messaging.rpc.respond(
      subjects.userRpcCreate,
      createRoute(
        subjects.userRpcCreate,
        createUserDtoSchema,
        userResponseDtoSchema,
        (input) => users.signUp(input),
        logger,
      ),
      { onError: createErrorResponder(logger, subjects.userRpcCreate) },
    ),
    messaging.rpc.respond(
      subjects.userRpcAuthenticate,
      createRoute(
        subjects.userRpcAuthenticate,
        loginDtoSchema,
        authenticatedUserSchema,
        (input) => users.login(input),
        logger,
      ),
      { onError: createErrorResponder(logger, subjects.userRpcAuthenticate) },
    ),
    messaging.rpc.respond(
      subjects.userRpcGetById,
      createRoute(
        subjects.userRpcGetById,
        getUserRequestSchema,
        userResponseDtoSchema,
        (input) => users.getUser(input.id),
        logger,
      ),
      { onError: createErrorResponder(logger, subjects.userRpcGetById) },
    ),
    messaging.rpc.respond(
      subjects.userRpcUpdate,
      createRoute(
        subjects.userRpcUpdate,
        updateUserRequestSchema,
        userResponseDtoSchema,
        ({ id, ...input }) => users.updateUser(id, input),
        logger,
      ),
      { onError: createErrorResponder(logger, subjects.userRpcUpdate) },
    ),
  ];
}

function createRoute<TInput, TOutput>(
  subject: string,
  requestSchema: ZodType<TInput>,
  responseSchema: ZodType<TOutput>,
  operation: (input: TInput) => Promise<TOutput>,
  logger?: MessagingLogger,
): (payload: unknown) => Promise<unknown> {
  return async (payload) => {
    const request = requestSchema.safeParse(payload);

    if (!request.success) {
      const error = createRpcFailure({
        code: "INVALID_REQUEST",
        message: "RPC request does not match its contract",
        details: request.error.flatten(),
      });
      logRouteError(logger, subject, error);
      return error;
    }

    try {
      const result = await operation(request.data);
      const response = responseSchema.safeParse(result);

      if (!response.success) {
        const error = createRpcFailure({
          code: "INTERNAL_ERROR",
          message: "User Service produced an invalid RPC response",
        });
        logger?.error(
          { subject, details: response.error.flatten() },
          "User RPC response failed validation",
        );
        return error;
      }

      return createRpcSuccess(response.data);
    } catch (error) {
      const failure = toRpcFailure(error);
      logRouteError(logger, subject, failure, error);
      return failure;
    }
  };
}

function createErrorResponder(
  logger: MessagingLogger | undefined,
  subject: string,
): (error: unknown) => RpcFailure {
  return (error) => {
    const failure = toRpcFailure(error);
    logRouteError(logger, subject, failure, error);
    return failure;
  };
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

function logRouteError(
  logger: MessagingLogger | undefined,
  subject: string,
  failure: RpcFailure,
  error?: unknown,
): void {
  logger?.warn(
    {
      subject,
      code: failure.error.code,
      error: error instanceof Error ? error.message : undefined,
    },
    failure.error.message,
  );
}
