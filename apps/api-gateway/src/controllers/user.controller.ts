// Protected user endpoints forwarded to User Service over NATS request/reply.

import type {
  GetUserRequest,
  UpdateUserDto,
  UpdateUserRequest,
} from "@app/contracts";
import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error";
import { toAppError } from "../errors/rpc-error.mapper";
import type { UserServiceRpcClient } from "../nats/rpc-client";

export interface UserController {
  getUser: RequestHandler;
  updateUser: RequestHandler;
}

export function createUserController(
  users: UserServiceRpcClient,
): UserController {
  return {
    getUser: async (req, res, next) => {
      try {
        const input = req.params as GetUserRequest;
        requireSelf(req.auth?.sub, input.id);
        const user = await users.getUser(input);
        res.json(user);
      } catch (error) {
        next(toAppError(error));
      }
    },
    updateUser: async (req, res, next) => {
      try {
        const { id } = req.params as GetUserRequest;
        requireSelf(req.auth?.sub, id);
        const input: UpdateUserRequest = { id, ...(req.body as UpdateUserDto) };
        const user = await users.updateUser(input);
        res.json(user);
      } catch (error) {
        next(toAppError(error));
      }
    },
  };
}

function requireSelf(subject: string | undefined, userId: string): void {
  if (subject !== userId) {
    throw new AppError("You cannot access another user", 403);
  }
}
