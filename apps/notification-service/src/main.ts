// Notification Service composition root. No HTTP server is exposed.

import { PrismaPg } from "@prisma/adapter-pg";
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
  shutdown(): Promise<void>;
}

export async function startNotificationService(): Promise<RunningNotificationService> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  let messaging: MessagingClient | undefined;

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
    const consumer = await new UserEventsConsumer(connectedMessaging).startCreated(
      config.consumer,
      (event) => notifications.handleUserCreated(event),
    );
    let shutdownPromise: Promise<void> | undefined;

    logger.info(
      { durableName: consumer.durableName },
      "Notification Service is ready for user.created events",
    );

    return {
      messaging,
      consumer,
      shutdown(): Promise<void> {
        shutdownPromise ??= shutdownNotificationService(
          consumer,
          connectedMessaging,
          prisma,
        );
        return shutdownPromise;
      },
    };
  } catch (error) {
    await Promise.allSettled([
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
  consumer: StartedDurableConsumer,
  messaging: MessagingClient,
  prisma: PrismaClient,
): Promise<void> {
  logger.info(
    { durableName: consumer.durableName },
    "Stopping Notification Service consumer",
  );

  try {
    await consumer.messages.close();
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
  logger.fatal(
    { error: errorMessage(error) },
    "Notification Service failed to start",
  );
  process.exitCode = 1;
});
