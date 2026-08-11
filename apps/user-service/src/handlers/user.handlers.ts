// Subscribes to User Service RPC subjects and dispatches validated input.

import {
  authenticatedUserSchema,
  createUserDtoSchema,
  loginDtoSchema,
  subjects,
  userResponseDtoSchema,
  type AuthenticatedUser,
  type CreateUserDto,
  type LoginDto,
  type UserResponseDto,
} from '@app/contracts';
import type { MessagingClient, MessagingLogger } from '@app/messaging';
import type { Subscription } from 'nats';

export interface UserRpcOperations {
  signUp(input: CreateUserDto): Promise<UserResponseDto>;
  login(input: LoginDto): Promise<AuthenticatedUser>;
}

export function registerUserRpcRoutes(
  messaging: MessagingClient,
  users: UserRpcOperations,
  logger?: MessagingLogger,
): Subscription[] {
  return [
    messaging.rpc.respond(
      subjects.userRpcCreate,
      async (payload) => {
        const input = createUserDtoSchema.parse(payload);
        const user = await users.signUp(input);
        return userResponseDtoSchema.parse(user);
      },
      { onError: createErrorLogger(logger, subjects.userRpcCreate) },
    ),
    messaging.rpc.respond(
      subjects.userRpcAuthenticate,
      async (payload) => {
        const input = loginDtoSchema.parse(payload);
        const user = await users.login(input);
        return authenticatedUserSchema.parse(user);
      },
      { onError: createErrorLogger(logger, subjects.userRpcAuthenticate) },
    ),
  ];
}

function createErrorLogger(
  logger: MessagingLogger | undefined,
  subject: string,
): (error: unknown) => void {
  return (error) => {
    logger?.warn(
      {
        subject,
        error: error instanceof Error ? error.message : String(error),
      },
      'User RPC request failed',
    );
  };
}
