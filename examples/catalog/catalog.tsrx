export default function Catalog({
	products,
	selectedId,
	onSelect,
}: {
	products: { id: string; name: string; price: number; featured: boolean }[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) @{
	<section id="catalog" className="catalog" aria-label="Product catalog">
		<h2>Products</h2>
		<ul className="product-grid">
			@for (const product of products; index index; key product.id) {
				<li className={[product.id === selectedId ? "selected" : "", "product-card"].filter(Boolean).join(" ")} data-index={index}>
					@if (product.featured) {
						<span className="badge">Featured</span>
					}
					<h3>{product.name}</h3>
					<p className="price">${product.price.toFixed(2)}</p>
					<button type="button" formNoValidate disabled={product.id === selectedId} onClick={() => onSelect(product.id)}>Select</button>
				</li>
			} @empty {
				<li className="empty-state">No products available.</li>
			}
		</ul>
	</section>
}
