---
name: opencourts-conventions
description: Use when editing files under src/routes/, src/server/, src/db/, or src/styles.css in the OpenCourts project. Reminds about project conventions — semantic HTML, plain CSS (no Tailwind), raw SQL (no ORM), no new deps, lazy promotion, anonymous sessions. Refer here before adding routes, server functions, SQL, or styles.
---

# OpenCourts conventions

These are project-specific conventions. They override generic best-practice instincts when there's a conflict. Authoritative sources: `CLAUDE.md` and `VISION.md`. This skill is a quick-reference summary.

## Hard rules — recap

1. No Tailwind, no CSS-in-JS, no UI libraries. Plain CSS in `src/styles.css`. Semantic HTML.
2. **Drizzle ORM (`drizzle-orm/d1`) only.** No `drizzle-kit`. No other ORMs. No raw SQL inside app code.
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

## Writing queries (Drizzle on D1)

- DB access happens via `makeDb(env.DB)` exported from `src/db/client.ts`.
- D1's binding is **per-request**, so Drizzle is built inside the server-function handler — never as a module-level singleton:
  ```ts
  import { eq } from 'drizzle-orm'
  import { courts } from '#/db/schema'

  export const getCourt = createServerFn({ method: 'GET' })
    .validator((id: string) => id)
    .handler(async ({ data: id, context }) => {
      const db = makeDb(context.env.DB)
      return db
        .select({
          id: courts.id,
          name: courts.name,
          numCourts: courts.numCourts,
        })
        .from(courts)
        .where(eq(courts.id, id))
        .get()
    })
  ```
- **Prefer explicit selects** when the row will be returned to the client — forces awareness when columns are added.
- **camelCase in TS, snake_case in SQL.** Drizzle handles the mapping in the schema definition (`text('court_id')` ↔ `courtId`). App code only sees camelCase.
- **Transactions are shallow.** One per server fn, no nesting. (D1's transactions are limited; multi-statement atomic work often uses `db.batch([...])`.)
- `drizzle-orm/d1` is imported only by `src/db/client.ts`. Never elsewhere.

### Row types — use the auto-derived ones

```ts
import type { Court, NewCourt, QueueEntry } from '#/db/schema'
// Or, equivalently:
import { courts } from '#/db/schema'
type Court = typeof courts.$inferSelect
type NewCourt = typeof courts.$inferInsert  // omits defaulted/generated cols
```

Never write a hand-rolled interface that mirrors a Drizzle table — your schema-in-TS already emits the type for free.

## Schema changes

Two files change in lockstep. Same PR.

```
1. pnpm db:new <name>             → scaffolds migrations/000N_<name>.sql (empty)
2. Write CREATE/ALTER SQL in that file
3. Mirror the change in src/db/schema.ts (add/modify a sqliteTable, update inferred types)
4. pnpm db:migrate                → applies to local D1
5. Commit migration AND schema.ts together
6. After merge: pnpm db:migrate:prod
```

- Migrations are never renamed or edited after applied.
- One migration per logical change. No bundles.
- **Forward-only, by policy.** No `down` blocks, no rollback command. Local rollback = `pnpm db:reset`. Production rollback = a new forward migration that reverses the previous one.
- **Schema.ts is hand-maintained**, not auto-generated. When a migration changes the DB, edit `src/db/schema.ts` to match in the same PR.
- **Never run `drizzle-kit`.** No JSON snapshots, no schema generation tools, no `pull`/`push`/`generate`/`migrate` rituals.

### Schema + migration pairing example

```ts
// src/db/schema.ts — add a column
export const courts = sqliteTable('courts', {
  // ...existing columns...
  contactEmail: text('contact_email'),  // new
})
```

```sql
-- migrations/0002_add_contact_email.sql
ALTER TABLE courts ADD COLUMN contact_email TEXT;
```

Both files in the same commit. Reviewer flags PRs missing one side.

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

## Mobile-first UX (non-negotiable)

The phone is *the* device. Most users land here from a QR scan. Every screen must work at **375×667**. Desktop = mobile + whitespace.

### Layout
- One column. Max width ~640px, centered.
- No sidebars, no two-pane views, no horizontal scroll.

### Tap targets
- Buttons ≥ 44×44px (use generous padding, not just font size).
- ≥ 8px between tappable elements.

### Interaction
- **No hover-only interactions.** Hover = decoration.
- **No drag-drop, no keyboard shortcuts as primary path.**
- **One primary action per screen.** Secondary actions visually subordinate.
- **No multi-step modals.** No popups that hide important content.

### Forms
- Native `<input>`, `<select>`, `<textarea>`. No custom widgets.
- Use the right `type=` (`tel`, `number`, `email`, etc.) so mobile keyboards adapt.
- One field per row. `<label>` always — placeholder is not a label.
- Body text ≥ 16px (prevents iOS zoom-on-focus).

### Forbidden
- Carousels.
- Hamburger menus on a 4-route app.
- Floating action buttons.
- Splash screens.
- Cookie banners (we don't track anything).
- Anything requiring a tooltip or tutorial to use.

## What "dead simple" means in practice

- Choose the boring option.
- 30 lines of bespoke code beat a 200KB dependency.
- Skip tooling that exists for problems you don't have.
- Optional config = no config.
- If a feature can be cut from v1, cut it.
