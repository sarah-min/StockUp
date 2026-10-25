import { useEffect, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import { useMyUserId } from './useMyUserId';

export type WishlistProduct = { url: string; retailer: string; title: string; image: string | null; brand: string | null; price_cents: number; stars: number | null };
type SavedProduct = { id: bigint; url: string; retailer: string; title: string; priceCents: bigint };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type Props = { onClose: () => void };

export default function Wishlist({ onClose }: Props) {
  const { isActive, getConnection } = useSpacetimeDB();
  const myUserId = useMyUserId();
  const [rows] = useTable(tables.wishlistProduct);
  const [orderRows] = useTable(tables.wishlistOrder);
  // The table is public, so only show rows owned by the signed-in account.
  // Cheapest first: that is the order auto-buy purchases them in.
  const items: SavedProduct[] = rows.filter((row) => row.userId === myUserId).sort((a, b) => Number(a.priceCents - b.priceCents) || Number(a.id - b.id));
  const orders = orderRows.filter((row) => row.userId === myUserId).sort((a, b) => Number(b.id - a.id));
  const inProgress = orders.filter((order) => order.status !== 'delivered');
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    <div className="modal-head">
      <div><h2>Wishlist</h2><p className="modal-sub">Rewards bought automatically when your realized profit hits the target.{isActive ? '' : ' Connecting…'}</p></div>
      <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
    </div>
    <form className="wish-search" onSubmit={search}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products across retailers…" autoFocus />
      <button className="primary" disabled={loading || !query.trim()}>{loading ? 'Searching…' : 'Search'}</button>
    </form>
    {sandbox && <p className="helper">Zinc sandbox: results are sample products, no real orders.</p>}
    {error && <div className="error"><span>{error}</span></div>}
    <div className="wish-columns">
      <div>
        <div className="section-label">Results</div>
        {results.length === 0 ? <p className="history-empty">Search to find something to add.</p> : results.map((item) => <div className="wish-row" key={item.url}>
          <div className="wish-info">{item.image ? <img src={item.image} alt="" loading="lazy" /> : <span className="wish-thumb" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4m0 8v-8m8-4l-8 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg></span>}<div><strong>{item.title}</strong><span>{item.retailer}{item.brand ? ` · ${item.brand}` : ''}{item.stars ? ` · ★${item.stars}` : ''}</span></div></div>
          <span className="wish-price">{money.format(item.price_cents / 100)}</span>
          <button className={saved.has(item.url) ? 'secondary small' : 'primary small'} disabled={!isActive || saved.has(item.url)} onClick={() => onAdd(item)}>{saved.has(item.url) ? 'Added ✓' : 'Add'}</button>
        </div>)}
      </div>
      <div className="wish-saved">
        <div className="section-label">Your wishlist <span className="count">{items.length}</span></div>
        {items.length === 0 ? <p className="history-empty">Nothing yet. Cheapest items are bought first.</p> : items.map((item, index) => <div className="wish-row" key={String(item.id)}>
          <div className="wish-info"><span className="wish-rank">{index + 1}</span><div><strong>{item.title}</strong><span>{item.retailer}</span></div></div>
          <span className="wish-price">{money.format(Number(item.priceCents) / 100)}</span>
          <button className="secondary small" onClick={() => onRemove(item.id)}>Remove</button>
        </div>)}
      </div>
    </div>
    {inProgress.length > 0 && <div className="wish-orders"><div className="section-label">In progress <span className="count">{inProgress.length}</span> · delivered ones are under Purchases</div>{inProgress.map((order) => <div className="wish-row" key={String(order.id)}>
      <div className="wish-info"><div><strong>{order.title}</strong><span>{order.carrier ? `${order.carrier}${order.trackingNumber ? ` · ${order.trackingNumber}` : ''}` : order.error ?? order.retailer}</span></div></div>
      <span className="wish-price">{order.totalCents ? money.format(Number(order.totalCents) / 100) : money.format(Number(order.priceCents) / 100)}</span>
      <span className={`badge order-${order.status}`}>{order.status}</span>
    </div>)}</div>}
  </div></div>;
}
