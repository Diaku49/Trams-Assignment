// Generic event envelope: eventId, occurredAt, type, payload.

import { z } from 'zod';

export interface EventEnvelope<TType extends string, TPayload> {
  eventId: string;
  occurredAt: string;
  type: TType;
  payload: TPayload;
}

export function eventEnvelopeSchema<
  TType extends string,
  TPayloadSchema extends z.ZodTypeAny,
>(typeSchema: z.ZodType<TType>, payloadSchema: TPayloadSchema) {
  return z
    .object({
      eventId: z.string().uuid(),
      occurredAt: z.string().datetime(),
      type: typeSchema,
      payload: payloadSchema,
    })
    .strict();
}
