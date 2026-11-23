import {
  ACTIVE_VERSION_KEY,
  boardGenreStatements,
  collectBoardGenres,
  publishRunStatements,
} from "./schema.js";
import { safeJsonParse } from "../utils/http.js";

export const BOARD_ORDER = ["episodes", "new-episodes", "new-podcasts", "podcasts"];

export const BOARD_CONFIG = {
  episodes: {
    endpoint: "https://xyzrank.com/api/episodes",
    type: "episode",
  },
  "new-episodes": {
    endpoint: "https://xyzrank.com/api/new-episodes",
    type: "episode",
  },
  "new-podcasts": {
    endpoint: "https://xyzrank.com/api/new-podcasts",
    type: "podcast",
  },
  podcasts: {
    endpoint: "https://xyzrank.com/api/podcasts",
    type: "podcast",
  },
};

export const PAGE_LIMIT = 100;
export const DEFAULT_MAX_PAGES_PER_BATCH = 15;
/**
 * Most pages one invocation may fetch. A page costs one upstream request and one
 * D1 query, the Free plan allows 50 of each per invocation, and starting the run,
 * publishing the version and recording a failure take a few more. The default is
 * lower because the Free plan also allows 10 ms of CPU time per Cron Trigger,
 * and 15 pages is the size that has been running in production.
 */
export const MAX_PAGES_PER_INVOCATION = 35;
/** UTC hour of the daily run. Every trigger of the day belongs to it. */
export const DAILY_SYNC_HOUR_UTC = 0;
/** A trigger this long after the daily run started is a catch-up one. */
export const CATCH_UP_AFTER_MS = 60 * 60_000;
// One page is a 12s upstream timeout plus one D1 batch at most, so a lock that has
// not been refreshed for this long belongs to an invocation that is gone.
const LOCK_MS = 90_000;
const MAX_RETRY_BACKOFF_MS = 16 * 60_000;

/** How long the run waits after its `failures`-th failed attempt in a row. */
function retryBackoffMs(failures) {
  return Math.min(2 ** failures * 60_000, MAX_RETRY_BACKOFF_MS);
}

const XYZ_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://xyzrank.com/",
  Accept: "application/json",
};

/**
 * Extract XiaoYuZhou episode ID from an episode link URL.
 */
export function extractEpisodeId(link) {
  if (typeof link !== "string") return "";
  const match = link.match(/\/episode\/([a-zA-Z0-9]+)/);
  return match ? match[1] : "";
}

/**
 * Extract XiaoYuZhou podcast ID and URL from xyzrank links array.
 */
export function extractPodcastLinkInfo(links) {
  if (!Array.isArray(links)) return { pid: "", xyzUrl: "" };
  const candidate =
    links.find((l) => l && l.name === "xyz" && typeof l.url === "string") ||
    links.find((l) => l && typeof l.url === "string" && l.url.includes("xiaoyuzhoufm.com/podcast/"));
  if (!candidate || !candidate.url) return { pid: "", xyzUrl: "" };
  const match = candidate.url.match(/\/podcast\/([a-zA-Z0-9]+)/);
  return {
    pid: match ? match[1] : "",
    xyzUrl: candidate.url,
  };
}

