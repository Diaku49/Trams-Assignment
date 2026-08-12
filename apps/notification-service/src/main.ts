// Notification Service composition root. No HTTP server is exposed.

import {
  connectNats,
  type MessagingClient,
  type StartedDurableConsumer,
} from "@app/messaging";
import pino from "pino";
import { ConsoleNotificationChannel } from "./channels/console.channel";
import { config } from "./config/env";
import { UserEventsConsumer } from "./consumers/user-events.consumer";
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
  const messaging = await connectNats({
    servers: config.nats.url,
    name: "notification-service",
    user: config.nats.user,
    password: config.nats.password,
    tls: config.nats.tls,
    logger,
  });

  try {
    const notifications = new NotificationService(
      new ConsoleNotificationChannel(logger),
      logger,
    );
    const consumer = await new UserEventsConsumer(messaging).startCreated(
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
        shutdownPromise ??= shutdownNotificationService(consumer, messaging);
        return shutdownPromise;
      },
    };
  } catch (error) {
    await messaging.drain();
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
): Promise<void> {
  logger.info(
    { durableName: consumer.durableName },
    "Stopping Notification Service consumer",
  );

  try {
    await consumer.messages.close();
  } finally {
    await messaging.drain();
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
