import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";

import { makeDb } from "#/db/client";
import { courts } from "#/db/schema";

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
