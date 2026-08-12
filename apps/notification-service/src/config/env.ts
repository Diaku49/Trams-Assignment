// Notification Service environment loading and validation.

import "dotenv/config";
import { z } from "zod";

export interface NotificationServiceConfig {
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  healthPort: number;
  databaseUrl: string;
  nats: {
    url: string;
    user: string;
    password: string;
    tls: {
      caFile: string;
    };
  };
  consumer: {
    durableName: string;
    maxDeliver: number;
    ackWaitMs: number;
    maxAckPending: number;
  };
  deliveryLeaseMs: number;
}

const schema = z.object({
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NOTIFICATION_HEALTH_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3001),
  NOTIFICATION_DATABASE_URL: z.string().url(),
  NATS_URL: z.string().min(1),
  NATS_USER: z.string().min(1),
  NATS_PASSWORD: z.string().min(1),
  NATS_TLS_CA_FILE: z.string().trim().min(1),
  NOTIFICATION_DURABLE_NAME: z
    .string()
    .trim()
    .min(1)
    .default("notification-user-created"),
  NOTIFICATION_MAX_DELIVER: z.coerce.number().int().min(1).max(5).default(5),
  NOTIFICATION_ACK_WAIT_MS: z.coerce.number().int().positive().default(30_000),
  NOTIFICATION_MAX_ACK_PENDING: z.coerce.number().int().positive().default(10),
  NOTIFICATION_DELIVERY_LEASE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(60_000),
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
    healthPort: env.NOTIFICATION_HEALTH_PORT,
    databaseUrl: env.NOTIFICATION_DATABASE_URL,
    nats: {
      url: env.NATS_URL,
      user: env.NATS_USER,
      password: env.NATS_PASSWORD,
      tls: {
        caFile: env.NATS_TLS_CA_FILE,
      },
    },
    consumer: {
      durableName: env.NOTIFICATION_DURABLE_NAME,
      maxDeliver: env.NOTIFICATION_MAX_DELIVER,
      ackWaitMs: env.NOTIFICATION_ACK_WAIT_MS,
      maxAckPending: env.NOTIFICATION_MAX_ACK_PENDING,
    },
    deliveryLeaseMs: env.NOTIFICATION_DELIVERY_LEASE_MS,
  };
}

export const config = loadEnv();
