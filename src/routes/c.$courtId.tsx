import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { CourtEntry } from "#/server/queue";
import { checkIn, DURATIONS, getCourt, signOut } from "#/server/queue";

// Refresh cadence for the court page. The queue changes on human timescales
// (minutes), so a slow poll reads as "live" while keeping invocations near
// zero. Each poll re-runs getCourt → fresh state + lazy promotion. We only
// poll while the tab is visible (phone in pocket = no requests).
// NOTE: the /courts list is intentionally *not* polled yet — it's glance-and-go
// and you re-enter it fresh. Add the same hook there if real demand appears.
const POLL_MS = 5 * 60_000;

export const Route = createFileRoute("/c/$courtId")({
	component: Court,
	loader: ({ params }) => getCourt({ data: { courtId: params.courtId } }),
});

// Whole minutes between two unix-second timestamps, floored at 0.
function minutesBetween(from: number, to: number): number {
	return Math.max(0, Math.floor((to - from) / 60));
}

function Court() {
	const state = Route.useLoaderData();
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const { court, playing, waiting, hasActiveEntry } = state;
	const inUse = playing.length;
	const open = court.numCourts - inUse;

	// Slow poll while visible. Pause when the tab is hidden; refresh on return.
	useEffect(() => {
		let timer: ReturnType<typeof setInterval> | undefined;

		function start() {
			if (timer) return;
			timer = setInterval(() => router.invalidate(), POLL_MS);
		}
		function stop() {
			if (timer) clearInterval(timer);
			timer = undefined;
		}
		function onVisibility() {
			if (document.visibilityState === "visible") {
				router.invalidate(); // catch up immediately, then resume polling
				start();
			} else {
				stop();
			}
		}

		start();
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			stop();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [router]);

	async function onCheckIn(durationMin: number) {
		setError(null);
		setBusy(true);
		try {
			await checkIn({ data: { courtId: court.id, durationMin } });
			await router.invalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not check in");
		} finally {
			setBusy(false);
		}
	}

	async function onSignOut(entryId: string) {
		setError(null);
		setBusy(true);
		try {
			await signOut({ data: { entryId } });
			await router.invalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not sign out");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main>
			<h1>{court.name}</h1>
			<p className="muted">{court.location}</p>
			<p className="lead">
				{open > 0
					? `${open} of ${court.numCourts} open`
					: `Full — ${court.numCourts} in use`}
				{waiting.length > 0 && ` · ${waiting.length} waiting`}
			</p>

			{error && (
				<p role="alert" className="error">
					{error}
				</p>
			)}

			<section>
				<h2>On court</h2>
				{playing.length === 0 ? (
					<p className="muted">Court is open.</p>
				) : (
					<ul className="bare">
						{playing.map((e) => (
							<PlayingItem
								key={e.id}
								entry={e}
								busy={busy}
								onSignOut={onSignOut}
							/>
						))}
					</ul>
				)}
			</section>

			{waiting.length > 0 && (
				<section>
					<h2>Waiting</h2>
					<ul className="bare">
						{waiting.map((e, i) => (
							<WaitingItem
								key={e.id}
								entry={e}
								position={i + 1}
								busy={busy}
								onSignOut={onSignOut}
							/>
						))}
					</ul>
				</section>
			)}

			{!hasActiveEntry && (
				<CheckInForm busy={busy} courtFull={open <= 0} onCheckIn={onCheckIn} />
			)}
		</main>
	);
}

function PlayingItem({
	entry,
	busy,
	onSignOut,
}: {
	entry: CourtEntry;
	busy: boolean;
	onSignOut: (id: string) => void;
}) {
	const nowSec = Math.floor(Date.now() / 1000);
	const elapsed = entry.startedAt ? minutesBetween(entry.startedAt, nowSec) : 0;
	const left = entry.expiresAt ? minutesBetween(nowSec, entry.expiresAt) : 0;
	return (
		<li>
			<span>
				Playing {elapsed}m · {left}m left
			</span>
			<SignOutButton entry={entry} busy={busy} onSignOut={onSignOut} />
		</li>
	);
}

function WaitingItem({
	entry,
	position,
	busy,
	onSignOut,
}: {
	entry: CourtEntry;
	position: number;
	busy: boolean;
	onSignOut: (id: string) => void;
}) {
	return (
		<li>
			<span>#{position} in line</span>
			<SignOutButton entry={entry} busy={busy} onSignOut={onSignOut} />
		</li>
	);
}

// Owner gets a stronger "I'm done"; community override is a subtler "Clear".
function SignOutButton({
	entry,
	busy,
	onSignOut,
}: {
	entry: CourtEntry;
	busy: boolean;
	onSignOut: (id: string) => void;
}) {
	return (
		<button
			type="button"
			className={entry.isMine ? "btn btn-primary" : "btn"}
			disabled={busy}
			onClick={() => onSignOut(entry.id)}
		>
			{entry.isMine ? "I'm done" : "Clear"}
		</button>
	);
}

function CheckInForm({
	busy,
	courtFull,
	onCheckIn,
}: {
	busy: boolean;
	courtFull: boolean;
	onCheckIn: (durationMin: number) => void;
}) {
	const [durationMin, setDurationMin] = useState(90);

	return (
		<section>
			<h2>{courtFull ? "Join the queue" : "I'm here"}</h2>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					onCheckIn(durationMin);
				}}
			>
				<label>
					How long?
					<select
						name="durationMin"
						value={durationMin}
						onChange={(e) => setDurationMin(Number(e.target.value))}
					>
						{DURATIONS.map((d) => (
							<option key={d} value={d}>
								{d} min
							</option>
						))}
					</select>
				</label>

				<button type="submit" className="btn btn-primary" disabled={busy}>
					{busy ? "…" : courtFull ? "Join queue" : "I'm here"}
				</button>
			</form>
		</section>
	);
}
