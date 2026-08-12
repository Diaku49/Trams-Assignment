// Express app factory: security middleware, routes, error handler. No listen() here.

import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { AppError } from "./errors/app-error";
import { errorHandler } from "./middleware/error-handler.middleware";
import { createRoutes, type GatewayRoutes } from "./routes";

export interface GatewayAppDependencies extends GatewayRoutes {
  corsOrigins: string[];
  logger: Logger;
}

export function createApp(dependencies: GatewayAppDependencies): Express {
  const app = express();

  app.use(
    pinoHttp({
      logger: dependencies.logger,
      genReqId(req, res) {
        const incoming = req.headers["x-request-id"];
        const requestId =
          typeof incoming === "string" &&
          /^[A-Za-z0-9._:-]{1,128}$/.test(incoming.trim())
            ? incoming.trim()
            : randomUUID();
        res.setHeader("x-request-id", requestId);
        return requestId;
      },
      customLogLevel(_req, res, error) {
        if (error || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      customProps(req) {
        return { requestId: String(req.id) };
      },
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
        ],
        censor: "[REDACTED]",
      },
    }),
  );
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
