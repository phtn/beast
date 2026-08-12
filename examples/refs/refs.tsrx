"use strong";
import { useRef } from "octane";

export default function Refs({
	label,
	onAttach,
}: {
	label: string;
	onAttach: (element: HTMLInputElement | null) => void;
}) @{
	const inputRef = useRef<HTMLInputElement | null>(null);
	const reportInput = (element: HTMLInputElement | null) => {
	  onAttach(element);
	  if (element !== null) return () => onAttach(null);
	};

	<section className="ref-demo">
		<label htmlFor="multi-ref-input">{label}</label>
		<input id="multi-ref-input" ref={[inputRef, reportInput]} />
		<button type="button" onClick={() => inputRef.current?.focus()}>Focus input</button>
	</section>
}
