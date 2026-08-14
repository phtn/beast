import { ViewTransition, addTransitionType, startTransition, useState } from "octane";
type Tab = "overview" | "activity";

export default function Transitions() @{
	const [tab, setTab] = useState<Tab>("overview");
	const selectTab = (next: Tab) => {
	  startTransition(() => {
	    addTransitionType(next === "activity" ? "forward" : "backward");
	    setTab(next);
	  });
	};

	<section className="project-view">
		<h2>Project view</h2>
		<nav aria-label="Project sections">
			<button type="button" aria-current={tab === "overview" ? "page" : undefined} onClick={() => selectTab("overview")}>Overview</button>
			<button type="button" aria-current={tab === "activity" ? "page" : undefined} onClick={() => selectTab("activity")}>Activity</button>
		</nav>
		<ViewTransition name="project-panel" enter="panel-enter" exit="panel-exit" update={{ default: "panel-update", forward: "slide-left", backward: "slide-right" }}>
			<article className="project-panel">
				<h3>{tab === "overview" ? "Overview" : "Activity"}</h3>
				<p>{tab === "overview" ? "Overview is ready." : "Recent activity is ready."}</p>
			</article>
		</ViewTransition>
	</section>
}
