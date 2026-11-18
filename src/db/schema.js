import { safeJsonParse } from "../utils/http.js";

const ACTIVE_VERSION_KEY = "active_sync_version";
const PREV_VERSION_KEY = "prev_sync_version";
const GENRES_KEY_PREFIX = "genres:";

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
 * Resolve the previous completed sync_version for rank trend comparison.
 * Checks app_state first, falling back to sync_runs history.
 */
export async function getPreviousSyncVersion(db, currentSyncVersion) {
  if (!currentSyncVersion) return null;
  const saved = await getAppState(db, PREV_VERSION_KEY);
  if (saved?.value && saved.value !== currentSyncVersion) {
    return saved.value;
  }

  const prevRun = await db
    .prepare(
      `SELECT run_id FROM sync_runs
       WHERE status = 'completed' AND run_id != ?1
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .bind(currentSyncVersion)
    .first();
  return prevRun?.run_id || null;
}

/**
 * Save the previous active sync_version when activating a new version.
 */
export async function setPreviousSyncVersion(db, prevVersion, nowIso = new Date().toISOString()) {
  if (!prevVersion) return;
  await setAppState(db, PREV_VERSION_KEY, prevVersion, nowIso);
}

/**
 * Atomically switch active_sync_version after a full sync run completes.
 */
export async function activateSyncVersion(db, syncVersion, nowIso = new Date().toISOString()) {
  await setAppState(db, ACTIVE_VERSION_KEY, syncVersion, nowIso);
}

/**
 * Read precomputed board genre counts for a sync_version from app_state.
 */
export async function getCachedBoardGenres(db, syncVersion) {
  if (!syncVersion) return null;
  const row = await getAppState(db, `${GENRES_KEY_PREFIX}${syncVersion}`);
  if (!row?.value) return null;
  const parsed = safeJsonParse(row.value, null);
  return parsed && typeof parsed === "object" ? parsed : null;
}

/**
 * Aggregate genre counts across episode & podcast rank tables and optionally persist in app_state.
 */
export async function computeBoardGenres(db, syncVersion, { persist = false, nowIso = new Date().toISOString() } = {}) {
  if (!syncVersion) return {};
  const [epGenresRows, podGenresRows] = await Promise.all([
    db
      .prepare(
        `SELECT board, primary_genre AS genre, COUNT(*) AS count
         FROM episodes_rank
         WHERE sync_version = ?1 AND primary_genre != ''
         GROUP BY board, primary_genre
         ORDER BY count DESC`
      )
      .bind(syncVersion)
      .all(),
    db
      .prepare(
        `SELECT board, primary_genre AS genre, COUNT(*) AS count
         FROM podcasts_rank
         WHERE sync_version = ?1 AND primary_genre != ''
         GROUP BY board, primary_genre
         ORDER BY count DESC`
      )
      .bind(syncVersion)
      .all(),
  ]);

  const genresByBoard = {};
  for (const row of [...(epGenresRows?.results || []), ...(podGenresRows?.results || [])]) {
    if (!genresByBoard[row.board]) genresByBoard[row.board] = [];
    genresByBoard[row.board].push({ genre: row.genre, count: row.count });
  }

  if (persist) {
    await setAppState(db, `${GENRES_KEY_PREFIX}${syncVersion}`, JSON.stringify(genresByBoard), nowIso);
  }
  return genresByBoard;
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
 * Remove stale rank rows and cached genre maps older than the kept versions.
 */
export async function cleanupOldSyncVersions(db, keepVersions = []) {
  const keep = [...new Set(keepVersions.filter(Boolean))];
  if (keep.length === 0) return;

  const placeholders = keep.map((_, idx) => `?${idx + 1}`).join(", ");
  const genreKeys = keep.map((v) => `${GENRES_KEY_PREFIX}${v}`);
  const genrePlaceholders = genreKeys.map((_, idx) => `?${idx + 1}`).join(", ");

  await db.batch([
    db.prepare(`DELETE FROM episodes_rank WHERE sync_version NOT IN (${placeholders})`).bind(...keep),
    db.prepare(`DELETE FROM podcasts_rank WHERE sync_version NOT IN (${placeholders})`).bind(...keep),
    db.prepare(`DELETE FROM board_meta WHERE sync_version NOT IN (${placeholders})`).bind(...keep),
    db
      .prepare(
        `DELETE FROM app_state WHERE key LIKE '${GENRES_KEY_PREFIX}%' AND key NOT IN (${genrePlaceholders})`
      )
      .bind(...genreKeys),
  ]);
}
