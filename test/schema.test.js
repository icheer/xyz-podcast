import test from "node:test";
import assert from "node:assert/strict";
import { clampInt, isValidXyzId, safeJsonParse } from "../src/utils/http.js";
import { getEffectiveSyncVersion, getPreviousSyncVersion } from "../src/db/schema.js";
import { mapEpisodeRow, mapPodcastRow } from "../src/handlers/boards.js";

test("isValidXyzId validates XiaoYuZhou episode/podcast IDs", () => {
  assert.equal(isValidXyzId("6aec7f8c5b7c4709bfe1a757"), true);
  assert.equal(isValidXyzId("625635587bfca4e73e990703"), true);
  assert.equal(isValidXyzId("short"), false);
  assert.equal(isValidXyzId("625635587bfca4e73e990703/../evil"), false);
  assert.equal(isValidXyzId(""), false);
  assert.equal(isValidXyzId(null), false);
});

test("clampInt clamps numbers safely", () => {
  assert.equal(clampInt(undefined, 30, 1, 100), 30);
  assert.equal(clampInt("200", 30, 1, 100), 100);
  assert.equal(clampInt("-5", 30, 1, 100), 1);
  assert.equal(clampInt("abc", 30, 1, 100), 30);
  assert.equal(clampInt("42", 30, 1, 100), 42);
});

test("safeJsonParse handles invalid JSON gracefully", () => {
  assert.deepEqual(safeJsonParse('{"a":1}', {}), { a: 1 });
  assert.deepEqual(safeJsonParse("{bad", { fallback: true }), { fallback: true });
  assert.deepEqual(safeJsonParse(null, []), []);
});

test("getEffectiveSyncVersion prefers active_sync_version and falls back on cold start", async () => {
  const mockDbActive = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("FROM app_state")) {
            return { value: "20261117T00", updated_at: "2026-11-17T00:06:00Z" };
          }
          return null;
        },
      };
    },
  };
  assert.equal(await getEffectiveSyncVersion(mockDbActive), "20261117T00");

  const mockDbFallback = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("FROM app_state")) return null;
          if (sql.includes("FROM sync_runs")) return { run_id: "20261117T00-cold" };
          return null;
        },
      };
    },
  };
  assert.equal(await getEffectiveSyncVersion(mockDbFallback), "20261117T00-cold");
});

test("getPreviousSyncVersion reads app_state first and falls back to sync_runs", async () => {
  const dbWithState = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("FROM app_state")) {
            return { value: "20261117T12", updated_at: "2026-11-18T00:08:00Z" };
          }
          return null;
        },
      };
    },
  };
  assert.equal(await getPreviousSyncVersion(dbWithState, "20261118T00"), "20261117T12");

  const dbFallback = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("FROM app_state")) return null;
          if (sql.includes("FROM sync_runs")) return { run_id: "20261117T00" };
          return null;
        },
      };
    },
  };
  assert.equal(await getPreviousSyncVersion(dbFallback, "20261117T12"), "20261117T00");
});

test("mapEpisodeRow and mapPodcastRow compute rankDelta, isNew, and podcastPid", () => {
  const baseEp = {
    rank: 3,
    eid: "ep1",
    title: "Ep",
    podcast_id_raw: "rawpod1",
    podcast_pid: "625635587bfca4e73e990703",
    podcast_name: "Pod",
    logo_url: "",
    link: "",
    play_count: 100,
    comment_count: 10,
    subscription: 500,
    duration_min: 45,
    post_time: "",
    primary_genre: "科技",
    total_episodes_count: 20,
    open_rate: 0.2,
    interactive_rate: 0.1,
    last_release_days: 1,
  };

  // Without baseline -> no spurious NEW badge
  const cold = mapEpisodeRow({ ...baseEp, prev_rank: null }, false);
  assert.equal(cold.rankDelta, null);
  assert.equal(cold.isNew, false);
  assert.equal(cold.podcastPid, "625635587bfca4e73e990703");

  // Rose from #11 to #3 -> +8
  const risen = mapEpisodeRow({ ...baseEp, prev_rank: 11 }, true);
  assert.equal(risen.rankDelta, 8);
  assert.equal(risen.isNew, false);

  // New entry when baseline exists -> isNew = true
  const fresh = mapEpisodeRow({ ...baseEp, prev_rank: null }, true);
  assert.equal(fresh.rankDelta, null);
  assert.equal(fresh.isNew, true);

  // Podcast dropped from #2 to #5 -> -3
  const pod = mapPodcastRow(
    {
      rank: 5,
      prev_rank: 2,
      pid: "625635587bfca4e73e990703",
      raw_id: "rawpod1",
      name: "Pod",
      links_json: "[]",
    },
    true
  );
  assert.equal(pod.rankDelta, -3);
  assert.equal(pod.isNew, false);
});
