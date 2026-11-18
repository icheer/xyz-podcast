import {
  computeBoardGenres,
  getActiveSyncVersion,
  getCachedBoardGenres,
  getEffectiveSyncVersion,
  getPreviousSyncVersion,
} from "../db/schema.js";
import { BOARD_CONFIG, BOARD_ORDER } from "../db/sync.js";
import { clampInt, errorJson, json, safeJsonParse } from "../utils/http.js";

const COMPLETE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

const PARTIAL_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=10",
};

const EPISODE_SORT_COLUMNS = {
  rank: "rank",
  playCount: "play_count",
  commentCount: "comment_count",
  interactiveRate: "interactive_rate",
  openRate: "open_rate",
  duration: "duration_min",
  postTime: "post_time",
  subscription: "subscription",
};

const PODCAST_SORT_COLUMNS = {
  rank: "rank",
  avgUpdateFreq: "avg_update_freq_hours",
  lastReleaseDateDayCount: "last_release_days",
  trackCount: "track_count",
  avgDuration: "avg_duration_min",
  avgPlayCount: "avg_play_count",
  avgCommentCount: "avg_comment_count",
  avgInteractIndicator: "avg_interact_indicator",
  avgOpenRate: "avg_open_rate",
};

function escapeLikePattern(str) {
  return str.replace(/[\\%_]/g, "\\$&");
}

function getEdgeCache() {
  return typeof caches !== "undefined" && caches?.default ? caches.default : null;
}

function buildVersionedCacheRequest(request, syncVersion, prevVersion = "") {
  if (!request?.url || !syncVersion) return null;
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set("__sv", syncVersion);
  if (prevVersion) cacheUrl.searchParams.set("__pv", prevVersion);
  return new Request(cacheUrl.toString(), { method: "GET" });
}

function computeRankTrend(row, hasPrevBaseline) {
  if (!hasPrevBaseline) {
    return { rankDelta: null, isNew: false };
  }
  if (row.prev_rank !== null && row.prev_rank !== undefined) {
    const prevRank = Number(row.prev_rank);
    const currRank = Number(row.rank);
    if (Number.isFinite(prevRank) && Number.isFinite(currRank) && prevRank > 0 && currRank > 0) {
      return { rankDelta: prevRank - currRank, isNew: false };
    }
  }
  return { rankDelta: null, isNew: true };
}

export function mapEpisodeRow(row, hasPrevBaseline = false) {
  const { rankDelta, isNew } = computeRankTrend(row, hasPrevBaseline);
  return {
    rank: row.rank,
    rankDelta,
    isNew,
    eid: row.eid,
    title: row.title,
    podcastID: row.podcast_id_raw,
    podcastPid: row.podcast_pid || "",
    podcastName: row.podcast_name,
    logoURL: row.logo_url,
    link: row.link,
    playCount: row.play_count,
    commentCount: row.comment_count,
    subscription: row.subscription,
    duration: row.duration_min,
    postTime: row.post_time,
    primaryGenreName: row.primary_genre,
    totalEpisodesCount: row.total_episodes_count,
    openRate: row.open_rate,
    interactiveRate: row.interactive_rate,
    lastReleaseDateDayCount: row.last_release_days,
  };
}

export function mapPodcastRow(row, hasPrevBaseline = false) {
  const { rankDelta, isNew } = computeRankTrend(row, hasPrevBaseline);
  return {
    rank: row.rank,
    rankDelta,
    isNew,
    pid: row.pid,
    id: row.raw_id,
    name: row.name,
    logoURL: row.logo_url,
    primaryGenreName: row.primary_genre,
    authorsText: row.authors_text,
    trackCount: row.track_count,
    lastReleaseDate: row.last_release_date,
    lastReleaseDateDayCount: row.last_release_days,
    firstEpisodePostTime: row.first_episode_time,
    activeRate: row.active_rate,
    avgDuration: row.avg_duration_min,
    avgPlayCount: row.avg_play_count,
    avgUpdateFreq: row.avg_update_freq_hours,
    avgCommentCount: row.avg_comment_count,
    avgInteractIndicator: row.avg_interact_indicator,
    avgOpenRate: row.avg_open_rate,
    xyzUrl: row.xyz_url,
    links: safeJsonParse(row.links_json, []),
  };
}

