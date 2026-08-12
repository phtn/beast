import Card from "../card/card.btsx";
import Status from "../status/status.btsx";

export default function App({
	title,
	themeClass,
	user,
	unreadCount,
	messages,
	groups,
}: {
	title: string;
	themeClass: string;
	user: { name: string; id: string; isAdmin: boolean };
	unreadCount: number;
	messages: { id: string; text: string }[];
	groups: {
		id: string;
		title: string;
		status: string;
		items: { label: string; value: string }[];
	}[];
}) @{
	<main id="app" className={[themeClass, "shell"].filter(Boolean).join(" ")}>
		<header className="hero">
			<p className="eyebrow">Beast composition example</p>
			<h1>{title}</h1>
		</header>
		<Card user={user} unreadCount={unreadCount} messages={messages} />
		<Status groups={groups} />
	</main>
}
