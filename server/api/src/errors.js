export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.statusCode = status;
    this.code = code;
  }
}

export const fail = (status, code) => new HttpError(status, code);