function toInt(val) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function toFloat(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize an episode item from xyzrank /api/episodes or /api/new-episodes.
 */
export function normalizeEpisodeItem(item, syncVersion, board) {
  const rank = toInt(item?.rank);
  const link = String(item?.link || "");
  const extractedEid = extractEpisodeId(link);
  const podcastIdRaw = String(item?.podcastID || "");
  const eid = extractedEid || `raw-${rank}-${podcastIdRaw || "ep"}`;
  const playCount = toInt(item?.playCount);
  const commentCount = toInt(item?.commentCount);
  const subscription = toInt(item?.subscription);
  const interactiveRate = playCount > 0 ? commentCount / playCount : 0;
  const openRate =
    item?.openRate !== undefined && item?.openRate !== null
      ? toFloat(item.openRate)
      : subscription > 0
        ? playCount / subscription
        : 0;

  return {
    syncVersion,
    board,
    rank,
    eid,
    title: String(item?.title || ""),
    podcastIdRaw,
    podcastName: String(item?.podcastName || ""),
    logoUrl: String(item?.logoURL || ""),
    link,
    playCount,
    commentCount,
    subscription,
    durationMin: toInt(item?.duration),
    postTime: String(item?.postTime || ""),
    primaryGenre: String(item?.primaryGenreName || "").trim(),
    totalEpisodesCount: toInt(item?.totalEpisodesCount),
    openRate,
    interactiveRate,
    lastReleaseDays: toFloat(item?.lastReleaseDateDayCount),
  };
}

/**
 * Normalize a podcast item from xyzrank /api/podcasts or /api/new-podcasts.
 */
export function normalizePodcastItem(item, syncVersion, board) {
  const rank = toInt(item?.rank);
  const links = Array.isArray(item?.links) ? item.links : [];
  const { pid, xyzUrl } = extractPodcastLinkInfo(links);
  const rawId = String(item?.id || pid || `raw-${rank}`);

  return {
    syncVersion,
    board,
    rank,
    pid,
    rawId,
    name: String(item?.name || ""),
    logoUrl: String(item?.logoURL || ""),
    primaryGenre: String(item?.primaryGenreName || "").trim(),
    authorsText: String(item?.authorsText || ""),
    trackCount: toInt(item?.trackCount),
    lastReleaseDate: String(item?.lastReleaseDate || ""),
    lastReleaseDays: toFloat(item?.lastReleaseDateDayCount),
    firstEpisodeTime: String(item?.firstEpisodePostTime || ""),
    activeRate: toFloat(item?.activeRate),
    avgDurationMin: toInt(item?.avgDuration),
    avgPlayCount: toInt(item?.avgPlayCount),
    avgUpdateFreqHours: toFloat(item?.avgUpdateFreq),
    avgCommentCount: toInt(item?.avgCommentCount),
    avgInteractIndicator: toFloat(item?.avgInteractIndicator),
    avgOpenRate: toFloat(item?.avgOpenRate),
    xyzUrl,
    linksJson: JSON.stringify(links),
  };
}

/**
 * Compute deterministic UTC slot and run ID for scheduled runs.
 * Examples: 2026-11-17T00:04:00Z -> { runId: "20261117T00", slot: "00" }
 */
export function computeSyncRunKey(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  return {
    runId: `${yyyy}${mm}${dd}T${hh}`,
    slot: hh,
  };
}

/**
 * The run a scheduled time belongs to. The cron keeps firing for the same run
 * later in the day, so a trigger at 10:00 continues the 08:00 run (Beijing time)
 * instead of starting another one.
 */
export function computeDailyRunKey(date = new Date()) {
  const start = dailyRunStart(date.getTime());
  const started = new Date(start);
  const slot = String(DAILY_SYNC_HOUR_UTC).padStart(2, "0");
  return {
    runId: `${started.getUTCFullYear()}${String(started.getUTCMonth() + 1).padStart(2, "0")}${String(
      started.getUTCDate()
    ).padStart(2, "0")}T${slot}`,
    slot,
  };
}

/** Start of the daily run that `nowMs` belongs to, in milliseconds. */
export function dailyRunStart(nowMs) {
  const shifted = new Date(nowMs - DAILY_SYNC_HOUR_UTC * 3_600_000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), DAILY_SYNC_HOUR_UTC);
}

function nextBoardAfter(board) {
  const idx = BOARD_ORDER.indexOf(board);
  if (idx === -1 || idx + 1 >= BOARD_ORDER.length) return null;
  return BOARD_ORDER[idx + 1];
}

