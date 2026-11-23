import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOARD_ORDER,
  computeDailyRunKey,
  computeSyncRunKey,
  extractEpisodeId,
  extractPodcastLinkInfo,
  normalizeEpisodeItem,
  normalizePodcastItem,
  runSyncBatch,
} from "../src/db/sync.js";
import { createD1Binding, createSqliteDb, insertRows } from "./helpers/sqliteD1.js";

test("extractEpisodeId extracts XiaoYuZhou episode ID from link", () => {
  assert.equal(
    extractEpisodeId("https://www.xiaoyuzhoufm.com/episode/6aec7f8c5b7c4709bfe1a757"),
    "6aec7f8c5b7c4709bfe1a757"
  );
  assert.equal(extractEpisodeId("https://example.com/other"), "");
  assert.equal(extractEpisodeId(null), "");
});

test("extractPodcastLinkInfo extracts XiaoYuZhou podcast ID from links array", () => {
  const links = [
    { name: "xyz", url: "https://www.xiaoyuzhoufm.com/podcast/625635587bfca4e73e990703" },
    { name: "apple", url: "https://podcasts.apple.com/cn/podcast/id123456" },
  ];
  assert.deepEqual(extractPodcastLinkInfo(links), {
    pid: "625635587bfca4e73e990703",
    xyzUrl: "https://www.xiaoyuzhoufm.com/podcast/625635587bfca4e73e990703",
  });
  assert.deepEqual(extractPodcastLinkInfo([]), { pid: "", xyzUrl: "" });
});

test("normalizeEpisodeItem computes rates and handles missing fields safely", () => {
  const row = normalizeEpisodeItem(
    {
      rank: 1,
      title: "Test Episode",
      podcastID: "md5raw",
      podcastName: "Test Pod",
      logoURL: "https://img.test/a.jpg",
      link: "https://www.xiaoyuzhoufm.com/episode/6aec7f8c5b7c4709bfe1a757",
      playCount: 1000,
      commentCount: 50,
      subscription: 2000,
      duration: 60,
      postTime: "2026-11-05T13:27:23.383Z",
      primaryGenreName: " 科技 ",
      totalEpisodesCount: 100,
    },
    "20261117T00",
    "episodes"
  );
  assert.equal(row.eid, "6aec7f8c5b7c4709bfe1a757");
  assert.equal(row.interactiveRate, 0.05);
  assert.equal(row.openRate, 0.5);
  assert.equal(row.primaryGenre, "科技");
  assert.equal(row.durationMin, 60);

  const fallbackRow = normalizeEpisodeItem({ rank: 9, title: "No Link", playCount: 0 }, "v1", "episodes");
  assert.equal(fallbackRow.eid, "raw-9-ep");
  assert.equal(fallbackRow.interactiveRate, 0);
});

test("normalizePodcastItem extracts pid and defaults safely", () => {
  const row = normalizePodcastItem(
    {
      id: "raw123",
      rank: 2,
      name: "Podcast Name",
      links: [{ name: "xyz", url: "https://www.xiaoyuzhoufm.com/podcast/625635587bfca4e73e990703" }],
      avgUpdateFreq: 48,
    },
    "20261117T00",
    "podcasts"
  );
  assert.equal(row.pid, "625635587bfca4e73e990703");
  assert.equal(row.rawId, "raw123");
  assert.equal(row.avgUpdateFreqHours, 48);
});

test("computeSyncRunKey uses UTC slot", () => {
  const key = computeSyncRunKey(new Date("2026-11-17T00:06:00Z"));
  assert.deepEqual(key, { runId: "20261117T00", slot: "00" });
});

test("computeDailyRunKey gives every trigger of the day the run of the 08:00 slot", () => {
  const runIdAt = (iso) => computeDailyRunKey(new Date(iso));
  assert.deepEqual(runIdAt("2026-11-17T00:04:00Z"), { runId: "20261117T00", slot: "00" });
  assert.equal(runIdAt("2026-11-17T02:30:00Z").runId, "20261117T00", "10:30 in Beijing");
  assert.equal(runIdAt("2026-11-17T10:30:00Z").runId, "20261117T00", "18:30 in Beijing");
  assert.equal(runIdAt("2026-11-17T23:59:59Z").runId, "20261117T00");
  assert.equal(runIdAt("2026-11-18T00:00:00Z").runId, "20261118T00", "the next day has its own");
});

test("the cron keeps the morning window and comes back twice for a run that is not finished", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const crons = JSON.parse(toml.match(/^crons = (\[.*\])$/m)[1]);
  // 08:00-08:30, 10:00-10:30 and 18:00-18:30 in Beijing time, every 2 minutes.
  assert.deepEqual(crons, ["0-30/2 0,2,10 * * *"]);
});

