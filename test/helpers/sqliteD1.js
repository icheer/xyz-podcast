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

const RETURNS_ROWS = /^\s*(SELECT|WITH)\b/i;

// Like D1's `meta`: `changes` is the number of rows a statement wrote, which is
// how the sync state machine tells whether a conditional statement applied.
function executeRaw(sqlite, sql, params) {
  const stmt = sqlite.prepare(sql);
  if (RETURNS_ROWS.test(sql)) {
    return { success: true, results: stmt.all(...params), meta: { changes: 0, rows_written: 0 } };
  }
  const changes = Number(stmt.run(...params).changes);
  return { success: true, results: [], meta: { changes, rows_written: changes } };
}

/**
 * D1-shaped binding (`prepare().bind().first/all/run`, `batch`).
 * `queries` records the SQL of every statement sent, batches included, so tests
 * can assert how much a handler reads. `roundTrips` counts calls to the binding:
 * D1 lets a Free plan Worker make 50 per invocation and counts a whole batch as one.
 */
export function createD1Binding(sqlite) {
  const queries = [];
  let roundTrips = 0;

  function prepare(sql) {
    let params = [];
    const execute = () => {
      queries.push(sql);
      return executeRaw(sqlite, sql, params);
    };
    const api = {
      bind(...values) {
        params = values;
        return api;
      },
      async all() {
        roundTrips += 1;
        return execute();
      },
      async first(column) {
        roundTrips += 1;
        const row = execute().results[0] ?? null;
        if (!row) return null;
        return column === undefined ? row : (row[column] ?? null);
      },
      async run() {
        roundTrips += 1;
        return execute();
      },
      [RAW]: execute,
    };
    return api;
  }

  // D1 runs a batch as one transaction.
  async function batch(statements) {
    roundTrips += 1;
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

  return {
    prepare,
    batch,
    queries,
    get roundTrips() {
      return roundTrips;
    },
  };
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
