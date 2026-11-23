// A minimal D1 binding on top of Node's built-in SQLite, so SQL in handlers and
// in the sync state machine can run against the real migrations in unit tests.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const DEFAULT_MIGRATIONS = ["0001_init.sql", "0002_rank_composite_keys.sql"];
const RAW = Symbol("raw");

/** In-memory database with every migration applied, as a fresh D1 database would be. */
export function createSqliteDb(migrations = DEFAULT_MIGRATIONS) {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of migrations) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS_DIR), "utf8"));
  }
  return sqlite;
}

/**
 * D1-shaped binding (`prepare().bind().first/all/run`, `batch`).
 * `queries` records the SQL of every statement sent, batches included, so tests
 * can assert how much a handler reads.
 */
export function createD1Binding(sqlite) {
  const queries = [];

  function prepare(sql) {
    const stmt = sqlite.prepare(sql);
    let params = [];
    const api = {
      bind(...values) {
        params = values;
        return api;
      },
      async all() {
        queries.push(sql);
        return { success: true, results: stmt.all(...params), meta: {} };
      },
      async first(column) {
        queries.push(sql);
        const row = stmt.get(...params);
        if (!row) return null;
        return column === undefined ? row : (row[column] ?? null);
      },
      async run() {
        queries.push(sql);
        return { success: true, results: [], meta: { rows_written: Number(stmt.run(...params).changes) } };
      },
      [RAW]() {
        queries.push(sql);
        return { success: true, results: [], meta: { rows_written: Number(stmt.run(...params).changes) } };
      },
    };
    return api;
  }

  // D1 runs a batch as one transaction.
  async function batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement[RAW]());
      sqlite.exec("COMMIT");
      return results;
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  }

  return { prepare, batch, queries };
}

/** Insert many rows inside one transaction. */
export function insertRows(sqlite, table, columns, rows) {
  const stmt = sqlite.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
  );
  sqlite.exec("BEGIN");
  try {
    for (const row of rows) stmt.run(...row);
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
}
