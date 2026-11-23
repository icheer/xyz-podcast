import { ACTIVE_VERSION_KEY } from "../db/schema.js";
import { isBoardDataStale } from "../utils/freshness.js";
import { errorJson, json } from "../utils/http.js";

/**
 * Health of the Worker and its database, and of the board data: how old the
 * published list is. `sync.stale` is what an external monitor can alert on.
 * Before anything has been published, it counts from the first sync that started.
 */
export async function handleHealth(env, nowMs = Date.now()) {
  if (!env.DB) {
    return errorJson("D1 binding DB is not configured", 500);
  }

  const row = await env.DB.prepare(
    `SELECT 1 AS ok,
       (SELECT value FROM app_state WHERE key = '${ACTIVE_VERSION_KEY}') AS sync_version,
       (SELECT MAX(updated_at) FROM board_meta
         WHERE sync_version = (SELECT value FROM app_state WHERE key = '${ACTIVE_VERSION_KEY}')) AS updated_at,
       (SELECT MIN(started_at) FROM sync_runs) AS first_run_at`
  ).first();

  const updatedAt = row?.updated_at || null;
  const ageHours = updatedAt ? Math.round(((nowMs - Date.parse(updatedAt)) / 3_600_000) * 10) / 10 : null;
  // A first sync that has not published anything in a day is as bad as a stale list.
  const stale = isBoardDataStale(updatedAt || row?.first_run_at, nowMs);
  return json(
    {
      ok: row?.ok === 1,
      db: "ok",
      timestamp: new Date(nowMs).toISOString(),
      sync: {
        version: row?.sync_version || null,
        updatedAt,
        ageHours,
        stale,
      },
    },
    200,
    { "Cache-Control": "no-store" }
  );
}
