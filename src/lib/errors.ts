/** Application errors that map cleanly onto HTTP status codes. */

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Нэвтрэх шаардлагатай.") {
    super(message, 401, "unauthorized");
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = "Энэ үйлдлийг гүйцэтгэх эрх байхгүй.",
    readonly required?: { action: string; subject: string },
  ) {
    super(message, 403, "forbidden", required);
  }
}

/**
 * Returned instead of 403 when revealing that a record exists would itself
 * leak across a tenant boundary. A cross-tenant id must look like a typo,
 * not like a locked door.
 */
export class NotFoundError extends AppError {
  constructor(message = "Олдсонгүй.") {
    super(message, 404, "not_found");
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, "conflict", details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "validation_failed", details);
  }
}

export function toErrorResponse(err: unknown): {
  status: number;
  body: { error: { code: string; message: string; details?: unknown } };
} {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message, details: err.details } },
    };
  }
  // Never leak an internal message to the client.
  console.error("[unhandled]", err);
  return {
    status: 500,
    body: { error: { code: "internal_error", message: "Дотоод алдаа гарлаа." } },
  };
}
