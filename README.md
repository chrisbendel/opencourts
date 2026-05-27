# OpenCourts

Anonymous, friction-free queue tracker for public tennis courts. Scan a QR on the fence, see who's playing, tap to check in. No accounts, no app, no nonsense.

## Why this exists

You show up to a public court. You don't know if it's free, how many people are waiting, or how long the current players will be. Today you stand around and guess. OpenCourts is a tiny shared signal — a QR code on the fence, a web page, an auto-expiring queue. That's it.

Full problem statement and principles: [VISION.md](./VISION.md). Project conventions (hard rules, security, UX, Drizzle guardrails): [CLAUDE.md](./CLAUDE.md).

## Stack

| Layer | Choice |
|---|---|
| Framework | [TanStack Start](https://tanstack.com/start) (Vite + React, file-based routes, `createServerFn`) |
| Hosting | Cloudflare Workers + Static Assets |
| Database | Cloudflare D1 (managed SQLite, request-scoped `env.DB` binding) |
| ORM (runtime only) | [Drizzle](https://orm.drizzle.team) — `drizzle-orm/d1`. **No `drizzle-kit`.** |
| Migrations | Plain SQL in `migrations/`, applied via `wrangler d1 migrations apply` |
| Styling | Plain CSS in `src/styles.css`. No Tailwind, no CSS-in-JS, no UI lib. |
| Package manager | pnpm |
| Lint/format | [Biome](https://biomejs.dev/) |

## Local dev

```bash
pnpm install
pnpm db:migrate        # apply migrations to local D1 (.wrangler/state/)
pnpm dev               # http://localhost:4040
```

## Commands

| Script | What it does |
|---|---|
| `pnpm dev` | Vite dev server on :4040 |
| `pnpm build` | Production build |
| `pnpm test` | Vitest run (includes schema ↔ migrations drift check) |
| `pnpm check` | Biome lint + format check |
| `pnpm typecheck` | Regen worker types + `tsc --noEmit` |
| `pnpm cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `pnpm cf-typegen:check` | Verify committed worker types are fresh (used in CI) |
| `pnpm db:new <name>` | Create a new numbered migration file |
| `pnpm db:migrate` | Apply migrations to **local** D1 |
| `pnpm db:status` | List applied migrations on local D1 |
| `pnpm db:reset` | Wipe local D1 and reapply all migrations |
| `pnpm db:check` | Drift test: Drizzle schema ↔ migrations |

There are no `--remote` or `deploy` scripts on purpose. Production changes only flow through CI (see below).

## Schema changes

Source of truth is split deliberately:

- `src/db/schema.ts` — TypeScript types (Drizzle table builders)
- `migrations/NNNN_*.sql` — actual database structure

Both must change together in the same PR. The drift check in `pnpm db:check` enforces it. See [migrations/README.md](./migrations/README.md) for the full playbook (adding tables, nullable columns, backfills, indexes, etc.).

Quick loop:

```bash
pnpm db:new add_something      # creates migrations/000N_add_something.sql
# edit the SQL file
# edit src/db/schema.ts to match
pnpm db:migrate                # apply locally
pnpm db:check                  # verify they agree
```

Forward-only — no `down` migrations. Bad migration? Fix with another forward migration. Local rollback = `pnpm db:reset`.

## Deployment

Production deploys are handled by **Cloudflare Workers Builds** (CF-native CI). Every push to `main` triggers:

1. `pnpm install --frozen-lockfile`
2. `pnpm db:migrate` (ephemeral local D1, for drift test)
3. `pnpm db:check` (schema ↔ migrations drift gate)
4. `pnpm build` (Vite build)
5. `npx wrangler d1 migrations apply opencourts --remote` (apply to prod D1)
6. `npx wrangler deploy` (ship the Worker)

**No deploys from a laptop.** No `--remote` or `deploy` scripts in package.json by design. If you find yourself reaching for `wrangler … --remote` locally, stop and open a PR instead.

PR-side checks (typecheck, tests, drift, lint) run on GitHub Actions — see [.github/workflows/ci.yml](./.github/workflows/ci.yml).

## Layout

```
src/
├── routes/           TanStack file-based routes (flat dotted form: c.$courtId.tsx)
├── server/           server functions — only consumer of the Drizzle instance
├── db/               Drizzle schema + client factory (no app code imports drizzle-orm/d1 directly)
└── styles.css        all styling lives here
migrations/           plain SQL, numbered, append-only
public/               static assets (favicon, manifest, robots.txt)
wrangler.jsonc        Worker config (D1 binding, observability, compat date)
```

More project rules and rationale: [CLAUDE.md](./CLAUDE.md).
