// /users route wiring.

import { Router } from 'express';
import { getUser } from '../controllers/user.controller';

export const userRoutes = Router();

userRoutes.get('/:id', getUser);
userRoutes.put("/:id", updateUser);