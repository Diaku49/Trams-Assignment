// Mounts all route modules onto the Express router.

import { Router } from "express";
import type { AuthController } from "../controllers/auth.controller";
import type { UserController } from "../controllers/user.controller";
import type { JwtTokenService } from "../utils/jwt";
import { createAuthRouter } from "./auth.routes";
import { createUserRouter } from "./user.routes";

export interface GatewayRoutes {
  auth: AuthController;
  users: UserController;
  tokens: JwtTokenService;
}

export function createRoutes(dependencies: GatewayRoutes): Router {
  const routes = Router();

  routes.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  routes.use("/auth", createAuthRouter(dependencies.auth));
  routes.use(
    "/users",
    createUserRouter(dependencies.users, dependencies.tokens),
  );

  return routes;
}
