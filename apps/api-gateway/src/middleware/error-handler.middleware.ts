// Central Express error handler: maps errors to HTTP status codes.

import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    req.log.warn({ err, statusCode: err.status }, "HTTP request rejected");
    res.status(err.status).json({ msg: err.msg, data: err.data });
    return;
  }

  req.log.error({ err }, "Unhandled HTTP request error");
  res.status(500).json({ msg: "Internal server error", data: null });
};
