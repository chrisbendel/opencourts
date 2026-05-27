-- Local dev seed. Three sample courts so `/` and `/courts` aren't empty.
-- Short human-readable IDs are intentional — production uses generated UUIDs
-- via `registerCourt`; these slugs are dev-only conveniences for URLs like
-- `/c/riverside`.
--
-- `INSERT OR REPLACE` makes this idempotent: re-running `pnpm db:seed` against
-- an already-seeded DB upserts the same rows.
INSERT OR REPLACE INTO courts (id, name, location, num_courts) VALUES
  ('riverside',  'Riverside Park',      'Riverside Park, North Field', 4),
  ('lincoln-hs', 'Lincoln High School', '500 W Lincoln St',            2),
  ('oak-st',     'Oak Street Courts',   '1300 Oak St',                 1);
