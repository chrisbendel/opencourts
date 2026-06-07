import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, isNotNull, lt } from "drizzle-orm";

import { type Db, makeDb } from "#/db/client";
import { courts, queueEntries } from "#/db/schema";
import { ensureSessionId, getSessionId } from "#/server/session";

// Allowed duration steps (minutes). Source of truth for both the check-in
// validator and the picker UI (imported by the court route).
export const DURATIONS = [30, 60, 90, 120, 150, 180];

// Unix seconds. Shared clock for server fns.
export function now(): number {
	return Math.floor(Date.now() / 1000);
}

// ─── tiny validation primitives (no dep; CLAUDE.md rule #3) ──────────────────
function asObject(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== "object") throw new Error("Invalid input");
	return raw as Record<string, unknown>;
}

// An id-shaped string field: present, 1–64 chars.
function reqId(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length < 1 || value.length > 64) {
		throw new Error(`Invalid ${label}`);
	}
	return value;
}

// ─── lazy promotion ─────────────────────────────────────────────────────────
//
// State is honest by query, not by clock (VISION → Lazy promotion). D1 has no
// interactive transactions, but Workers serialise a request and D1 serialises
// writes, so the race window is negligible — acceptable for an honor-system app.
//
//   1. Delete expired playing entries (waiters have no expires_at, so untouched).
//   2. While playing < num_courts and waiters exist, promote the oldest waiter:
//      status='playing', started_at=now, expires_at=now + duration_min*60.
//
// Runs inside getCourt() and before every check-in so reads/writes see fresh
// state. Returns the number of free courts after promotion, so callers don't
// have to re-count the playing entries it already inspected.
async function promote(
	db: Db,
	courtId: string,
	numCourts: number,
): Promise<number> {
	const ts = now();

	await db
		.delete(queueEntries)
		.where(
			and(
				eq(queueEntries.courtId, courtId),
				isNotNull(queueEntries.expiresAt),
				lt(queueEntries.expiresAt, ts),
			),
		);

	const playing = await db
		.select({ id: queueEntries.id })
		.from(queueEntries)
		.where(
			and(
				eq(queueEntries.courtId, courtId),
				eq(queueEntries.status, "playing"),
			),
		)
		.all();

	const free = numCourts - playing.length;
	if (free <= 0) return 0;

	const waiters = await db
		.select({ id: queueEntries.id, durationMin: queueEntries.durationMin })
		.from(queueEntries)
		.where(
			and(
				eq(queueEntries.courtId, courtId),
				eq(queueEntries.status, "waiting"),
			),
		)
		.orderBy(asc(queueEntries.joinedAt))
		.limit(free)
		.all();

	if (waiters.length === 0) return free;

	const updates = waiters.map((w) =>
		db
			.update(queueEntries)
			.set({
				status: "playing",
				startedAt: ts,
				expiresAt: ts + w.durationMin * 60,
			})
			.where(eq(queueEntries.id, w.id)),
	);
	// D1 atomic statement batch — promotions land together.
	await db.batch(updates as [(typeof updates)[number], ...typeof updates]);

	return free - waiters.length;
}

// ─── getCourt (loader) ───────────────────────────────────────────────────────

export interface CourtEntry {
	id: string;
	startedAt: number | null;
	expiresAt: number | null;
	joinedAt: number;
	isMine: boolean;
}

export interface CourtState {
	court: { id: string; name: string; location: string; numCourts: number };
	playing: CourtEntry[];
	waiting: CourtEntry[];
	hasActiveEntry: boolean; // current session already in this court's queue
}

function validateCourtId(raw: unknown): { courtId: string } {
	const { courtId } = asObject(raw);
	return { courtId: reqId(courtId, "courtId") };
}

