// Handles user endpoints by forwarding requests over NATS request/reply.

import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error';

export function getUser(req: Request, res: Response): void {
  const { id } = req.params;

  if (id === '0') {
    throw new AppError('User not found', 404, { id });
  }

  res.json({ id, name: 'placeholder user', source: 'stub' });
}
