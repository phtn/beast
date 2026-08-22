import { useDeferredValue, useState, useTransition } from "octane";
type Tab = "overview" | "activity";
interface SearchResultsProps { query: string }
interface TabPanelProps { tab: Tab }

function SearchResults({ query }: SearchResultsProps) @{
	<p>{"Showing results for " + (query || "all products")}</p>
}

function TabPanel({ tab }: TabPanelProps) @{
	<p>{tab === "overview" ? "Overview is ready." : "Activity is ready."}</p>
}

export default function Responsive() @{
	const [tab, setTab] = useState<Tab>("overview");
	const [isPending, startTransition] = useTransition();
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);
	const isStale = query !== deferredQuery;

	<section className="project-dashboard">
		<h2>Project dashboard</h2>
		<nav aria-label="Project sections">
			<button type="button" aria-current={tab === "overview" ? "page" : undefined} onClick={() => startTransition(() => setTab("overview"))}>Overview</button>
			<button type="button" aria-current={tab === "activity" ? "page" : undefined} onClick={() => startTransition(() => setTab("activity"))}>{isPending ? "Opening…" : "Activity"}</button>
		</nav>
		<TabPanel tab={tab} />
		<label>
			Search products
			<input value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
		</label>
		<div className="results" aria-busy={isStale}>
			<SearchResults query={deferredQuery} />
		</div>
	</section>
}
