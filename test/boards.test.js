import test from "node:test";
import assert from "node:assert/strict";
import { handleBoardQuery } from "../src/handlers/boards.js";
import { createD1Binding, createSqliteDb, insertRows } from "./helpers/sqliteD1.js";

const PREV_VERSION = "20261122T00";
const ACTIVE_VERSION = "20261123T00";
const PODCAST_COLUMNS = [
  "sync_version",
  "board",
  "rank",
  "pid",
  "raw_id",
  "name",
  "logo_url",
  "primary_genre",
  "authors_text",
  "track_count",
  "last_release_date",
  "last_release_days",
  "first_episode_time",
  "active_rate",
  "avg_duration_min",
  "avg_play_count",
  "avg_update_freq_hours",
  "avg_comment_count",
  "avg_interact_indicator",
  "avg_open_rate",
  "xyz_url",
  "links_json",
];
const EPISODE_COLUMNS = [
  "sync_version",
  "board",
  "rank",
  "eid",
  "title",
  "podcast_id_raw",
  "podcast_name",
  "logo_url",
  "link",
  "play_count",
  "comment_count",
  "subscription",
  "duration_min",
  "post_time",
  "primary_genre",
  "total_episodes_count",
  "open_rate",
  "interactive_rate",
  "last_release_days",
];
const GENRES = ["科技", "社会文化", "喜剧"];

function podcastName(rank) {
  if (rank === 7) return "100% 真实播客";
  if (rank === 11) return "under_score radio";
  return rank % 5 === 0 ? `AI Podcast ${rank}` : `Podcast ${rank}`;
}

function podcastRow(version, board, rank) {
  return [
    version,
    board,
    rank,
    `pid-${board}-${rank}`,
    `raw-${board}-${rank}`,
    podcastName(rank),
    "",
    GENRES[rank % GENRES.length],
    `Author ${rank}`,
    10 + rank,
    "2026-11-20T00:00:00.000Z",
    3,
    "2020-01-01T00:00:00.000Z",
    0.5,
    60,
    1000 * (500 - rank),
    24 * (rank % 7),
    5 * rank,
    0.01,
    0.2,
    `https://www.xiaoyuzhoufm.com/podcast/pid-${board}-${rank}`,
    "[]",
  ];
}

function episodeRow(version, board, rank) {
  return [
    version,
    board,
    rank,
    `eid-${board}-${rank}`,
    rank % 4 === 0 ? `AI Episode ${rank}` : `Episode ${rank}`,
    `raw-podcasts-${rank}`,
    `Podcast ${rank}`,
    "",
    `https://www.xiaoyuzhoufm.com/episode/eid-${board}-${rank}`,
    9000 * (300 - rank),
    90 * rank,
    1000 * rank,
    45,
    "2026-11-21T00:00:00.000Z",
    GENRES[rank % GENRES.length],
    50,
    0.3,
    0.02,
    2,
  ];
}

/** Two synced versions (previous + active) with 120 podcasts and 60 episodes in each board. */
function setup() {
  const sqlite = createSqliteDb();
  const db = createD1Binding(sqlite);
  const podcasts = [];
  const episodes = [];
  const boardMeta = [];
  for (const version of [PREV_VERSION, ACTIVE_VERSION]) {
    // The previous version lacks one podcast, so rank 120 is new in the active one.
    const podcastRanks = Array.from({ length: version === ACTIVE_VERSION ? 120 : 119 }, (_, i) => i + 1);
    podcasts.push(...podcastRanks.map((rank) => podcastRow(version, "podcasts", rank)));
    podcasts.push(...[1, 2, 3, 4, 5].map((rank) => podcastRow(version, "new-podcasts", rank)));
    episodes.push(...Array.from({ length: 60 }, (_, i) => episodeRow(version, "episodes", i + 1)));
    episodes.push(...[1, 2, 3, 4].map((rank) => episodeRow(version, "new-episodes", rank)));
    boardMeta.push(
      [version, "podcasts", podcastRanks.length, podcastRanks.length, '{"avgPlayCount": 5}', `${version} 08:10:00`],
      [version, "new-podcasts", 5, 5, "{}", `${version} 08:05:00`],
      [version, "episodes", 60, 60, "{}", `${version} 08:02:00`],
      [version, "new-episodes", 4, 4, "{}", `${version} 08:03:00`]
    );
  }
  insertRows(sqlite, "podcasts_rank", PODCAST_COLUMNS, podcasts);
  insertRows(sqlite, "episodes_rank", EPISODE_COLUMNS, episodes);
  insertRows(sqlite, "board_meta", ["sync_version", "board", "total", "synced_count", "median_values_json", "updated_at"], boardMeta);
  insertRows(sqlite, "app_state", ["key", "value", "updated_at"], [
    ["active_sync_version", ACTIVE_VERSION, "2026-11-23T00:12:00.000Z"],
    ["prev_sync_version", PREV_VERSION, "2026-11-23T00:12:00.000Z"],
  ]);
  insertRows(sqlite, "sync_runs", ["run_id", "slot", "status", "current_board", "items_written", "started_at", "finished_at"], [
    [PREV_VERSION, "20261122T00", "completed", "done", 889, "2026-11-22T00:00:00.000Z", "2026-11-22T00:12:00.000Z"],
    [ACTIVE_VERSION, "20261123T00", "completed", "done", 900, "2026-11-23T00:00:00.000Z", "2026-11-23T00:12:00.000Z"],
  ]);
  return { sqlite, db, env: { DB: db } };
}

