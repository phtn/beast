import { Children, cloneElement, createElement, isChildrenBlock, isValidElement, preconnect, prefetchDNS, preinit, preinitModule, preload, preloadModule } from "octane";

function ChildrenProbe({ children }: { children: unknown }) @{
	const block = isChildrenBlock(children);

	<section className="children-probe" data-children-block={block}>
		{children}
	</section>
}

export default function Library() @{
	preload("/assets/beast.woff2", { as: "font", type: "font/woff2" });
	preload("/assets/beast.woff2", { as: "font", type: "font/woff2" });
	preinit("/assets/app.css", { as: "style", precedence: "critical" });
	preinit("/assets/runtime.js", { as: "script" });
	preloadModule("/assets/chart.js", { crossOrigin: "anonymous" });
	preinitModule("/assets/editor.js", { as: "script" });
	preconnect("https://api.example.com", { crossOrigin: "anonymous" });
	prefetchDNS("https://cdn.example.com");
	const base = createElement("li", { className: "base", key: "base", "data-kind": "base" }, "Base");
	const cloned = cloneElement(base, { className: "cloned", key: "clone", "data-kind": "clone" }, "Cloned");
	const sourceChildren = [base, null, false, cloned];
	let visited = 0;
	Children.forEach(sourceChildren, () => { visited += 1; });
	const count = Children.count(sourceChildren);
	const flattened = Children.toArray(sourceChildren);
	const mapped = Children.map(sourceChildren, (child, index) => isValidElement(child) ? cloneElement(child, { "data-index": index }) : child);
	const only = Children.only(cloned);
	const allValid = flattened.every(isValidElement);

	<section className="library-apis">
		<h2>Library APIs</h2>
		<p data-count={count} data-flattened={flattened.length} data-visited={visited} data-valid={allValid}>Descriptor summary</p>
		<ul className="mapped">
			{mapped}
		</ul>
		<ul className="only">
			{only}
		</ul>
		<ChildrenProbe>
			<span>First child</span>
			<span>Second child</span>
		</ChildrenProbe>
	</section>
}
