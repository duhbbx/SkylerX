/** 本地 SQLite 表结构（桌面端自身存储，与"目标数据库"无关）。 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS connections (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  dialect      TEXT    NOT NULL,
  host         TEXT    NOT NULL,
  port         INTEGER NOT NULL,
  username     TEXT    NOT NULL,
  password_enc TEXT,
  database     TEXT,
  ssl_json     TEXT,
  ssh_json     TEXT,
  group_name   TEXT,
  extra_json   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS query_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT    NOT NULL,
  sql           TEXT    NOT NULL,
  executed_at   INTEGER NOT NULL,
  duration_ms   INTEGER,
  success       INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);
`
