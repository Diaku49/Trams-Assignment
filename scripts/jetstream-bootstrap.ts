// One-off JetStream provisioning for local/deployment startup. User Service
// owns this stream definition; services consume it only after this job succeeds.

import "dotenv/config";
import { connectNats } from "@app/messaging";
import { userEventsStream } from "../apps/user-service/src/events/user-events.stream";

interface BootstrapConfig {
  nats: {
    url: string;
    user: string;
    password: string;
    tls: {
      caFile: string;
    };
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const messaging = await connectNats({
    servers: config.nats.url,
    name: "jetstream-bootstrap",
    user: config.nats.user,
    password: config.nats.password,
    tls: config.nats.tls,
    logger: consoleLogger,
  });

  try {
    const result = await messaging.streams.ensure(userEventsStream);
    consoleLogger.info(
      {
        stream: result.stream.config.name,
        created: result.created,
        updated: result.updated,
      },
      "JetStream bootstrap completed",
    );
  } finally {
    await messaging.drain();
  }
}

function loadConfig(): BootstrapConfig {
  return {
    nats: {
      url: requiredEnv("NATS_URL"),
      // The User Service account owns publication to user.created and has the
      // $JS.API permission required to create/reconcile its stream.
      user: requiredEnv("NATS_USER"),
      password: requiredEnv("NATS_PASSWORD"),
      tls: { caFile: requiredEnv("NATS_TLS_CA_FILE") },
    },
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for JetStream bootstrap`);
  }

  return value;
}

const consoleLogger = {
  info(context: Record<string, unknown>, message: string): void {
    process.stdout.write(`${message} ${JSON.stringify(context)}\n`);
  },
  warn(context: Record<string, unknown>, message: string): void {
    process.stderr.write(`${message} ${JSON.stringify(context)}\n`);
  },
  error(context: Record<string, unknown>, message: string): void {
    process.stderr.write(`${message} ${JSON.stringify(context)}\n`);
  },
};

void main().catch((error) => {
  process.stderr.write(
    `JetStream bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
