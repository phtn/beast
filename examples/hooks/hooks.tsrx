import { memo, useCallback, useDebugValue, useEffectEvent, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useReducer } from "octane";
interface CounterHandle { reset(): void; read(): number }
interface AdvancedHooksProps {
  initialCount: number;
  handleRef: { current: CounterHandle | null };
  onPhase: (phase: string) => void;
  onReport: (count: number) => void;
}
type CounterAction = { type: "increment" } | { type: "reset" };
function reduceCount(count: number, action: CounterAction) {
  return action.type === "increment" ? count + 1 : 0;
}
function sameSummary(previous: Readonly<{ count: number }>, next: Readonly<{ count: number }>) {
  return previous.count === next.count;
}

function CountSummary({ count }: { count: number }) @{
	<p>Reducer count: {count}</p>
}

export default function Hooks({ initialCount, handleRef, onPhase, onReport }: AdvancedHooksProps) @{
	const [count, dispatch, getCount] = useReducer(reduceCount, initialCount, (value) => value * 2);
	const descriptionId = useId();
	const MemoCountSummary = useMemo(() => memo(CountSummary, sameSummary));
	const increment = useCallback(() => dispatch({ type: "increment" }));
	const reportLatest = useEffectEvent(() => onReport(getCount()));
	useDebugValue(count, (value) => `count:${value}`);
	useImperativeHandle(handleRef, () => ({
	  reset: () => dispatch({ type: "reset" }),
	  read: getCount,
	}));
	useInsertionEffect(() => {
	  onPhase("insertion");
	  return () => onPhase("insertion-cleanup");
	});
	useLayoutEffect(() => {
	  onPhase("layout");
	  return () => onPhase("layout-cleanup");
	});

	<section className="advanced-hooks" aria-labelledby={descriptionId}>
		<h2 id={descriptionId}>Advanced hooks</h2>
		<MemoCountSummary count={count} />
		<button type="button" onClick={increment}>Increment</button>
		<button type="button" onClick={reportLatest}>Report latest</button>
	</section>
}
