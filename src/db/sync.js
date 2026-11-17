import {
  activateSyncVersion,
  batchExecute,
  cleanupOldSyncVersions,
  getActiveSyncVersion,
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
const MAX_LOCK_MS = 90_000;
const MAX_RETRIES = 10;

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

async function fetchBoardPage(fetchFn, board, offset, limit = PAGE_LIMIT) {
  const cfg = BOARD_CONFIG[board];
  if (!cfg) throw new Error(`Unknown board: ${board}`);
  const url = `${cfg.endpoint}?offset=${offset}&limit=${limit}`;
  const res = await fetchFn(url, { headers: XYZ_HEADERS });
  if (!res.ok) {
    throw new Error(`Upstream ${board} offset=${offset} failed with HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data || !Array.isArray(data.items)) {
    throw new Error(`Upstream ${board} offset=${offset} returned malformed JSON`);
  }
  return data;
}

/**
 * Execute one Free-Plan-safe batch of the relay sync state machine.
 * Never makes more than `maxPages` external fetch() requests in a single invocation.
 */
export async function runSyncBatch(db, options = {}) {
  const {
    now = new Date(),
    fetchFn = fetch,
    maxPages = DEFAULT_MAX_PAGES_PER_BATCH,
    force = false,
    slotOverride = null,
    runIdOverride = null,
  } = options;

  const safeMaxPages = Math.max(1, Math.min(35, Number(maxPages) || DEFAULT_MAX_PAGES_PER_BATCH));
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const key = computeSyncRunKey(now);
  const runId = runIdOverride || (force ? `${key.runId}-m${nowMs}` : key.runId);
  const slot = slotOverride || (force ? "manual" : key.slot);

  let run = await db
    .prepare("SELECT * FROM sync_runs WHERE run_id = ?1")
    .bind(runId)
    .first();

  if (!run) {
    await db
      .prepare(
        `INSERT INTO sync_runs (
          run_id, slot, status, current_board, current_offset, board_totals_json,
          pages_fetched, items_written, retry_count, last_error, locked_until, started_at
        ) VALUES (?1, ?2, 'running', ?3, 0, '{}', 0, 0, 0, NULL, ?4, ?5)`
      )
      .bind(runId, slot, BOARD_ORDER[0], nowMs + MAX_LOCK_MS, nowIso)
      .run();
    run = await db.prepare("SELECT * FROM sync_runs WHERE run_id = ?1").bind(runId).first();
  } else {
    if (run.status === "completed") {
      return { skipped: true, reason: "already_completed", run, done: true };
    }
    if (run.status === "failed" && !force) {
      return { skipped: true, reason: "max_retries_exceeded", run, done: false };
    }
    if (run.locked_until && Number(run.locked_until) > nowMs) {
      return { skipped: true, reason: "locked", run, done: false };
    }
    await db
      .prepare(
        "UPDATE sync_runs SET status = 'running', locked_until = ?2 WHERE run_id = ?1"
      )
      .bind(runId, nowMs + MAX_LOCK_MS)
      .run();
  }

  let currentBoard = run.current_board || BOARD_ORDER[0];
  let currentOffset = Number(run.current_offset) || 0;
  let pagesFetchedTotal = Number(run.pages_fetched) || 0;
  let itemsWrittenTotal = Number(run.items_written) || 0;
  let retryCount = Number(run.retry_count) || 0;
  const boardTotals = safeJsonParse(run.board_totals_json, {});

  let batchPages = 0;
  let batchItems = 0;
  let completedAll = false;

  try {
    while (batchPages < safeMaxPages && currentBoard) {
      const cfg = BOARD_CONFIG[currentBoard];
      const data = await fetchBoardPage(fetchFn, currentBoard, currentOffset, PAGE_LIMIT);
      batchPages += 1;
      pagesFetchedTotal += 1;

      const items = data.items || [];
      const total = Number.isFinite(Number(data.total)) ? Number(data.total) : currentOffset + items.length;
      const stmts = items.map((item) =>
        cfg.type === "episode"
          ? buildEpisodeUpsertStmt(db, normalizeEpisodeItem(item, runId, currentBoard))
          : buildPodcastUpsertStmt(db, normalizePodcastItem(item, runId, currentBoard))
      );

      if (stmts.length > 0) {
        await batchExecute(db, stmts, 50);
        batchItems += stmts.length;
        itemsWrittenTotal += stmts.length;
      }

      const nextOffset = currentOffset + items.length;
      const boardDone = items.length === 0 || nextOffset >= total;
      boardTotals[currentBoard] = {
        total,
        syncedCount: boardDone ? total : nextOffset,
      };

      const medianJson = data.medianValues ? JSON.stringify(data.medianValues) : "{}";
      await db
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
        .bind(runId, currentBoard, total, nextOffset, medianJson, nowIso)
        .run();

      if (boardDone) {
        const next = nextBoardAfter(currentBoard);
        if (!next) {
          currentBoard = null;
          currentOffset = 0;
          completedAll = true;
          break;
        }
        currentBoard = next;
        currentOffset = 0;
      } else {
        currentOffset = nextOffset;
      }
    }

    if (completedAll) {
      const prevActive = await getActiveSyncVersion(db);
      await db
        .prepare(
          `UPDATE sync_runs
           SET status = 'completed', current_board = 'done', current_offset = 0,
               board_totals_json = ?2, pages_fetched = ?3, items_written = ?4,
               last_error = NULL, locked_until = 0, finished_at = ?5
           WHERE run_id = ?1`
        )
        .bind(runId, JSON.stringify(boardTotals), pagesFetchedTotal, itemsWrittenTotal, nowIso)
        .run();
      await activateSyncVersion(db, runId, nowIso);
      await cleanupOldSyncVersions(db, [runId, prevActive]);
    } else {
      await db
        .prepare(
          `UPDATE sync_runs
           SET status = 'running', current_board = ?2, current_offset = ?3,
               board_totals_json = ?4, pages_fetched = ?5, items_written = ?6,
               last_error = NULL, locked_until = 0
           WHERE run_id = ?1`
        )
        .bind(
          runId,
          currentBoard || BOARD_ORDER[0],
          currentOffset,
          JSON.stringify(boardTotals),
          pagesFetchedTotal,
          itemsWrittenTotal
        )
        .run();
    }

    const updatedRun = await db.prepare("SELECT * FROM sync_runs WHERE run_id = ?1").bind(runId).first();
    return {
      skipped: false,
      done: completedAll,
      batchPages,
      batchItems,
      run: updatedRun,
    };
  } catch (err) {
    retryCount += 1;
    const status = retryCount >= MAX_RETRIES ? "failed" : "running";
    await db
      .prepare(
        `UPDATE sync_runs
         SET status = ?2, current_board = ?3, current_offset = ?4,
             board_totals_json = ?5, pages_fetched = ?6, items_written = ?7,
             retry_count = ?8, last_error = ?9, locked_until = 0
         WHERE run_id = ?1`
      )
      .bind(
        runId,
        status,
        currentBoard || BOARD_ORDER[0],
        currentOffset,
        JSON.stringify(boardTotals),
        pagesFetchedTotal,
        itemsWrittenTotal,
        retryCount,
        err?.message || String(err)
      )
      .run();

    throw err;
  }
}
