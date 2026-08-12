// Operator utility for inspecting and deliberately replaying user.events.dlq.

import { readFile } from "node:fs/promises";
import { subjects, userCreatedEventSchema } from "@app/contracts";
import {
  connect,
  type MsgHdrs,
  type NatsConnection,
  type StoredMsg,
} from "nats";

const STREAM = "USER_EVENTS";
const DLQ_SUBJECT = "user.events.dlq";

async function main(): Promise<void> {
  const [command, sequenceText, ...flags] = process.argv.slice(2);

  if (command !== "inspect" && command !== "replay") {
    usage();
  }

  const connection = await connectNats();
  try {
    if (command === "inspect") {
      await inspect(connection);
      return;
    }

    const sequence = Number(sequenceText);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("Replay requires a positive USER_EVENTS stream sequence");
    }

    await replay(connection, sequence, flags);
  } finally {
    await connection.drain();
  }
}

async function inspect(connection: NatsConnection): Promise<void> {
  const manager = await connection.jetstreamManager();
  const info = await manager.streams.info(STREAM, {
    subjects_filter: DLQ_SUBJECT,
  });
  const matches: Array<Record<string, unknown>> = [];

  for (
    let sequence = info.state.first_seq;
    sequence <= info.state.last_seq;
    sequence += 1
  ) {
    try {
      const message = await manager.streams.getMessage(STREAM, {
        seq: sequence,
      });
      if (message.subject === DLQ_SUBJECT) {
        matches.push(describe(message));
      }
    } catch (error) {
      if (!isMessageNotFound(error)) {
        throw error;
      }
    }
  }

  process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
}

async function replay(
  connection: NatsConnection,
  sequence: number,
  flags: string[],
): Promise<void> {
  const execute = flags.includes("--execute");
  const payloadFileIndex = flags.indexOf("--payload-file");
  const payloadFile =
    payloadFileIndex === -1 ? undefined : flags[payloadFileIndex + 1];
  const manager = await connection.jetstreamManager();
  const message = await manager.streams.getMessage(STREAM, { seq: sequence });

  if (message.subject !== DLQ_SUBJECT) {
    throw new Error(`Stream sequence ${sequence} is not a DLQ record`);
  }

  const originalSubject = message.header.get("Trams-Original-Subject");
  const reason = message.header.get("Trams-Dlq-Reason");
  if (!originalSubject) {
    throw new Error("DLQ record has no Trams-Original-Subject header");
  }

  if (originalSubject !== subjects.userCreated) {
    throw new Error(`Unsupported original subject: ${originalSubject}`);
  }

  if (reason === "malformed" && !payloadFile) {
    throw new Error(
      "Malformed records require --payload-file <corrected-json-file>; replaying the same invalid bytes would fail again",
    );
  }

  const data = payloadFile ? await readFile(payloadFile) : message.data;
  const event = validateUserCreatedPayload(data);
  const recordedEventId = message.header.get("Trams-Event-Id");
  if (recordedEventId && event.eventId !== recordedEventId) {
    throw new Error(
      `Replay eventId ${event.eventId} does not match DLQ eventId ${recordedEventId}`,
    );
  }
  const preview = {
    streamSequence: sequence,
    reason,
    originalSubject,
    payloadBytes: data.byteLength,
    source: payloadFile ?? "preserved DLQ payload",
  };

  if (!execute) {
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, ...preview }, null, 2)}\nAdd --execute to publish.\n`,
    );
    return;
  }

  const acknowledgement = await connection
    .jetstream()
    .publish(originalSubject, data, {
      msgID: `dlq-replay:${sequence}:${Date.now()}`,
      timeout: 5_000,
    });
  process.stdout.write(
    `${JSON.stringify({ replayed: true, ...preview, acknowledgement }, null, 2)}\n`,
  );
}

function describe(message: StoredMsg): Record<string, unknown> {
  const data = Buffer.from(message.data);
  return {
    streamSequence: message.seq,
    storedAt: message.timestamp,
    reason: message.header.get("Trams-Dlq-Reason"),
    originalSubject: message.header.get("Trams-Original-Subject"),
    sourceStream: message.header.get("Trams-Source-Stream"),
    sourceSequence: message.header.get("Trams-Source-Sequence"),
    consumer: message.header.get("Trams-Consumer"),
    deliveryCount: message.header.get("Trams-Delivery-Count"),
    error: message.header.get("Trams-Error"),
    eventId: message.header.get("Trams-Event-Id") || null,
    payloadUtf8: data.toString("utf8"),
    payloadBase64: data.toString("base64"),
    headers: headerRecord(message.header),
  };
}

function headerRecord(headers: MsgHdrs): Record<string, string[]> {
  return Object.fromEntries(
    headers.keys().map((key) => [key, headers.values(key)]),
  );
}

function connectNats(): Promise<NatsConnection> {
  const servers = requiredEnv("NATS_URL");
  const user = requiredEnv("NATS_USER");
  const pass = requiredEnv("NATS_PASSWORD");
  const caFile = requiredEnv("NATS_TLS_CA_FILE");
  return connect({
    servers,
    user,
    pass,
    tls: { caFile },
    name: "dlq-operator",
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function validateUserCreatedPayload(data: Uint8Array) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(data).toString("utf8"));
  } catch (error) {
    throw new Error(
      `Replay payload is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = userCreatedEventSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(
      `Replay payload is not a valid user.created event: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function isMessageNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === "no message found";
}

function usage(): never {
  throw new Error(
    "Usage: npm run dlq:inspect | npm run dlq:replay -- <stream-sequence> [--payload-file corrected.json] [--execute]",
  );
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
