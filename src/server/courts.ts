import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, gt } from "drizzle-orm";

import { makeDb } from "#/db/client";
import { courts, queueEntries } from "#/db/schema";
import { now } from "#/server/queue";

export interface RegisterCourtInput {
	name: string;
	location: string;
	numCourts: number;
}

function validateRegisterInput(raw: unknown): RegisterCourtInput {
	if (!raw || typeof raw !== "object") throw new Error("Invalid input");
	const { name, location, numCourts } = raw as Record<string, unknown>;

	if (typeof name !== "string" || name.trim().length < 1 || name.length > 80) {
		throw new Error("name must be 1-80 characters");
	}
	if (
		typeof location !== "string" ||
		location.trim().length < 1 ||
		location.length > 200
	) {
		throw new Error("location must be 1-200 characters");
	}
	const n = Number(numCourts);
	if (!Number.isInteger(n) || n < 1 || n > 12) {
		throw new Error("numCourts must be an integer 1-12");
	}

	return { name: name.trim(), location: location.trim(), numCourts: n };
}

export const registerCourt = createServerFn({ method: "POST" })
	.inputValidator(validateRegisterInput)
	.handler(async ({ data }): Promise<{ courtId: string }> => {
		const db = makeDb(env.DB);
		const id = crypto.randomUUID();

		await db.insert(courts).values({
			id,
			name: data.name,
			location: data.location,
			numCourts: data.numCourts,
		});

		return { courtId: id };
	});

export interface CourtListing {
	id: string;
	name: string;
	location: string;
	numCourts: number;
	openCount: number; // free courts right now (numCourts − active players)
	waitingCount: number;
}

// Browse registry. Newest first, with live-at-load status.
//
// Status is computed read-only — no promotion, no writes. A court reads as
// "open" the moment a playing slot's expires_at passes, because we count only
// `expires_at > now`; we don't need to promote a waiter to know the seat is
// free. (Promotion still happens lazily on the court page itself.)
//
// Three cheap reads (courts + two grouped counts), merged in memory. No
// per-court fan-out. Geolocation/search is a later branch (#15).
export const listCourts = createServerFn({ method: "GET" }).handler(
	async (): Promise<CourtListing[]> => {
		const db = makeDb(env.DB);
		const ts = now();

		// Three independent reads — one D1 round-trip via batch.
		const [rows, playing, waiting] = await db.batch([
			db
				.select({
					id: courts.id,
					name: courts.name,
					location: courts.location,
					numCourts: courts.numCourts,
				})
				.from(courts)
				.orderBy(desc(courts.createdAt)),
			db
				.select({ courtId: queueEntries.courtId, n: count() })
				.from(queueEntries)
				.where(
					and(
						eq(queueEntries.status, "playing"),
						gt(queueEntries.expiresAt, ts),
					),
				)
				.groupBy(queueEntries.courtId),
			db
				.select({ courtId: queueEntries.courtId, n: count() })
				.from(queueEntries)
				.where(eq(queueEntries.status, "waiting"))
				.groupBy(queueEntries.courtId),
		]);

		const playingBy = new Map(playing.map((r) => [r.courtId, r.n]));
		const waitingBy = new Map(waiting.map((r) => [r.courtId, r.n]));

		return rows.map((c) => ({
			...c,
			openCount: Math.max(0, c.numCourts - (playingBy.get(c.id) ?? 0)),
			waitingCount: waitingBy.get(c.id) ?? 0,
		}));
	},
);
