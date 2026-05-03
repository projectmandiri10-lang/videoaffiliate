const MAX_RETRY_DELAY_MS = 60_000;

interface ParsedPayload {
  code?: number | string;
  message?: string;
  retryDelayMs?: number;
  retryDelayText?: string;
  statusCode?: number;
  type?: string;
}

function parseDelayToMs(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }

  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }

  const secondsMatch = value.match(/^(\d+(?:\.\d+)?)s$/i);
  if (secondsMatch) {
    return Math.round(Number(secondsMatch[1]) * 1000);
  }

  const millisecondsMatch = value.match(/^(\d+(?:\.\d+)?)ms$/i);
  if (millisecondsMatch) {
    return Math.round(Number(millisecondsMatch[1]));
  }

  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return undefined;
}

function formatDelayText(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    return "";
  }

  if (/^\d+$/.test(normalized)) {
    return `${normalized} detik`;
  }

  const secondsMatch = normalized.match(/^(\d+(?:\.\d+)?)s$/i);
  if (secondsMatch) {
    return `${secondsMatch[1]} detik`;
  }

  const millisecondsMatch = normalized.match(/^(\d+(?:\.\d+)?)ms$/i);
  if (millisecondsMatch) {
    return `${millisecondsMatch[1]} ms`;
  }

  return normalized;
}

function readHeader(headersLike: unknown, name: string): string | undefined {
  if (!headersLike) {
    return undefined;
  }

  if (headersLike instanceof Headers) {
    return headersLike.get(name) ?? undefined;
  }

  if (
    typeof headersLike === "object" &&
    headersLike !== null &&
    "get" in headersLike &&
    typeof (headersLike as { get?: unknown }).get === "function"
  ) {
    const value = (headersLike as { get(name: string): string | null }).get(name);
    return value ?? undefined;
  }

  if (typeof headersLike === "object" && headersLike !== null) {
    const entry = Object.entries(headersLike as Record<string, unknown>).find(
      ([key]) => key.toLowerCase() === name.toLowerCase()
    );
    if (!entry) {
      return undefined;
    }
    return String(entry[1]);
  }

  return undefined;
}

function parsePayloadCandidate(candidate: unknown): ParsedPayload | undefined {
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const payload = candidate as {
    error?: {
      code?: number | string;
      message?: string;
      type?: string;
      status?: string | number;
      details?: Array<Record<string, unknown>>;
    };
    code?: number | string;
    message?: string;
    type?: string;
    status?: string | number;
  };

  const errorPayload = payload.error && typeof payload.error === "object" ? payload.error : payload;
  const parsed: ParsedPayload = {
    code: errorPayload.code,
    message: typeof errorPayload.message === "string" ? errorPayload.message : undefined,
    type: typeof errorPayload.type === "string" ? errorPayload.type : undefined
  };

  if (typeof errorPayload.status === "number") {
    parsed.statusCode = errorPayload.status;
  }
  if (typeof errorPayload.code === "number") {
    parsed.statusCode = errorPayload.code;
  }

  const details = Array.isArray(payload.error?.details) ? payload.error.details : [];
  for (const detail of details) {
    const detailType = String(detail["@type"] || "");
    if (detailType.includes("RetryInfo")) {
      const retryDelay = String(detail["retryDelay"] || "").trim();
      if (retryDelay) {
        parsed.retryDelayText = formatDelayText(retryDelay);
        parsed.retryDelayMs = parseDelayToMs(retryDelay);
      }
    }
  }

  return parsed;
}

