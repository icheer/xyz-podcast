import test from "node:test";
import assert from "node:assert/strict";
import { clampInt, isValidXyzId, safeJsonParse } from "../src/utils/http.js";
import { getEffectiveSyncVersion } from "../src/db/schema.js";

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
