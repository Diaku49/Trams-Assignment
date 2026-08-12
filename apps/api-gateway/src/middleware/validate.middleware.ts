// Validates request body/params against a shared schema before forwarding.

import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";
import { AppError } from "../errors/app-error";

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(
        new AppError("Request body is invalid", 400, result.error.flatten()),
      );
      return;
    }

    req.body = result.data;
    next();
  };
}

export function validateParams(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      next(
        new AppError(
          "Route parameters are invalid",
          400,
          result.error.flatten(),
        ),
      );
      return;
    }

    req.params = result.data;
    next();
  };
}
