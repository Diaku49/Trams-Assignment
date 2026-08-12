// Public auth endpoints: User Service checks credentials; Gateway issues JWTs.

import {
  loginResponseDtoSchema,
  type CreateUserDto,
  type LoginDto,
} from "@app/contracts";
import type { RequestHandler } from "express";
import { toAppError } from "../errors/rpc-error.mapper";
import type { UserServiceRpcClient } from "../nats/user-rpc.client";
import type { JwtTokenService } from "../utils/jwt";

export interface AuthController {
  signUp: RequestHandler;
  login: RequestHandler;
}

export function createAuthController(
  users: UserServiceRpcClient,
  tokens: JwtTokenService,
  tokenExpiresIn: string,
): AuthController {
  return {
    signUp: async (req, res, next) => {
      try {
        const user = await users.signUp(req.body as CreateUserDto, {
          requestId: String(req.id),
        });
        res.status(201).json(user);
      } catch (error) {
        next(toAppError(error));
      }
    },
    login: async (req, res, next) => {
      try {
        const user = await users.login(req.body as LoginDto, {
          requestId: String(req.id),
        });
        const response = loginResponseDtoSchema.parse({
          accessToken: tokens.sign(user),
          tokenType: "Bearer",
          expiresIn: tokenExpiresIn,
          user,
        });
        res.json(response);
      } catch (error) {
        next(toAppError(error));
      }
    },
  };
}
