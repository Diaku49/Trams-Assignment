import { PrismaPg } from "@prisma/adapter-pg";
import {
  connectNats,
  type MessagingClient,
  type MessagingLogger,
} from "@app/messaging";
import type { Subscription } from "nats";
import pino from "pino";
import { config } from "./config/env";
import { userEventsStream } from "./events/user-events.stream";
import { PrismaClient } from "./generated/prisma/client";
import { registerUserRpcRoutes } from "./handlers/user.handlers";
import { OutboxRelay } from "./outbox/outbox.relay";
import { OutboxRepository } from "./outbox/outbox.repository";
import { UserRepository } from "./repositories/user.repository";
import { UserService } from "./services/user.service";
import { BcryptPasswordHasher } from "./utils/password";

const logger = pino({
  name: "user-service",
  level: config.logLevel,
});

export interface RunningUserService {
  messaging: MessagingClient;
  subscriptions: Subscription[];
  shutdown(): Promise<void>;
}

// Starts the User Service's transport and persistence dependencies.
export async function startUserService(): Promise<RunningUserService> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  let messaging: MessagingClient | undefined;
  let outboxRelay: OutboxRelay | undefined;

  try {
    // Connect to PostgreSQL database
    await prisma.$connect();
    logger.info("Connected to PostgreSQL");

    // Connect to NATS messaging server
    const connectedMessaging = await connectNats({
      servers: config.nats.url,
      name: "user-service",
      user: config.nats.user,
      password: config.nats.password,
      logger,
    });
    messaging = connectedMessaging;
    await connectedMessaging.streams.ensure(userEventsStream);

    // Initialize the service components
    const repository = new UserRepository(prisma);
    const passwords = new BcryptPasswordHasher(config.passwordSaltRounds);
    const runningOutboxRelay = new OutboxRelay(
      new OutboxRepository(prisma),
      connectedMessaging.publisher,
      logger,
    );
    outboxRelay = runningOutboxRelay;
    const users = new UserService(repository, passwords);
    const subscriptions = registerUserRpcRoutes(
      connectedMessaging,
      users,
      logger,
    );
    runningOutboxRelay.start();
    let shutdownPromise: Promise<void> | undefined;

    logger.info(
      {
        subjects: [
          "user.rpc.create",
          "user.rpc.authenticate",
          "user.rpc.get-by-id",
          "user.rpc.update",
        ],
      },
      "User Service is ready for RPC requests",
    );

    return {
      messaging: connectedMessaging,
      subscriptions,
      shutdown(): Promise<void> {
        shutdownPromise ??= drainUserService(
          subscriptions,
          runningOutboxRelay,
          connectedMessaging,
          prisma,
          logger,
        );
        return shutdownPromise;
      },
    };
  } catch (error) {
    await Promise.allSettled([
      outboxRelay?.stop() ?? Promise.resolve(),
      messaging?.drain() ?? Promise.resolve(),
      prisma.$disconnect(),
    ]);
    throw error;
  }
}

// main cycle
async function main(): Promise<void> {
  const service = await startUserService();
  const shutdown = (signal: NodeJS.Signals): void => {
    void service.shutdown().catch((error) => {
      logger.error({ signal, error: errorMessage(error) }, "Shutdown failed");
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

// Cleans up the service's subscriptions, messaging connection, and database connection.
async function drainUserService(
  subscriptions: Subscription[],
  outboxRelay: OutboxRelay,
  messaging: MessagingClient,
  prisma: PrismaClient,
  logger?: MessagingLogger,
): Promise<void> {
  logger?.info({}, "Draining User Service RPC subscriptions");

  try {
    await Promise.all(
      subscriptions.map((subscription) => subscription.drain()),
    );
    await outboxRelay.stop();
  } finally {
    try {
      await messaging.drain();
    } finally {
      await prisma.$disconnect();
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  logger.fatal({ error: errorMessage(error) }, "User Service failed to start");
  process.exitCode = 1;
});
