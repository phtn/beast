import { Activity, ErrorBoundary, Suspense, use } from "octane";
interface ProfileData { name: string; role: string }

function AsyncProfile({ profile }: { profile: PromiseLike<ProfileData> }) @{
	const resolved = use(profile);

	<article className="profile">
		<h2>{resolved.name}</h2>
		<p>{resolved.role}</p>
	</article>
}

export default function Async({
	profile,
}: {
	profile: PromiseLike<ProfileData>;
}) @{
	<section className="async-dashboard">
		<ErrorBoundary fallback="Profile failed.">
			<Suspense fallback="Loading profile…">
				<AsyncProfile profile={profile} />
			</Suspense>
		</ErrorBoundary>
		<Activity mode="visible">
			<p>Visible activity</p>
		</Activity>
		<Activity mode="hidden">
			<p>Hidden activity</p>
		</Activity>
		<Activity mode="prerender">
			<p>Prerendered activity</p>
		</Activity>
	</section>
}
