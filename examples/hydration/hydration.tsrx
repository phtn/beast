import { Hydrate } from "octane";
import { condition, idle, initializeHydrationEventCapture, interaction, load, media, never, visible } from "octane/hydration";
import type { HydrationPrefetchContext } from "octane/hydration";
export function prepareHydrationCapture(ownerDocument: Document) {
  initializeHydrationEventCapture(ownerDocument);
  initializeHydrationEventCapture(ownerDocument);
}

function HydrationPanel({ label }: { label: string }) @{
	<article className="hydration-panel">
		<h2>{label}</h2>
		<button type="button">Activate</button>
	</article>
}

export default function Hydration({
	enabled,
	onHydrated,
	warm,
}: {
	enabled: boolean;
	onHydrated: () => void;
	warm: (signal: AbortSignal) => Promise<void>;
}) @{
	const prefetchPanel = async ({ element, preload, signal, waitFor }: HydrationPrefetchContext) => {
	  await preload();
	  const reason = await waitFor(idle({ timeout: 250 }));
	  if (reason === "abort" || signal.aborted) return;
	  void element;
	  await warm(signal);
	};

	<>
		<Hydrate when={load()} split={false}>
			<HydrationPanel label="Load" />
		</Hydrate>
		<Hydrate when={idle({ timeout: 1000 })} split={false}>
			<HydrationPanel label="Idle" />
		</Hydrate>
		<Hydrate when={visible({ rootMargin: "300px", threshold: [0, 0.5] })} split={false}>
			<HydrationPanel label="Visible" />
		</Hydrate>
		<Hydrate when={media("(min-width: 64rem)")} split={false}>
			<HydrationPanel label="Media" />
		</Hydrate>
		<Hydrate when={interaction({ events: ["focusin", "click"] })} split={false}>
			<HydrationPanel label="Interaction" />
		</Hydrate>
		<Hydrate when={condition(enabled)} split={false}>
			<HydrationPanel label="Condition" />
		</Hydrate>
		<Hydrate split={false} when={never()}>
			<HydrationPanel label="Never" />
		</Hydrate>
		<Hydrate when={() => window.matchMedia("(pointer: coarse)").matches ? interaction() : visible()} split={false}>
			<HydrationPanel label="Dynamic" />
		</Hydrate>
		<Hydrate when={interaction()} prefetch={idle()} fallback="Preparing editor…" onHydrated={onHydrated}>
			<HydrationPanel label="Split and prefetched" />
		</Hydrate>
		<Hydrate when={visible()} prefetch={prefetchPanel} split={false}>
			<HydrationPanel label="Procedural prefetch" />
		</Hydrate>
	</>
}
