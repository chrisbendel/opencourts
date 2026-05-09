# OpenCourts

A dead-simple, anonymous, near-zero-cost queue tracker for public tennis courts.

## The Problem

You show up to a public tennis court. You don't know:
- Whether any courts are free
- How many people are already waiting
- How long the current players have been there or plan to stay

Today you just stand around and guess. There's no shared signal.

## The Solution

A QR code on the fence at each court. Scan it to check in. The site shows who's currently on the court and who's waiting. Entries auto-expire so the queue stays honest with zero moderation.

## Core Principles

1. **Zero friction.** No accounts. No app install. No email. Scan a QR, tap one or two buttons, done. If it takes more than 5 seconds it won't get used.
2. **Public benefit by default.** Anyone can register a court. Anyone can use any court. The data is open. The site exists to make a small public good slightly better.
3. **Self-correcting.** Entries expire automatically. Stale data clears itself. No moderators required.
4. **Near-zero operating cost.** The whole thing should run on free tiers indefinitely. If it gets popular, costs stay in pennies-per-month range.
5. **Organic scale.** Anyone with a printer and a lamination pouch can spread it. No central rollout.

## User Flows

### Player arriving at court

1. Scan QR code at the court.
2. Land on `/c/{courtId}` showing current state: who's playing, who's waiting, estimated wait.
3. Tap "I'm here" → optionally pick duration (default 60 or 90 min) → optionally note "+1 / +2 / +3 others with me" so groups don't all need to scan.
4. Done. They're now in the queue (or on the court if it was empty).
5. When they leave, they tap "Done" to free the spot. If they forget, the timer expires and the spot frees automatically.

### Court organizer

1. Visit site, click "Register a court."
2. Enter court name (e.g. "Riverside Park Court 2"), rough location, number of courts at the location (1, 2, 4, etc.).
3. Get a printable PDF with QR code(s) and short instructions.
4. Print, laminate, zip-tie to fence. Done.

### Identity & sign-out without accounts

- On first scan, browser gets a random session ID stored in localStorage / cookie.
- That ID owns any check-ins from that device, so the same person can tap "I'm done" later and clear their own entry.
- No PII collected. No email. No login.

## Data Model (rough)

A "court" is really a **location** that may contain N physical courts. The queue is shared across the location — any free court works.

```
courts
  id (uuid)
  name
  location (text or lat/lng)
  num_courts (int)             -- 1+ physical courts at this location, share one queue
  created_at

queue_entries
  id (uuid)
  court_id -> courts.id
  session_id (random, from device)
  party_size (int, default 1)  -- "+1, +2" for groups
  status (waiting | playing)
  started_at
  expires_at                   -- auto-clears when now() > expires_at
```

Reads always filter `WHERE expires_at > now()`. No cleanup job needed; expired rows can be vacuumed lazily.

### Lazy promotion

No background workers, no cron. Promotion happens at read time inside one transaction:

1. Mark/delete entries where `expires_at < now()`.
2. While `count(playing) < num_courts` and waiters exist → promote oldest waiter (`status = 'playing'`, set `started_at = now()`, `expires_at = now() + duration`).
3. Return current state.

State is honest by query, not by clock.

## Route Map (v1)

| Path | Purpose |
|---|---|
| `/` | Landing. What it is + CTA "Register a court" + recent courts list. |
| `/c/$courtId` | **Main UX.** QR scan target. Shows current playing + waiting, check-in button. |
| `/c/$courtId/print` | Printable QR sheet for organizer (post-register redirect). |
| `/register` | Form: court name, location, num_courts. |
| `/courts` | Browse all courts. v1 = bare `<ul>`. Polish later. |

Future / deferred: `/about`, search, map view.

## Server Functions (TanStack Start `createServerFn`)

**Loaders:**
- `getCourt(courtId)` — court meta + active queue (after lazy-promotion transaction).
- `listCourts()` — all courts, ordered by created_at desc. For `/courts` and `/`.

