# OpenCourts — project memory for Claude

This file is project memory. Read it before suggesting code, dependencies, or architecture changes. Linked context: [VISION.md](./VISION.md).

## What this project is

A dead-simple, anonymous, near-zero-cost queue tracker for public tennis courts. QR code on a fence → scan → check in → auto-expire. No accounts, no native app, no backend complexity beyond what's strictly needed.

## Hard rules

These are non-negotiable. If a request would violate one, **stop and flag the conflict before proceeding**.

1. **No Tailwind, no CSS-in-JS, no UI libraries (shadcn, Material, Chakra, etc.).** Plain CSS in `src/styles.css`. Semantic HTML elements over class-based component soup.
2. **Drizzle ORM only** (`drizzle-orm/d1`, runtime half only). No `drizzle-kit`. No Prisma. No other ORMs or query builders. No raw SQL inside app code (`src/server/`, `src/routes/`).
3. **No new dependencies without justification.** A new `dependencies` or `devDependencies` entry requires a one-line note in the PR explaining why nothing already in the project covers it. If it's a small utility, write 30 lines instead.
4. **No background workers, no cron, no queue services.** State stays honest via lazy promotion at read time (see VISION.md).
5. **No accounts.** Anonymous identity = random UUID in httpOnly cookie. No email, password, OAuth, or third-party auth provider.
6. **No vendor lock-in if avoidable.** Hosting target is Cloudflare Pages today, but framework + DB + libs should remain swappable. Prefer Web-Standard APIs (`fetch`, `crypto.randomUUID`) over Node or platform-specific ones.
7. **Friction is the enemy.** A new code path that adds a tap, a confirmation, or a wait time on the user's main flow needs an explicit principle-level reason. Default answer is no.
8. **Mobile-first, dead simple.** Phone is the primary device — most landings come from a QR scan. Design for 375×667 first. Big tap targets (≥44px). One column. One primary action per screen. No sidebars, no nested modals, no hover-only interactions, no drag-drop. Desktop is whatever mobile gives you with more whitespace.
9. **Production ops happen only through CI/CD.** No deploys from a laptop. No remote D1 migrations from a laptop. The package.json scripts intentionally have no `--remote` or `deploy` shortcuts. All prod changes flow through Workers Builds on push to `main` (issue #5). If you find yourself reaching for `wrangler … --remote` directly, stop and ask whether the change should go through a PR instead.

## Stack (locked)

| Layer | Choice |
|---|---|
| Framework | TanStack Start (Vite + React, file-based routing, `createServerFn`) |
| Hosting | Cloudflare Pages / Workers + Static Assets |
| DB | Cloudflare D1 (CF-native managed SQLite, Worker binding `env.DB`) |
| DB client | [Drizzle ORM](https://orm.drizzle.team) (`drizzle-orm/d1`) — schema-in-TS, auto-derived types |
| DB types | Derived from `src/db/schema.ts` via `$inferSelect` / `$inferInsert` |
| Migrations | Plain `.sql` files in `migrations/`, applied via `wrangler d1 migrations apply`. **No `drizzle-kit`.** |
| Styling | Plain CSS, semantic HTML |
| Package manager | pnpm |
| Lint/format | Biome |
| QR generation | TBD, edge-friendly lib (chosen at #11) |

## File layout

```
src/
├── routes/                  ← TanStack file-based routes (flat dotted form)
│   ├── __root.tsx
│   ├── index.tsx            ← /
│   ├── register.tsx         ← /register
│   ├── courts.tsx           ← /courts
│   ├── c.$courtId.tsx       ← /c/:courtId
│   └── c.$courtId.print.tsx ← /c/:courtId/print
├── server/                  ← server functions, ONLY consumer of the Drizzle instance
│   ├── courts.ts            ← registerCourt, getCourt, listCourts
│   ├── queue.ts             ← checkIn, signOut, extendStay
│   └── session.ts           ← anonymous cookie helpers
├── db/                      ← DB plumbing — only place that builds the Drizzle instance
│   ├── client.ts            ← makeDb(env.DB) factory
│   └── schema.ts            ← Drizzle schema; source of truth for TS types
├── styles.css               ← all styling lives here
├── router.tsx
└── routeTree.gen.ts         ← do not edit (auto-generated)

migrations/
├── 0001_init.sql            ← plain SQL, numbered, append-only, NEVER edited after applied
└── ...

public/
├── favicon.svg              ← bird's-eye tennis court, N–S
├── manifest.json
└── robots.txt
```

## Conventions

- **Server functions** use TanStack Start's `createServerFn`. Names are `verbNoun` (e.g. `registerCourt`, `checkIn`, `getCourt`).
- **Routes** use TanStack's flat dotted form (`c.$courtId.tsx`, not `[courtId]/page.tsx`). Params via `Route.useParams()`.
- **HTML** uses semantic elements: `<main>`, `<header>`, `<nav>`, `<section>`, `<form>`, `<label>`, `<button>`. Reach for ARIA only when semantics aren't enough.
- **CSS** uses CSS variables for the few accent colors (see `styles.css`). Class names are short (`.btn`, `.btn-primary`, `.actions`, `.muted`).
- **Imports** use the `#/` path alias for `src/` (configured in `package.json` imports map and `tsconfig.json`).

## UX rules (read before editing routes / styles)

The phone is *the* device. Every screen must work cleanly at **375×667**. Desktop is "mobile + whitespace." Anything that violates the following is a defect, not a stylistic preference.

### Layout

- One column. No sidebars, no two-pane views.
- Max content width ~640px (`max-width: var(--max)` in styles.css). Centered.
- Sticky/floating UI is the exception, not the default — only for the primary action when scroll matters.
- No layout that requires horizontal scrolling on phone.

### Tap targets + spacing

- Buttons + tappable controls ≥ 44×44px (Apple HIG minimum). Padding generously rather than relying on font size.
- Vertical spacing between tappable elements ≥ 8px.
- Don't put two destructive/important actions adjacent — finger fat is real.

### Interaction

- **No hover-only interactions.** Hover is decoration, never the only path to information.
- **No drag-drop.** Touch + drag conflicts with scroll on phones.
- **No keyboard shortcuts as a primary path.** Phones don't have keyboards.
- **No multi-step modals** or modals that open modals.
- **One primary action per screen.** Secondary actions are visually subordinate (border-only buttons, smaller, or in an overflow).
- **No popups, tooltips, or hover cards** that hide important content. Show it inline or not at all.

### Forms

- Native inputs (`<input>`, `<select>`, `<textarea>`) over custom widgets. Mobile keyboards know what to do with them.
- Use proper `type=` (`tel`, `number`, `email`, `url`) — phones swap to the right keyboard.
- One field per row. No two-column form layouts.
- `<label>` always; either visually attached or `for=`-linked. Placeholder is not a label.
- Submit button below the form, full-width on mobile.

### Type + density

- Body text 16px minimum (prevents iOS zoom-on-focus).
- Headings prominent enough to read at arm's length.
- Don't pack the screen — generous whitespace beats information density.

### Loading / state

- Skeletons or spinners only when load is genuinely > 200ms. Otherwise just render.
- Don't replace whole-page content with a spinner — preserve layout, swap inner state.
- Empty states have one clear next action.

### Forbidden (UX-side blockers — see also `simplicity-reviewer`)

- Carousels.
- Hamburger menus on a 4-route app.
- Floating action buttons that obscure list content on scroll.
- Anything requiring a tutorial or tooltip to use.
- Splash screens.
- Cookie banners (we don't use tracking cookies — only the session UUID, which is functional, not analytics).

## Drizzle guardrails (read before touching `src/db/` or `migrations/`)

We use **`drizzle-orm`** for queries + types. We do **not** use `drizzle-kit` for migrations — wrangler manages those (no JSON snapshots, no PR diff bloat).

### Boundaries

- **Only `src/db/client.ts` constructs the Drizzle instance** via `makeDb(env.DB)`. The `drizzle-orm/d1` import lives only here.
- **Only `src/server/*.ts` calls `makeDb()`** to get a per-request instance. Routes never query the DB directly.
- **Drizzle is per-request, not module-scoped.** D1's `env.DB` binding is request-scoped (only available once the Worker has a request in hand). Build a fresh Drizzle instance inside each server-function handler. Top-level singletons = blocker.

### Two sources of truth, kept in lockstep

| File | Source of truth for |
|---|---|
| `src/db/schema.ts` | TypeScript types (Drizzle table builders) |
| `migrations/NNNN_*.sql` | Actual database structure |

When you change one, you change the other in the same PR. Code review is the drift-detection mechanism. Don't try to automate diffing — that path leads back to JSON snapshots.

### Forbidden: `drizzle-kit`

- Do not install `drizzle-kit`.
- Do not run `drizzle-kit generate`, `drizzle-kit push`, `drizzle-kit migrate`.
- Do not create a `drizzle.config.ts`.
- Do not commit `drizzle/meta/` or `_journal.json` snapshot files.

If you find yourself wanting drizzle-kit, you're solving the wrong problem. Migrations are wrangler's job.

### Row types

Drizzle gives us auto-derived types — use them:

```ts
import { courts } from '#/db/schema'

type Court = typeof courts.$inferSelect      // read shape
type NewCourt = typeof courts.$inferInsert   // insert shape (omits Generated/defaulted cols)
```

Or import the pre-exported aliases:

```ts
import type { Court, NewCourt, QueueEntry, NewQueueEntry } from '#/db/schema'
```

### Query rules

- **Prefer explicit selects** over default-select-all when the row will be returned to the client. Forces awareness when columns are added.
  ```ts
  // good
  await db
    .select({ id: courts.id, name: courts.name, numCourts: courts.numCourts })
    .from(courts)
    .where(eq(courts.id, id))
    .get()

  // ok inside server fns where you'll use the full row internally
  await db.select().from(courts).where(eq(courts.id, id)).get()
  ```
- **Snake_case in SQL, camelCase in TS** — Drizzle handles the mapping via the column names you give in `text('column_name')`. App code only ever sees camelCase property names.
- **Transactions are shallow.** One per server function, no nesting. (D1 transactions are limited; multi-statement work often uses Drizzle's `db.batch([...])` for D1's atomic statement batching.)
- **Don't import `drizzle-orm/d1` outside `src/db/client.ts`.**

### Migrations

- Plain SQL files: `migrations/NNNN_description.sql`.
- Created via `pnpm db:new <name>` → `wrangler d1 migrations create opencourts <name>` (wrangler picks the next number).
- Numbered with leading zeros (`0001_…`, `0002_…`), **never renamed**, **never edited after applied**.
- One migration = one logical change. Don't bundle unrelated alterations.
- Migration tracking is handled by D1 itself (`d1_migrations` table managed by wrangler).

### Workflow when changing the schema

> **Full playbook with copy-paste recipes lives at [`migrations/README.md`](./migrations/README.md).** Read it before any schema change. It covers: adding tables, adding columns (nullable / NOT NULL / with backfill), dropping/renaming columns, indexes, pure data migrations, FK additions, and SQLite-specific gotchas. Both humans and AI agents should reach for it first.

Quick recap of the loop:

```
1. pnpm db:new <name>          → creates migrations/000N_<name>.sql (empty)
2. Write the CREATE/ALTER SQL in that file
3. Update src/db/schema.ts to match (add/modify table builders)
4. pnpm db:migrate             → applies to LOCAL D1 only
5. Commit migration AND schema.ts together — same PR
6. Merge → CI applies to remote D1 + deploys (no laptop ever touches prod)
```

Steps 2 and 3 must agree. Reviewer agent + simplicity-reviewer flag PRs that touch one without the other. Step 6 is automatic — see issue #5 (Workers Builds).

### Migration philosophy: forward-only, Rails-style

The pattern is **Rails ActiveRecord migrations minus `down` blocks**. Map:

| Rails | Here |
|---|---|
| `db/migrate/000N_thing.rb` | `migrations/000N_thing.sql` |
| `rake db:migrate` | `pnpm db:migrate` |
| `rake db:reset` | `pnpm db:reset` |
| `rake db:rollback` | (intentionally missing — see below) |
| `db/schema.rb` (auto-generated) | `src/db/schema.ts` (hand-maintained) |

**Two deliberate departures from Rails:**

1. **No `down` migrations, no rollback command.** This isn't a tooling limitation we're working around — it's a policy. Modern industry consensus (and Rails teams in practice) is that production rollback is risky and rarely run. The fix for a bad migration is *another* forward migration that reverses it.
   - Local dev rollback = `pnpm db:reset` (wipes local D1, replays all). Practical equivalent of `rake db:rollback` for solo dev.
   - Prod rollback = new forward migration. Always.
2. **Schema.ts is hand-maintained, not generated.** Rails generates `db/schema.rb` from the live DB. We hand-maintain `src/db/schema.ts` to match the migrations. The alternative tools (drizzle-kit pull, kysely-codegen) drag in native-binary peer deps and tooling complexity that don't justify themselves at our scale (2-3 tables, low churn).
   - Discipline: any PR touching `migrations/*.sql` must also touch `src/db/schema.ts`. Reviewer agent enforces.

### Query rules

- **Never `.selectAll()` in app code.** Always pick explicit columns. Forces awareness when a column is added.
- **camelCase in TypeScript, snake_case in SQL.** `CamelCasePlugin` is enabled once in `client.ts`. App code never sees `num_courts` — it's `numCourts`.
- **Transactions are shallow.** One per server function, no nesting.
- **One server function = one logical operation.** If a server fn juggles five queries and conditional branching, split it.
- **No raw SQL in app code.** Use Drizzle's `sql\`...\`` template only inside `src/db/` if absolutely needed.

## Key models

- **Lazy promotion** (see VISION.md → Data Model → Lazy promotion). Promotion happens inside `getCourt()` in one transaction. No background worker.
- **Sign-out trust model** (see VISION.md → Sign-out trust model). v1 = honor system: any visitor can clear any entry. Owner gets a stronger-styled "I'm done" button when their session cookie matches.

## When you propose a change

- Cite the rule, principle, or VISION section being honored or relaxed.
- If something feels too simple, that's probably correct. Bias toward removal.
- If a new file would be < 50 lines, consider whether it can fold into an existing one.
- New routes: stub first (placeholder under-construction body), then wire data, then wire actions. No dead routes in main.

## Open decisions

- **Domain name**.
- **Polling interval** for live court page updates.
- **QR generation library** (chosen at issue #11).

## Pointers

- [VISION.md](./VISION.md) — full problem statement, principles, data model, route map.
- `.claude/agents/simplicity-reviewer.md` — automated reviewer that flags ethos violations on diffs.
- `.claude/skills/opencourts-conventions/SKILL.md` — convention reminders triggered when editing routes/server/db/css.
- GitHub issues — small unit work items, dep chain in titles/bodies.
