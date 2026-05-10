# Database migration playbook

This directory holds the SQL migrations applied to Cloudflare D1.
**Read this before adding/changing any DB schema.**

> Source-of-truth split:
> - **Actual database** ← `migrations/*.sql` (this folder)
> - **TypeScript types** ← `src/db/schema.ts` (Drizzle table builders)
>
> They drift if you only edit one. Code review catches that. Don't shortcut.

---

## TL;DR workflow

```bash
# 1. scaffold an empty SQL file (wrangler picks the next number)
pnpm db:new <short_snake_case_description>

# 2. write the SQL in the new migrations/000N_<name>.sql file
# 3. mirror the change in src/db/schema.ts
# 4. apply LOCALLY (never to prod from your laptop)
pnpm db:migrate

# 5. commit BOTH files in the same PR
git add migrations/000N_*.sql src/db/schema.ts
git commit -m "feat(db): <what changed>"

# 6. open PR → merge → CI applies to remote + deploys.
#    There is intentionally no `db:migrate:prod` script. See "Production rollout" below.
```

---

## Rules

1. **Forward-only.** No `down` migrations. To undo a deployed change, ship a new forward migration that reverses it. Locally, `pnpm db:reset` wipes and replays.
2. **Numbered, append-only, immutable.** Once a migration is committed and applied (locally or in prod), the file is **never edited or renamed**. Need a fix? Write the next migration.
3. **One logical change per migration.** Don't bundle "add table + rename column + backfill data" into one file. Split them.
4. **Schema.ts and migration always change together.** A PR with one but not the other is a defect. The simplicity-reviewer agent flags this.
5. **No `drizzle-kit`.** No `push`/`pull`/`generate`. Hand-write SQL. Hand-update schema.ts.
6. **No raw SQL in app code.** Use Drizzle in `src/server/*.ts`. SQL lives only here.

---

## Recipes

Each recipe shows: **SQL** + **schema.ts diff** + any **gotchas**.

### Add a new table

**SQL** — `migrations/000N_add_reviews.sql`
```sql
CREATE TABLE reviews (
  id          TEXT    PRIMARY KEY,
  court_id    TEXT    NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_reviews_court ON reviews (court_id);
```

**`src/db/schema.ts`**
```ts
export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  courtId: text('court_id')
    .notNull()
    .references(() => courts.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  body: text('body'),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert
```

---

### Add a column (nullable — easy case)

**SQL** — `migrations/000N_add_court_email.sql`
```sql
ALTER TABLE courts ADD COLUMN contact_email TEXT;
```

**`src/db/schema.ts`** — add the column to the existing `courts` builder:
```ts
export const courts = sqliteTable('courts', {
  // ...existing columns...
  contactEmail: text('contact_email'),  // nullable: no .notNull()
})
```

---

### Add a column (NOT NULL with a default — easy case)

```sql
ALTER TABLE queue_entries
  ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0;
```

```ts
reminded: integer('reminded').notNull().default(0),
```

---

### Add a column (NOT NULL without a default — needs backfill)

This is a **two-step** migration. SQLite won't let you add a NOT NULL column without a default unless the table is empty.

**Migration `000N_add_court_owner_step1.sql`** — add nullable
```sql
ALTER TABLE courts ADD COLUMN owner_session_id TEXT;
```

**Migration `000N+1_backfill_court_owner.sql`** — fill the data
```sql
-- Backfill: assign all existing courts to a sentinel "system" session
UPDATE courts
   SET owner_session_id = 'system'
 WHERE owner_session_id IS NULL;
```

**Migration `000N+2_court_owner_required.sql`** — enforce NOT NULL
```sql
-- SQLite can't ALTER COLUMN to add NOT NULL directly.
-- Use the 12-step table rebuild (see "Gotchas" below).
-- For most cases, leave the column nullable in DB and enforce in app code instead.
```

**Schema.ts** — the column lands as `.notNull()` only after the third migration. Until then, type it nullable.

> **Strong recommendation:** for a small project, prefer leaving the column nullable in the DB and enforcing presence in your server function validators. Saves an entire rebuild migration.

---

### Drop a column

D1's SQLite supports `DROP COLUMN` natively (SQLite ≥ 3.35).

```sql
ALTER TABLE courts DROP COLUMN contact_email;
```

```ts
// remove `contactEmail` from the courts table builder
```

**Two-deploy dance for production:**
1. **Deploy 1:** ship code that no longer references the column.
2. **Deploy 2:** apply the DROP migration.

Reverse order = code in flight tries to read a column that just disappeared. Bad.

---

### Rename a column

D1's SQLite supports column rename (SQLite ≥ 3.25).

```sql
ALTER TABLE courts RENAME COLUMN num_courts TO court_count;
```

```ts
// rename property in schema.ts
courtCount: integer('court_count').notNull(),
```

**Multi-deploy dance:**
1. **Deploy 1:** add the new column (nullable). Backfill from old.
2. **Deploy 2:** ship code that reads/writes both for a release.
3. **Deploy 3:** ship code that uses only the new column.
4. **Deploy 4:** drop the old column.

For OpenCourts at this scale, just rename in one go and accept brief downtime if the change is small. Document the choice in the PR.

---

### Change a column's type

SQLite is loose about types but doesn't have direct `ALTER COLUMN TYPE`. Two paths:

**Path A — soft change (often enough)**: change the type in `schema.ts` only. SQLite will store whatever; Drizzle will read it as the new type. No SQL migration needed if data is compatible.

**Path B — hard change (table rebuild)**: write a migration that creates a new table with the new type, copies data, drops old, renames. The 12-step process (see SQLite docs).

