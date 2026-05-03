import { ZodError } from "zod";
import {
  buildRateLimitErrorMessage,
  extractErrorMessage,
  extractStatusCode,
  isDependencyUnavailableError,
  isRateLimitError
} from "./llm-error.js";

export interface NormalizedApiError {
  statusCode: number;
  error: string;
}

function formatZodError(error: ZodError): string {
  const firstIssue = error.issues[0];
  if (!firstIssue) {
    return error.message;
  }

  const path = firstIssue.path.length ? `${firstIssue.path.join(".")}: ` : "";
  return `${path}${firstIssue.message}`;
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  const explicitStatus = extractStatusCode(error);
  const message = extractErrorMessage(error);

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      error: formatZodError(error)
    };
  }

  if (isRateLimitError(error)) {
    return {
      statusCode: 429,
      error: buildRateLimitErrorMessage(error)
    };
  }

  if (Number.isInteger(explicitStatus) && explicitStatus! >= 400 && explicitStatus! < 500) {
    return {
      statusCode: explicitStatus!,
      error: message
    };
  }

  if (isDependencyUnavailableError(error)) {
    return {
      statusCode: 503,
      error: message
    };
  }

  return {
    statusCode: 500,
    error: message
  };
}
