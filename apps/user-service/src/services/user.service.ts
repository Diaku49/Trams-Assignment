// User business logic: persistence, password hashing, and domain events.

import { randomUUID } from 'node:crypto';
import type {
  AuthenticatedUser,
  CreateUserDto,
  LoginDto,
  UpdateUserDto,
  UserCreatedEvent,
  UserResponseDto,
} from '@app/contracts';

import { UserServiceError } from '../errors/user-service.error';

import type {
  CreateUserData,
  UpdateUserData,
  UserRecord,
  UserRepositoryPort,
} from '../repositories/user.repository';

import type { PasswordHasher } from '../utils/password';


export interface UserCreatedEventPublisher {
  created(event: UserCreatedEvent): Promise<unknown>;
}

export class UserService {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly passwords: PasswordHasher,
    private readonly events: UserCreatedEventPublisher,
  ) {}

  async signUp(input: CreateUserDto): Promise<UserResponseDto> {
    const existing = await this.users.getUserByEmail(input.email);

    if (existing) {
      throw new UserServiceError(
        'A user with this email already exists',
        'EMAIL_ALREADY_IN_USE',
      );
    }

    const passwordHash = await this.passwords.hash(input.password);
    let user: UserRecord;

    try {
      user = await this.users.createUser(
        createUserData(input, passwordHash),
      );
    } catch (error) {
      if (isUniqueEmailError(error)) {
        throw new UserServiceError(
          'A user with this email already exists',
          'EMAIL_ALREADY_IN_USE',
        );
      }

      throw error;
    }

    await this.events.created(toUserCreatedEvent(user));
    return toUserResponse(user);
  }

  async login(input: LoginDto): Promise<AuthenticatedUser> {
    const user = await this.users.getUserByEmail(input.email);

    if (!user || !(await this.passwords.verify(input.password, user.passwordHash))) {
      throw new UserServiceError(
        'Invalid email or password',
        'INVALID_CREDENTIALS',
      );
    }

    return toAuthenticatedUser(user);
  }

  async getUser(id: string): Promise<UserResponseDto> {
    return toUserResponse(await this.requireUser(id));
  }

  async updateUser(
    id: string,
    input: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const passwordHash =
      input.password === undefined
        ? undefined
        : await this.passwords.hash(input.password);

    try {
      const user = await this.users.updateUser(
        id,
        updateUserData(input, passwordHash),
      );
      return toUserResponse(user);
    } catch (error) {
      if (isUniqueEmailError(error)) {
        throw new UserServiceError(
          'A user with this email already exists',
          'EMAIL_ALREADY_IN_USE',
        );
      }

      if (isRecordNotFoundError(error)) {
        throw new UserServiceError('User not found', 'USER_NOT_FOUND');
      }

      throw error;
    }
  }

  private async requireUser(id: string): Promise<UserRecord> {
    const user = await this.users.getUser(id);

    if (!user) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    return user;
  }
}

function createUserData(
  input: CreateUserDto,
  passwordHash: string,
): CreateUserData {
  return {
    email: input.email,
    passwordHash,
    ...(input.name !== undefined ? { name: input.name } : {}),
  };
}

function updateUserData(
  input: UpdateUserDto,
  passwordHash: string | undefined,
): UpdateUserData {
  return {
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(passwordHash !== undefined ? { passwordHash } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
  };
}

function toUserResponse(user: UserRecord): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function toAuthenticatedUser(user: UserRecord): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

function toUserCreatedEvent(user: UserRecord): UserCreatedEvent {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    type: 'user.created',
    payload: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    },
  };
}

function isUniqueEmailError(error: unknown): boolean {
  return getPrismaErrorCode(error) === 'P2002';
}

function isRecordNotFoundError(error: unknown): boolean {
  return getPrismaErrorCode(error) === 'P2025';
}

function getPrismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}
