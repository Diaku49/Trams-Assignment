// Public authentication route wiring.

import { createUserDtoSchema, loginDtoSchema } from "@app/contracts";
import { Router } from "express";
import type { AuthController } from "../controllers/auth.controller";
import { authRateLimit } from "../middleware/rate-limit.middleware";
import { validateBody } from "../middleware/validate.middleware";

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  router.post(
    "/signup",
    authRateLimit,
    validateBody(createUserDtoSchema),
    controller.signUp,
  );
  router.post(
    "/login",
    authRateLimit,
    validateBody(loginDtoSchema),
    controller.login,
  );

  return router;
}
