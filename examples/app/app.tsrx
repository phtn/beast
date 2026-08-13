import Card from "../card/card.btsx";
import Status from "../status/status.btsx";
import { AppProps } from "./types";

export default function App({ title, themeClass, user, unreadCount, messages, groups }: AppProps) @{
	<main id="app" className={[themeClass, "shell"].filter(Boolean).join(" ")}>
		<header className="hero">
			<p className="eyebrow">Beast composition example</p>
			<h1>{title}</h1>
		</header>
		<Card user={user} unreadCount={unreadCount} messages={messages} />
		<Status groups={groups} />
	</main>
}