const DAY = Date.parse("2026-11-23T00:00:00Z");
const at = (minutes) => new Date(DAY + minutes * 60_000);
const RUN = "20261123T00";
const ACTIVE = "20261122T00";
const PREV = "20261121T00";
// Leftovers of a run that never completed.
const OLDER = "20261120T00";
// The totals of 2026-11-23: 8 + 1 + 2 + 82 = 93 pages of 100 items.
const LIVE_TOTALS = { episodes: 791, "new-episodes": 19, "new-podcasts": 131, podcasts: 8191 };
// Small enough to read at a glance: 2 + 1 + 1 + 3 = 7 pages.
const SMALL_TOTALS = { episodes: 150, "new-episodes": 10, "new-podcasts": 20, podcasts: 250 };

/** xyzrank's four list endpoints; `failOn(call, requestNumber)` returns a status to fail with. */
function fakeXyzrank(totals, { failOn = () => 0 } = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    const { pathname, searchParams } = new URL(url);
    const board = pathname.split("/").pop();
    const offset = Number(searchParams.get("offset"));
    const limit = Number(searchParams.get("limit"));
    const call = { board, offset, limit };
    calls.push(call);
    const failure = failOn(call, calls.length);
    if (failure) return new Response("boom", { status: failure });

    const count = Math.max(0, Math.min(limit, totals[board] - offset));
    const items = Array.from({ length: count }, (_, idx) => {
      const rank = offset + idx + 1;
      return board.includes("episodes")
        ? {
            rank,
            title: `${board} ${rank}`,
            podcastName: `播客 ${rank}`,
            link: `https://www.xiaoyuzhoufm.com/episode/${String(rank).padStart(24, "e")}`,
            playCount: 1000,
            commentCount: 10,
            primaryGenreName: "科技",
          }
        : {
            id: `${board}-${rank}`,
            rank,
            name: `${board} ${rank}`,
            links: [{ name: "xyz", url: `https://www.xiaoyuzhoufm.com/podcast/${String(rank).padStart(24, "p")}` }],
            primaryGenreName: "商业",
          };
    });
    return new Response(JSON.stringify({ items, total: totals[board], offset, limit, medianValues: { playCount: 50 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, fetchFn };
}

const pages = (calls) => calls.map((call) => `${call.board}@${call.offset}`);
const outline = (invocations) => invocations.map((one) => [one.batchPages, one.queries]);

/** The database as it is on the morning of a sync: two published versions, nothing for today. */
function setup(totals, options = {}) {
  const sqlite = createSqliteDb();
  const db = createD1Binding(sqlite);
  const published = [PREV, ACTIVE];
  const iso = (version, time) => `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}T${time}`;

  insertRows(
    sqlite,
    "episodes_rank",
    ["sync_version", "board", "rank", "eid", "title"],
    published.flatMap((version) => [
      [version, "episodes", 1, `eid-${version}`, "单集"],
      [version, "podcasts", 2, `eid2-${version}`, "单集"],
    ])
  );
  insertRows(sqlite, "episodes_rank", ["sync_version", "board", "rank", "eid", "title"], [
    [OLDER, "episodes", 1, "eid-older", "未完成的单集"],
  ]);
  insertRows(
    sqlite,
    "podcasts_rank",
    ["sync_version", "board", "rank", "raw_id", "name"],
    published.map((version) => [version, "podcasts", 1, `raw-${version}`, "播客"])
  );
  insertRows(
    sqlite,
    "board_meta",
    ["sync_version", "board", "total", "synced_count", "median_values_json", "updated_at"],
    published.flatMap((version) =>
      BOARD_ORDER.map((board) => [version, board, 10, 10, "{}", iso(version, "00:10:00.000Z")])
    )
  );
  insertRows(sqlite, "board_meta", ["sync_version", "board", "total", "synced_count", "median_values_json", "updated_at"], [
    [OLDER, "episodes", 100, 100, "{}", iso(OLDER, "00:05:00.000Z")],
  ]);
  insertRows(sqlite, "app_state", ["key", "value", "updated_at"], [
    ["active_sync_version", ACTIVE, iso(ACTIVE, "00:12:00.000Z")],
    ["prev_sync_version", PREV, iso(ACTIVE, "00:12:00.000Z")],
    [`genres:${ACTIVE}`, "{}", iso(ACTIVE, "00:12:00.000Z")],
    [`genres:${PREV}`, "{}", iso(ACTIVE, "00:12:00.000Z")],
  ]);

  const upstream = fakeXyzrank(totals, options);
  const run = (minute, extra = {}) =>
    runSyncBatch(db, { now: at(minute), clock: () => at(minute), fetchFn: upstream.fetchFn, ...extra });
  const runRow = () => sqlite.prepare("SELECT * FROM sync_runs WHERE run_id = ?").get(RUN) || null;
  const cursor = () => {
    const row = runRow();
    return `${row.current_board}@${row.current_offset}`;
  };
  const rows = (table, version) =>
    sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE sync_version = ?`).get(version).n;
  const state = (key) => sqlite.prepare("SELECT value FROM app_state WHERE key = ?").get(key)?.value ?? null;
  /** One trigger every two minutes until the day's sync is done, each with its D1 query count. */
  const runDay = async (extra = {}) => {
    const invocations = [];
    for (let minute = 0; minute < 60 && !invocations.at(-1)?.done; minute += 2) {
      const queriesBefore = db.roundTrips;
      invocations.push({ ...(await run(minute, extra)), queries: db.roundTrips - queriesBefore });
    }
    return invocations;
  };
  return { sqlite, db, upstream, run, runRow, cursor, rows, state, runDay };
}

/** Run `hook` just before the first batch that contains a statement prepared from `sql`. */
function beforeBatchWith(db, sql, hook) {
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  const matching = new WeakSet();
  db.prepare = (text) => {
    const statement = prepare(text);
    if (text.includes(sql)) matching.add(statement);
    return statement;
  };
  let fired = false;
  db.batch = async (statements) => {
    if (!fired && statements.some((statement) => matching.has(statement))) {
      fired = true;
      await hook();
    }
    return batch(statements);
  };
}

/** Run `hook` just before the first statement prepared from `sql` is sent on its own. */
function beforeStatementRuns(db, sql, hook) {
  const prepare = db.prepare.bind(db);
  let fired = false;
  db.prepare = (text) => {
    const statement = prepare(text);
    if (!text.includes(sql)) return statement;
    const run = statement.run.bind(statement);
    statement.run = async () => {
      if (!fired) {
        fired = true;
        await hook();
      }
      return run();
    };
    return statement;
  };
}

test("runSyncBatch relays the boards across invocations, saving every page as it goes", async () => {
  const { db, upstream, run, runRow, cursor, rows, state } = setup(SMALL_TOTALS);

  const first = await run(0, { maxPages: 3 });
  assert.equal(first.done, false);
  assert.equal(first.batchPages, 3);
  assert.deepEqual(pages(upstream.calls), ["episodes@0", "episodes@100", "new-episodes@0"]);
  // The pages fetched so far are stored, with the cursor that follows them.
  assert.equal(rows("episodes_rank", RUN), 160);
  assert.equal(rows("podcasts_rank", RUN), 0);
  assert.equal(cursor(), "new-podcasts@0");
  assert.equal(runRow().pages_fetched, 3);
  assert.equal(runRow().locked_until, 0, "the lock is released at the end of a batch");
  assert.equal(state("active_sync_version"), ACTIVE, "nothing is published before the run completes");

  const second = await run(2, { maxPages: 3 });
  assert.equal(second.done, false);
  assert.deepEqual(pages(upstream.calls.slice(3)), ["new-podcasts@0", "podcasts@0", "podcasts@100"]);
  assert.equal(rows("podcasts_rank", RUN), 220);

  const third = await run(4, { maxPages: 3 });
  assert.equal(third.done, true);
  assert.equal(third.batchPages, 1);
  assert.equal(third.run.status, "completed");
  assert.equal(rows("episodes_rank", RUN), 160);
  assert.equal(rows("podcasts_rank", RUN), 270);

  // The finished run is published, and only the versions it supersedes are removed.
  assert.equal(state("active_sync_version"), RUN);
  assert.equal(state("prev_sync_version"), ACTIVE);
  assert.deepEqual(JSON.parse(state(`genres:${RUN}`)), {
    episodes: [{ genre: "科技", count: 150 }],
    "new-episodes": [{ genre: "科技", count: 10 }],
    "new-podcasts": [{ genre: "商业", count: 20 }],
    podcasts: [{ genre: "商业", count: 250 }],
  });
  assert.equal(rows("podcasts_rank", ACTIVE), 1, "the previous version stays for rank trends");
  assert.equal(rows("episodes_rank", PREV), 0);
  assert.equal(rows("podcasts_rank", PREV), 0);
  assert.equal(rows("board_meta", PREV), 0);
  assert.equal(state(`genres:${PREV}`), null);
  assert.equal(rows("episodes_rank", OLDER), 0, "leftovers of a run that never completed are removed too");
  assert.equal(rows("board_meta", OLDER), 0);
  assert.equal(runRow().locked_until, 0);

  // Later triggers of the day cost one query and fetch nothing.
  const queriesBefore = db.roundTrips;
  const fetchedBefore = upstream.calls.length;
  const later = await run(6);
  assert.deepEqual(
    { skipped: later.skipped, reason: later.reason, done: later.done },
    { skipped: true, reason: "already_completed", done: true }
  );
  assert.equal(db.roundTrips - queriesBefore, 1);
  assert.equal(upstream.calls.length, fetchedBefore);
});

test("no invocation comes near the 50 D1 queries the Free plan allows", async () => {
  // A full batch is 2 queries to start, 1 per page and 1 to read the result back;
  // the one that finishes the run adds 2 for the switch-over.
  const live = setup(LIVE_TOTALS);
  const day = await live.runDay();
  assert.deepEqual(outline(day), [
    [15, 18],
    [15, 18],
    [15, 18],
    [15, 18],
    [15, 18],
    [15, 18],
    [3, 8],
  ]);
  assert.equal(live.rows("podcasts_rank", RUN), 8322, "131 new podcasts and the board of 8,191");

  // A last batch that is full, right before the switch-over, used to need 51 to 54 queries.
  for (const [podcasts, expected] of [
    [2600, [[15, 18], [14, 19]]],
    [2700, [[15, 18], [15, 20]]],
  ]) {
    const { runDay } = setup({ episodes: 5, "new-episodes": 5, "new-podcasts": 5, podcasts });
    const day = await runDay();
    assert.deepEqual(outline(day), expected);
  }

  // The largest batch the admin API accepts still fits: one request and one query per page.
  const big = setup(LIVE_TOTALS);
  const queriesBefore = big.db.roundTrips;
  const result = await big.run(0, { maxPages: 100 });
  assert.equal(result.batchPages, 35, "more than 35 pages per invocation is not allowed");
  assert.equal(big.upstream.calls.length, 35);
  assert.equal(big.db.roundTrips - queriesBefore, 38);
});

test("a page is saved before the next one is fetched, so a failure resumes where it stopped", async () => {
  const { sqlite, upstream, run, runRow, cursor, rows } = setup(SMALL_TOTALS, {
    failOn: (call, request) => (request === 3 ? 503 : 0),
  });

  await assert.rejects(run(0, { maxPages: 3 }), /Upstream new-episodes offset=0 failed with HTTP 503/);
  // The two pages fetched before the failure are stored, and the run points at the page that failed.
  assert.equal(rows("episodes_rank", RUN), 150);
  assert.equal(runRow().pages_fetched, 2);
  assert.equal(cursor(), "new-episodes@0");
  // Saving pages before the failure means it is not counted as a failed attempt.
  assert.deepEqual(
    { status: runRow().status, failures: runRow().retry_count, error: runRow().last_error, lock: runRow().locked_until },
    {
      status: "running",
      failures: 0,
      error: "Upstream new-episodes offset=0 failed with HTTP 503",
      lock: 0,
    }
  );
  const stored = sqlite.prepare("SELECT synced_count FROM board_meta WHERE sync_version = ? AND board = 'episodes'").get(RUN);
  assert.equal(stored.synced_count, 150);

  // The next trigger carries on from there.
  const next = await run(2, { maxPages: 3 });
  assert.equal(next.batchPages, 3);
  assert.equal(pages(upstream.calls.slice(3))[0], "new-episodes@0");
  assert.equal(upstream.calls.filter((call) => call.board === "episodes").length, 2, "saved pages are not fetched again");
});

test("a run that keeps failing is asked less often, and is never given up", async () => {
  let healthy = false;
  const { run, runRow, upstream } = setup(LIVE_TOTALS, { failOn: () => (healthy ? 0 : 503) });

  // Every trigger of the half-hour window: the attempts fall 2, 4, 8 and 16
  // minutes apart instead of one every 2 minutes, and the rest are skipped.
  const attempts = [];
  for (let minute = 0; minute <= 30; minute += 2) {
    const fetchedBefore = upstream.calls.length;
    const result = await run(minute).catch((err) => ({ failed: err.message }));
    if (upstream.calls.length > fetchedBefore) attempts.push(minute);
    else assert.deepEqual([result.skipped, result.reason], [true, "backoff"]);
  }
  assert.deepEqual(attempts, [0, 2, 6, 14, 30]);
  assert.deepEqual(
    { status: runRow().status, failures: runRow().retry_count, error: runRow().last_error },
    { status: "failed", failures: 5, error: "Upstream episodes offset=0 failed with HTTP 503" }
  );
  assert.equal(runRow().locked_until, at(30).getTime() + 16 * 60_000);

  // However often it has failed, the next trigger after the wait picks it up again.
  healthy = true;
  const recovered = await run(48);
  assert.equal(recovered.batchPages, 15);
  assert.deepEqual(
    { status: runRow().status, failures: runRow().retry_count, error: runRow().last_error, lock: runRow().locked_until },
    { status: "running", failures: 0, error: null, lock: 0 }
  );
});

test("a run left as failed by the old counter is picked up again", async () => {
  const { sqlite, run, runRow, cursor } = setup(LIVE_TOTALS);
  // The counter used to grow with every failure, and a run that reached ten was
  // skipped for the rest of the day.
  sqlite
    .prepare(
      `INSERT INTO sync_runs (run_id, slot, status, current_board, current_offset, pages_fetched, items_written,
         retry_count, last_error, locked_until, started_at)
       VALUES (?, '00', 'failed', 'podcasts', 1900, 30, 2810, 12, 'Upstream podcasts offset=1900 failed with HTTP 500', 0, ?)`
    )
    .run(RUN, at(0).toISOString());

  const result = await run(0);
  assert.equal(result.skipped, false);
  assert.equal(result.batchPages, 15);
  assert.deepEqual([runRow().status, runRow().retry_count, runRow().last_error], ["running", 0, null]);
  assert.equal(cursor(), "podcasts@3400");
});

test("a saved page clears the failure count, so the next run of failures starts over", async () => {
  let healthy = false;
  const { run, runRow } = setup(LIVE_TOTALS, { failOn: () => (healthy ? 0 : 503) });

  await assert.rejects(run(0), /503/);
  await assert.rejects(run(2), /503/);
  assert.equal(runRow().retry_count, 2);
  assert.equal(runRow().locked_until, at(2).getTime() + 4 * 60_000);

  healthy = true;
  await run(6);
  assert.deepEqual([runRow().status, runRow().retry_count, runRow().last_error], ["running", 0, null]);

  healthy = false;
  await assert.rejects(run(8), /503/);
  assert.deepEqual([runRow().status, runRow().retry_count], ["failed", 1]);
  assert.equal(runRow().locked_until, at(8).getTime() + 2 * 60_000, "the first wait again, not the third");
});

test("an empty page in the middle of a board is an error, not the end of the board", async () => {
  const { upstream, run, runRow, cursor, rows, state } = setup(SMALL_TOTALS);
  // The sixth request is the second page of the podcasts board: the upstream
  // answers it with no items but the full total.
  let requests = 0;
  const fetchFn = async (url) => {
    requests += 1;
    if (requests !== 6) return upstream.fetchFn(url);
    return new Response(JSON.stringify({ items: [], total: 250, offset: 100, limit: 100 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(run(0, { maxPages: 7, fetchFn }), /podcasts offset=100 returned an empty page before the end of the board \(100 of 250\)/);
  // Taken for the end of the board, it would have published a run without the other 150 podcasts.
  assert.equal(state("active_sync_version"), ACTIVE);
  assert.equal(runRow().status, "running");
  assert.equal(cursor(), "podcasts@100");
  assert.equal(rows("podcasts_rank", RUN), 120, "the new podcasts and the first page of the board");

  const finished = await run(2, { maxPages: 7, fetchFn });
  assert.equal(finished.done, true);
  assert.equal(rows("podcasts_rank", RUN), 270);
  assert.equal(state("active_sync_version"), RUN);
});

test("a run that came back with a fraction of the current list is not published", async () => {
  const { sqlite, run, runRow, rows, state } = setup(SMALL_TOTALS);
  // The active version lists 400 items in each board; today's run finds 430 in all.
  sqlite.prepare("UPDATE board_meta SET total = 400 WHERE sync_version = ?").run(ACTIVE);

  await assert.rejects(
    run(0, { maxPages: 7 }),
    /Refusing to publish 20261123T00: the upstream lists 430 items, against 1600 in the active version/
  );
  assert.equal(state("active_sync_version"), ACTIVE);
  assert.equal(state("prev_sync_version"), PREV);
  assert.equal(rows("episodes_rank", PREV), 2, "the published versions are left alone");
  assert.deepEqual([runRow().status, runRow().retry_count], ["failed", 1]);
  assert.equal(runRow().last_error, "Refusing to publish 20261123T00: the upstream lists 430 items, against 1600 in the active version");
});

test("later triggers of the day continue the same run instead of starting another", async () => {
  const { sqlite, db, upstream, run, state } = setup(LIVE_TOTALS);
  const runs = () => sqlite.prepare("SELECT run_id FROM sync_runs ORDER BY run_id").all().map((row) => row.run_id);

  const morning = await run(0);
  assert.equal(morning.batchPages, 15);
  assert.equal(morning.catchUp, false);

  // A manual trigger outside the cron advances the same run.
  const manual = await run(300, { slotOverride: "manual" });
  assert.equal(manual.batchPages, 15);
  assert.deepEqual([manual.catchUp, manual.run.pages_fetched, runs().length], [false, 30, 1]);

  // The 10:00 window finds the run 64 pages from the end and finishes it there.
  const catchUp = [];
  for (let minute = 120; minute < 150 && !catchUp.at(-1)?.done; minute += 2) {
    catchUp.push(await run(minute));
  }
  assert.equal(catchUp.length, 5);
  assert.ok(catchUp.every((one) => one.catchUp));
  assert.deepEqual(runs(), [RUN], "no second version for the day");
  assert.equal(state("active_sync_version"), RUN);

  // The 18:00 window then costs one query per trigger and fetches nothing.
  const queriesBefore = db.roundTrips;
  const fetchedBefore = upstream.calls.length;
  const evening = await run(360);
  assert.deepEqual([evening.skipped, evening.reason, evening.catchUp], [true, "already_completed", true]);
  assert.deepEqual([db.roundTrips - queriesBefore, upstream.calls.length - fetchedBefore], [1, 0]);

  // A forced run is still a run of its own, and never a catch-up.
  const forced = await run(362, { force: true });
  assert.deepEqual([forced.catchUp, forced.run.run_id.startsWith(`${RUN}-m`), runs().length], [false, true, 2]);
});

test("a day whose morning window was missed is caught up at 10:00", async () => {
  const { upstream, run, runRow, state } = setup(LIVE_TOTALS);

  const catchUp = [];
  for (let minute = 120; minute < 150 && !catchUp.at(-1)?.done; minute += 2) {
    catchUp.push(await run(minute));
  }

  // Nothing had been fetched: the whole board, 93 pages, comes in the first catch-up window.
  assert.deepEqual(catchUp.map((one) => one.batchPages), [15, 15, 15, 15, 15, 15, 3]);
  assert.equal(upstream.calls.length, 93);
  assert.deepEqual([runRow().status, state("active_sync_version")], ["completed", RUN]);
});

test("a failed catch-up attempt is reported once; the morning window is not", async () => {
  let healthy = false;
  const alerts = [];
  const { upstream, run, state } = setup(LIVE_TOTALS, { failOn: () => (healthy ? 0 : 503) });
  const trigger = (minute) =>
    run(minute, {
      onAlert: async (message) => {
        alerts.push({ minute, message });
        return true;
      },
    }).catch(() => {});

  // A bad morning is what the catch-up windows are for.
  for (let minute = 0; minute <= 30; minute += 2) await trigger(minute);
  assert.equal(alerts.length, 0);

  // The 10:00 window tries twice (the waits are at their maximum by now) and reports the first failure.
  for (let minute = 120; minute <= 150; minute += 2) await trigger(minute);
  assert.deepEqual(
    alerts.map((alert) => alert.minute),
    [120]
  );
  assert.equal(
    alerts[0].message,
    "xyz-podcast 榜单同步没有完成（20261123T00）：已同步 0 页、0 条，最近错误：Upstream episodes offset=0 failed with HTTP 503。" +
      "这一次没有发布新的榜单，之后的定时触发会继续重试。"
  );
  assert.equal(state(`sync_alert:${RUN}`), String(at(120).getTime()));

  // Four hours later it is worth saying again.
  await trigger(600);
  assert.deepEqual(
    alerts.map((alert) => alert.minute),
    [120, 600]
  );

  // An evening attempt that gets through is good news, which is no news.
  healthy = true;
  const fetchedBefore = upstream.calls.length;
  await trigger(616);
  assert.equal(upstream.calls.length - fetchedBefore, 15);
  assert.equal(alerts.length, 2);
});

test("an alert that did not go out is not counted as sent", async () => {
  const alerts = [];
  const { run, state } = setup(LIVE_TOTALS, { failOn: () => 503 });
  const delivered = [false, true, true];
  const trigger = (minute) =>
    run(minute, {
      onAlert: async () => {
        alerts.push(minute);
        return delivered[alerts.length - 1];
      },
    }).catch(() => {});

  await trigger(120);
  await trigger(122);
  assert.deepEqual(alerts, [120, 122], "the endpoint is tried again at the next failed attempt");
  assert.equal(state(`sync_alert:${RUN}`), String(at(122).getTime()));
  await trigger(126);
  assert.deepEqual(alerts, [120, 122], "then it counts as sent");
});

test("publishing a run clears the alert marks", async () => {
  const { sqlite, run, state } = setup(SMALL_TOTALS);
  const insert = sqlite.prepare("INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)");
  for (const key of ["sync_alert:20261122T00", `sync_alert:${RUN}`]) {
    insert.run(key, String(at(0).getTime()), at(0).toISOString());
  }

  const finished = await run(120, { maxPages: 7 });
  assert.equal(finished.done, true);
  // The run has nothing left to report, and the runs before it are history.
  assert.equal(state("sync_alert:20261122T00"), null);
  assert.equal(state(`sync_alert:${RUN}`), null);
});

test("a catch-up attempt that saved pages before failing is not reported", async () => {
  const alerts = [];
  const { run } = setup(LIVE_TOTALS, { failOn: (call, request) => (request === 3 ? 503 : 0) });
  const onAlert = async (message) => {
    alerts.push(message);
    return true;
  };

  // Two pages saved, then a failure: the next trigger simply carries on.
  await assert.rejects(run(120, { onAlert }), /503/);
  assert.equal(alerts.length, 0);
});

test("a stale invocation does not report a failure it could not record", async () => {
  const alerts = [];
  const { sqlite, db, upstream, run } = setup(LIVE_TOTALS);
  const onAlert = async (message) => {
    alerts.push(message);
    return true;
  };
  // During the second page another invocation takes the run over, then this one's write fails.
  let fetched = 0;
  const fetchFn = async (url) => {
    fetched += 1;
    if (fetched === 2) {
      sqlite
        .prepare("UPDATE sync_runs SET locked_until = ? WHERE run_id = ?")
        .run(at(120).getTime() + 10 * 60_000, RUN);
    }
    return upstream.fetchFn(url);
  };
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  const cursorStatements = new WeakSet();
  db.prepare = (text) => {
    const statement = prepare(text);
    if (text.includes("SET status = 'running', current_board")) cursorStatements.add(statement);
    return statement;
  };
  let pageBatches = 0;
  db.batch = async (statements) => {
    if (statements.some((statement) => cursorStatements.has(statement)) && (pageBatches += 1) === 2) {
      throw new Error("D1_ERROR: over quota");
    }
    return batch(statements);
  };

  await assert.rejects(run(120, { onAlert, fetchFn }), /over quota/);
  assert.equal(alerts.length, 0);
  assert.equal(sqlite.prepare("SELECT last_error FROM sync_runs WHERE run_id = ?").get(RUN).last_error, null);
});

test("a trigger that arrives while the previous invocation still runs waits for it", async () => {
  const { sqlite, db, upstream, run } = setup(LIVE_TOTALS);

  // The next trigger fires while the first invocation is still fetching its first page.
  const overlapping = {};
  const fetchFn = async (url) => {
    if (!overlapping.result) {
      const fetchedBefore = upstream.calls.length;
      const queriesBefore = db.roundTrips;
      overlapping.result = await run(1);
      Object.assign(overlapping, {
        fetched: upstream.calls.length - fetchedBefore,
        queries: db.roundTrips - queriesBefore,
      });
    }
    return upstream.fetchFn(url);
  };
  const first = await run(0, { fetchFn });
  assert.equal(first.batchPages, 15);
  assert.deepEqual(
    {
      skipped: overlapping.result.skipped,
      reason: overlapping.result.reason,
      fetched: overlapping.fetched,
      queries: overlapping.queries,
    },
    { skipped: true, reason: "locked", fetched: 0, queries: 2 }
  );

  // Two triggers that both find no run for the day: the one that inserts the row proceeds.
  const racing = setup(SMALL_TOTALS);
  beforeStatementRuns(racing.db, "INSERT OR IGNORE INTO sync_runs", () => {
    racing.sqlite
      .prepare("INSERT INTO sync_runs (run_id, slot, status, current_board, locked_until, started_at) VALUES (?, '00', 'running', 'episodes', ?, ?)")
      .run(RUN, at(0).getTime() + 90_000, at(0).toISOString());
  });
  const lost = await racing.run(0);
  assert.deepEqual(
    { skipped: lost.skipped, reason: lost.reason, fetched: racing.upstream.calls.length },
    { skipped: true, reason: "locked", fetched: 0 }
  );

  // A lock is kept for 90 seconds after the last page of the invocation holding it,
  // then the next trigger takes the run over.
  sqlite.prepare("UPDATE sync_runs SET locked_until = ? WHERE run_id = ?").run(at(3).getTime() + 60_000, RUN);
  const waiting = await run(3);
  assert.equal(waiting.reason, "locked");
  const takenOver = await run(4.5);
  assert.equal(takenOver.skipped, false);
  assert.equal(takenOver.batchPages, 15);
});

test("an invocation whose lock expired stops as soon as another one has moved the run on", async () => {
  for (const [minute, catchUp] of [
    [0, false],
    [120, true],
  ]) {
    const { sqlite, upstream, run, runRow, cursor } = setup(LIVE_TOTALS);
    let fetched = 0;
    const fetchFn = async (url) => {
      fetched += 1;
      if (fetched === 2) {
        // Its lock expired during a slow page, and another invocation carried on.
        sqlite
          .prepare(
            "UPDATE sync_runs SET pages_fetched = pages_fetched + 5, current_board = 'podcasts', current_offset = 500, locked_until = ? WHERE run_id = ?"
          )
          .run(at(minute).getTime() + 10 * 60_000, RUN);
      }
      return upstream.fetchFn(url);
    };

    const result = await run(minute, { fetchFn });
    assert.deepEqual(
      { skipped: result.skipped, reason: result.reason, catchUp: result.catchUp, fetched },
      { skipped: true, reason: "taken_over", catchUp, fetched: 2 }
    );
    assert.equal(cursor(), "podcasts@500");
    assert.equal(runRow().pages_fetched, 6);
    assert.equal(runRow().locked_until, at(minute).getTime() + 10 * 60_000, "the other invocation keeps its lock");
  }
});

test("an invocation whose lock expired cannot record its failure over the new owner", async () => {
  const { sqlite, db, upstream, run, runRow } = setup(LIVE_TOTALS);
  // The lock expires during the second page, another invocation takes the run
  // over, and then the stale invocation's own write fails.
  const othersLock = at(0).getTime() + 10 * 60_000;
  let fetched = 0;
  let pageBatches = 0;
  const fetchFn = async (url) => {
    fetched += 1;
    if (fetched === 2) {
      sqlite
        .prepare("UPDATE sync_runs SET locked_until = ?, retry_count = 0 WHERE run_id = ?")
        .run(othersLock, RUN);
    }
    return upstream.fetchFn(url);
  };
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  const cursorStatements = new WeakSet();
  db.prepare = (text) => {
    const statement = prepare(text);
    if (text.includes("SET status = 'running', current_board")) cursorStatements.add(statement);
    return statement;
  };
  db.batch = async (statements) => {
    if (statements.some((statement) => cursorStatements.has(statement)) && (pageBatches += 1) === 2) {
      throw new Error("D1_ERROR: over quota");
    }
    return batch(statements);
  };

  await assert.rejects(run(0, { fetchFn }), /over quota/);
  assert.deepEqual({ fetched, pageBatches }, { fetched: 2, pageBatches: 2 });
  assert.equal(runRow().retry_count, 0, "the failure is not counted against the run");
  assert.equal(runRow().last_error, null);
  assert.equal(runRow().locked_until, othersLock, "the other invocation keeps its lock");
  assert.equal(runRow().pages_fetched, 1);
});

test("a switch-over that fails is retried with one request and publishes the same data", async () => {
  const { db, upstream, run, runRow, rows, state } = setup(SMALL_TOTALS);
  // The database refuses the batch that publishes the run, once.
  beforeBatchWith(db, "INSERT INTO app_state (key, value, updated_at)", async () => {
    throw new Error("D1_ERROR: over quota");
  });

  await assert.rejects(run(0, { maxPages: 7 }), /over quota/);
  assert.equal(state("active_sync_version"), ACTIVE, "the previous version stays in place");
  // Retrying it fetches nothing new, so it waits like a page that could not be fetched.
  assert.deepEqual([runRow().status, runRow().retry_count, runRow().locked_until], ["failed", 1, at(2).getTime()]);
  assert.equal(rows("episodes_rank", RUN), 160, "the pages that were fetched stay");
  assert.equal(rows("podcasts_rank", RUN), 270);

  const retried = await run(2);
  assert.equal(retried.done, true);
  assert.deepEqual(pages(upstream.calls.slice(7)), ["podcasts@250"], "only the end of the last board is asked for again");
  assert.equal(state("active_sync_version"), RUN);
  assert.equal(rows("podcasts_rank", RUN), 270);
  assert.equal(runRow().locked_until, 0);
});

test("a run that lost its lock cannot publish the version or remove another one", async () => {
  const { sqlite, db, run, runRow, rows, state } = setup(SMALL_TOTALS);
  // Another invocation takes the lock right after the last page is stored.
  const othersLock = at(0).getTime() + 5 * 60_000;
  beforeBatchWith(db, "SELECT value FROM app_state WHERE key = ?1", () => {
    sqlite.prepare("UPDATE sync_runs SET locked_until = ? WHERE run_id = ?").run(othersLock, RUN);
  });

  const result = await run(0, { maxPages: 7 });
  assert.deepEqual(
    { skipped: result.skipped, reason: result.reason, catchUp: result.catchUp },
    { skipped: true, reason: "taken_over", catchUp: false }
  );
  assert.equal(runRow().status, "running");
  assert.equal(runRow().locked_until, othersLock);
  assert.equal(state("active_sync_version"), ACTIVE);
  assert.equal(state(`genres:${RUN}`), null);
  assert.equal(rows("episodes_rank", PREV), 2, "the versions in place are not removed");
  assert.equal(rows("episodes_rank", OLDER), 1, "nothing is cleaned up either");
  assert.equal(rows("episodes_rank", RUN), 160, "the pages that were fetched stay");
});
