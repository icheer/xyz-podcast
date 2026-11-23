import test from "node:test";
import assert from "node:assert/strict";
import { handleHealth } from "../src/handlers/health.js";
import { isBoardDataStale, STALE_AFTER_MS } from "../src/utils/freshness.js";
import { createD1Binding, createSqliteDb, insertRows } from "./helpers/sqliteD1.js";

const NOW = Date.parse("2026-11-23T10:00:00Z");
const hoursAgo = (hours) => new Date(NOW - hours * 3_600_000).toISOString();

/** A database with, or without, a published version last updated `updatedAt`,
 * and with a first sync that started at `firstRunAt`. */
function setup(activeVersion, updatedAt, firstRunAt = null) {
  const sqlite = createSqliteDb();
  const db = createD1Binding(sqlite);
  if (firstRunAt) {
    sqlite
      .prepare(
        "INSERT INTO sync_runs (run_id, slot, status, current_board, current_offset, board_totals_json, pages_fetched, items_written, retry_count, last_error, locked_until, started_at) VALUES (?, '00', 'running', 'episodes', 0, '{}', 2, 200, 5, NULL, 0, ?)"
      )
      .run("20261122T00", firstRunAt);
  }
  if (activeVersion) {
    insertRows(
      sqlite,
      "board_meta",
      ["sync_version", "board", "total", "synced_count", "median_values_json", "updated_at"],
      [[activeVersion, "podcasts", 10, 10, "{}", updatedAt]]
    );
    insertRows(sqlite, "app_state", ["key", "value", "updated_at"], [["active_sync_version", activeVersion, updatedAt]]);
  }
  return { db, env: { DB: db } };
}

test("/api/health says how old the published list is, in one query", async () => {
  const fresh = setup("20261123T00", hoursAgo(2));
  const response = await handleHealth(fresh.env, NOW);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    db: "ok",
    timestamp: "2026-11-23T10:00:00.000Z",
    sync: { version: "20261123T00", updatedAt: hoursAgo(2), ageHours: 2, stale: false },
  });
  assert.equal(fresh.db.roundTrips, 1);

  // A list that should have been replaced by yesterday morning's sync.
  const stale = await (await handleHealth(setup("20261122T00", hoursAgo(26.5)).env, NOW)).json();
  assert.deepEqual(stale.sync, { version: "20261122T00", updatedAt: hoursAgo(26.5), ageHours: 26.5, stale: true });

  // Nothing published yet, as right after a first deployment.
  const empty = await (await handleHealth(setup(null, null).env, NOW)).json();
  assert.deepEqual(empty, {
    ok: true,
    db: "ok",
    timestamp: "2026-11-23T10:00:00.000Z",
    sync: { version: null, updatedAt: null, ageHours: null, stale: false },
  });

  // A first sync that has been going for a day without publishing anything.
  const stuck = await (await handleHealth(setup(null, null, hoursAgo(26)).env, NOW)).json();
  assert.deepEqual(stuck.sync, { version: null, updatedAt: null, ageHours: null, stale: true });
  const starting = await (await handleHealth(setup(null, null, hoursAgo(2)).env, NOW)).json();
  assert.equal(starting.sync.stale, false, "a first sync that started this morning is still on time");

  assert.equal((await handleHealth({})).status, 500);
});

test("board data counts as stale an hour after the time its daily sync should have replaced it", () => {
  const updated = new Date(NOW - STALE_AFTER_MS).toISOString();
  assert.equal(STALE_AFTER_MS, 25 * 60 * 60 * 1000);
  assert.equal(isBoardDataStale(updated, NOW), false, "exactly 25 hours is still within a day plus the morning window");
  assert.equal(isBoardDataStale(updated, NOW + 1), true);
  assert.equal(isBoardDataStale(hoursAgo(24), NOW), false, "yesterday's list is normal before the sync");
  // Unknown, unreadable or future timestamps are not reported as stale.
  assert.equal(isBoardDataStale(null, NOW), false);
  assert.equal(isBoardDataStale("", NOW), false);
  assert.equal(isBoardDataStale("not a date", NOW), false);
  assert.equal(isBoardDataStale(new Date(NOW + 3_600_000).toISOString(), NOW), false);
});
