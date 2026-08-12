interface AnalyticsProps {
	reportId: string;
}

export default function Analytics({ reportId }: AnalyticsProps) @{
	<article class="analytics-panel">
		<h3>{"Analytics for " + reportId}</h3>
		<p>Revenue and engagement are ready.</p>
	</article>
}