**Actions:**
- `registerCourt({ name, location, numCourts })` → returns `{ courtId }`.
- `checkIn({ courtId, durationMin, partySize })` → inserts queue entry. Sets sessionId cookie if missing. Auto-status: `playing` if seats free else `waiting`.
- `signOut({ entryId })` → marks entry done. Honor-system: any session can sign anyone out (see below).
- `extendStay({ entryId, addMin })` (later) → bump `expires_at`.

### Duration picker

Default 90 min. Picker steps: 30 / 60 / 90 / 120 / 150 / 180 min.

### Sign-out trust model (community / honor system)

- **Owner sign-out:** if the device's `sessionId` cookie matches the entry's `session_id`, allow.
- **Community override:** any visitor can also sign someone out — common scenario: 4 courts, 2 marked busy, but those people left without signing out. New arrival sees state is wrong, fixes it.
- v1: no friction on community sign-outs. Trust the honor system.
- v2 ideas (deferred): "Are you sure? This entry has X minutes left" confirm dialog. Cooldown so one bad actor can't nuke everyone. Maybe simple report mechanism. Worth iterating on once real users exist.

## Local dev seed data

Seed script writes a few sample courts so `/` and `/courts` aren't empty during dev:
- "Riverside Park (4 courts)"
- "Lincoln High (2 courts)"
- "Oak Street Single (1 court)"

Wipe + reseed via `pnpm db:seed`.

## Anti-abuse / edge cases (worth thinking about, not blockers)

- Someone spamming check-ins from one device → rate limit by session ID + IP.
- Someone checking in to courts they're not at → not really fixable without GPS, and adding GPS kills the friction principle. Accept it. Bad-faith actors are rare for a tennis queue.
- Multiple people scanning the same QR while standing together → that's fine, they each get their own entry. Or one scans and adds party_size.

## Tech Stack (locked)

