const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

/**
 * Return a JSON response with optional status and extra headers.
 */
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

/**
 * Return a consistent JSON error payload.
 */
export function errorJson(message, status = 400, details = undefined) {
  const body = { error: message };
  if (details !== undefined) body.details = details;
  return json(body, status);
}

/**
 * Validate XiaoYuZhou episode/podcast ID format to prevent path traversal or SSRF.
 */
export function isValidXyzId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9]{16,40}$/.test(id);
}

/**
 * Clamp an integer query param into [min, max].
 */
export function clampInt(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Safely parse JSON string with fallback.
 */
export function safeJsonParse(raw, fallback) {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
