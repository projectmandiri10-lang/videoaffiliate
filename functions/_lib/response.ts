export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });
}

export function errorResponse(message: string, status = 500, error?: unknown) {
  return json(
    {
      message,
      error: error instanceof Error ? error.message : String(error || message)
    },
    { status }
  );
}
