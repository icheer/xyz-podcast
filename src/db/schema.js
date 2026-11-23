import { safeJsonParse } from "../utils/http.js";

export const ACTIVE_VERSION_KEY = "active_sync_version";
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
 * The grouped reads behind the genre lists of a sync version.
 */
export function boardGenreStatements(db, syncVersion) {
  const sql = (table) =>
    `SELECT board, primary_genre AS genre, COUNT(*) AS count
     FROM ${table}
     WHERE sync_version = ?1 AND primary_genre != ''
     GROUP BY board, primary_genre
     ORDER BY count DESC`;
  return [
    db.prepare(sql("episodes_rank")).bind(syncVersion),
    db.prepare(sql("podcasts_rank")).bind(syncVersion),
  ];
}

/**
 * Merge the results of `boardGenreStatements` into `{ board: [{ genre, count }] }`.
 */
export function collectBoardGenres(results) {
  const genresByBoard = {};
  for (const result of results) {
    for (const row of result?.results || []) {
      if (!genresByBoard[row.board]) genresByBoard[row.board] = [];
      genresByBoard[row.board].push({ genre: row.genre, count: row.count });
    }
  }
  return genresByBoard;
}

/**
 * Aggregate genre counts across episode & podcast rank tables and optionally persist in app_state.
 */
export async function computeBoardGenres(db, syncVersion, { persist = false, nowIso = new Date().toISOString() } = {}) {
  if (!syncVersion) return {};
  const genresByBoard = collectBoardGenres(await db.batch(boardGenreStatements(db, syncVersion)));

  if (persist) {
    await setAppState(db, `${GENRES_KEY_PREFIX}${syncVersion}`, JSON.stringify(genresByBoard), nowIso);
  }
  return genresByBoard;
}

/**
 * Statements that publish a completed run: the genre cache, the previous and the
 * active version, then the removal of the superseded versions. Each one only acts
 * once the run row says `completed`, so a run that lost its lock can neither
 * publish nor delete anything, and the switch-over is one transaction.
 */
export function publishRunStatements(db, runId, { genresJson = null, prevActiveVersion = null, nowIso } = {}) {
  const stateWrites = [];
  // Without a computed cache the meta endpoint keeps computing the genres on demand.
  if (genresJson) stateWrites.push([`${GENRES_KEY_PREFIX}${runId}`, genresJson]);
  if (prevActiveVersion && prevActiveVersion !== runId) {
    stateWrites.push([PREV_VERSION_KEY, prevActiveVersion]);
  }
  stateWrites.push([ACTIVE_VERSION_KEY, runId]);

  const statements = stateWrites.map(([key, value]) =>
    db
      .prepare(
        `INSERT INTO app_state (key, value, updated_at)
         SELECT ?1, ?2, ?3 FROM sync_runs WHERE run_id = ?4 AND status = 'completed'
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(key, value, nowIso, runId)
  );

  // The keys are module constants, never user input.
  const kept = `SELECT value FROM app_state WHERE key IN ('${ACTIVE_VERSION_KEY}', '${PREV_VERSION_KEY}')`;
  const published = `EXISTS (SELECT 1 FROM app_state WHERE key = '${ACTIVE_VERSION_KEY}' AND value = ?1)`;
  const keptGenreKeys = `SELECT '${GENRES_KEY_PREFIX}' || value FROM app_state WHERE key IN ('${ACTIVE_VERSION_KEY}', '${PREV_VERSION_KEY}')`;
  statements.push(
    db.prepare(`DELETE FROM episodes_rank WHERE sync_version NOT IN (${kept}) AND ${published}`).bind(runId),
    db.prepare(`DELETE FROM podcasts_rank WHERE sync_version NOT IN (${kept}) AND ${published}`).bind(runId),
    db.prepare(`DELETE FROM board_meta WHERE sync_version NOT IN (${kept}) AND ${published}`).bind(runId),
    db
      .prepare(
        `DELETE FROM app_state
          WHERE key LIKE '${GENRES_KEY_PREFIX}%' AND key NOT IN (${keptGenreKeys}) AND ${published}`
      )
      .bind(runId)
  );
  return statements;
}
