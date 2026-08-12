// Env var loading + schema validation. Fails fast on missing config.

import 'dotenv/config';
import { z } from 'zod';

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  port: number;
  jwt: {
    secret: string;
    expiresIn: string;
  };
  corsOrigins: string[];
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
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  GATEWAY_PORT: z.coerce.number().int().positive().max(65535).default(3000),

  JWT_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters - use a long random value'),
  JWT_EXPIRES_IN: z.string().min(1).default('15m'),

  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  NATS_URL: z.string().min(1),
  NATS_USER: z.string().min(1),
  NATS_PASSWORD: z.string().min(1),
  NATS_TLS_CA_FILE: z.string().trim().min(1),
});

function loadEnv(): Config {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.GATEWAY_PORT,
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
    },
    corsOrigins: env.CORS_ORIGINS,
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

export const config: Config = loadEnv();
