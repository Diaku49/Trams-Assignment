import assert from "node:assert/strict";
import test from "node:test";
import type { UserCreatedEvent } from "@app/contracts";
import type {
  UserRecord,
  UserRepositoryPort,
} from "../src/repositories/user.repository";
import { UserService } from "../src/services/user.service";
import type { PasswordHasher } from "../src/utils/password";

test("signup hashes the password and creates a safe user.created event", async () => {
  const record: UserRecord = {
    id: "78217e61-4d24-4b9d-8bb5-d19f4d550c97",
    email: "ada@example.com",
    passwordHash: "hashed-password",
    name: "Ada",
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
    updatedAt: new Date("2026-08-12T00:00:00.000Z"),
  };
  let createdEvent: UserCreatedEvent | undefined;
  const repository: UserRepositoryPort = {
    async createUser(data, createEvent): Promise<UserRecord> {
      assert.equal(data.passwordHash, "hashed-password");
      createdEvent = createEvent(record);
      return record;
    },
    async getUser(): Promise<UserRecord | null> {
      return record;
    },
    async getUserByEmail(): Promise<UserRecord | null> {
      return null;
    },
    async updateUser(): Promise<UserRecord> {
      return record;
    },
    async checkHealth(): Promise<void> {},
  };
  const passwords: PasswordHasher = {
    async hash(password): Promise<string> {
      assert.equal(password, "secure-password-123");
      return "hashed-password";
    },
    async verify(): Promise<boolean> {
      return true;
    },
  };

  const response = await new UserService(repository, passwords).signUp({
    email: "ada@example.com",
    password: "secure-password-123",
    name: "Ada",
  });

  assert.equal(response.id, record.id);
  assert.equal("passwordHash" in response, false);
  assert.equal(createdEvent?.type, "user.created");
  assert.equal(createdEvent?.payload.email, record.email);
  assert.equal("passwordHash" in (createdEvent?.payload ?? {}), false);
});
