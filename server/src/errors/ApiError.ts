export class ApiError extends Error {
  public constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
