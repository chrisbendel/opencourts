-- 0002_queue_entry_ordering.sql
--
-- Lazy promotion needs two facts that 0001 didn't store:
--   1. joined_at  — FIFO order to pick the *oldest* waiter to promote.
--   2. duration_min — a waiter's requested play length, applied when they're
--      promoted (expires_at = started_at + duration_min*60). Without it,
--      promotion has no duration to set.
--
-- Both NOT NULL with sane defaults so any pre-existing rows stay valid.

ALTER TABLE queue_entries ADD COLUMN joined_at   INTEGER NOT NULL DEFAULT (unixepoch());
ALTER TABLE queue_entries ADD COLUMN duration_min INTEGER NOT NULL DEFAULT 90;

-- Waiter promotion scans (court_id, status) ordered by joined_at.
CREATE INDEX idx_queue_entries_court_waiting
  ON queue_entries (court_id, status, joined_at);