export async function handleBoardsMeta(env, request = null, ctx = null) {
  const [activeVersion, syncVersion] = await Promise.all([
    getActiveSyncVersion(env.DB),
    getEffectiveSyncVersion(env.DB),
  ]);

  if (!syncVersion) {
    return json(
      {
        syncVersion: null,
        isComplete: false,
        updatedAt: null,
        boards: {},
      },
      200,
      { "Cache-Control": "no-store" }
    );
  }

  const isActiveVersion = activeVersion === syncVersion;
  const edgeCache = getEdgeCache();
  const cacheReq = isActiveVersion ? buildVersionedCacheRequest(request, syncVersion) : null;
  if (edgeCache && cacheReq) {
    const hit = await edgeCache.match(cacheReq);
    if (hit) return hit;
  }

  const [metaRows, cachedGenres] = await Promise.all([
    env.DB.prepare("SELECT * FROM board_meta WHERE sync_version = ?1").bind(syncVersion).all(),
    getCachedBoardGenres(env.DB, syncVersion),
  ]);

  const genresByBoard =
    cachedGenres ||
    (await computeBoardGenres(env.DB, syncVersion, { persist: isActiveVersion }));

  const boards = {};
  let latestUpdatedAt = null;
  for (const row of metaRows?.results || []) {
    boards[row.board] = {
      board: row.board,
      total: row.total,
      syncedCount: row.synced_count,
      medianValues: safeJsonParse(row.median_values_json, {}),
      updatedAt: row.updated_at,
      genres: genresByBoard[row.board] || [],
    };
    if (!latestUpdatedAt || row.updated_at > latestUpdatedAt) {
      latestUpdatedAt = row.updated_at;
    }
  }

  const isComplete = isActiveVersion && BOARD_ORDER.every((b) => Boolean(boards[b]));
  const response = json(
    {
      syncVersion,
      isComplete,
      updatedAt: latestUpdatedAt,
      boards,
    },
    200,
    isComplete ? COMPLETE_CACHE_HEADERS : PARTIAL_CACHE_HEADERS
  );

  if (edgeCache && cacheReq && isComplete) {
    const putPromise = edgeCache.put(cacheReq, response.clone());
    if (ctx?.waitUntil) ctx.waitUntil(putPromise);
    else await putPromise.catch(() => {});
  }

  return response;
}

