// Application error carrying a client-safe message plus arbitrary context data.

export class AppError extends Error {
  readonly msg: string;
  readonly status: number;
  readonly data: unknown;

  constructor(msg: string, status = 400, data: unknown = null) {
    super(msg);
    this.name = 'AppError';
    this.msg = msg;
    this.status = status;
    this.data = data;
  }
}
