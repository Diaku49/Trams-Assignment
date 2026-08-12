// /users route wiring.

import { getUserRequestSchema, updateUserDtoSchema } from "@app/contracts";
import { Router } from "express";
import type { UserController } from "../controllers/user.controller";
import { requireAuth } from "../middleware/auth.middleware";
import {
  validateBody,
  validateParams,
} from "../middleware/validate.middleware";
import type { JwtTokenService } from "../utils/jwt";

export function createUserRouter(
  controller: UserController,
  tokens: JwtTokenService,
): Router {
  const router = Router();

  router.use(requireAuth(tokens));
  router.get("/:id", validateParams(getUserRequestSchema), controller.getUser);
  router.put(
    "/:id",
    validateParams(getUserRequestSchema),
    validateBody(updateUserDtoSchema),
    controller.updateUser,
  );

  return router;
}
