// Injectable bcrypt password hashing and verification.

import bcrypt from 'bcryptjs';

const DEFAULT_SALT_ROUNDS = 12;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
}

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly saltRounds = DEFAULT_SALT_ROUNDS) {
    if (!Number.isSafeInteger(saltRounds) || saltRounds < 10 || saltRounds > 15) {
      throw new Error('bcrypt salt rounds must be an integer between 10 and 15');
    }
  }

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  verify(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}
