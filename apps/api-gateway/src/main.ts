// API Gateway composition root: NATS client, JWTs, Express, graceful shutdown.

import type { Server } from "node:http";
import pino from "pino";
import { createApp } from "./app";
import { config } from "./config/env";
import { createAuthController } from "./controllers/auth.controller";
import { createUserController } from "./controllers/user.controller";
import { connectGatewayNats, UserRpcClient } from "./nats/user-rpc.client";
import { JwtService } from "./utils/jwt";

const logger = pino({ name: "api-gateway", level: config.logLevel });

export interface RunningGateway {
  shutdown(): Promise<void>;
}

export async function startGateway(): Promise<RunningGateway> {
  const messaging = await connectGatewayNats(config.nats, logger);
  const users = new UserRpcClient(messaging.nats);
  const tokens = new JwtService(config.jwt);
  const app = createApp({
    auth: createAuthController(users, tokens, config.jwt.expiresIn),
    users: createUserController(users),
    tokens,
    corsOrigins: config.corsOrigins,
  });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "API Gateway is listening");
  });
  let shutdownPromise: Promise<void> | undefined;

  return {
    shutdown(): Promise<void> {
      shutdownPromise ??= shutdownGateway(
        server,
        messaging.drain.bind(messaging),
      );
      return shutdownPromise;
    },
  };
}

async function main(): Promise<void> {
  const gateway = await startGateway();
  const shutdown = (signal: NodeJS.Signals): void => {
    void gateway.shutdown().catch((error) => {
      logger.error({ signal, error: errorMessage(error) }, "Shutdown failed");
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function shutdownGateway(
  server: Server,
  drainNats: () => Promise<void>,
): Promise<void> {
  await closeHttpServer(server);
  await drainNats();
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  logger.fatal({ error: errorMessage(error) }, "API Gateway failed to start");
  process.exitCode = 1;
});