async function query(env, board, params = {}) {
  const url = new URL(`http://localhost/api/boards/${board}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const res = await handleBoardQuery(board, url, env);
  assert.equal(res.status, 200);
  return res.json();
}

const countQueries = (db) => db.queries.filter((sql) => sql.includes("COUNT(*)")).length;

test("unfiltered pages of the active version read their total from board_meta without COUNT(*)", async () => {
  const { env, db } = setup();

  for (const offset of [0, 40, 80]) {
    const body = await query(env, "podcasts", { offset, limit: 40, sort: "rank", dir: "asc" });
    assert.equal(body.total, 120);
    assert.equal(body.items.length, 40);
    assert.equal(body.items[0].rank, offset + 1);
  }
  assert.equal(countQueries(db), 0, "COUNT(*) scans the whole board on every request");

  const last = await query(env, "podcasts", { offset: 120, limit: 40 });
  assert.equal(last.total, 120);
  assert.equal(last.items.length, 0);
  assert.equal(countQueries(db), 0);
});

test("unfiltered totals still work for sorted pages and for the episode boards", async () => {
  const { env, db } = setup();

  const sorted = await query(env, "podcasts", { limit: 5, sort: "avgPlayCount", dir: "desc" });
  assert.equal(sorted.total, 120);
  assert.deepEqual(sorted.items.map((item) => item.rank), [1, 2, 3, 4, 5], "higher rank number means lower play count");

  const episodes = await query(env, "episodes", { limit: 40 });
  assert.equal(episodes.total, 60);
  assert.equal(episodes.items[0].eid, "eid-episodes-1");
  assert.equal(episodes.items[0].podcastPid, "pid-podcasts-1", "episode rows join the podcast pid");
  assert.equal(episodes.prevSyncVersion, PREV_VERSION);

  const newEpisodes = await query(env, "new-episodes", {});
  assert.equal(newEpisodes.total, 4);
  assert.equal(newEpisodes.items.length, 4);

  assert.equal(countQueries(db), 0);
});

test("a filtered query counts once, then reuses the total for its other pages and sorts", async () => {
  const { env, db } = setup();

  const first = await query(env, "podcasts", { q: "AI", limit: 10 });
  assert.equal(first.total, 24, "every 5th podcast of 120");
  assert.equal(first.items.length, 10);
  assert.equal(countQueries(db), 1);

  const second = await query(env, "podcasts", { q: "AI", limit: 10, offset: 10, sort: "avgPlayCount", dir: "desc" });
  assert.equal(second.total, 24);
  assert.equal(second.items.length, 10);
  assert.equal(countQueries(db), 1, "later pages of the same filter must not count again");

  const byGenre = await query(env, "podcasts", { genre: "科技", limit: 100 });
  assert.equal(byGenre.total, 40);
  assert.ok(byGenre.items.every((item) => item.primaryGenreName === "科技"));
  assert.equal(countQueries(db), 2, "another filter is counted separately");
});

test("LIKE wildcards in the search text are matched literally", async () => {
  const { env } = setup();

  const percent = await query(env, "podcasts", { q: "%" });
  assert.deepEqual(percent.items.map((item) => item.rank), [7]);

  const underscore = await query(env, "podcasts", { q: "under_score" });
  assert.deepEqual(underscore.items.map((item) => item.rank), [11]);
});

test("unknown sort columns and directions fall back to the defaults and the limit is capped", async () => {
  const { env } = setup();

  const injected = await query(env, "podcasts", { sort: "rank; DROP TABLE podcasts_rank", dir: "sideways", limit: 500 });
  assert.equal(injected.sort, "rank");
  assert.equal(injected.dir, "asc");
  assert.equal(injected.limit, 100);
  assert.equal(injected.items.length, 100);
  assert.equal(injected.items[0].rank, 1);

  const stillThere = await query(env, "podcasts", { limit: 1 });
  assert.equal(stillThere.total, 120);
});

test("rank trends compare against the previous version", async () => {
  const { env } = setup();

  // The limit is capped at 100 rows per request.
  const firstPage = await query(env, "podcasts", { limit: 100 });
  const secondPage = await query(env, "podcasts", { limit: 100, offset: 100 });
  const byRank = new Map([...firstPage.items, ...secondPage.items].map((item) => [item.rank, item]));
  assert.equal(byRank.size, 120);
  assert.equal(byRank.get(1).rankDelta, 0);
  assert.equal(byRank.get(120).isNew, true, "rank 120 is missing from the previous version");
  assert.equal(byRank.get(120).rankDelta, null);
  assert.equal(byRank.get(60).rankDelta, 0);
});

test("a board_meta row without a usable total falls back to COUNT(*)", async () => {
  const { env, sqlite, db } = setup();
  sqlite.prepare("DELETE FROM board_meta WHERE sync_version = ? AND board = ?").run(ACTIVE_VERSION, "podcasts");

  const body = await query(env, "podcasts", { limit: 40 });
  assert.equal(body.total, 120);
  assert.deepEqual(body.medianValues, {});
  assert.equal(body.updatedAt, null);
  assert.equal(countQueries(db), 1);
});

test("without an active version the partially synced data is counted on every request", async () => {
  const { env, sqlite, db } = setup();
  sqlite.prepare("DELETE FROM app_state WHERE key IN ('active_sync_version', 'prev_sync_version')").run();

  const first = await query(env, "podcasts", { limit: 40 });
  assert.equal(first.syncVersion, ACTIVE_VERSION, "falls back to the latest run that wrote rows");
  assert.equal(first.total, 120);

  sqlite.prepare("DELETE FROM podcasts_rank WHERE sync_version = ? AND rank > ?").run(ACTIVE_VERSION, 90);
  const second = await query(env, "podcasts", { limit: 40 });
  assert.equal(second.total, 90, "partial data is not cached");
  assert.equal(countQueries(db), 2);
});