Document the path you chose in the PR.

---

### Add an index

```sql
CREATE INDEX idx_courts_location ON courts (location);
```

Indexes are not represented in `schema.ts` table builders. Drizzle's index API exists but we don't use it — our schema.ts is types-only. Add an inline comment in schema.ts noting the index for awareness:

```ts
export const courts = sqliteTable('courts', {
  // ...
  location: text('location').notNull(),  // indexed: idx_courts_location
  // ...
})
```

---

### Drop an index

```sql
DROP INDEX IF EXISTS idx_courts_location;
```

Update the comment in schema.ts.

---

### Pure data migration (no schema change)

Sometimes you need to backfill, fix, or transform existing rows.

```sql
-- migrations/000N_normalize_court_locations.sql
UPDATE courts
   SET location = trim(location)
 WHERE location != trim(location);
```

No schema.ts change.

**Gotchas:**
- Wrap multi-statement work in `BEGIN; ... COMMIT;` so it's atomic.
- For huge data migrations, consider running them in batches (D1 has statement timeouts).
- Idempotency: pretend the migration runs twice — does the second run break?

---

### Add a foreign key to an existing table

SQLite doesn't support `ALTER TABLE ADD FOREIGN KEY`. You have to rebuild the table:

```sql
-- 1. Create new table with the FK
CREATE TABLE courts_new (
  id TEXT PRIMARY KEY,
  -- ...all existing columns...
  owner_session_id TEXT REFERENCES sessions(id)
);

-- 2. Copy data
INSERT INTO courts_new SELECT *, NULL FROM courts;

-- 3. Drop old, rename new
DROP TABLE courts;
ALTER TABLE courts_new RENAME TO courts;

-- 4. Re-create any indexes that were on the old table
CREATE INDEX idx_courts_... ON courts (...);
```

This is enough rope to hang yourself with. **Strongly prefer**: add the column nullable, enforce the relationship at the application layer, skip the FK constraint.

---

## Gotchas (SQLite-specific)

- **No `ALTER COLUMN`.** You can't change `NOT NULL`, defaults, or types in place. Rebuild the table or live with it.
- **`PRAGMA foreign_keys = ON` is per-connection.** D1 enables it for you, but watch out if you ever shell into the local SQLite directly via `sqlite3` CLI.
- **Statement timeouts on D1.** Long-running data migrations may exceed limits — split into batches.
- **`unixepoch()` returns seconds, not milliseconds.** Watch units when comparing to JS `Date.now()` (which is ms). Our schema uses seconds throughout — multiply/divide as needed at the boundary.
- **No native UUID type.** Use `TEXT` and `crypto.randomUUID()` in app code.
- **Booleans are integers** (0/1). Drizzle's `integer({ mode: 'boolean' })` handles this if you opt in.

---

## Testing a migration before merge

```bash
# locally, against a clean DB
pnpm db:reset                 # nuke + replay all migrations including the new one
pnpm db:check                 # ⚑ drift check: confirms migrations and schema.ts agree
pnpm exec tsc --noEmit        # confirm schema.ts compiles cleanly
pnpm dev                      # smoke-test the app

# inspect tables
npx wrangler d1 execute opencourts --local \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# inspect a specific table's schema
npx wrangler d1 execute opencourts --local \
  --command "SELECT sql FROM sqlite_master WHERE name='courts'"
```

If any of those fail or look wrong, fix the migration **before applying to prod**.

### About `pnpm db:check`

A vitest test at `src/db/schema.test.ts` that:
1. Queries the local D1 SQLite for the actual tables + columns.
2. Walks every Drizzle table exported from `src/db/schema.ts`.
3. Fails if a table is in one source but not the other, or if column names don't match between them.

What it catches: structural drift (forgot to update schema.ts after a migration, or vice versa).
What it doesn't catch: type / nullability / default mismatches — those surface fast at runtime.

Runs as part of `pnpm test` too; CI (issue #5) will gate deploys on this passing.

---

## Production rollout

**Production ops happen only through CI/CD.** Workers Builds (issue #5) is wired to:

1. Run `pnpm install --frozen-lockfile`
2. Run `pnpm build`
3. Run `npx wrangler d1 migrations apply opencourts --remote` (applies any new migrations to remote D1)
4. Run `npx wrangler deploy` (ships the Worker)

This happens on every push to `main`. There is **no laptop equivalent** of these steps — the relevant scripts (`deploy`, `db:migrate:prod`, `db:status:prod`) were intentionally removed from `package.json` so nobody can apply a migration or deploy to production from their laptop.

### Inspecting prod

To check what migrations have been applied to remote D1 without applying anything:

```bash
npx wrangler d1 migrations list opencourts --remote
npx wrangler d1 execute opencourts --remote --command "<read-only SQL>"
```

These are read-only and safe.

### True emergency only

If CI is genuinely down and prod has a critical bug requiring DB intervention, the bare wrangler commands still work from your laptop with your CF auth:

```bash
npx wrangler d1 migrations apply opencourts --remote
npx wrangler deploy
```

But this should require an incident-level reason and a follow-up commit fixing whatever made CI unavailable. **Do not use this as a routine workflow.**

---

## When in doubt

- **Tiny change?** Hand-write the SQL, edit schema.ts, ship.
- **Bigger / risky?** Open a PR labeled `db-migration` early, write the SQL + schema.ts, run `pnpm db:reset` locally to verify, request review.
- **Touching a lot of data?** Test against a copy of prod data if available. At our scale, prod data is open and tiny — copying via `wrangler d1 export` is fine.
- **Truly unsure?** Stop and ask. Cheaper than recovering from a bad prod migration.