function buildEpisodeUpsertStmt(db, row) {
  return db
    .prepare(
      `INSERT INTO episodes_rank (
        sync_version, board, rank, eid, title, podcast_id_raw, podcast_name,
        logo_url, link, play_count, comment_count, subscription, duration_min,
        post_time, primary_genre, total_episodes_count, open_rate,
        interactive_rate, last_release_days
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
      ON CONFLICT(sync_version, board, eid) DO UPDATE SET
        rank = excluded.rank,
        title = excluded.title,
        podcast_id_raw = excluded.podcast_id_raw,
        podcast_name = excluded.podcast_name,
        logo_url = excluded.logo_url,
        link = excluded.link,
        play_count = excluded.play_count,
        comment_count = excluded.comment_count,
        subscription = excluded.subscription,
        duration_min = excluded.duration_min,
        post_time = excluded.post_time,
        primary_genre = excluded.primary_genre,
        total_episodes_count = excluded.total_episodes_count,
        open_rate = excluded.open_rate,
        interactive_rate = excluded.interactive_rate,
        last_release_days = excluded.last_release_days`
    )
    .bind(
      row.syncVersion,
      row.board,
      row.rank,
      row.eid,
      row.title,
      row.podcastIdRaw,
      row.podcastName,
      row.logoUrl,
      row.link,
      row.playCount,
      row.commentCount,
      row.subscription,
      row.durationMin,
      row.postTime,
      row.primaryGenre,
      row.totalEpisodesCount,
      row.openRate,
      row.interactiveRate,
      row.lastReleaseDays
    );
}

function buildPodcastUpsertStmt(db, row) {
  return db
    .prepare(
      `INSERT INTO podcasts_rank (
        sync_version, board, rank, pid, raw_id, name, logo_url, primary_genre,
        authors_text, track_count, last_release_date, last_release_days,
        first_episode_time, active_rate, avg_duration_min, avg_play_count,
        avg_update_freq_hours, avg_comment_count, avg_interact_indicator,
        avg_open_rate, xyz_url, links_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
      ON CONFLICT(sync_version, board, raw_id) DO UPDATE SET
        rank = excluded.rank,
        pid = excluded.pid,
        name = excluded.name,
        logo_url = excluded.logo_url,
        primary_genre = excluded.primary_genre,
        authors_text = excluded.authors_text,
        track_count = excluded.track_count,
        last_release_date = excluded.last_release_date,
        last_release_days = excluded.last_release_days,
        first_episode_time = excluded.first_episode_time,
        active_rate = excluded.active_rate,
        avg_duration_min = excluded.avg_duration_min,
        avg_play_count = excluded.avg_play_count,
        avg_update_freq_hours = excluded.avg_update_freq_hours,
        avg_comment_count = excluded.avg_comment_count,
        avg_interact_indicator = excluded.avg_interact_indicator,
        avg_open_rate = excluded.avg_open_rate,
        xyz_url = excluded.xyz_url,
        links_json = excluded.links_json`
    )
    .bind(
      row.syncVersion,
      row.board,
      row.rank,
      row.pid,
      row.rawId,
      row.name,
      row.logoUrl,
      row.primaryGenre,
      row.authorsText,
      row.trackCount,
      row.lastReleaseDate,
      row.lastReleaseDays,
      row.firstEpisodeTime,
      row.activeRate,
      row.avgDurationMin,
      row.avgPlayCount,
      row.avgUpdateFreqHours,
      row.avgCommentCount,
      row.avgInteractIndicator,
      row.avgOpenRate,
      row.xyzUrl,
      row.linksJson
    );
}

