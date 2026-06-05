import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRoute,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { useEffect, useRef, useState } from "react";

import appCss from "../styles.css?url";

// Grand Slam themes. Each id maps to a [data-theme] palette in styles.css.
const THEMES = [
	{ id: "us-open", label: "US Open" },
	{ id: "ao", label: "Australian Open" },
	{ id: "rg", label: "Roland Garros" },
	{ id: "wimbledon", label: "Wimbledon" },
];
const THEME_IDS = THEMES.map((t) => t.id);
const DEFAULT_THEME = "us-open";
const THEME_KEY = "oc_theme";
const THEME_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Read the theme cookie on the server so SSR renders the correct palette up
// front — no boot script, no flash, no hydration mismatch. The theme cookie is
// functional (a UI preference, like the session UUID), not tracking.
const getThemeCookie = createServerFn({ method: "GET" }).handler(() => {
	const t = getCookie(THEME_KEY);
	return t && THEME_IDS.includes(t) ? t : DEFAULT_THEME;
});

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "OpenCourts" },
			{
				name: "description",
				content:
					"Anonymous, friction-free queue tracker for public tennis courts.",
			},
			{ name: "theme-color", content: "#2f6fb5" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
			{ rel: "manifest", href: "/manifest.json" },
		],
	}),
	loader: () => getThemeCookie(),
	shellComponent: RootDocument,
	component: RootLayout,
});

// Color-swatch theme switcher. Collapsed = just the current theme's ball; tap
// it to reveal the others, pick one, it collapses back. All four are always
// rendered so the reveal/hide animates in CSS (no mount/unmount jump).
function ThemePicker({
	theme,
	onPick,
}: {
	theme: string;
	onPick: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	// Tap/click outside closes the expanded picker.
	useEffect(() => {
		if (!open) return;
		function onDown(e: PointerEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("pointerdown", onDown);
		return () => document.removeEventListener("pointerdown", onDown);
	}, [open]);

	function choose(id: string) {
		if (id === theme) {
			setOpen((o) => !o); // tapping the current ball toggles the picker
			return;
		}
		onPick(id);
		setOpen(false);
	}

	return (
		<div
			ref={ref}
			className={`theme-picker${open ? " is-open" : ""}`}
			role="radiogroup"
			aria-label="Theme"
		>
			{THEMES.map((t) => {
				const active = t.id === theme;
				return (
					<button
						key={t.id}
						type="button"
						role="radio"
						aria-checked={active}
						aria-label={active ? `Theme: ${t.label}. Change theme` : t.label}
						title={t.label}
						tabIndex={open || active ? 0 : -1}
						className={`swatch swatch-${t.id}${active ? " is-active" : ""}`}
						onClick={() => choose(t.id)}
					/>
				);
			})}
		</div>
	);
}

// Themed wrapper + header. Lives in the root *component* (not the shell) so it
// can read the server-resolved theme from the loader — SSR and client init from
// the same value, so there's nothing to reconcile.
function RootLayout() {
	const initialTheme = Route.useLoaderData();
	const [theme, setTheme] = useState(initialTheme);

	function pick(next: string) {
		setTheme(next);
		// Persist for the next request's SSR. Non-httpOnly: the value isn't
		// sensitive and only drives the palette.
		document.cookie = `${THEME_KEY}=${next}; path=/; max-age=${THEME_MAX_AGE}; samesite=lax`;
	}

	return (
		<div className="app" data-theme={theme}>
			<header className="site-header">
				<nav>
					<Link to="/" className="brand">
						OpenCourts
					</Link>
					<ThemePicker theme={theme} onPick={pick} />
				</nav>
			</header>
			<Outlet />
		</div>
	);
}

// Static document shell — nothing theme-dependent here, so no hydration risk.
function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<TanStackDevtools
					config={{ position: "bottom-right" }}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
