// Express app factory: security middleware, routes, error handler. No listen() here.

import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { routes } from './routes';
import { errorHandler } from './middleware/error-handler.middleware';
import { AppError } from './errors/app-error';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.use('/api', routes);

  app.use((_req, _res, next) => {
    next(new AppError('Route not found', 404));
  });

  // Must be last.
  app.use(errorHandler);

  return app;
}
