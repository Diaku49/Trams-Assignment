// Generic idempotent JetStream stream provisioning.

import {
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  nanos,
  type JetStreamManager,
  type NatsConnection,
  type StreamInfo,
  type StreamUpdateConfig,
} from 'nats';
import type { MessagingLogger } from '../types';

export interface DurableStreamConfig {
  name: string;
  description: string;
  subjects: string[];
  maxMessages: number;
  maxBytes: number;
  maxMessageSize: number;
  maxAgeMs: number;
  duplicateWindowMs: number;
  replicas: number;
}

export interface StreamBootstrapResult {
  stream: StreamInfo;
  created: boolean;
  updated: boolean;
}

export class JetStreamStreams {
  constructor(
    private readonly connection: NatsConnection,
    private readonly logger?: MessagingLogger,
  ) {}

  async ensure(config: DurableStreamConfig): Promise<StreamBootstrapResult> {
    const manager = await this.connection.jetstreamManager();
    const updateConfig = toStreamUpdateConfig(config);

    try {
      const existing = await manager.streams.info(config.name);
      return reconcileStream(
        manager,
        config,
        updateConfig,
        existing,
        this.logger,
      );
    } catch (error) {
      if (!isStreamNotFound(error)) {
        throw error;
      }

      try {
        const stream = await manager.streams.add({
          name: config.name,
          retention: RetentionPolicy.Limits,
          storage: StorageType.File,
          max_consumers: -1,
          ...updateConfig,
        });

        this.logger?.info(
          { stream: config.name, subjects: stream.config.subjects },
          'Created JetStream stream',
        );
        return { stream, created: true, updated: false };
      } catch (createError) {
        try {
          const existing = await manager.streams.info(config.name);
          return reconcileStream(
            manager,
            config,
            updateConfig,
            existing,
            this.logger,
          );
        } catch {
          throw createError;
        }
      }
    }
  }
}

async function reconcileStream(
  manager: JetStreamManager,
  config: DurableStreamConfig,
  updateConfig: Partial<StreamUpdateConfig>,
  existing: StreamInfo,
  logger?: MessagingLogger,
): Promise<StreamBootstrapResult> {
  assertCompatibleStorage(config, existing);

  if (!requiresUpdate(existing, updateConfig)) {
    logger?.info(
      { stream: config.name, subjects: existing.config.subjects },
      'JetStream stream is already configured',
    );
    return { stream: existing, created: false, updated: false };
  }

  const stream = await manager.streams.update(config.name, updateConfig);
  logger?.info(
    { stream: config.name, subjects: stream.config.subjects },
    'Updated JetStream stream configuration',
  );
  return { stream, created: false, updated: true };
}

function toStreamUpdateConfig(
  config: DurableStreamConfig,
): Partial<StreamUpdateConfig> {
  return {
    description: config.description,
    subjects: config.subjects,
    max_msgs: config.maxMessages,
    max_bytes: config.maxBytes,
    max_msg_size: config.maxMessageSize,
    max_age: nanos(config.maxAgeMs),
    discard: DiscardPolicy.Old,
    duplicate_window: nanos(config.duplicateWindowMs),
    num_replicas: config.replicas,
  };
}

function assertCompatibleStorage(
  config: DurableStreamConfig,
  stream: StreamInfo,
): void {
  if (stream.config.retention !== RetentionPolicy.Limits) {
    throw new Error(
      `${config.name} must use limits retention; found ${stream.config.retention}`,
    );
  }

  if (stream.config.storage !== StorageType.File) {
    throw new Error(
      `${config.name} must use file storage; found ${stream.config.storage}`,
    );
  }
}

function requiresUpdate(
  stream: StreamInfo,
  expected: Partial<StreamUpdateConfig>,
): boolean {
  const config = stream.config;

  return (
    !sameSubjects(config.subjects, expected.subjects ?? []) ||
    config.description !== expected.description ||
    config.max_msgs !== expected.max_msgs ||
    config.max_bytes !== expected.max_bytes ||
    config.max_msg_size !== expected.max_msg_size ||
    config.max_age !== expected.max_age ||
    config.discard !== expected.discard ||
    config.duplicate_window !== expected.duplicate_window ||
    config.num_replicas !== expected.num_replicas
  );
}

function sameSubjects(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function isStreamNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === 'stream not found';
}
