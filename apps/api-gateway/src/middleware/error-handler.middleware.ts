// Central Express error handler: maps errors to HTTP status codes.

import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/app-error';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ msg: err.msg, data: err.data });
    return;
  }

  console.error(err);
  res.status(500).json({ msg: 'Internal server error', data: null });
};
