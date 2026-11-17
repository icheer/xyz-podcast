import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSyncRunKey,
  extractEpisodeId,
  extractPodcastLinkInfo,
  normalizeEpisodeItem,
  normalizePodcastItem,
  runSyncBatch,
} from "../src/db/sync.js";

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

function createInMemoryMockDb() {
  const state = {
    syncRuns: new Map(),
    appState: new Map(),
    boardMeta: new Map(),
    episodes: new Map(),
    podcasts: new Map(),
  };

  function makeStmt(sql, bound = []) {
    return {
      sql,
      bound,
      bind(...args) {
        return makeStmt(sql, args);
      },
      async first() {
        if (sql.includes("FROM sync_runs WHERE run_id =")) {
          return state.syncRuns.get(bound[0]) || null;
        }
        if (sql.includes("SELECT value, updated_at FROM app_state WHERE key =")) {
          return state.appState.get(bound[0]) || null;
        }
        return null;
      },
      async run() {
        if (sql.startsWith("INSERT INTO sync_runs")) {
          const [run_id, slot, current_board, locked_until, started_at] = bound;
          state.syncRuns.set(run_id, {
            run_id,
            slot,
            status: "running",
            current_board,
            current_offset: 0,
            board_totals_json: "{}",
            pages_fetched: 0,
            items_written: 0,
            retry_count: 0,
            last_error: null,
            locked_until,
            started_at,
            finished_at: null,
          });
        } else if (sql.startsWith("UPDATE sync_runs SET status = 'running', locked_until")) {
          const run = state.syncRuns.get(bound[0]);
          if (run) run.locked_until = bound[1];
        } else if (sql.includes("SET status = 'completed'")) {
          const [runId, boardTotalsJson, pagesFetched, itemsWritten, finishedAt] = bound;
          const run = state.syncRuns.get(runId);
          Object.assign(run, {
            status: "completed",
            current_board: "done",
            current_offset: 0,
            board_totals_json: boardTotalsJson,
            pages_fetched: pagesFetched,
            items_written: itemsWritten,
            last_error: null,
            locked_until: 0,
            finished_at: finishedAt,
          });
        } else if (sql.includes("SET status = 'running', current_board =")) {
          const [runId, currentBoard, currentOffset, boardTotalsJson, pagesFetched, itemsWritten] = bound;
          const run = state.syncRuns.get(runId);
          Object.assign(run, {
            status: "running",
            current_board: currentBoard,
            current_offset: currentOffset,
            board_totals_json: boardTotalsJson,
            pages_fetched: pagesFetched,
            items_written: itemsWritten,
            locked_until: 0,
          });
        } else if (sql.includes("SET status = ?2, current_board = ?3")) {
          const [runId, status, currentBoard, currentOffset, boardTotalsJson, pagesFetched, itemsWritten, retryCount, lastError] = bound;
          const run = state.syncRuns.get(runId);
          Object.assign(run, {
            status,
            current_board: currentBoard,
            current_offset: currentOffset,
            board_totals_json: boardTotalsJson,
            pages_fetched: pagesFetched,
            items_written: itemsWritten,
            retry_count: retryCount,
            last_error: lastError,
            locked_until: 0,
          });
        } else if (sql.startsWith("INSERT INTO board_meta")) {
          const [syncVersion, board, total, syncedCount, medianJson, updatedAt] = bound;
          state.boardMeta.set(`${syncVersion}:${board}`, {
            syncVersion,
            board,
            total,
            syncedCount,
            medianJson,
            updatedAt,
          });
        } else if (sql.startsWith("INSERT INTO app_state")) {
          const [key, value, updated_at] = bound;
          state.appState.set(key, { key, value, updated_at });
        } else if (sql.startsWith("INSERT INTO episodes_rank")) {
          const [syncVersion, board, rank, eid] = bound;
          state.episodes.set(`${syncVersion}:${board}:${eid}`, { syncVersion, board, rank, eid });
        } else if (sql.startsWith("INSERT INTO podcasts_rank")) {
          const [syncVersion, board, rank, pid, rawId] = bound;
          state.podcasts.set(`${syncVersion}:${board}:${rawId}`, { syncVersion, board, rank, pid, rawId });
        } else if (sql.startsWith("DELETE FROM episodes_rank")) {
          const keep = new Set(bound);
          for (const [k, v] of state.episodes.entries()) {
            if (!keep.has(v.syncVersion)) state.episodes.delete(k);
          }
        } else if (sql.startsWith("DELETE FROM podcasts_rank")) {
          const keep = new Set(bound);
          for (const [k, v] of state.podcasts.entries()) {
            if (!keep.has(v.syncVersion)) state.podcasts.delete(k);
          }
        } else if (sql.startsWith("DELETE FROM board_meta")) {
          const keep = new Set(bound);
          for (const [k, v] of state.boardMeta.entries()) {
            if (!keep.has(v.syncVersion)) state.boardMeta.delete(k);
          }
        }
        return { success: true };
      },
    };
  }

  return {
    state,
    prepare(sql) {
      return makeStmt(sql);
    },
    async batch(stmts) {
      for (const s of stmts) {
        await s.run();
      }
      return [];
    },
  };
}