async function fetchBoardPage(fetchFn, board, offset, limit = PAGE_LIMIT, timeoutMs = 12_000) {
  const cfg = BOARD_CONFIG[board];
  if (!cfg) throw new Error(`Unknown board: ${board}`);
  const url = `${cfg.endpoint}?offset=${offset}&limit=${limit}`;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(url, {
      headers: XYZ_HEADERS,
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) {
      throw new Error(`Upstream ${board} offset=${offset} failed with HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.items)) {
      throw new Error(`Upstream ${board} offset=${offset} returned malformed JSON`);
    }
    return data;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Upstream ${board} offset=${offset} timed out after ${timeoutMs}ms`, {
        cause: err,
      });
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildBoardMetaStmt(db, { runId, board, total, syncedCount, medianJson, nowIso }) {
  return db
    .prepare(
      `INSERT INTO board_meta (sync_version, board, total, synced_count, median_values_json, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(sync_version, board) DO UPDATE SET
         total = excluded.total,
         synced_count = excluded.synced_count,
         median_values_json = CASE
           WHEN excluded.median_values_json = '{}' THEN board_meta.median_values_json
           ELSE excluded.median_values_json
         END,
         updated_at = excluded.updated_at`
    )
    .bind(runId, board, total, syncedCount, medianJson, nowIso);
}

/**
 * Save where the run has got to. It is the last statement of the batch that
 * writes a page, so it only applies while the run is still where this
 * invocation last saw it: one that was taken over in the meantime stops here
 * instead of moving the cursor back.
 */
function buildCursorStmt(db, { runId, board, offset, boardTotalsJson, pages, items, lockUntil, expectedPages }) {
  return db
    .prepare(
      `UPDATE sync_runs
        SET status = 'running', current_board = ?3, current_offset = ?4, board_totals_json = ?5,
            pages_fetched = ?6, items_written = ?7, retry_count = 0, last_error = NULL, locked_until = ?2
        WHERE run_id = ?1 AND pages_fetched = ?8`
    )
    .bind(runId, lockUntil, board, offset, boardTotalsJson, pages, items, expectedPages);
}

/**
 * Execute one Free-Plan-safe batch of the relay sync state machine.
 * Never makes more than `maxPages` external fetch() requests in a single invocation,
 * and spends one D1 query per page plus a fixed handful for the rest.
 */
export async function runSyncBatch(db, options = {}) {
  const {
    now = new Date(),
    clock = () => new Date(),
    fetchFn = fetch,
    maxPages = DEFAULT_MAX_PAGES_PER_BATCH,
    force = false,
    slotOverride = null,
    runIdOverride = null,
  } = options;

  const safeMaxPages = Math.max(
    1,
    Math.min(MAX_PAGES_PER_INVOCATION, Number(maxPages) || DEFAULT_MAX_PAGES_PER_BATCH)
  );
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const key = computeDailyRunKey(now);
  const runId = runIdOverride || (force ? `${key.runId}-m${nowMs}` : key.runId);
  const slot = slotOverride || (force ? "manual" : key.slot);
  // Later in the day the cron comes back to a run that is not finished, whether
  // it failed in the morning or never got the chance to start.
  const catchUp = !force && !slotOverride && !runIdOverride && nowMs - dailyRunStart(nowMs) > CATCH_UP_AFTER_MS;

  const run = await db.prepare("SELECT * FROM sync_runs WHERE run_id = ?1").bind(runId).first();
  if (run?.status === "completed") {
    return { skipped: true, reason: "already_completed", catchUp, run, done: true };
  }

  // Taking the lock is one conditional statement, so two invocations that start
  // together cannot both get it. `changes` tells which one did.
  const lockUntil = clock().getTime() + LOCK_MS;
  const acquired = run
    ? await db
        .prepare(
          `UPDATE sync_runs SET status = 'running', locked_until = ?2
           WHERE run_id = ?1 AND status != 'completed' AND locked_until <= ?3`
        )
        .bind(runId, lockUntil, lockUntil - LOCK_MS)
        .run()
    : await db
        .prepare(
          `INSERT OR IGNORE INTO sync_runs (
            run_id, slot, status, current_board, current_offset, board_totals_json,
            pages_fetched, items_written, retry_count, last_error, locked_until, started_at
          ) VALUES (?1, ?2, 'running', ?3, 0, '{}', 0, 0, 0, NULL, ?4, ?5)`
        )
        .bind(runId, slot, BOARD_ORDER[0], lockUntil, nowIso)
        .run();
  if (Number(acquired?.meta?.changes) !== 1) {
    // The row read above usually already showed the lock taken; it is read again
    // only when it did not, to tell a lost race from a run completed meanwhile.
    const wasLocked = Boolean(run) && Number(run.locked_until) > lockUntil - LOCK_MS;
    const current = wasLocked ? run : await db.prepare("SELECT * FROM sync_runs WHERE run_id = ?1").bind(runId).first();
    if (current?.status === "completed") {
      return { skipped: true, reason: "already_completed", catchUp, run: current, done: true };
    }
    // A lock held by a run whose last attempt failed is the wait before its retry.
    const reason = current?.status === "failed" ? "backoff" : "locked";
    return { skipped: true, reason, catchUp, run: current, done: false };
  }

  let currentBoard = run?.current_board || BOARD_ORDER[0];
  let currentOffset = Number(run?.current_offset) || 0;
  let pagesFetchedTotal = Number(run?.pages_fetched) || 0;
  let itemsWrittenTotal = Number(run?.items_written) || 0;
  const failuresBefore = Number(run?.retry_count) || 0;
  const boardTotals = safeJsonParse(run?.board_totals_json, {}) || {};

  let batchPages = 0;
  let batchItems = 0;
  let completedAll = false;
  // The lock value this invocation last wrote; only the invocation that holds it may record a failure.
  let myLockUntil = lockUntil;
  // True once the pages are fetched and the run is being published. Failing
  // there leaves the run where it is, so retrying only makes sense after a
  // wait, as after a page that could not be fetched at all.
  let publishing = false;

  try {
    while (batchPages < safeMaxPages && currentBoard) {
      const cfg = BOARD_CONFIG[currentBoard];
      const data = await fetchBoardPage(fetchFn, currentBoard, currentOffset, PAGE_LIMIT);
      const items = data.items || [];
      const total = Number.isFinite(Number(data.total)) ? Number(data.total) : currentOffset + items.length;
      // An empty answer in the middle of a board is not the end of the board:
      // taking it for one would publish the run with the rest of the board missing.
      if (items.length === 0 && currentOffset < total) {
        throw new Error(
          `Upstream ${currentBoard} offset=${currentOffset} returned an empty page before the end of the board (${currentOffset} of ${total})`
        );
      }
      const nextOffset = currentOffset + items.length;
      const boardDone = items.length === 0 || nextOffset >= total;
      const nextBoard = boardDone ? nextBoardAfter(currentBoard) : currentBoard;
      completedAll = boardDone && !nextBoard;
      boardTotals[currentBoard] = {
        total,
        syncedCount: boardDone ? total : nextOffset,
      };

      // Every page is one D1 batch: its rows, the board totals and the new cursor
      // commit together, so a failed page is retried as a whole and a page that
      // was fetched is never fetched again because a later one failed. The batch
      // also refreshes the lock, and lets go of it on the last page of the batch.
      const lastPageOfBatch = batchPages + 1 >= safeMaxPages;
      const pageLockUntil = clock().getTime() + LOCK_MS;
      const keepLock = completedAll || !lastPageOfBatch;
      const medianJson = data.medianValues ? JSON.stringify(data.medianValues) : "{}";
      const stmts = items.map((item) =>
        cfg.type === "episode"
          ? buildEpisodeUpsertStmt(db, normalizeEpisodeItem(item, runId, currentBoard))
          : buildPodcastUpsertStmt(db, normalizePodcastItem(item, runId, currentBoard))
      );
      stmts.push(
        buildBoardMetaStmt(db, {
          runId,
          board: currentBoard,
          total,
          syncedCount: nextOffset,
          medianJson,
          nowIso: new Date(clock().getTime()).toISOString(),
        }),
        buildCursorStmt(db, {
          runId,
          board: nextBoard || currentBoard,
          // The last page of the last board leaves the cursor at its end, so a
          // switch-over that fails is retried with one request instead of a board.
          offset: boardDone && !completedAll ? 0 : nextOffset,
          boardTotalsJson: JSON.stringify(boardTotals),
          pages: pagesFetchedTotal + 1,
          items: itemsWrittenTotal + items.length,
          lockUntil: keepLock ? pageLockUntil : 0,
          expectedPages: pagesFetchedTotal,
        })
      );
      const results = await db.batch(stmts);
      if (Number(results[results.length - 1]?.meta?.changes) !== 1) {
        // The lock expired and another invocation moved the run on. Its cursor
        // stands; the rows written above are the same ones it writes.
        const current = await db.prepare("SELECT * FROM sync_runs WHERE run_id = ?1").bind(runId).first();
        return { skipped: true, reason: "taken_over", run: current, done: false };
      }
      // A batch that rolled back did not write this lock value either.
      if (keepLock) myLockUntil = pageLockUntil;

      batchPages += 1;
      batchItems += items.length;
      pagesFetchedTotal += 1;
      itemsWrittenTotal += items.length;
      currentBoard = nextBoard;
      currentOffset = boardDone ? 0 : nextOffset;
    }

    publishing = true;
    if (completedAll) {
      const finishedIso = new Date(clock().getTime()).toISOString();
      let prevActive = null;
      let previousItems = 0;
      let genresJson = null;
      try {
        const [activeRow, previousItemsRow, ...genreResults] = await db.batch([
          db.prepare("SELECT value FROM app_state WHERE key = ?1").bind(ACTIVE_VERSION_KEY),
          db
            .prepare(
              `SELECT COALESCE(SUM(total), 0) AS items FROM board_meta
                WHERE sync_version = (SELECT value FROM app_state WHERE key = ?1)`
            )
            .bind(ACTIVE_VERSION_KEY),
          ...boardGenreStatements(db, runId),
        ]);
        prevActive = activeRow?.results?.[0]?.value || null;
        previousItems = Number(previousItemsRow?.results?.[0]?.items) || 0;
        genresJson = JSON.stringify(collectBoardGenres(genreResults));
      } catch {
        // The genre cache is optional (the meta endpoint recomputes it); the
        // previous active version is not.
        prevActive =
          (await db.prepare("SELECT value FROM app_state WHERE key = ?1").bind(ACTIVE_VERSION_KEY).first())
            ?.value || null;
      }

      // Publishing replaces the list and removes what it supersedes. A run that
      // came back with a fraction of the items the active version has is not a
      // new day of the same boards, so the active version stays.
      const listedItems = Object.values(boardTotals).reduce((sum, board) => sum + (Number(board.total) || 0), 0);
      if (previousItems > 0 && listedItems < previousItems / 2) {
        throw new Error(
          `Refusing to publish ${runId}: the upstream lists ${listedItems} items, against ${previousItems} in the active version`
        );
      }

      // Marking the run completed and switching to it commit together, with
      // the removal of the versions it supersedes. Everything in the batch is
      // conditional on the run being completed, so it only takes effect if this
      // invocation still holds the lock.
      const published = await db.batch([
        db
          .prepare(
            `UPDATE sync_runs
              SET status = 'completed', current_board = 'done', current_offset = 0,
                  board_totals_json = ?2, pages_fetched = ?3, items_written = ?4,
                  retry_count = 0, last_error = NULL, locked_until = 0, finished_at = ?5
              WHERE run_id = ?1 AND locked_until = ?6`
          )
          .bind(
            runId,
            JSON.stringify(boardTotals),
            pagesFetchedTotal,
            itemsWrittenTotal,
            finishedIso,
            myLockUntil
          ),
        ...publishRunStatements(db, runId, {
          genresJson,
          prevActiveVersion: prevActive,
          nowIso: finishedIso,
        }),
      ]);
      if (Number(published[0]?.meta?.changes) !== 1) {
        const current = await db.prepare("SELECT * FROM sync_runs WHERE run_id = ?1").bind(runId).first();
        return { skipped: true, reason: "taken_over", run: current, done: false };
      }
    }
  } catch (err) {
    const failedAttempt = batchPages === 0 || publishing;
    // Pages saved in this attempt have already cleared the count, so a failed
    // switch-over starts a new streak at one.
    const failures = failedAttempt ? (batchPages === 0 ? failuresBefore + 1 : 1) : 0;
    const failedAt = clock().getTime();
    await db
      .prepare(
        `UPDATE sync_runs SET status = ?2, retry_count = ?3, last_error = ?4, locked_until = ?5
          WHERE run_id = ?1 AND locked_until = ?6`
      )
      .bind(
        runId,
        failedAttempt ? "failed" : "running",
        failures,
        err?.message || String(err),
        failedAttempt ? failedAt + retryBackoffMs(failures) : 0,
        myLockUntil
      )
      .run()
      .catch((recordErr) => {
        console.error("Could not record the sync failure:", recordErr);
      });
    throw err;
  }

  const updatedRun = await db.prepare("SELECT * FROM sync_runs WHERE run_id = ?1").bind(runId).first();
  return {
    skipped: false,
    catchUp,
    done: completedAll,
    batchPages,
    batchItems,
    run: updatedRun,
  };
}
