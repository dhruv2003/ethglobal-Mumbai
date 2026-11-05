export class MatchingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MatchingError';
    this.code = code;
  }
}
