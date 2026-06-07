-- 0003_drop_party_size.sql
--
-- party_size bought nothing: queue math counts *entries* (one party = one
-- court), never heads. The number was pure cosmetic and added a check-in tap.
-- One entry = one party = one court. Drop it. (SQLite 3.35+ / D1 supports
-- ALTER TABLE ... DROP COLUMN.)

ALTER TABLE queue_entries DROP COLUMN party_size;
