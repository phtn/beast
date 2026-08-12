"use strong";
const shortcutKey = "/";
import { useEffect, useRef } from "octane";

export default function Shortcut({ label }: { label: string }) @{
	const inputRef = useRef<HTMLInputElement | null>(null);

	// Own one global listener and release it when the component unmounts.
	useEffect(() => {
	  const focusInput = (event: KeyboardEvent) => {
	    if (event.key === shortcutKey) inputRef.current?.focus();
	  };
	  window.addEventListener("keydown", focusInput);
	  return () => window.removeEventListener("keydown", focusInput);
	});

	<section className="shortcut-search">
		<label htmlFor="shortcut-search">{label}</label>
		<input id="shortcut-search" ref={inputRef} aria-keyshortcuts={shortcutKey} />
		<button type="button" onClick={() => inputRef.current?.focus()}>Focus search</button>
	</section>
}
