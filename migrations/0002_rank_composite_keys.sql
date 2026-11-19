-- Keep snapshot and lookup keys in the table itself, without a rowid or sequence.
CREATE TABLE episodes_rank_new (
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
  PRIMARY KEY (sync_version, board, eid)
) WITHOUT ROWID;

INSERT INTO episodes_rank_new (
  sync_version, board, rank, eid, title, podcast_id_raw, podcast_name,
  logo_url, link, play_count, comment_count, subscription, duration_min,
  post_time, primary_genre, total_episodes_count, open_rate,
  interactive_rate, last_release_days
)
SELECT
  sync_version, board, rank, eid, title, podcast_id_raw, podcast_name,
  logo_url, link, play_count, comment_count, subscription, duration_min,
  post_time, primary_genre, total_episodes_count, open_rate,
  interactive_rate, last_release_days
FROM episodes_rank;

DROP TABLE episodes_rank;
ALTER TABLE episodes_rank_new RENAME TO episodes_rank;

-- The episode boards are small enough to filter by genre within a single board.
CREATE INDEX idx_episodes_rank_board_rank
  ON episodes_rank (sync_version, board, rank);

CREATE TABLE podcasts_rank_new (
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
  PRIMARY KEY (sync_version, board, raw_id)
) WITHOUT ROWID;

INSERT INTO podcasts_rank_new (
  sync_version, board, rank, pid, raw_id, name, logo_url, primary_genre,
  authors_text, track_count, last_release_date, last_release_days,
  first_episode_time, active_rate, avg_duration_min, avg_play_count,
  avg_update_freq_hours, avg_comment_count, avg_interact_indicator,
  avg_open_rate, xyz_url, links_json
)
SELECT
  sync_version, board, rank, pid, raw_id, name, logo_url, primary_genre,
  authors_text, track_count, last_release_date, last_release_days,
  first_episode_time, active_rate, avg_duration_min, avg_play_count,
  avg_update_freq_hours, avg_comment_count, avg_interact_indicator,
  avg_open_rate, xyz_url, links_json
FROM podcasts_rank;

DROP TABLE podcasts_rank;
ALTER TABLE podcasts_rank_new RENAME TO podcasts_rank;

CREATE INDEX idx_podcasts_rank_board_rank
  ON podcasts_rank (sync_version, board, rank);
CREATE INDEX idx_podcasts_rank_board_genre
  ON podcasts_rank (sync_version, board, primary_genre);
