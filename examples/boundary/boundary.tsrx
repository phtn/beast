export default function Boundary({
	Profile,
	data,
}: {
	Profile: (props: { data: Promise<unknown> }) => unknown;
	data: Promise<unknown>;
}) @{
	<section className="profile-boundary">
		@try {
			<Profile data={data} />
		} @pending {
			<p role="status">Loading profile…</p>
		} @catch (error, reset) {
			<div className="error" role="alert">
				<p>Could not load profile: {error instanceof Error ? error.message : String(error)}</p>
				<button type="button" onClick={reset}>Try again</button>
			</div>
		}
	</section>
}
