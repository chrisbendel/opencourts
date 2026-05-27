import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { registerCourt } from "#/server/courts";

export const Route = createFileRoute("/register")({ component: Register });

function Register() {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);

		const form = new FormData(e.currentTarget);
		const data = {
			name: String(form.get("name") ?? ""),
			location: String(form.get("location") ?? ""),
			numCourts: Number(form.get("numCourts") ?? 1),
		};

		try {
			const { courtId } = await registerCourt({ data });
			await navigate({ to: "/c/$courtId/print", params: { courtId } });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not register court");
			setSubmitting(false);
		}
	}

	return (
		<main>
			<h1>Register a court</h1>
			<p className="muted">
				Add a public tennis court so others can see its queue.
			</p>

			<form onSubmit={onSubmit}>
				<label>
					Court name
					<input
						name="name"
						type="text"
						required
						maxLength={80}
						placeholder="Riverside Park Court 2"
						autoComplete="off"
					/>
				</label>

				<label>
					Location
					<input
						name="location"
						type="text"
						required
						maxLength={200}
						placeholder="123 Riverside Dr, Springfield"
						autoComplete="off"
					/>
				</label>

				<label>
					Number of courts at this location
					<input
						name="numCourts"
						type="number"
						required
						min={1}
						max={12}
						defaultValue={1}
						inputMode="numeric"
					/>
				</label>

				{error && (
					<p role="alert" className="error">
						{error}
					</p>
				)}

				<button type="submit" className="btn btn-primary" disabled={submitting}>
					{submitting ? "Registering…" : "Register court"}
				</button>
			</form>
		</main>
	);
}
