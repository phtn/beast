import { ErrorBoundary, Hydrate, Suspense, lazy } from "octane";
import { visible } from "octane/hydration";
type DashboardProps = { reportId: string };
const LazyAnalytics = lazy(() => import("./analytics.tsrx"));

function ReviewSummary({ reportId }: DashboardProps) @{
  <article class="review-summary">
    <h3>{"Reviews for " + reportId}</h3>
    <button type="button">Open reviews</button>
  </article>
}

export default function Deferred({ reportId }: DashboardProps) @{
	<ErrorBoundary fallback="The dashboard could not be loaded.">
		<section className="dashboard">
			<h2>Async dashboard</h2>
			<Suspense fallback="Loading analytics…">
				<LazyAnalytics reportId={reportId} />
			</Suspense>
			<Hydrate when={visible({ rootMargin: "400px" })} fallback="Preparing reviews…" split={false}>
				<ReviewSummary reportId={reportId} />
			</Hydrate>
		</section>
	</ErrorBoundary>
}
