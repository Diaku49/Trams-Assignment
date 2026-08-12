// Verifies the JWT bearer token and attaches the caller to the request.

import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error";
import type { AccessTokenClaims, JwtTokenService } from "../utils/jwt";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

export function requireAuth(tokens: JwtTokenService): RequestHandler {
  return (req, _res, next) => {
    const token = readBearerToken(req.headers.authorization);

    if (!token) {
      next(new AppError("A bearer token is required", 401));
      return;
    }

    try {
      req.auth = tokens.verify(token);
      next();
    } catch {
      next(new AppError("Bearer token is invalid or expired", 401));
    }
  };
}

function readBearerToken(value: string | undefined): string | undefined {
  const [scheme, token] = value?.split(" ") ?? [];
  return scheme === "Bearer" && token ? token : undefined;
}
