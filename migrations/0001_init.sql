-- XYZ Podcast D1 Initial Schema
-- Note: Cloudflare D1 executes migration files as SQL batches; avoid explicit BEGIN/COMMIT statements.

CREATE TABLE IF NOT EXISTS episodes_rank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_version TEXT NOT NULL,
  board TEXT NOT NULL,
  rank INTEGER NOT NULL,
  eid TEXT NOT NULL,
  title TEXT NOT NULL,
  podcast_id_raw TEXT NOT NULL DEFAULT '',
  podcast_name TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  play_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  subscription INTEGER NOT NULL DEFAULT 0,
  duration_min INTEGER NOT NULL DEFAULT 0,
  post_time TEXT NOT NULL DEFAULT '',
  primary_genre TEXT NOT NULL DEFAULT '',
  total_episodes_count INTEGER NOT NULL DEFAULT 0,
  open_rate REAL NOT NULL DEFAULT 0,
  interactive_rate REAL NOT NULL DEFAULT 0,
  last_release_days REAL NOT NULL DEFAULT 0,
  UNIQUE(sync_version, board, eid)
);

CREATE INDEX IF NOT EXISTS idx_episodes_rank_board_rank
  ON episodes_rank (sync_version, board, rank);
CREATE INDEX IF NOT EXISTS idx_episodes_rank_board_genre
  ON episodes_rank (sync_version, board, primary_genre);

CREATE TABLE IF NOT EXISTS podcasts_rank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_version TEXT NOT NULL,
  board TEXT NOT NULL,
  rank INTEGER NOT NULL,
  pid TEXT NOT NULL DEFAULT '',
  raw_id TEXT NOT NULL,
  name TEXT NOT NULL,
  logo_url TEXT NOT NULL DEFAULT '',
  primary_genre TEXT NOT NULL DEFAULT '',
  authors_text TEXT NOT NULL DEFAULT '',
  track_count INTEGER NOT NULL DEFAULT 0,
  last_release_date TEXT NOT NULL DEFAULT '',
  last_release_days REAL NOT NULL DEFAULT 0,
  first_episode_time TEXT NOT NULL DEFAULT '',
  active_rate REAL NOT NULL DEFAULT 0,
  avg_duration_min INTEGER NOT NULL DEFAULT 0,
  avg_play_count INTEGER NOT NULL DEFAULT 0,
  avg_update_freq_hours REAL NOT NULL DEFAULT 0,
  avg_comment_count INTEGER NOT NULL DEFAULT 0,
  avg_interact_indicator REAL NOT NULL DEFAULT 0,
  avg_open_rate REAL NOT NULL DEFAULT 0,
  xyz_url TEXT NOT NULL DEFAULT '',
  links_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE(sync_version, board, raw_id)
);

CREATE INDEX IF NOT EXISTS idx_podcasts_rank_board_rank
  ON podcasts_rank (sync_version, board, rank);
CREATE INDEX IF NOT EXISTS idx_podcasts_rank_board_genre
  ON podcasts_rank (sync_version, board, primary_genre);

CREATE TABLE IF NOT EXISTS board_meta (
  sync_version TEXT NOT NULL,
  board TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  synced_count INTEGER NOT NULL DEFAULT 0,
  median_values_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (sync_version, board)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  run_id TEXT PRIMARY KEY,
  slot TEXT NOT NULL,
  status TEXT NOT NULL,
  current_board TEXT NOT NULL,
  current_offset INTEGER NOT NULL DEFAULT 0,
  board_totals_json TEXT NOT NULL DEFAULT '{}',
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  items_written INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_until INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started
  ON sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
