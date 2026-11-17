const ACTIVE_VERSION_KEY = "active_sync_version";

/**
 * Read a key from app_state table.
 */
export async function getAppState(db, key) {
  const row = await db
    .prepare("SELECT value, updated_at FROM app_state WHERE key = ?1")
    .bind(key)
    .first();
  return row || null;
}

/**
 * Upsert a key into app_state table.
 */
export async function setAppState(db, key, value, nowIso = new Date().toISOString()) {
  await db
    .prepare(
      `INSERT INTO app_state (key, value, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, String(value), nowIso)
    .run();
}

/**
 * Get the active completed sync version if available.
 */
export async function getActiveSyncVersion(db) {
  const row = await getAppState(db, ACTIVE_VERSION_KEY);
  return row?.value || null;
}

/**
 * Resolve which sync_version queries should read from.
 * Prefers active_sync_version; falls back to the latest sync_run during initial cold start.
 */
export async function getEffectiveSyncVersion(db) {
  const active = await getActiveSyncVersion(db);
  if (active) return active;

  const fallback = await db
    .prepare(
      `SELECT run_id FROM sync_runs
       WHERE items_written > 0
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .first();
  return fallback?.run_id || null;
}

/**
 * Atomically switch active_sync_version after a full sync run completes.
 */
export async function activateSyncVersion(db, syncVersion, nowIso = new Date().toISOString()) {
  await setAppState(db, ACTIVE_VERSION_KEY, syncVersion, nowIso);
}

/**
 * Execute D1 prepared statements in chunks to keep each batch call bounded.
 */
export async function batchExecute(db, statements, chunkSize = 50) {
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    if (chunk.length > 0) {
      await db.batch(chunk);
    }
  }
}

/**
 * Remove stale rank rows older than the latest keepCount versions.
 */
export async function cleanupOldSyncVersions(db, keepVersions = []) {
  const keep = [...new Set(keepVersions.filter(Boolean))];
  if (keep.length === 0) return;

  const placeholders = keep.map((_, idx) => `?${idx + 1}`).join(", ");
  await db.batch([
    db.prepare(`DELETE FROM episodes_rank WHERE sync_version NOT IN (${placeholders})`).bind(...keep),
    db.prepare(`DELETE FROM podcasts_rank WHERE sync_version NOT IN (${placeholders})`).bind(...keep),
    db.prepare(`DELETE FROM board_meta WHERE sync_version NOT IN (${placeholders})`).bind(...keep),
  ]);
}
