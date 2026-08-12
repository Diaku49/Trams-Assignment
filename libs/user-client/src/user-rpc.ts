// Typed User Service operations built on the generic RPC client.

import {
  authenticatedUserSchema,
  createUserDtoSchema,
  getUserRequestSchema,
  loginDtoSchema,
  rpcResponseSchema,
  subjects,
  updateUserRequestSchema,
  userResponseDtoSchema,
  type AuthenticatedUser,
  type CreateUserDto,
  type GetUserRequest,
  type LoginDto,
  type RpcFailure,
  type RpcSuccess,
  type UpdateUserRequest,
  type UserResponseDto,
} from "@app/contracts";
import { RpcClient, RpcError, type RpcOptions } from "@app/messaging";
import type { ZodTypeAny } from "zod";

export class UserRpcClient {
  constructor(private readonly rpc: RpcClient) {}

  async signUp(
    input: CreateUserDto,
    options: RpcOptions = {},
  ): Promise<UserResponseDto> {
    const request = validate(createUserDtoSchema, input, "INVALID_REQUEST");
    const reply = await this.rpc.request(
      subjects.userRpcCreate,
      request,
      options,
    );

    return unwrapResponse(userResponseDtoSchema, reply);
  }

  async login(
    input: LoginDto,
    options: RpcOptions = {},
  ): Promise<AuthenticatedUser> {
    const request = validate(loginDtoSchema, input, "INVALID_REQUEST");
    const reply = await this.rpc.request(
      subjects.userRpcAuthenticate,
      request,
      options,
    );

    return unwrapResponse(authenticatedUserSchema, reply);
  }

  async getUser(
    input: GetUserRequest,
    options: RpcOptions = {},
  ): Promise<UserResponseDto> {
    const request = validate(getUserRequestSchema, input, "INVALID_REQUEST");
    const reply = await this.rpc.request(
      subjects.userRpcGetById,
      request,
      options,
    );

    return unwrapResponse(userResponseDtoSchema, reply);
  }

  async updateUser(
    input: UpdateUserRequest,
    options: RpcOptions = {},
  ): Promise<UserResponseDto> {
    const request = validate(updateUserRequestSchema, input, "INVALID_REQUEST");
    const reply = await this.rpc.request(
      subjects.userRpcUpdate,
      request,
      options,
    );

    return unwrapResponse(userResponseDtoSchema, reply);
  }
}

function validate<TSchema extends ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  errorCode: "INVALID_REQUEST" | "INVALID_RESPONSE",
): TSchema["_output"] {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new RpcError(
      errorCode === "INVALID_REQUEST"
        ? "RPC request does not match its contract"
        : "RPC reply does not match its contract",
      errorCode,
      result.error.flatten(),
    );
  }

  return result.data;
}

function unwrapResponse<TSchema extends ZodTypeAny>(
  dataSchema: TSchema,
  value: unknown,
): TSchema["_output"] {
  const result = rpcResponseSchema(dataSchema).safeParse(value);

  if (!result.success) {
    throw new RpcError(
      "RPC reply does not match its contract",
      "INVALID_RESPONSE",
      result.error.flatten(),
    );
  }

  const response = result.data as RpcSuccess<TSchema["_output"]> | RpcFailure;

  if (!response.ok) {
    throw new RpcError(response.error.message, "REMOTE_ERROR", response.error);
  }

  return response.data;
}
