import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';

type Order = { order_id: string; status: string; delivered: boolean; total_cents: number | null; estimated_delivery: string | null; carrier: string | null; tracking_number: string | null; tracking_url: string | null };
type Toast = { id: number; tone: 'good' | 'bad'; title: string; detail: string };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const STORAGE_KEY = 'stockup.autobuy';

function loadSettings() {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || ''); if (saved.threshold > 0) return saved as { threshold: number; step: number; enabled: boolean }; } catch { /* use defaults */ }
  return { threshold: 50, step: 50, enabled: true };
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

// Watches realized paper-trading profit (closed buy -> sell round trips) and, each time it reaches the threshold, "buys" the oldest wishlist item through Zinc.
// Rendered next to <App /> (inside the SpacetimeDB provider) so it keeps running while the wishlist modal is closed.
export default function WishlistAutoBuy() {
  const { isActive, identity, getConnection } = useSpacetimeDB();
  const [rows] = useTable(tables.wishlistProduct);
  const [settings, setSettings] = useState(loadSettings);
  const [value, setValue] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const busy = useRef(false);
  const failed = useRef(new Set<string>());

  const items = rows.filter((row) => row.owner.toHexString() === identity?.toHexString()).sort((a, b) => Number(a.id - b.id));
  const update = (next: typeof settings) => { setSettings(next); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } };
  const toast = useCallback((tone: Toast['tone'], title: string, detail: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, title, detail }]);
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 15_000);
  }, []);

  useEffect(() => {
    const load = () => api<{ realized_profit: number }>('/api/portfolio').then((result) => setValue(result.realized_profit)).catch(() => undefined);
    void load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, []);

  const watchDelivery = useCallback((title: string, orderId: string) => {
    const timer = setInterval(async () => {
      try {
        const { order } = await api<{ order: Order }>(`/api/wishlist/order/${orderId}`);
        if (order.delivered) { clearInterval(timer); toast('good', 'Delivered! 📦', `${title} has arrived.`); }
      } catch { clearInterval(timer); }
    }, 4000);
    setTimeout(() => clearInterval(timer), 120_000);
  }, [toast]);

  useEffect(() => {
    const item = items.find((entry) => !failed.current.has(String(entry.id)));
    if (!settings.enabled || !isActive || !item || value === null || value < settings.threshold || busy.current) return;
    busy.current = true;
    const conn = getConnection() as DbConnection | null;
    void (async () => {
      try {
        const { order } = await api<{ order: Order }>('/api/wishlist/purchase', { method: 'POST', body: JSON.stringify({ item: { id: String(item.id), url: item.url, title: item.title, price_cents: Number(item.priceCents) } }) });
        const arrival = order.estimated_delivery ? `arriving ${new Date(order.estimated_delivery).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}` : order.carrier ? `shipping via ${order.carrier}${order.tracking_number ? ` · ${order.tracking_number}` : ''}` : 'order placed, tracking soon';
        toast('good', `OMG! You've made ${money.format(settings.threshold)} in profit 🎉`, `We bought "${item.title}"${order.total_cents ? ` for ${money.format(order.total_cents / 100)}` : ''}: ${arrival}.`);
        update({ ...settings, threshold: settings.threshold + settings.step });
        void conn?.reducers.removeWishlistProduct({ id: item.id }).catch(console.error);
        watchDelivery(item.title, order.order_id);
      } catch (err) {
        failed.current.add(String(item.id));
        toast('bad', `Couldn't buy "${item.title}"`, err instanceof Error ? err.message : 'Purchase failed');
      } finally { busy.current = false; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, settings, isActive, rows.length]);

  return <>
    <div className="autobuy card">
      <div className="card-label">WISHLIST AUTO-BUY</div>
      <div className="autobuy-row"><span>Realized profit</span><strong>{value === null ? '…' : money.format(value)}</strong></div>
      <div className="autobuy-row"><span>Buy at</span><input type="number" min="0.01" step="0.01" value={settings.threshold} onChange={(event) => update({ ...settings, threshold: Math.max(0.01, Number(event.target.value)) })} aria-label="Auto-buy threshold in dollars" /></div>
      <label className="autobuy-row"><span>{items.length} on wishlist</span><input type="checkbox" checked={settings.enabled} onChange={(event) => update({ ...settings, enabled: event.target.checked })} /></label>
    </div>
    <div className="toasts" aria-live="polite">{toasts.map((entry) => <div key={entry.id} className={`toast toast-${entry.tone}`}><strong>{entry.title}</strong><span>{entry.detail}</span><button onClick={() => setToasts((current) => current.filter((other) => other.id !== entry.id))} aria-label="Dismiss">×</button></div>)}</div>
  </>;
}
