import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';

export type WishlistProduct = { url: string; retailer: string; title: string; image: string | null; brand: string | null; price_cents: number; stars: number | null };
type SavedProduct = { id: bigint; url: string; retailer: string; title: string; priceCents: bigint };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type Props = { onClose: () => void };

export default function Wishlist({ onClose }: Props) {
  const { isActive, identity, getConnection } = useSpacetimeDB();
  const [rows] = useTable(tables.wishlistProduct);
  const [orderRows] = useTable(tables.wishlistOrder);
  // The table is public, so only show rows this browser's identity owns.
  // Cheapest first: that is the order auto-buy purchases them in.
  const items: SavedProduct[] = rows.filter((row) => row.owner.toHexString() === identity?.toHexString()).sort((a, b) => Number(a.priceCents - b.priceCents) || Number(a.id - b.id));
  const orders = orderRows.filter((row) => row.owner.toHexString() === identity?.toHexString()).sort((a, b) => Number(b.id - a.id));
  const conn = getConnection() as DbConnection | null;
  const onAdd = (item: WishlistProduct) => {
    if (!conn || !isActive) return;
    void conn.reducers.addWishlistProduct({ url: item.url, retailer: item.retailer, title: item.title, brand: item.brand ?? undefined, image: item.image ?? undefined, priceCents: BigInt(item.price_cents) }).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not add item'));
  };
  const onRemove = (id: bigint) => {
    if (!conn || !isActive) return;
    void conn.reducers.removeWishlistProduct({ id }).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not remove item'));
  };
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WishlistProduct[]>([]);
  const [sandbox, setSandbox] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const saved = new Set(items.map((item) => item.url));

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/wishlist/search?q=${encodeURIComponent(query)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Search failed');
      setResults(body.results); setSandbox(body.sandbox);
    } catch (err) { setError(err instanceof Error ? err.message : 'Search failed'); }
    finally { setLoading(false); }
  };

  return <div className="modal-backdrop" onClick={onClose}><div className="modal card" role="dialog" aria-label="Wishlist" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head"><div className="card-label">WISHLIST · AUTO-BUY WHEN YOUR PORTFOLIO HITS THE TARGET{isActive ? '' : ' · connecting…'}</div><button className="modal-close" onClick={onClose} aria-label="Close">×</button></div>
    <form className="wish-search" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products across retailers…" autoFocus /><button className="primary" disabled={loading || !query.trim()}>{loading ? 'Searching…' : 'Search'}</button></form>
    {sandbox && <p className="helper">Zinc sandbox: results are sample products, no real orders.</p>}
    {error && <div className="error">{error}</div>}
    <div className="wish-columns">
      <div><div className="card-label">RESULTS</div>{results.length === 0 ? <p className="history-empty">Search to find something to add.</p> : results.map((item) => <div className="wish-row" key={item.url}><div><strong>{item.title}</strong><span>{item.retailer}{item.brand ? ` · ${item.brand}` : ''}{item.stars ? ` · ★${item.stars}` : ''}</span></div><span>{money.format(item.price_cents / 100)}</span><button className="secondary" disabled={!isActive || saved.has(item.url)} onClick={() => onAdd(item)}>{saved.has(item.url) ? 'Added' : 'Add'}</button></div>)}</div>
      <div><div className="card-label">YOUR WISHLIST ({items.length})</div>{items.length === 0 ? <p className="history-empty">Nothing yet.</p> : items.map((item) => <div className="wish-row" key={String(item.id)}><div><strong>{item.title}</strong><span>{item.retailer}</span></div><span>{money.format(Number(item.priceCents) / 100)}</span><button className="secondary" onClick={() => onRemove(item.id)}>Remove</button></div>)}</div>
    </div>
    {orders.length > 0 && <div className="wish-orders"><div className="card-label">ORDERS ({orders.length})</div>{orders.map((order) => <div className="wish-row" key={String(order.id)}><div><strong>{order.title}</strong><span>{order.carrier ? `${order.carrier}${order.trackingNumber ? ` · ${order.trackingNumber}` : ''}` : order.error ?? order.retailer}</span></div><span>{order.totalCents ? money.format(Number(order.totalCents) / 100) : money.format(Number(order.priceCents) / 100)}</span><span className={`order-status order-${order.status}`}>{order.status}</span></div>)}</div>}
  </div></div>;
}
