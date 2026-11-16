export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const bad = (code, msg) => new ApiError(400, code, msg);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Forbidden') => new ApiError(403, 'FORBIDDEN', msg);
export const conflict = (code, msg) => new ApiError(409, code, msg);
