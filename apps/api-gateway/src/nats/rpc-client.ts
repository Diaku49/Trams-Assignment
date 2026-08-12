// Gateway-owned NATS connection setup and the User Service port its controllers use.

import type {
  AuthenticatedUser,
  CreateUserDto,
  GetUserRequest,
  LoginDto,
  UpdateUserRequest,
  UserResponseDto,
} from "@app/contracts";
import {
  connectNats,
  type MessagingClient,
  type MessagingLogger,
  type RpcOptions,
} from "@app/messaging";

export interface GatewayNatsConfig {
  url: string;
  user: string;
  password: string;
}

/** Opens API Gateway's one long-lived NATS connection. */
export function connectGatewayNats(
  config: GatewayNatsConfig,
  logger?: MessagingLogger,
): Promise<MessagingClient> {
  return connectNats({
    servers: config.url,
    name: "api-gateway",
    user: config.user,
    password: config.password,
    logger,
  });
}

/**
 * What Gateway controllers need from the private User Service. Declared here, by
 * the consumer, so controllers depend on this rather than on @app/user-client.
 * UserRpcClient satisfies it structurally; tests can supply any stand-in.
 */
export interface UserServiceRpcClient {
  signUp(input: CreateUserDto, options?: RpcOptions): Promise<UserResponseDto>;
  login(input: LoginDto, options?: RpcOptions): Promise<AuthenticatedUser>;
  getUser(
    input: GetUserRequest,
    options?: RpcOptions,
  ): Promise<UserResponseDto>;
  updateUser(
    input: UpdateUserRequest,
    options?: RpcOptions,
  ): Promise<UserResponseDto>;
}
