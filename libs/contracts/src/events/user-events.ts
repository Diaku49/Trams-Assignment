// Event payloads published by User Service. They never include password hashes.

import { z } from 'zod';
import { emailSchema, userIdSchema } from '../dto/user.dto';
import { eventEnvelopeSchema } from './envelope';

export const userCreatedPayloadSchema = z
  .object({
    id: userIdSchema,
    email: emailSchema,
    name: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const userCreatedEventSchema = eventEnvelopeSchema(
  z.literal('user.created'),
  userCreatedPayloadSchema,
);

export type UserCreatedPayload = z.infer<typeof userCreatedPayloadSchema>;
export type UserCreatedEvent = z.infer<typeof userCreatedEventSchema>;
