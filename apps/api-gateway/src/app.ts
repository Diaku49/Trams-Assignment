// Express app factory: security middleware, routes, error handler. No listen() here.

import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { AppError } from "./errors/app-error";
import { errorHandler } from "./middleware/error-handler.middleware";
import { createRoutes, type GatewayRoutes } from "./routes";

export interface GatewayAppDependencies extends GatewayRoutes {
  corsOrigins: string[];
}

export function createApp(dependencies: GatewayAppDependencies): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin:
        dependencies.corsOrigins.length > 0 ? dependencies.corsOrigins : false,
    }),
  );
  app.use(express.json({ limit: "16kb" }));

  app.use("/api", createRoutes(dependencies));

  app.use((_req, _res, next) => {
    next(new AppError("Route not found", 404));
  });

  // Must be last.
  app.use(errorHandler);

  return app;
}
