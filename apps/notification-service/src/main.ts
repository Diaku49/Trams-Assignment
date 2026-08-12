// Notification Service composition root. Its health probe binds to loopback only.

import { PrismaPg } from "@prisma/adapter-pg";
import { createServer, type Server, type ServerResponse } from "node:http";
import {
  connectNats,
  type MessagingClient,
  type StartedDurableConsumer,
} from "@app/messaging";
import pino from "pino";
import { ConsoleNotificationChannel } from "./channels/console.channel";
import { config } from "./config/env";
import { UserEventsConsumer } from "./consumers/user-events.consumer";
import { PrismaClient } from "./generated/prisma/client";
import { NotificationDeliveryRepository } from "./repositories/notification-delivery.repository";
import { NotificationService } from "./services/notification.service";

const logger = pino({
  name: "notification-service",
  level: config.logLevel,
});

export interface RunningNotificationService {
  messaging: MessagingClient;
  consumer: StartedDurableConsumer;
  isReady(): Promise<void>;
  shutdown(): Promise<void>;
}

export async function startNotificationService(): Promise<RunningNotificationService> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  let messaging: MessagingClient | undefined;
  let consumer: StartedDurableConsumer | undefined;
  let healthServer: Server | undefined;

  try {
    await prisma.$connect();
    logger.info("Connected to Notification Service PostgreSQL database");

    const connectedMessaging = await connectNats({
      servers: config.nats.url,
      name: "notification-service",
      user: config.nats.user,
      password: config.nats.password,
      tls: config.nats.tls,
      logger,
    });
    messaging = connectedMessaging;

    const notifications = new NotificationService(
      new ConsoleNotificationChannel(logger),
      new NotificationDeliveryRepository(prisma),
      logger,
      { leaseDurationMs: config.deliveryLeaseMs },
    );
    const startedConsumer = await new UserEventsConsumer(
      connectedMessaging,
    ).startCreated(config.consumer, (event) =>
      notifications.handleUserCreated(event),
    );
    consumer = startedConsumer;
    const isReady = (): Promise<void> =>
      assertNotificationReadiness(prisma, connectedMessaging, startedConsumer);
    const startedHealthServer = await startHealthServer(
      config.healthPort,
      isReady,
    );
    healthServer = startedHealthServer;
    let shutdownPromise: Promise<void> | undefined;

    logger.info(
      {
        durableName: startedConsumer.durableName,
        healthPort: config.healthPort,
      },
      "Notification Service is ready for user.created events",
    );

    return {
      messaging,
      consumer: startedConsumer,
      isReady,
      shutdown(): Promise<void> {
        shutdownPromise ??= shutdownNotificationService(
          startedHealthServer,
          startedConsumer,
          connectedMessaging,
          prisma,
        );
        return shutdownPromise;
      },
    };
  } catch (error) {
    await Promise.allSettled([
      healthServer ? closeHttpServer(healthServer) : Promise.resolve(),
      consumer?.messages.close() ?? Promise.resolve(),
      messaging?.drain() ?? Promise.resolve(),
      prisma.$disconnect(),
    ]);
    throw error;
  }
}

async function main(): Promise<void> {
  const service = await startNotificationService();
  const shutdown = (signal: NodeJS.Signals): void => {
    void service.shutdown().catch((error) => {
      logger.error({ signal, error: errorMessage(error) }, "Shutdown failed");
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function shutdownNotificationService(
  healthServer: Server,
  consumer: StartedDurableConsumer,
  messaging: MessagingClient,
  prisma: PrismaClient,
): Promise<void> {
  logger.info(
    { durableName: consumer.durableName },
    "Stopping Notification Service consumer",
  );

  try {
    await closeHttpServer(healthServer);
    await consumer.messages.close();
  } finally {
    try {
      await messaging.drain();
    } finally {
      await prisma.$disconnect();
    }
  }
}

async function assertNotificationReadiness(
  prisma: PrismaClient,
  messaging: MessagingClient,
  consumer: StartedDurableConsumer,
): Promise<void> {
  if (!consumer.isRunning()) {
    throw new Error("Notification JetStream consumer is not running");
  }

  await Promise.all([
    withTimeout(prisma.$queryRaw`SELECT 1`, 1_000, "Notification database"),
    messaging.ping(1_000),
  ]);
}

function startHealthServer(
  port: number,
  isReady: () => Promise<void>,
): Promise<Server> {
  const server = createServer((request, response) => {
    void handleHealthRequest(request.url, response, isReady);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      logger.info({ port }, "Notification health probe is listening locally");
      resolve(server);
    });
  });
}

async function handleHealthRequest(
  url: string | undefined,
  response: ServerResponse,
  isReady: () => Promise<void>,
): Promise<void> {
  if (url === "/health/live") {
    respondJson(response, 200, { status: "ok", check: "liveness" });
    return;
  }

  if (url !== "/health/ready") {
    respondJson(response, 404, { status: "not_found" });
    return;
  }

  try {
    await isReady();
    respondJson(response, 200, { status: "ok", check: "readiness" });
  } catch (error) {
    logger.warn(
      { error: errorMessage(error) },
      "Notification Service readiness check failed",
    );
    respondJson(response, 503, { status: "unavailable", check: "readiness" });
  }
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, string>,
): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  dependency: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${dependency} timed out`)),
      timeoutMs,
    );
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  logger.fatal(
    { error: errorMessage(error) },
    "Notification Service failed to start",
  );
  process.exitCode = 1;
});
