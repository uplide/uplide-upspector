import { measureServerComponent } from "@uplide/debugbar-next/server";
import { API_BASE_URL, type Product } from "@/lib/api";
import { ClientPanel } from "./client-panel";

/** Server-side `fetch`: captured as an SSR entry by the instrumentation wrapper. */
async function loadProducts(): Promise<Product[]> {
  const response = await fetch(`${API_BASE_URL}/api/products`, { cache: "no-store" });
  const body = (await response.json()) as { data: Product[] };

  return body.data;
}

export default measureServerComponent("HomePage", async function HomePage() {
  const products = await loadProducts();

  return (
    <main>
      <h1>debugbar example</h1>
      <p>
        This list was rendered on the server. Open the debugbar toolbar in the
        bottom-right corner: the SSR request and its SQL (including an N+1)
        are there.
      </p>
      <ul>
        {products.map((product) => (
          <li key={product.id}>
            {product.name} — {(product.price / 100).toFixed(2)} ·{" "}
            {product.reviewCount} reviews
          </li>
        ))}
      </ul>
      <ClientPanel />
    </main>
  );
});