function parseErrorPayload(error: unknown): ParsedPayload {
  const candidates: unknown[] = [];
  if (typeof error === "object" && error !== null) {
    const source = error as {
      body?: unknown;
      error?: unknown;
      response?: { data?: unknown };
      message?: string;
    };
    candidates.push(source.body, source.error, source.response?.data);
    if (source.message) {
      try {
        candidates.push(JSON.parse(source.message));
      } catch {
        // ignore invalid JSON
      }
    }
  }

  for (const candidate of candidates) {
    const parsed = parsePayloadCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return {};
}

function extractDelayFromHeaders(error: unknown): {
  retryDelayMs?: number;
  retryDelayText?: string;
} {
  const headers =
    (error as { headers?: unknown })?.headers ||
    (error as { response?: { headers?: unknown } })?.response?.headers;

  const retryAfterMs = readHeader(headers, "retry-after-ms");
  if (retryAfterMs) {
    const numericMs = Number(retryAfterMs);
    return {
      retryDelayMs: Number.isFinite(numericMs) ? numericMs : parseDelayToMs(retryAfterMs),
      retryDelayText: formatDelayText(
        Number.isFinite(numericMs) ? `${Math.round(numericMs)}ms` : retryAfterMs
      )
    };
  }

  const rawDelay =
    readHeader(headers, "retry-after") ||
    readHeader(headers, "x-ratelimit-reset-requests") ||
    readHeader(headers, "x-ratelimit-reset-tokens");

  if (!rawDelay) {
    return {};
  }

  return {
    retryDelayMs: parseDelayToMs(rawDelay),
    retryDelayText: formatDelayText(rawDelay)
  };
}

export function extractStatusCode(error: unknown): number | undefined {
  const directStatus = Number(
    (error as { statusCode?: unknown })?.statusCode ?? (error as { status?: unknown })?.status
  );
  if (Number.isInteger(directStatus) && directStatus > 0) {
    return directStatus;
  }

  return parseErrorPayload(error).statusCode;
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  const directMessage = (error as { message?: unknown })?.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage;
  }

  const parsed = parseErrorPayload(error);
  if (parsed.message) {
    return parsed.message;
  }

  return String(error || "Error tidak diketahui.");
}

export function extractRetryDelayText(error: unknown): string | undefined {
  const fromPayload = parseErrorPayload(error).retryDelayText;
  if (fromPayload) {
    return fromPayload;
  }
  return extractDelayFromHeaders(error).retryDelayText;
}

export function getRetryDelayMs(error: unknown, fallbackDelayMs: number): number {
  const fromPayload = parseErrorPayload(error).retryDelayMs;
  const fromHeaders = extractDelayFromHeaders(error).retryDelayMs;
  const selectedDelay = fromPayload ?? fromHeaders ?? fallbackDelayMs;
  return Math.min(Math.max(selectedDelay, fallbackDelayMs), MAX_RETRY_DELAY_MS);
}

export function isRateLimitError(error: unknown): boolean {
  const statusCode = extractStatusCode(error);
  const parsed = parseErrorPayload(error);
  const text = `${extractErrorMessage(error)} ${String(parsed.code || "")} ${String(
    parsed.type || ""
  )}`.toLowerCase();

  return (
    statusCode === 429 ||
    text.includes("rate limit") ||
    text.includes("rate_limit") ||
    text.includes("quota") ||
    text.includes("resource_exhausted")
  );
}

export function isTransientLlmError(error: unknown): boolean {
  if (isRateLimitError(error)) {
    return true;
  }

  const statusCode = extractStatusCode(error);
  if (statusCode && [408, 409, 423, 425, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const text = extractErrorMessage(error).toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("temporar") ||
    text.includes("unavailable") ||
    text.includes("connection") ||
    text.includes("connect") ||
    text.includes("network") ||
    text.includes("socket hang up") ||
    text.includes("fetch failed") ||
    text.includes("failed_precondition")
  );
}

export function isDependencyUnavailableError(error: unknown): boolean {
  const statusCode = extractStatusCode(error);
  if (statusCode && [408, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const text = extractErrorMessage(error).toLowerCase();
  return (
    text.includes("ffmpeg tidak ditemukan") ||
    text.includes("ffprobe-static tidak tersedia") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("temporar") ||
    text.includes("unavailable") ||
    text.includes("connection") ||
    text.includes("connect") ||
    text.includes("network") ||
    text.includes("fetch failed") ||
    text.includes("failed_precondition")
  );
}

export function buildRateLimitErrorMessage(error: unknown): string {
  const retryDelay = extractRetryDelayText(error);
  const retryText = retryDelay ? ` Coba lagi dalam ${retryDelay}.` : "";
  return `Layanan model sedang membatasi permintaan atau kuota habis.${retryText}`.trim();
}
