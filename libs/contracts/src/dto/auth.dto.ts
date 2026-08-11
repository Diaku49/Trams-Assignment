// Authentication request/response shapes shared by API Gateway and User Service.

import { z } from 'zod';
import { emailSchema, passwordSchema, userIdSchema } from './user.dto';

export const loginDtoSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

/** The User Service returns this after verifying credentials over NATS. */
export const authenticatedUserSchema = z
  .object({
    id: userIdSchema,
    email: emailSchema,
    name: z.string().nullable(),
  })
  .strict();

/** The API Gateway returns this after signing a JWT for an authenticated user. */
export const loginResponseDtoSchema = z
  .object({
    accessToken: z.string().min(1),
    tokenType: z.literal('Bearer'),
    expiresIn: z.string().min(1),
    user: authenticatedUserSchema,
  })
  .strict();

export type LoginDto = z.infer<typeof loginDtoSchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type LoginResponseDto = z.infer<typeof loginResponseDtoSchema>;
