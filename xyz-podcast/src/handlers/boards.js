import { getActiveSyncVersion, getEffectiveSyncVersion } from "../db/schema.js";
import { BOARD_CONFIG, BOARD_ORDER } from "../db/sync.js";
import { clampInt, errorJson, json, safeJsonParse } from "../utils/http.js";

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

function mapEpisodeRow(row) {
  return {
    rank: row.rank,
    eid: row.eid,
    title: row.title,
    podcastID: row.podcast_id_raw,
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

function mapPodcastRow(row) {
  return {
    rank: row.rank,
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

export async function handleBoardsMeta(env) {
  const [activeVersion, syncVersion] = await Promise.all([
    getActiveSyncVersion(env.DB),
    getEffectiveSyncVersion(env.DB),
  ]);

  if (!syncVersion) {
    return json({
      syncVersion: null,
      isComplete: false,
      updatedAt: null,
      boards: {},
    });
  }

  const [metaRows, epGenresRows, podGenresRows] = await Promise.all([
    env.DB.prepare("SELECT * FROM board_meta WHERE sync_version = ?1").bind(syncVersion).all(),
    env.DB.prepare(
      `SELECT board, primary_genre AS genre, COUNT(*) AS count
       FROM episodes_rank
       WHERE sync_version = ?1 AND primary_genre != ''
       GROUP BY board, primary_genre
       ORDER BY count DESC`
    )
      .bind(syncVersion)
      .all(),
    env.DB.prepare(
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

  return json({
    syncVersion,
    isComplete: activeVersion === syncVersion && BOARD_ORDER.every((b) => Boolean(boards[b])),
    updatedAt: latestUpdatedAt,
    boards,
  });
}

export async function handleBoardQuery(board, url, env) {
  const cfg = BOARD_CONFIG[board];
  if (!cfg) {
    return errorJson(`Unsupported board: ${board}`, 400);
  }

  const syncVersion = await getEffectiveSyncVersion(env.DB);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 100);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const genre = (url.searchParams.get("genre") || "").trim().slice(0, 60);
  const sortParam = (url.searchParams.get("sort") || "rank").trim();
  const dirParam = (url.searchParams.get("dir") || "").trim().toLowerCase();

  if (!syncVersion) {
    return json({
      board,
      syncVersion: null,
      updatedAt: null,
      total: 0,
      offset,
      limit,
      medianValues: {},
      items: [],
    });
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
  const params = [syncVersion, board];
  let idx = 3;

  if (genre && genre !== "all") {
    where.push(`primary_genre = ?${idx}`);
    params.push(genre);
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
    params.push(pattern);
    idx += 1;
  }

  const whereSql = where.join(" AND ");
  const countSql = `SELECT COUNT(*) AS total FROM ${table} WHERE ${whereSql}`;
  const dataSql = `SELECT * FROM ${table} WHERE ${whereSql} ORDER BY ${sortCol} ${sortDir}, rank ASC LIMIT ?${idx} OFFSET ?${idx + 1}`;

  const [metaRow, countRow, itemsRes] = await Promise.all([
    env.DB.prepare("SELECT median_values_json, updated_at FROM board_meta WHERE sync_version = ?1 AND board = ?2")
      .bind(syncVersion, board)
      .first(),
    env.DB.prepare(countSql).bind(...params).first(),
    env.DB.prepare(dataSql).bind(...params, limit, offset).all(),
  ]);

  const rows = itemsRes?.results || [];
  const items = rows.map(isEpisode ? mapEpisodeRow : mapPodcastRow);

  return json({
    board,
    syncVersion,
    updatedAt: metaRow?.updated_at || null,
    total: Number(countRow?.total) || 0,
    offset,
    limit,
    sort: resolvedSortKey,
    dir: sortDir.toLowerCase(),
    medianValues: safeJsonParse(metaRow?.median_values_json, {}),
    items,
  });
}
