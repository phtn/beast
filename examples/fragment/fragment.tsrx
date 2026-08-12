export default function Fragment({
	heading,
	count,
}: {
	heading: string;
	count: number;
}) @{
	<>
		<h1>{heading}</h1>
		This view intentionally has multiple roots.
		<p className="notice">You have {count} pending items.</p>
		Symbols stay safe: &lt; &gt; &#123; &#125; &amp;.
	</>
}
