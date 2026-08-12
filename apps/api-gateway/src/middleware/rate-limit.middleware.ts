// Basic rate limiting on public authentication endpoints.

import rateLimit from "express-rate-limit";
import { AppError } from "../errors/app-error";

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError("Too many authentication attempts", 429));
  },
});
