import assert from "node:assert/strict";
import test from "node:test";
import type { UserCreatedEvent } from "@app/contracts";
import { UserServiceError } from "../src/errors/user-service.error";
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

test("login verifies the stored password and returns only authentication claims", async () => {
  const record = userRecord();
  let verifiedPassword: string | undefined;
  let verifiedHash: string | undefined;
  const passwords: PasswordHasher = {
    async hash(): Promise<string> {
      return "unused";
    },
    async verify(password, hash): Promise<boolean> {
      verifiedPassword = password;
      verifiedHash = hash;
      return true;
    },
  };

  const result = await new UserService(
    userRepository({
      async getUserByEmail(): Promise<UserRecord> {
        return record;
      },
    }),
    passwords,
  ).login({ email: record.email, password: "secure-password-123" });

  assert.deepEqual(result, {
    id: record.id,
    email: record.email,
    name: record.name,
  });
  assert.equal(verifiedPassword, "secure-password-123");
  assert.equal(verifiedHash, record.passwordHash);
  assert.equal("passwordHash" in result, false);
});

test("login rejects invalid credentials without revealing whether the user exists", async () => {
  const passwords: PasswordHasher = {
    async hash(): Promise<string> {
      return "unused";
    },
    async verify(): Promise<boolean> {
      return false;
    },
  };

  await assert.rejects(
    new UserService(userRepository(), passwords).login({
      email: "missing@example.com",
      password: "wrong-password",
    }),
    (error: unknown) =>
      error instanceof UserServiceError &&
      error.code === "INVALID_CREDENTIALS" &&
      error.message === "Invalid email or password",
  );
});

test("updateUser hashes a changed password before passing it to the repository", async () => {
  const record = userRecord();
  let receivedPasswordHash: string | undefined;
  const repository = userRepository({
    async updateUser(_id, data): Promise<UserRecord> {
      receivedPasswordHash = data.passwordHash;
      return { ...record, name: data.name ?? record.name };
    },
  });
  const passwords: PasswordHasher = {
    async hash(password): Promise<string> {
      assert.equal(password, "new-secure-password");
      return "new-password-hash";
    },
    async verify(): Promise<boolean> {
      return false;
    },
  };

  const result = await new UserService(repository, passwords).updateUser(
    record.id,
    { password: "new-secure-password", name: "Updated Ada" },
  );

  assert.equal(receivedPasswordHash, "new-password-hash");
  assert.equal(result.name, "Updated Ada");
  assert.equal("passwordHash" in result, false);
});

function userRecord(): UserRecord {
  return {
    id: "78217e61-4d24-4b9d-8bb5-d19f4d550c97",
    email: "ada@example.com",
    passwordHash: "stored-password-hash",
    name: "Ada",
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
    updatedAt: new Date("2026-08-12T00:00:00.000Z"),
  };
}

function userRepository(
  overrides: Partial<UserRepositoryPort> = {},
): UserRepositoryPort {
  const record = userRecord();

  return {
    async createUser(): Promise<UserRecord> {
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
    ...overrides,
  };
}
