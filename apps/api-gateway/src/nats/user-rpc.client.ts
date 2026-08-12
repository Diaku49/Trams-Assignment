// Gateway-owned NATS connection and typed calls to the private User Service.

import {
  authenticatedUserSchema,
  createUserDtoSchema,
  getUserRequestSchema,
  loginDtoSchema,
  natsHeaders,
  rpcResponseSchema,
  subjects,
  updateUserRequestSchema,
  userServiceHealthResponseSchema,
  userResponseDtoSchema,
  type AuthenticatedUser,
  type CreateUserDto,
  type GetUserRequest,
  type LoginDto,
  type RpcFailure,
  type RpcSuccess,
  type UpdateUserRequest,
  type UserResponseDto,
  type UserServiceHealthResponse,
} from "@app/contracts";
import {
  connectNats,
  type MessagingClient,
  type MessagingLogger,
} from "@app/messaging";
import {
  ErrorCode,
  JSONCodec,
  NatsError,
  headers,
  type NatsConnection,
} from "nats";
import type { ZodTypeAny } from "zod";

const codec = JSONCodec<unknown>();
const DEFAULT_RPC_TIMEOUT_MS = 3_000;

export interface GatewayNatsConfig {
  url: string;
  user: string;
  password: string;
  tls: {
    caFile: string;
  };
}

export type UserRpcErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "NO_RESPONDERS"
  | "TIMEOUT"
  | "REMOTE_ERROR"
  | "TRANSPORT_ERROR";

export class UserRpcError extends Error {
  constructor(
    message: string,
    readonly code: UserRpcErrorCode,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "UserRpcError";
  }
}

export interface RpcOptions {
  timeoutMs?: number;
  requestId?: string;
}

/** What Gateway controllers need from User Service. */
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
  health(options?: RpcOptions): Promise<UserServiceHealthResponse>;
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
    tls: config.tls,
    logger,
  });
}

export class UserRpcClient implements UserServiceRpcClient {
  constructor(private readonly connection: NatsConnection) {}

  async signUp(
    input: CreateUserDto,
    options: RpcOptions = {},
  ): Promise<UserResponseDto> {
    return this.call(
      subjects.userRpcCreate,
      validateRequest(createUserDtoSchema, input),
      userResponseDtoSchema,
      options,
    );
  }

  async login(
    input: LoginDto,
    options: RpcOptions = {},
  ): Promise<AuthenticatedUser> {
    return this.call(
      subjects.userRpcAuthenticate,
      validateRequest(loginDtoSchema, input),
      authenticatedUserSchema,
      options,
    );
  }

  async getUser(
    input: GetUserRequest,
    options: RpcOptions = {},
  ): Promise<UserResponseDto> {
    return this.call(
      subjects.userRpcGetById,
      validateRequest(getUserRequestSchema, input),
      userResponseDtoSchema,
      options,
    );
  }

  async updateUser(
    input: UpdateUserRequest,
    options: RpcOptions = {},
  ): Promise<UserResponseDto> {
    return this.call(
      subjects.userRpcUpdate,
      validateRequest(updateUserRequestSchema, input),
      userResponseDtoSchema,
      options,
    );
  }

  async health(options: RpcOptions = {}): Promise<UserServiceHealthResponse> {
    return this.call(
      subjects.userRpcHealth,
      {},
      userServiceHealthResponseSchema,
      options,
    );
  }

  private async call<TSchema extends ZodTypeAny>(
    subject: string,
    payload: unknown,
    responseSchema: TSchema,
    options: RpcOptions,
  ): Promise<TSchema["_output"]> {
    const reply = await request(this.connection, subject, payload, options);
    const parsed = rpcResponseSchema(responseSchema).safeParse(reply);

    if (!parsed.success) {
      throw new UserRpcError(
        "User Service reply does not match its contract",
        "INVALID_RESPONSE",
        parsed.error.flatten(),
      );
    }

    const response = parsed.data as RpcSuccess<TSchema["_output"]> | RpcFailure;

    if (!response.ok) {
      throw new UserRpcError(
        response.error.message,
        "REMOTE_ERROR",
        response.error,
      );
    }

    return response.data;
  }
}

function validateRequest<TSchema extends ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): TSchema["_output"] {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new UserRpcError(
      "User Service request does not match its contract",
      "INVALID_REQUEST",
      result.error.flatten(),
    );
  }

  return result.data;
}

async function request(
  connection: NatsConnection,
  subject: string,
  payload: unknown,
  options: RpcOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new UserRpcError(
      "RPC timeout must be a positive integer in milliseconds",
      "INVALID_REQUEST",
    );
  }

  try {
    const requestHeaders = headers();
    if (options.requestId) {
      requestHeaders.set(natsHeaders.requestId, options.requestId);
    }
    const reply = await connection.request(subject, codec.encode(payload), {
      timeout: timeoutMs,
      headers: requestHeaders,
    });

    try {
      return codec.decode(reply.data);
    } catch (error) {
      throw new UserRpcError(
        "User Service reply is not valid JSON",
        "INVALID_RESPONSE",
        error instanceof Error ? error.message : null,
      );
    }
  } catch (error) {
    if (error instanceof UserRpcError) {
      throw error;
    }

    if (error instanceof NatsError) {
      if (error.code === ErrorCode.NoResponders) {
        throw new UserRpcError(
          "No User Service instance is available",
          "NO_RESPONDERS",
        );
      }

      if (error.code === ErrorCode.Timeout) {
        throw new UserRpcError(
          "User Service did not respond before the timeout",
          "TIMEOUT",
        );
      }
    }

    throw new UserRpcError(
      "User Service RPC request failed",
      "TRANSPORT_ERROR",
      error instanceof Error ? error.message : null,
    );
  }
}
