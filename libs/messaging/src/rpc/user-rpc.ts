// Typed User Service operations built on the generic RPC client.

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
import type { ZodTypeAny } from 'zod';
import { RpcClient, RpcError, type RpcOptions } from './rpc';

export class UserRpcClient {
  constructor(private readonly rpc: RpcClient) {}

  async signUp(
    input: CreateUserDto,
    options: RpcOptions = {},
  ): Promise<UserResponseDto> {
    const request = validate(createUserDtoSchema, input, 'INVALID_REQUEST');
    const reply = await this.rpc.request(
      subjects.userRpcCreate,
      request,
      options,
    );

    return validate(userResponseDtoSchema, reply, 'INVALID_RESPONSE');
  }

  async login(
    input: LoginDto,
    options: RpcOptions = {},
  ): Promise<AuthenticatedUser> {
    const request = validate(loginDtoSchema, input, 'INVALID_REQUEST');
    const reply = await this.rpc.request(
      subjects.userRpcAuthenticate,
      request,
      options,
    );

    return validate(authenticatedUserSchema, reply, 'INVALID_RESPONSE');
  }
}

function validate<TSchema extends ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  errorCode: 'INVALID_REQUEST' | 'INVALID_RESPONSE',
): TSchema['_output'] {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new RpcError(
      errorCode === 'INVALID_REQUEST'
        ? 'RPC request does not match its contract'
        : 'RPC reply does not match its contract',
      errorCode,
      result.error.flatten(),
    );
  }

  return result.data;
}
