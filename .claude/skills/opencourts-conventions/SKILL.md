---
name: opencourts-conventions
description: Use when editing files under src/routes/, src/server/, src/db/, or src/styles.css in the OpenCourts project. Reminds about project conventions — semantic HTML, plain CSS (no Tailwind), raw SQL (no ORM), no new deps, lazy promotion, anonymous sessions. Refer here before adding routes, server functions, SQL, or styles.
---

# OpenCourts conventions

These are project-specific conventions. They override generic best-practice instincts when there's a conflict. Authoritative sources: `CLAUDE.md` and `VISION.md`. This skill is a quick-reference summary.

## Hard rules — recap

1. No Tailwind, no CSS-in-JS, no UI libraries. Plain CSS in `src/styles.css`. Semantic HTML.
2. No ORMs. Raw SQL via `@libsql/client` (or chosen lightweight wrapper).
3. No new deps without justification.
4. No background workers, cron, or queue services. Lazy promotion at read time.
5. No accounts. Anonymous identity = httpOnly cookie UUID.
6. No vendor lock-in if avoidable.
7. Friction is the enemy.

## Adding a new route

TanStack Start file-based routing, flat dotted form. Live in `src/routes/`.

```
/courts/$id           → src/routes/courts.$id.tsx
/courts/$id/print     → src/routes/courts.$id.print.tsx
/about                → src/routes/about.tsx
```

Boilerplate:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/the-path')({ component: TheView })

function TheView() {
  // const { someParam } = Route.useParams()  // for $param routes
  return (
    <main>
      <h1>Title</h1>
      <p className="muted">Body.</p>
    </main>
  )
}
```

- Use semantic elements: `<main>`, `<header>`, `<nav>`, `<section>`, `<form>`, `<label>`, `<button>`, `<ul>`/`<li>`.
- Use existing classes from `styles.css`: `.btn`, `.btn-primary`, `.actions`, `.muted`, `.lead`, `ul.bare`. Add new classes only when reusable.
- Loaders / actions: import from `src/server/*`, call via `Route.useLoaderData()` / server function invocation.

## Adding a server function

In `src/server/<area>.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'

export const registerCourt = createServerFn({ method: 'POST' })
  .validator((input: { name: string; location: string; numCourts: number }) => input)
  .handler(async ({ data }) => {
    // 1. Validate (length, range)
    // 2. Run SQL via src/db/client
    // 3. Return minimal payload
  })
```

- Names are `verbNoun`: `registerCourt`, `getCourt`, `checkIn`, `signOut`, `listCourts`.
- Validate input. Reject impossible values up front.
- Read session via `src/server/session.ts` helpers, not by parsing cookies inline.
- Wrap multi-statement DB work in a transaction.

## Writing queries (Kysely on D1)

- DB access happens via `makeDb(env.DB)` exported from `src/db/client.ts`.
- D1's binding is **per-request**, so Kysely is built inside the server-function handler — never as a module-level singleton:
  ```ts
  export const getCourt = createServerFn({ method: 'GET' })
    .validator((id: string) => id)
    .handler(async ({ data: id, context }) => {
      const db = makeDb(context.env.DB)
      return db
        .selectFrom('courts')
        .select(['id', 'name', 'numCourts'])
        .where('id', '=', id)
        .executeTakeFirst()
    })
  ```
- **Never `.selectAll()`** — always pick columns explicitly. Forces awareness when a column is added.
- Tables are `snake_case` in SQL, `camelCase` in TS — `CamelCasePlugin` handles the conversion. Don't write `num_courts` in app code.
- Transactions are shallow, one per server fn. (Note: D1 transactions are limited; multi-statement work often uses `db.transaction()` or `D1` batched statements. Prefer Kysely's transaction API where supported.)
- `src/db/schema.ts` is auto-generated. Treat as read-only. Regenerate via `pnpm db:codegen` after migrations.

## Schema changes

```
1. pnpm db:new <name>                         → scaffolds migrations/000N_<name>.sql
2. Edit the file with CREATE/ALTER SQL
3. pnpm db:migrate                            → applies to local D1
4. pnpm db:codegen                            → regenerates src/db/schema.ts
5. Commit BOTH migration and schema.ts in one PR
6. After merge: pnpm db:migrate:prod          → applies to remote D1
```

- Migrations are never renamed or edited after applied.
- One migration per logical change. No bundles.
- D1 + wrangler does not support down migrations. To "rollback" locally use `pnpm db:reset`. In production: always forward — write a new migration that undoes the change.

### Migration boilerplate

```sql
-- migrations/0001_init.sql

CREATE TABLE courts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  num_courts INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE queue_entries (
  id TEXT PRIMARY KEY,
  court_id TEXT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  party_size INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'playing')),
  started_at INTEGER,
  expires_at INTEGER
);

CREATE INDEX idx_queue_entries_court_active
  ON queue_entries (court_id, expires_at);
```

## Lazy promotion (the one piece of cleverness)

Every read of a court's queue runs this transaction:

```sql
BEGIN;
DELETE FROM queue_entries
  WHERE court_id = ? AND expires_at < unixepoch();

-- Promote oldest waiters until num_courts seats filled
-- (UPDATE queue_entries SET status = 'playing', started_at = ?, expires_at = ? + duration
--  WHERE id IN (...))

SELECT ... FROM queue_entries WHERE court_id = ?;
COMMIT;
```

This replaces background workers and cron. State is honest by query, not by clock.

## Sign-out trust model

- Owner sign-out: device's session cookie matches the entry's `session_id`. Show as primary "I'm done" button.
- Community override: any visitor can also clear an entry. Subtle "Mark done" button.
- v1: no confirmation dialog. Document in VISION.md if revisiting.

## Styling

- Add new selectors to `src/styles.css`. Keep file scannable; group related rules.
- Use existing CSS variables for color/spacing. Add new variables only when a value will reuse.
- No utility classes. If you need flex/grid, write a class with a meaning (`.actions`, `.card-grid`).
- Mobile-first. The phone is the primary device — most users land via QR scan.

## What "dead simple" means in practice

- Choose the boring option.
- 30 lines of bespoke code beat a 200KB dependency.
- Skip tooling that exists for problems you don't have.
- Optional config = no config.
- If a feature can be cut from v1, cut it.
