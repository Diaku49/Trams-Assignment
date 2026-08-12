// User Service environment loading and validation.

import "dotenv/config";
import { z } from "zod";

export interface UserServiceConfig {
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  databaseUrl: string;
  passwordSaltRounds: number;
  rpcQueueGroup: string;
  outbox: {
    publishedRetentionMs: number;
    cleanupIntervalMs: number;
    cleanupBatchSize: number;
    cleanupMaxBatches: number;
    metricsIntervalMs: number;
  };
  nats: {
    url: string;
    user: string;
    password: string;
    tls: {
      caFile: string;
    };
  };
}

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DATABASE_URL: z.string().url(),
  PASSWORD_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  USER_SERVICE_QUEUE_GROUP: z.string().trim().min(1).default("user-service"),
  OUTBOX_PUBLISHED_RETENTION_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60 * 1_000),
  OUTBOX_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 1_000),
  OUTBOX_CLEANUP_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  OUTBOX_CLEANUP_MAX_BATCHES: z.coerce.number().int().positive().default(20),
  OUTBOX_METRICS_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
  NATS_URL: z.string().min(1),
  NATS_USER: z.string().min(1),
  NATS_PASSWORD: z.string().min(1),
  NATS_TLS_CA_FILE: z.string().trim().min(1),
});

function loadEnv(): UserServiceConfig {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    passwordSaltRounds: env.PASSWORD_SALT_ROUNDS,
    rpcQueueGroup: env.USER_SERVICE_QUEUE_GROUP,
    outbox: {
      publishedRetentionMs: env.OUTBOX_PUBLISHED_RETENTION_MS,
      cleanupIntervalMs: env.OUTBOX_CLEANUP_INTERVAL_MS,
      cleanupBatchSize: env.OUTBOX_CLEANUP_BATCH_SIZE,
      cleanupMaxBatches: env.OUTBOX_CLEANUP_MAX_BATCHES,
      metricsIntervalMs: env.OUTBOX_METRICS_INTERVAL_MS,
    },
    nats: {
      url: env.NATS_URL,
      user: env.NATS_USER,
      password: env.NATS_PASSWORD,
      tls: {
        caFile: env.NATS_TLS_CA_FILE,
      },
    },
  };
}

export const config = loadEnv();
