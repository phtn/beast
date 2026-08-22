import { useEffect, useMemo, useState } from "octane";

export default function Counter({
	initialCount,
	step,
	onCountChange,
}: {
	initialCount: number;
	step: number;
	onCountChange: (count: number) => void;
}) @{
	const [count, setCount] = useState(initialCount);
	const doubled = useMemo(() => count * 2);
	useEffect(() => onCountChange(count));

	<section className="counter" aria-live="polite">
		<h2>Hook counter</h2>
		<p>Current: {count}</p>
		<p>Doubled: {doubled}</p>
		<div className="actions">
			<button type="button" onClick={() => setCount(count - step)}>Decrease</button>
			<button type="button" onClick={() => setCount(count + step)}>Increase</button>
		</div>
	</section>
}
