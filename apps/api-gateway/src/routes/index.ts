// Mounts all route modules onto the Express router.

import { Router } from 'express';
import { userRoutes } from './user.routes';

export const routes = Router();

routes.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

routes.use('/users', userRoutes);