export const getCourt = createServerFn({ method: "GET" })
	.inputValidator(validateCourtId)
	.handler(async ({ data }): Promise<CourtState> => {
		const db = makeDb(env.DB);

		const court = await db
			.select({
				id: courts.id,
				name: courts.name,
				location: courts.location,
				numCourts: courts.numCourts,
			})
			.from(courts)
			.where(eq(courts.id, data.courtId))
			.get();

		if (!court) throw new Error("Court not found");

		await promote(db, court.id, court.numCourts);

		const rows = await db
			.select({
				id: queueEntries.id,
				sessionId: queueEntries.sessionId,
				status: queueEntries.status,
				startedAt: queueEntries.startedAt,
				expiresAt: queueEntries.expiresAt,
				joinedAt: queueEntries.joinedAt,
			})
			.from(queueEntries)
			.where(eq(queueEntries.courtId, court.id))
			.orderBy(asc(queueEntries.joinedAt))
			.all();

		const mySession = getSessionId();
		const toEntry = (r: (typeof rows)[number]): CourtEntry => ({
			id: r.id,
			startedAt: r.startedAt,
			expiresAt: r.expiresAt,
			joinedAt: r.joinedAt,
			isMine: !!mySession && r.sessionId === mySession,
		});

		return {
			court,
			playing: rows.filter((r) => r.status === "playing").map(toEntry),
			waiting: rows.filter((r) => r.status === "waiting").map(toEntry),
			hasActiveEntry:
				!!mySession && rows.some((r) => r.sessionId === mySession),
		};
	});

// ─── checkIn (action) ─────────────────────────────────────────────────────────

interface CheckInInput {
	courtId: string;
	durationMin: number;
}

function validateCheckIn(raw: unknown): CheckInInput {
	const { courtId, durationMin } = asObject(raw);
	const dur = Number(durationMin);
	if (!DURATIONS.includes(dur)) {
		throw new Error(`durationMin must be one of ${DURATIONS.join(", ")}`);
	}
	return { courtId: reqId(courtId, "courtId"), durationMin: dur };
}

export const checkIn = createServerFn({ method: "POST" })
	.inputValidator(validateCheckIn)
	.handler(async ({ data }): Promise<{ entryId: string }> => {
		const db = makeDb(env.DB);
		const sessionId = ensureSessionId();

		const court = await db
			.select({ id: courts.id, numCourts: courts.numCourts })
			.from(courts)
			.where(eq(courts.id, data.courtId))
			.get();
		if (!court) throw new Error("Court not found");

		// Clear expired + fill open seats before deciding this entry's status.
		// promote() already counted the playing entries, so it hands back how
		// many courts are free — no need to re-query.
		const freeSeats = await promote(db, court.id, court.numCourts);

		// One active entry per session per court — re-tapping shouldn't stack.
		const mine = await db
			.select({ id: queueEntries.id })
			.from(queueEntries)
			.where(
				and(
					eq(queueEntries.courtId, court.id),
					eq(queueEntries.sessionId, sessionId),
				),
			)
			.get();
		if (mine) throw new Error("You're already in this court's queue");

		const ts = now();
		const seatFree = freeSeats > 0;
		const id = crypto.randomUUID();

		await db.insert(queueEntries).values({
			id,
			courtId: court.id,
			sessionId,
			durationMin: data.durationMin,
			status: seatFree ? "playing" : "waiting",
			joinedAt: ts,
			startedAt: seatFree ? ts : null,
			expiresAt: seatFree ? ts + data.durationMin * 60 : null,
		});

		return { entryId: id };
	});

// ─── signOut (action) ─────────────────────────────────────────────────────────
//
// Honor system (VISION → Sign-out trust model): any visitor can clear any
// entry. v1 has no friction on community overrides. Deleting frees the seat;
// the next getCourt read promotes a waiter into it.

function validateEntryId(raw: unknown): { entryId: string } {
	const { entryId } = asObject(raw);
	return { entryId: reqId(entryId, "entryId") };
}

export const signOut = createServerFn({ method: "POST" })
	.inputValidator(validateEntryId)
	.handler(async ({ data }): Promise<{ ok: true }> => {
		const db = makeDb(env.DB);
		await db.delete(queueEntries).where(eq(queueEntries.id, data.entryId));
		return { ok: true };
	});
