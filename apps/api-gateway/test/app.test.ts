import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthenticatedUser,
  UserResponseDto,
  UserServiceHealthResponse,
} from "@app/contracts";
import pino from "pino";
import request from "supertest";
import { createApp } from "../src/app";
import { createAuthController } from "../src/controllers/auth.controller";
import { createUserController } from "../src/controllers/user.controller";
import type {
  RpcOptions,
  UserServiceRpcClient,
} from "../src/nats/user-rpc.client";
import { JwtService } from "../src/utils/jwt";

const user: UserResponseDto = {
  id: "78217e61-4d24-4b9d-8bb5-d19f4d550c97",
  email: "ada@example.com",
  name: "Ada",
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

test("signup validates input and forwards a valid request with its request ID", async () => {
  let forwardedRequestId: string | undefined;
  const users: UserServiceRpcClient = {
    async signUp(_input, options): Promise<UserResponseDto> {
      forwardedRequestId = options?.requestId;
      return user;
    },
    async login(): Promise<AuthenticatedUser> {
      return { id: user.id, email: user.email, name: user.name };
    },
    async getUser(): Promise<UserResponseDto> {
      return user;
    },
    async updateUser(): Promise<UserResponseDto> {
      return user;
    },
    async health(_options?: RpcOptions): Promise<UserServiceHealthResponse> {
      return { status: "ok" };
    },
  };
  const tokens = new JwtService({ secret: "t".repeat(32), expiresIn: "15m" });
  const app = createApp({
    auth: createAuthController(users, tokens, "15m"),
    users: createUserController(users),
    tokens,
    readiness: users,
    corsOrigins: [],
    logger: pino({ level: "silent" }),
  });

  const invalid = await request(app)
    .post("/api/auth/signup")
    .send({ email: "not-an-email", password: "short" });
  assert.equal(invalid.status, 400);

  const valid = await request(app)
    .post("/api/auth/signup")
    .set("x-request-id", "signup-test")
    .send({
      email: "ada@example.com",
      password: "secure-password-123",
      name: "Ada",
    });

  assert.equal(valid.status, 201);
  assert.deepEqual(valid.body, user);
  assert.equal(valid.headers["x-request-id"], "signup-test");
  assert.equal(forwardedRequestId, "signup-test");
});
