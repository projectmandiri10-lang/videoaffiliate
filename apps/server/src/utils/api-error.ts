import { ZodError } from "zod";

interface ParsedGeminiApiError {
  code?: number;
  status?: string;
  retryDelay?: string;
}

export interface NormalizedApiError {
  statusCode: number;
  error: string;
}

function parseGeminiApiError(error: unknown): ParsedGeminiApiError {
  const message = String((error as { message?: string })?.message || "");
  const parsed: ParsedGeminiApiError = {};

  try {
    const payload = JSON.parse(message) as {
      error?: {
        code?: number;
        status?: string;
        details?: Array<Record<string, unknown>>;
      };
    };
    parsed.code = payload.error?.code;
    parsed.status = payload.error?.status;

    for (const detail of payload.error?.details || []) {
      const detailType = String(detail["@type"] || "");
      if (detailType.includes("RetryInfo")) {
        const retryDelay = String(detail["retryDelay"] || "").trim();
        if (retryDelay) {
          parsed.retryDelay = retryDelay;
        }
      }
    }
  } catch {
    return parsed;
  }

  return parsed;
}

function buildGeminiRateLimitMessage(error: unknown): string {
  const message = String((error as { message?: string })?.message || "");
  const parsed = parseGeminiApiError(error);
  const retryText = parsed.retryDelay ? ` Coba lagi dalam ${parsed.retryDelay}.` : "";
  return `Layanan Gemini sedang membatasi permintaan atau kuota habis.${retryText}`.trim();
}

function isRateLimitError(error: unknown): boolean {
  const parsed = parseGeminiApiError(error);
  const message = String((error as { message?: string })?.message || error).toLowerCase();
  return (
    parsed.code === 429 ||
    parsed.status === "RESOURCE_EXHAUSTED" ||
    message.includes("429") ||
    message.includes("resource_exhausted") ||
    message.includes("quota") ||
    message.includes("rate limit")
  );
}

function isDependencyUnavailableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error).toLowerCase();
  return (
    message.includes("ffmpeg tidak ditemukan") ||
    message.includes("ffprobe-static tidak tersedia") ||
    message.includes("failed_precondition") ||
    message.includes("temporar") ||
    message.includes("timeout") ||
    message.includes("unavailable") ||
    message.includes("not in an active state")
  );
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
  const explicitStatus = Number((error as { statusCode?: unknown })?.statusCode);
  const message = String((error as { message?: string })?.message || "Error tidak diketahui.");

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      error: formatZodError(error)
    };
  }

  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus < 500) {
    return {
      statusCode: explicitStatus,
      error: message
    };
  }

  if (isRateLimitError(error)) {
    return {
      statusCode: 429,
      error: buildGeminiRateLimitMessage(error)
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
