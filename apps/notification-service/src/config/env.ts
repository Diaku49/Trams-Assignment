// Notification Service environment loading and validation.

import "dotenv/config";
import { z } from "zod";

export interface NotificationServiceConfig {
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  nats: {
    url: string;
    user: string;
    password: string;
  };
  consumer: {
    durableName: string;
    maxDeliver: number;
    ackWaitMs: number;
    maxAckPending: number;
  };
}

const schema = z.object({
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NATS_URL: z.string().min(1),
  NATS_USER: z.string().min(1),
  NATS_PASSWORD: z.string().min(1),
  NOTIFICATION_DURABLE_NAME: z
    .string()
    .trim()
    .min(1)
    .default("notification-user-created"),
  NOTIFICATION_MAX_DELIVER: z.coerce.number().int().min(1).max(5).default(5),
  NOTIFICATION_ACK_WAIT_MS: z.coerce.number().int().positive().default(30_000),
  NOTIFICATION_MAX_ACK_PENDING: z.coerce.number().int().positive().default(10),
});

function loadEnv(): NotificationServiceConfig {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;
  return {
    logLevel: env.LOG_LEVEL,
    nats: {
      url: env.NATS_URL,
      user: env.NATS_USER,
      password: env.NATS_PASSWORD,
    },
    consumer: {
      durableName: env.NOTIFICATION_DURABLE_NAME,
      maxDeliver: env.NOTIFICATION_MAX_DELIVER,
      ackWaitMs: env.NOTIFICATION_ACK_WAIT_MS,
      maxAckPending: env.NOTIFICATION_MAX_ACK_PENDING,
    },
  };
}

export const config = loadEnv();
