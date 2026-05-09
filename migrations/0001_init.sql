-- 0001_init.sql
--
-- Initial schema for OpenCourts.
-- See VISION.md → Data Model for the rationale behind each column.

CREATE TABLE courts (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  location    TEXT    NOT NULL,
  num_courts  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE queue_entries (
  id          TEXT    PRIMARY KEY,
  court_id    TEXT    NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  session_id  TEXT    NOT NULL,
  party_size  INTEGER NOT NULL DEFAULT 1,
  status      TEXT    NOT NULL CHECK (status IN ('waiting', 'playing')),
  started_at  INTEGER,
  expires_at  INTEGER
);

-- Lazy promotion reads filter active rows by (court_id, expires_at).
CREATE INDEX idx_queue_entries_court_active
  ON queue_entries (court_id, expires_at);
