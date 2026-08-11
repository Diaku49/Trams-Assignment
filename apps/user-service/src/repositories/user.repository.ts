// Prisma persistence for User Service. Password hashes never leave this layer.

import type { PrismaClient } from '../generated/prisma/client';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  name?: string;
}

export interface UpdateUserData {
  email?: string;
  passwordHash?: string;
  /** `null` clears the display name; `undefined` leaves it unchanged. */
  name?: string | null;
}

export type UserDatabase = Pick<PrismaClient, 'user'>;

const userSelect = {
  id: true,
  email: true,
  passwordHash: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Persistence seam used by the future UserService. It accepts only the Prisma
 * delegate it needs, which also makes it straightforward to replace in tests.
 */
export class UserRepository {
  constructor(private readonly database: UserDatabase) {}

  async createUser(data: CreateUserData): Promise<UserRecord> {
    return this.database.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        ...(data.name !== undefined ? { name: data.name } : {}),
      },
      select: userSelect,
    });
  }

  /** Returns `null` when no user exists with this id. */
  async getUser(id: string): Promise<UserRecord | null> {
    return this.database.user.findUnique({
      where: { id },
      select: userSelect,
    });
  }

  /** Used by login. Email has a unique database constraint. */
  async getUserByEmail(email: string): Promise<UserRecord | null> {
    return this.database.user.findUnique({
      where: { email },
      select: userSelect,
    });
  }

  async updateUser(id: string, data: UpdateUserData): Promise<UserRecord> {
    const update = toPrismaUpdateData(data);

    if (Object.keys(update).length === 0) {
      throw new Error('At least one user field is required for an update');
    }

    return this.database.user.update({
      where: { id },
      data: update,
      select: userSelect,
    });
  }
}

function toPrismaUpdateData(data: UpdateUserData): UpdateUserData {
  return {
    ...(data.email !== undefined ? { email: data.email } : {}),
    ...(data.passwordHash !== undefined ? { passwordHash: data.passwordHash } : {}),
    ...(data.name !== undefined ? { name: data.name } : {}),
  };
}