test("runSyncBatch executes multi-batch relay across all 4 boards and activates sync version", async () => {
  const db = createInMemoryMockDb();
  // Seed an older version that should stay if it was prevActive, and an obsolete version that gets cleaned
  db.state.appState.set("active_sync_version", { value: "20261116T12", updated_at: "2026-11-16T12:06:00Z" });
  db.state.episodes.set("old-v0:episodes:e0", { syncVersion: "old-v0" });
  db.state.episodes.set("20261116T12:episodes:ePrev", { syncVersion: "20261116T12" });

  let fetchCalls = 0;
  const mockFetch = async (url) => {
    fetchCalls += 1;
    const u = new URL(url);
    const board = u.pathname.split("/").pop();
    const offset = Number(u.searchParams.get("offset"));

    const totals = {
      episodes: 150, // 2 pages
      "new-episodes": 10, // 1 page
      "new-podcasts": 20, // 1 page
      podcasts: 250, // 3 pages
    };
    const total = totals[board];
    const remaining = Math.max(0, total - offset);
    const count = Math.min(100, remaining);
    const items = Array.from({ length: count }, (_, idx) => {
      const rank = offset + idx + 1;
      if (board.includes("episodes")) {
        return {
          rank,
          title: `${board}-${rank}`,
          link: `https://www.xiaoyuzhoufm.com/episode/6aec7f8c5b7c4709bfe${String(rank).padStart(5, "0")}`,
          playCount: 100,
          commentCount: 10,
        };
      }
      return {
        id: `${board}-raw-${rank}`,
        rank,
        name: `${board}-${rank}`,
        links: [{ name: "xyz", url: `https://www.xiaoyuzhoufm.com/podcast/625635587bfca4e73e9${String(rank).padStart(5, "0")}` }],
      };
    });

    return new Response(
      JSON.stringify({ items, total, offset, limit: 100, medianValues: { playCount: 50 } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  // Batch 1: maxPages = 3 (episodes:2 + new-episodes:1)
  const r1 = await runSyncBatch(db, {
    now: new Date("2026-11-17T00:00:00Z"),
    fetchFn: mockFetch,
    maxPages: 3,
  });
  assert.equal(r1.done, false);
  assert.equal(r1.batchPages, 3);
  assert.equal(fetchCalls, 3);
  assert.equal(db.state.appState.get("active_sync_version").value, "20261116T12");

  // Batch 2: maxPages = 3 (new-podcasts:1 + podcasts:2)
  const r2 = await runSyncBatch(db, {
    now: new Date("2026-11-17T00:02:00Z"),
    fetchFn: mockFetch,
    maxPages: 3,
  });
  assert.equal(r2.done, false);
  assert.equal(r2.batchPages, 3);

  // Batch 3: remaining 1 page of podcasts -> completes!
  const r3 = await runSyncBatch(db, {
    now: new Date("2026-11-17T00:04:00Z"),
    fetchFn: mockFetch,
    maxPages: 3,
  });
  assert.equal(r3.done, true);
  assert.equal(r3.batchPages, 1);
  assert.equal(db.state.appState.get("active_sync_version").value, "20261117T00");
  assert.equal(db.state.episodes.has("old-v0:episodes:e0"), false);
  assert.equal(db.state.episodes.has("20261116T12:episodes:ePrev"), true);

  // Subsequent tick in same hour skips with 0 fetches
  const prevFetchCalls = fetchCalls;
  const r4 = await runSyncBatch(db, {
    now: new Date("2026-11-17T00:06:00Z"),
    fetchFn: mockFetch,
    maxPages: 3,
  });
  assert.equal(r4.skipped, true);
  assert.equal(r4.reason, "already_completed");
  assert.equal(fetchCalls, prevFetchCalls);
});
