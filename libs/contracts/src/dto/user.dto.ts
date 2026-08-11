// Request/response shapes for user endpoints, shared by gateway and User Service.

import { z } from 'zod';

export const userIdSchema = z.string().uuid();

export const emailSchema = z.string().trim().email().max(254).toLowerCase();

export const passwordSchema = z.string().min(8).max(128);

export const displayNameSchema = z.string().trim().min(1).max(100);

export const createUserDtoSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: displayNameSchema.optional(),
  })
  .strict();

export const updateUserDtoSchema = z
  .object({
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    name: displayNameSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const userResponseDtoSchema = z
  .object({
    id: userIdSchema,
    email: emailSchema,
    name: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const getUserRequestSchema = z
  .object({
    id: userIdSchema,
  })
  .strict();

export const updateUserRequestSchema = z
  .object({
    id: userIdSchema,
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    name: displayNameSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, {
    message: 'Provide at least one field to update',
  });

export type CreateUserDto = z.infer<typeof createUserDtoSchema>;
export type UpdateUserDto = z.infer<typeof updateUserDtoSchema>;
export type UserResponseDto = z.infer<typeof userResponseDtoSchema>;
export type GetUserRequest = z.infer<typeof getUserRequestSchema>;
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;
