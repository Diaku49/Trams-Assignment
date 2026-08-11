// User Service RPC operations

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
import type { NatsConnection } from 'nats';
import { requestUserService, type RpcOptions, validate } from './rpc';


// Sends a signup request to User Service and validates
export async function signUp(
  connection: NatsConnection,
  input: CreateUserDto,
  options: RpcOptions = {},
): Promise<UserResponseDto> {
  const request = validate(createUserDtoSchema, input, 'INVALID_REQUEST');
  const reply = await requestUserService(
    connection,
    subjects.userRpcCreate,
    request,
    options,
  );

  return validate(userResponseDtoSchema, reply, 'INVALID_RESPONSE');
}

// Sends a login request to User Service
export async function login(
  connection: NatsConnection,
  input: LoginDto,
  options: RpcOptions = {},
): Promise<AuthenticatedUser> {
  const request = validate(loginDtoSchema, input, 'INVALID_REQUEST');
  const reply = await requestUserService(
    connection,
    subjects.userRpcAuthenticate,
    request,
    options,
  );

  return validate(authenticatedUserSchema, reply, 'INVALID_RESPONSE');
}
