export type MoneyErrorCode = 'MEMBERSHIP_NOT_FOUND' | 'INSUFFICIENT_FUNDS' | 'NOTE_REQUIRED';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}
