-- A Google account, keyed by its stable `sub` claim.
CREATE TABLE users (
  id         TEXT    PRIMARY KEY,
  email      TEXT    NOT NULL,
  name       TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('now', 'subsec') * 1000 AS INTEGER))
);

-- Only a hash of the session token is kept, so a copy of the database cannot
-- be used to sign in as anyone.
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('now', 'subsec') * 1000 AS INTEGER)),
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);

-- Statuses are defined per user. A 'stage' is a step an application is still
-- moving through; an 'outcome' ends it. Stages are ordered by position, and
-- that order is what the dashboard's flow diagram follows.
CREATE TABLE statuses (
  id         INTEGER PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('stage', 'outcome')),
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('now', 'subsec') * 1000 AS INTEGER))
);

CREATE UNIQUE INDEX statuses_user_name ON statuses (user_id, name COLLATE NOCASE);

CREATE TABLE applications (
  id           INTEGER PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company      TEXT    NOT NULL,
  role         TEXT    NOT NULL,
  url          TEXT    NOT NULL DEFAULT '',
  location     TEXT    NOT NULL DEFAULT '',
  work_mode    TEXT    NOT NULL DEFAULT '' CHECK (work_mode IN ('', 'remote', 'hybrid', 'onsite')),
  salary       TEXT    NOT NULL DEFAULT '',
  source       TEXT    NOT NULL DEFAULT '',
  contact      TEXT    NOT NULL DEFAULT '',
  notes        TEXT    NOT NULL DEFAULT '',
  -- Calendar dates (yyyy-mm-dd) as the user entered them, not instants: the
  -- server's clock is UTC and would shift them a day either side.
  date_applied TEXT    NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('now', 'subsec') * 1000 AS INTEGER)),
  updated_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('now', 'subsec') * 1000 AS INTEGER))
);

CREATE INDEX applications_user ON applications (user_id, date_applied);

-- Every status an application has been in, in the order it happened. The
-- latest row is the current status. The flow diagram is drawn from these.
CREATE TABLE status_changes (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  -- No cascade: a status that is still in someone's history cannot be deleted.
  status_id      INTEGER NOT NULL REFERENCES statuses (id),
  changed_on     TEXT    NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('now', 'subsec') * 1000 AS INTEGER))
);

CREATE INDEX status_changes_application ON status_changes (application_id, id);
CREATE INDEX status_changes_status ON status_changes (status_id);
