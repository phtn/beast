interface StylingProps { title: string; cardProps: Record<string, unknown> }

export default function Styling({ title, cardProps }: StylingProps) @{
	<>
		<article className="card" {...cardProps}>
			<h2>{title}</h2>
			<p>Scoped styling follows this component.</p>
		</article>
		<style>
			.card {
			  padding: 1rem;
			}

			.card h2 {
			  color: rebeccapurple;
			}

			:global(body) {
			  margin: 0;
			}
		</style>
	</>
}