export async function handleBoardQuery(board, url, env, request = null, ctx = null) {
  const cfg = BOARD_CONFIG[board];
  if (!cfg) {
    return errorJson(`Unsupported board: ${board}`, 400);
  }

  const [activeVersion, syncVersion] = await Promise.all([
    getActiveSyncVersion(env.DB),
    getEffectiveSyncVersion(env.DB),
  ]);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 100);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const genre = (url.searchParams.get("genre") || "").trim().slice(0, 60);
  const sortParam = (url.searchParams.get("sort") || "rank").trim();
  const dirParam = (url.searchParams.get("dir") || "").trim().toLowerCase();

  if (!syncVersion) {
    return json(
      {
        board,
        syncVersion: null,
        updatedAt: null,
        total: 0,
        offset,
        limit,
        medianValues: {},
        items: [],
      },
      200,
      { "Cache-Control": "no-store" }
    );
  }

  const prevVersion = await getPreviousSyncVersion(env.DB, syncVersion);
  const isActiveVersion = activeVersion === syncVersion;
  const edgeCache = getEdgeCache();
  const cacheReq = isActiveVersion
    ? buildVersionedCacheRequest(request, syncVersion, prevVersion || "")
    : null;
  if (edgeCache && cacheReq) {
    const hit = await edgeCache.match(cacheReq);
    if (hit) return hit;
  }

  const isEpisode = cfg.type === "episode";
  const table = isEpisode ? "episodes_rank" : "podcasts_rank";
  const sortMap = isEpisode ? EPISODE_SORT_COLUMNS : PODCAST_SORT_COLUMNS;
  const sortCol = sortMap[sortParam] || "rank";
  const resolvedSortKey = sortMap[sortParam] ? sortParam : "rank";
  const sortDir =
    dirParam === "asc" || dirParam === "desc"
      ? dirParam.toUpperCase()
      : resolvedSortKey === "rank"
        ? "ASC"
        : "DESC";

  const where = ["sync_version = ?1", "board = ?2"];
  const baseParams = [syncVersion, board];
  let idx = 3;

  if (genre && genre !== "all") {
    where.push(`primary_genre = ?${idx}`);
    baseParams.push(genre);
    idx += 1;
  }

  if (q) {
    const pattern = `%${escapeLikePattern(q)}%`;
    if (isEpisode) {
      where.push(
        `(title LIKE ?${idx} ESCAPE '\\' OR podcast_name LIKE ?${idx} ESCAPE '\\' OR primary_genre LIKE ?${idx} ESCAPE '\\')`
      );
    } else {
      where.push(
        `(name LIKE ?${idx} ESCAPE '\\' OR authors_text LIKE ?${idx} ESCAPE '\\' OR primary_genre LIKE ?${idx} ESCAPE '\\')`
      );
    }
    baseParams.push(pattern);
    idx += 1;
  }

  const whereSql = where.join(" AND ");
  const limitIdx = idx;
  const offsetIdx = idx + 1;
  const prevVerIdx = idx + 2;
  const countSql = `SELECT COUNT(*) AS total FROM ${table} WHERE ${whereSql}`;

  const dataSql = isEpisode
    ? `WITH page AS (
         SELECT * FROM episodes_rank
         WHERE ${whereSql}
         ORDER BY ${sortCol} ${sortDir}, rank ASC
         LIMIT ?${limitIdx} OFFSET ?${offsetIdx}
       )
       SELECT
         page.*,
         prev.rank AS prev_rank,
         COALESCE(NULLIF(pod.pid, ''), NULLIF(npod.pid, ''), '') AS podcast_pid
       FROM page
       LEFT JOIN episodes_rank prev
         ON prev.sync_version = ?${prevVerIdx} AND prev.board = page.board AND prev.eid = page.eid
       LEFT JOIN podcasts_rank pod
         ON page.podcast_id_raw != '' AND pod.sync_version = page.sync_version AND pod.board = 'podcasts' AND pod.raw_id = page.podcast_id_raw
       LEFT JOIN podcasts_rank npod
         ON page.podcast_id_raw != '' AND npod.sync_version = page.sync_version AND npod.board = 'new-podcasts' AND npod.raw_id = page.podcast_id_raw
       ORDER BY page.${sortCol} ${sortDir}, page.rank ASC`
    : `WITH page AS (
         SELECT * FROM podcasts_rank
         WHERE ${whereSql}
         ORDER BY ${sortCol} ${sortDir}, rank ASC
         LIMIT ?${limitIdx} OFFSET ?${offsetIdx}
       )
       SELECT
         page.*,
         prev.rank AS prev_rank
       FROM page
       LEFT JOIN podcasts_rank prev
         ON prev.sync_version = ?${prevVerIdx} AND prev.board = page.board AND prev.raw_id = page.raw_id
       ORDER BY page.${sortCol} ${sortDir}, page.rank ASC`;

  const [metaRow, prevMetaRow, countRow, itemsRes] = await Promise.all([
    env.DB.prepare("SELECT median_values_json, updated_at FROM board_meta WHERE sync_version = ?1 AND board = ?2")
      .bind(syncVersion, board)
      .first(),
    prevVersion
      ? env.DB.prepare("SELECT 1 AS ok FROM board_meta WHERE sync_version = ?1 AND board = ?2")
          .bind(prevVersion, board)
          .first()
      : Promise.resolve(null),
    env.DB.prepare(countSql).bind(...baseParams).first(),
    env.DB.prepare(dataSql).bind(...baseParams, limit, offset, prevVersion || "").all(),
  ]);

  const hasPrevBaseline = Boolean(prevMetaRow?.ok);
  const rows = itemsRes?.results || [];
  const items = rows.map((row) =>
    isEpisode ? mapEpisodeRow(row, hasPrevBaseline) : mapPodcastRow(row, hasPrevBaseline)
  );

  const response = json(
    {
      board,
      syncVersion,
      prevSyncVersion: hasPrevBaseline ? prevVersion : null,
      updatedAt: metaRow?.updated_at || null,
      total: Number(countRow?.total) || 0,
      offset,
      limit,
      sort: resolvedSortKey,
      dir: sortDir.toLowerCase(),
      medianValues: safeJsonParse(metaRow?.median_values_json, {}),
      items,
    },
    200,
    isActiveVersion ? COMPLETE_CACHE_HEADERS : PARTIAL_CACHE_HEADERS
  );

  if (edgeCache && cacheReq && isActiveVersion) {
    const putPromise = edgeCache.put(cacheReq, response.clone());
    if (ctx?.waitUntil) ctx.waitUntil(putPromise);
    else await putPromise.catch(() => {});
  }

  return response;
}
