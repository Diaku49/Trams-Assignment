// Mounts all route modules onto the Express router.

import { Router, type RequestHandler } from "express";
import type { AuthController } from "../controllers/auth.controller";
import type { UserController } from "../controllers/user.controller";
import type { JwtTokenService } from "../utils/jwt";
import type { UserServiceRpcClient } from "../nats/user-rpc.client";
import { createAuthRouter } from "./auth.routes";
import { createUserRouter } from "./user.routes";

export interface GatewayRoutes {
  auth: AuthController;
  users: UserController;
  tokens: JwtTokenService;
  readiness: Pick<UserServiceRpcClient, "health">;
}

export function createRoutes(dependencies: GatewayRoutes): Router {
  const routes = Router();

  routes.get("/health/live", (_req, res) => {
    res.json({ status: "ok", check: "liveness" });
  });

  const readiness: RequestHandler = async (req, res) => {
    try {
      await dependencies.readiness.health({
        timeoutMs: 1_000,
        requestId: String(req.id),
      });
      res.json({ status: "ok", check: "readiness" });
    } catch (error) {
      req.log.warn({ err: error }, "API Gateway readiness check failed");
      res.status(503).json({
        status: "unavailable",
        check: "readiness",
        dependencies: { natsAndUserService: "unavailable" },
      });
    }
  };

  routes.get("/health/ready", readiness);
  // Compatibility alias: unlike before, this now performs a real readiness check.
  routes.get("/health", readiness);

  routes.use("/auth", createAuthRouter(dependencies.auth));
  routes.use(
    "/users",
    createUserRouter(dependencies.users, dependencies.tokens),
  );

  return routes;
}
