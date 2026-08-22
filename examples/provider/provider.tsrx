import { createContext, use, useContext } from "octane";
type ThemeName = "light" | "dark";
interface ProviderProps {
  theme: ThemeName;
  children: unknown;
}

const Theme = createContext<ThemeName>("light");

function ThemeLabel() @{
	const theme = use(Theme);

	<p className="theme-label">{"Current theme: " + theme}</p>
}

function ThemeSwatch() @{
	const theme = useContext(Theme);

	<span aria-label={"Theme swatch: " + theme} data-theme={theme} />
}

export default function Provider({ theme, children }: ProviderProps) @{
	<Theme.Provider value={theme}>
		<section className="theme-shell" data-theme={theme}>
			<ThemeLabel />
			<ThemeSwatch />
			{children}
		</section>
	</Theme.Provider>
}