- **Framework:** [TanStack Start](https://tanstack.com/start) — Vite-based React full-stack framework. File routes, server functions (RPC-style mutations and loaders). Vendor-agnostic build target.
- **Hosting:** Cloudflare Pages (or Workers + Static Assets, whichever is the current recommended pattern at scaffold time). Free tier handles ~3M requests/month.
- **Database:** [Cloudflare D1](https://developers.cloudflare.com/d1/) — CF-native managed SQLite, bound directly to the Worker via `wrangler.jsonc`. Same dashboard, same auth, same bill as the rest of the stack. Free tier: 5GB storage, 5M reads/day, 100k writes/day.
- **DB client:** [Drizzle ORM](https://orm.drizzle.team) (`drizzle-orm/d1`). Schema-in-TypeScript with auto-derived types via `$inferSelect` / `$inferInsert`. No codegen step, no schema DSL, no native binaries.
- **DB types:** Derived from `src/db/schema.ts` directly. Schema-in-TS = no separate type generation, no drift between schema and types.
- **Migrations:** plain `.sql` files in `migrations/`, numbered + append-only (`0001_init.sql`, `0002_*.sql`, …). Created with `wrangler d1 migrations create`, applied with `wrangler d1 migrations apply`. **Drizzle-kit is explicitly NOT used** — we keep migrations as wrangler-managed SQL to avoid drizzle-kit's JSON snapshot bloat in PR diffs.

> **Note on Drizzle**: we use only the runtime half of Drizzle (`drizzle-orm`). The migration tooling half (`drizzle-kit`) is rejected because its schema-snapshot JSON files are noisy in PR diffs. Schema (TS) and migrations (SQL) are kept in sync by code review, not by tooling. For a 2-3 table app this is a clean trade.
- **QR generation:** server-side at court registration, return PDF or PNG.
- **Identity:** random UUID in `httpOnly` cookie, set on first visit.
- **Styling:** plain CSS in `src/styles.css`. Semantic HTML. **No Tailwind, no CSS-in-JS, no UI library.**
- **DNS / domain:** Cloudflare (already in use for personal domains).
- **No auth provider. No Redis. No background workers. No cron.**

### Mental model: how the pieces fit

```
Phone ──HTTPS──▶ Cloudflare edge ──▶ Worker (TanStack Start server fn)
                                          │
                                          │ env.DB binding (in-process)
                                          ▼
                                     Cloudflare D1 (managed SQLite)
```

Worker is a V8 isolate. Spins up cold, dies fast. No persistent disk, no TCP pool. Each request runs fresh.

**Why D1 over Postgres on the edge:** Postgres is TCP and wants a connection pool, which Workers can't keep across invocations without a pooler in the middle (Hyperdrive, Neon serverless driver, etc.). D1 is a Cloudflare-native binding — `env.DB` is handed to the Worker per request. No pool, no driver setup, no URL/token to wire.

**Local dev:** `wrangler dev` automatically provisions a local SQLite file under `.wrangler/state/`. Migrations applied with `pnpm db:migrate` hit local by default; `pnpm db:migrate:prod` hits the real D1.

### Why not the alternatives

- *Vercel + Next.js*: ergonomic but soft lock-in, and we want to avoid Vercel-specific dependencies.
- *Rails / long-running server*: pays for idle. Defeats the cost goal.
- *Postgres (Neon, Supabase) on Workers*: needs a connection pooler. Extra hop, extra service.
- *Turso*: very capable libSQL host, slightly bigger free tier, more portable. Rejected in favor of D1 because we're already committed to Cloudflare and the single-platform ergonomics (one dashboard, one bill, native binding, no URL/auth-token plumbing) outweigh the portability advantage for this project.
- *Upstash Redis with TTL keys*: nice fit for the queue, but adds a second DB. SQLite with `expires_at` filter is just as good at this scale.
- *Prisma*: too heavy on D1, codegen step, schema DSL, "Early Access" migration story.
- *Kysely*: was the choice for one round, traded out for Drizzle once we realized `kysely-codegen` requires a native binary (`better-sqlite3`) that fights pnpm's build sandbox. Drizzle's schema-in-TS gives us auto types without any codegen step, no native binary.
- *`drizzle-kit`*: rejected. Its JSON snapshot files inflate PR diffs and have a learning curve we don't need. We use only `drizzle-orm` (the runtime half) and let wrangler own migrations as plain SQL.
- *Tailwind / shadcn / UI library*: rejected. Hides CSS behind class strings, locks us to a build pipeline, and the project's surface area is small enough that 100 lines of plain CSS covers everything.
- *Adding accounts*: would let users see their own history across devices, but the friction cost is huge for the marginal benefit. Skip.

### Known gotchas

- **No `node:` builtins** in Worker runtime. Web-Standard APIs only (`crypto.randomUUID()` etc.). Pick edge-friendly libs.
- **Worker bundle size**: 1MB free / 10MB paid. TanStack Start + Drizzle + libSQL fits comfortably; avoid heavy deps.
- **TanStack Start is still maturing** (pre-1.0 churn possible). Trade-off accepted in exchange for a cleaner agnostic stack.
- **Embedded Turso replicas** require disk → don't apply on Workers. Just use remote HTTPS; latency is fine.

## Explicit non-goals (for v1)

- No reservations or scheduling — only "I'm here now."
- No notifications / push — pull model only, you check the page.
- No social features, profiles, ratings, comments.
- No payments, no premium tier.
- No native app.
- No GPS verification.

## Open questions

- Should the court page poll or use server-sent events for live updates? Polling every 15-30s is probably fine and keeps function invocations low.
- How to seed initial courts in production? Probably just register a few local ones manually and let it grow. (Local dev has a seed script.)
- Domain name?
- Sign-out trust model polish (see Sign-out section) — what UX prevents accidental/abusive community overrides?

## Cost ceiling check (rough)

Assume 1000 active courts, each averaging 20 check-ins/day = 20k writes/day = 600k/month. Plus reads. Comfortably inside Cloudflare Pages + Turso free tiers (3M req/mo on CF, 25M writes/mo on Turso). Real ceiling is probably ~30k DAU before any cost shows up. If it ever blew past free tiers, that would be a fantastic problem to have and the bill would still be single-digit dollars.
