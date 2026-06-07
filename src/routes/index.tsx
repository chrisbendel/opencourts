import { createFileRoute, Link } from "@tanstack/react-router";

import { listCourts } from "#/server/courts";

export const Route = createFileRoute("/")({
	component: Home,
	loader: () => listCourts(),
});

// Natural-language status. "2 courts open" when seats free; otherwise
// "All courts full" (+ "· N in line" when anyone's waiting).
function statusLabel(
	numCourts: number,
	openCount: number,
	waitingCount: number,
): string {
	if (openCount > 0) {
		return `${openCount} ${openCount === 1 ? "court" : "courts"} open`;
	}
	const full = numCourts === 1 ? "Court full" : "All courts full";
	return waitingCount > 0 ? `${full} · ${waitingCount} in line` : full;
}

function Home() {
	const courts = Route.useLoaderData();

	return (
		<main>
			<div className="list-head">
				<h1 className="visually-hidden">Courts</h1>
				{/* A "near me" location lookup will live on the left here later (#15). */}
				<Link to="/register" className="btn btn-sm">
					Add a court
				</Link>
			</div>

			{courts.length === 0 ? (
				<p className="muted">
					No courts yet. Add one to get its queue started.
				</p>
			) : (
				<ul className="bare">
					{courts.map((c) => (
						<li key={c.id}>
							<Link to="/c/$courtId" params={{ courtId: c.id }}>
								<strong>{c.name}</strong>
								<br />
								<span className="muted">{c.location}</span>
								<br />
								<span
									className={c.openCount > 0 ? "status-open" : "status-full"}
								>
									{statusLabel(c.numCourts, c.openCount, c.waitingCount)}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</main>
	);
}
