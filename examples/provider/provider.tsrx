import { createContext, use, useContext } from "octane";
type ThemeName = "light" | "dark";
const Theme = createContext<ThemeName>("light");

function ThemeLabel() @{
  const theme = use(Theme);
  <p class="theme-label">{"Current theme: " + theme}</p>
}

function ThemeSwatch() @{
  const theme = useContext(Theme);
  <span aria-label={"Theme swatch: " + theme} data-theme={theme} />
}

export default function Provider({
	theme,
	children,
}: {
	theme: ThemeName;
	children: unknown;
}) @{
	<Theme.Provider value={theme}>
		<section className="theme-shell" data-theme={theme}>
			<ThemeLabel />
			<ThemeSwatch />
			{children}
		</section>
	</Theme.Provider>
}
