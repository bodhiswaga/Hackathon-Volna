PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  deadline TEXT NOT NULL,
  status_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_days INTEGER NOT NULL,
  status TEXT NOT NULL,
  assignee_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  due_date TEXT,
  start_not_earlier TEXT,
  actual_start TEXT,
  actual_end TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dependencies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  lag_days INTEGER NOT NULL DEFAULT 0,
  UNIQUE (predecessor_id, successor_id)
);

CREATE TABLE IF NOT EXISTS change_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT,
  ops_json TEXT NOT NULL,
  snapshot_before_json TEXT NOT NULL,
  finish_before TEXT NOT NULL,
  finish_after TEXT NOT NULL,
  buffer_before INTEGER NOT NULL,
  buffer_after INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_deps_project ON dependencies(project_id);
CREATE INDEX IF NOT EXISTS idx_events_project ON change_events(project_id, created_at);
