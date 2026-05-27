import { getCookie, setCookie } from "@tanstack/react-start/server";

const COOKIE_NAME = "oc_sid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Read the anonymous session id if present. Server-fn use only — depends on
// TanStack Start's request-scoped context.
export function getSessionId(): string | undefined {
	return getCookie(COOKIE_NAME);
}

// Read the cookie, or generate + set one and return the new id.
// Idempotent: safe to call from any mutating server fn.
export function ensureSessionId(): string {
	const existing = getCookie(COOKIE_NAME);
	if (existing) return existing;

	const id = crypto.randomUUID();
	setCookie(COOKIE_NAME, id, {
		httpOnly: true,
		sameSite: "lax",
		secure: import.meta.env.PROD,
		path: "/",
		maxAge: ONE_YEAR_SECONDS,
	});
	return id;
}
