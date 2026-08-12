import { Theme } from "./theme.ts";

export default function Provider({
	theme,
	children,
}: {
	theme: "light" | "dark";
	children: unknown;
}) @{
	<Theme.Provider value={theme}>
		<section className="theme-shell" data-theme={theme}>
			{children}
		</section>
	</Theme.Provider>
}
