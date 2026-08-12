export default function Variant({
	state,
}: {
	state: "idle" | "loading" | "ready" | "error";
}) @{
	<section className="status-card" aria-live="polite">
		@switch (state) {
			@case "idle": {
				<p>Choose an action.</p>
			}
			@case "loading": {
				<p role="status">Loading…</p>
			}
			@case "ready": {
				<p>Ready.</p>
			}
			@default: {
				<p role="alert">Something went wrong.</p>
			}
		}
	</section>
}
