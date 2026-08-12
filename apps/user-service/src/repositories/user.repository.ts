// Prisma persistence for User Service. Password hashes never leave this layer.

import { subjects, type UserCreatedEvent } from "@app/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client";

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
  name?: string | null;
}

export interface UserRepositoryPort {
  createUser(
    data: CreateUserData,
    createEvent: (user: UserRecord) => UserCreatedEvent,
  ): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  updateUser(id: string, data: UpdateUserData): Promise<UserRecord>;
}

export type UserDatabase = PrismaClient;

const userSelect = {
  id: true,
  email: true,
  passwordHash: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class UserRepository implements UserRepositoryPort {
  constructor(private readonly database: UserDatabase) {}

  /** Atomically commits the user and the event that must follow that write. */
  async createUser(
    data: CreateUserData,
    createEvent: (user: UserRecord) => UserCreatedEvent,
  ): Promise<UserRecord> {
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: toPrismaCreateData(data),
        select: userSelect,
      });
      const event = createEvent(user);

      await transaction.outboxEvent.create({
        data: {
          id: event.eventId,
          subject: subjects.userCreated,
          payload: toJsonPayload(event),
        },
      });

      return user;
    });
  }

  async getUser(id: string): Promise<UserRecord | null> {
    return this.database.user.findUnique({
      where: { id },
      select: userSelect,
    });
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    return this.database.user.findUnique({
      where: { email },
      select: userSelect,
    });
  }

  async updateUser(id: string, data: UpdateUserData): Promise<UserRecord> {
    const update = toPrismaUpdateData(data);

    if (Object.keys(update).length === 0) {
      throw new Error("At least one user field is required for an update");
    }

    return this.database.user.update({
      where: { id },
      data: update,
      select: userSelect,
    });
  }
}

function toPrismaCreateData(data: CreateUserData): CreateUserData {
  return {
    email: data.email,
    passwordHash: data.passwordHash,
    ...(data.name !== undefined ? { name: data.name } : {}),
  };
}

function toPrismaUpdateData(data: UpdateUserData): UpdateUserData {
  return {
    ...(data.email !== undefined ? { email: data.email } : {}),
    ...(data.passwordHash !== undefined
      ? { passwordHash: data.passwordHash }
      : {}),
    ...(data.name !== undefined ? { name: data.name } : {}),
  };
}

function toJsonPayload(event: UserCreatedEvent): Prisma.InputJsonObject {
  return {
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    type: event.type,
    payload: {
      id: event.payload.id,
      email: event.payload.email,
      name: event.payload.name,
      createdAt: event.payload.createdAt,
    },
  };
}
