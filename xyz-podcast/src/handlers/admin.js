import { getActiveSyncVersion, getEffectiveSyncVersion } from "../db/schema.js";
import { DEFAULT_MAX_PAGES_PER_BATCH, runSyncBatch } from "../db/sync.js";
import { clampInt, errorJson, json, safeJsonParse } from "../utils/http.js";

function timingSafeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function checkAdminAuth(request, env) {
  const configured = env.ADMIN_KEY;
  if (!configured) return false;
  const headerKey = request.headers.get("X-Admin-Key");
  if (headerKey && timingSafeEquals(headerKey, configured)) return true;
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    return timingSafeEquals(authHeader.slice(7).trim(), configured);
  }
  return false;
}

export async function handleAdminSync(request, env) {
  if (!checkAdminAuth(request, env)) {
    return errorJson("Unauthorized: missing or invalid X-Admin-Key", 401);
  }

  const body = await request.json().catch(() => ({}));
  const maxPages = clampInt(body?.maxPages, DEFAULT_MAX_PAGES_PER_BATCH, 1, 35);
  const force = Boolean(body?.force);
  const runIdOverride = typeof body?.runId === "string" && body.runId.trim() ? body.runId.trim() : null;

  const result = await runSyncBatch(env.DB, {
    maxPages,
    force,
    slotOverride: "manual",
    runIdOverride,
  });

  return json({ ok: true, ...result });
}

export async function handleAdminSyncStatus(request, env) {
  if (!checkAdminAuth(request, env)) {
    return errorJson("Unauthorized: missing or invalid X-Admin-Key", 401);
  }

  const [activeSyncVersion, effectiveSyncVersion, runsRes, metaRes] = await Promise.all([
    getActiveSyncVersion(env.DB),
    getEffectiveSyncVersion(env.DB),
    env.DB.prepare("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 10").all(),
    env.DB.prepare("SELECT * FROM board_meta ORDER BY updated_at DESC LIMIT 12").all(),
  ]);

  return json({
    activeSyncVersion,
    effectiveSyncVersion,
    runs: (runsRes?.results || []).map((r) => ({
      ...r,
      boardTotals: safeJsonParse(r.board_totals_json, {}),
    })),
    boardMeta: (metaRes?.results || []).map((m) => ({
      ...m,
      medianValues: safeJsonParse(m.median_values_json, {}),
    })),
  });
}
