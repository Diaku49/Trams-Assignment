// Errors raised by UserService business rules.

export type UserServiceErrorCode =
  | 'EMAIL_ALREADY_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'USER_NOT_FOUND';

export class UserServiceError extends Error {
  constructor(
    message: string,
    readonly code: UserServiceErrorCode,
  ) {
    super(message);
    this.name = 'UserServiceError';
  }
}
