import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import DevPanel from './DevPanel';

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

// Watches realized paper-trading profit (closed buy -> sell round trips) and, each time it reaches the threshold, starts a purchase of the
// cheapest wishlist item. beginPurchase atomically turns that item into a pending order row; the API server's order worker then places it
// with Zinc and keeps the row updated, and the toasts below come from those row updates.
// Rendered next to <App /> (inside the SpacetimeDB provider) so it keeps running while the wishlist modal is closed.
export default function WishlistAutoBuy() {
  const { isActive, identity, getConnection } = useSpacetimeDB();
  const [rows] = useTable(tables.wishlistProduct);
  const isMine = (owner: { toHexString(): string }) => owner.toHexString() === identity?.toHexString();
  useTable(tables.wishlistOrder, {
    onUpdate: (before, after) => {
      if (!isMine(after.owner) || before.status === after.status) return;
      const price = after.totalCents ? ` for ${money.format(Number(after.totalCents) / 100)}` : '';
      if (after.status === 'placed') {
        const arrival = after.estimatedDelivery ? `arriving ${new Date(after.estimatedDelivery).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}` : after.carrier ? `shipping via ${after.carrier}${after.trackingNumber ? ` · ${after.trackingNumber}` : ''}` : 'order placed, tracking soon';
        toast('good', `Bought "${after.title}"${price} 🎉`, arrival);
      } else if (after.status === 'delivered') toast('good', 'Delivered! 📦', `"${after.title}" has arrived.`);
      else if (after.status === 'failed') toast('bad', `Couldn't buy "${after.title}"`, after.error ?? 'The order failed. Add it to your wishlist again to retry.');
    },
  });
  const [settings, setSettings] = useState(loadSettings);
  const [value, setValue] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const busy = useRef(false);
  const failed = useRef(new Set<string>());

  const items = rows.filter((row) => isMine(row.owner)).sort((a, b) => Number(a.priceCents - b.priceCents) || Number(a.id - b.id)); // cheapest first, oldest breaks ties
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

  useEffect(() => {
    const item = items.find((entry) => !failed.current.has(String(entry.id)));
    if (!settings.enabled || !isActive || !item || value === null || value < settings.threshold || busy.current) return;
    busy.current = true;
    const conn = getConnection() as DbConnection | null;
    void (async () => {
      try {
        await conn?.reducers.beginPurchase({ productId: item.id });
        toast('good', `OMG! You've made ${money.format(settings.threshold)} in profit 🎉`, `Buying "${item.title}" from your wishlist…`);
        update({ ...settings, threshold: settings.threshold + settings.step });
      } catch (err) {
        failed.current.add(String(item.id));
        // "not found" means another tab already started this purchase, which is exactly what the guard is for.
        if (!(err instanceof Error && /not found/i.test(err.message))) toast('bad', `Couldn't start buying "${item.title}"`, err instanceof Error ? err.message : 'Purchase failed');
      } finally { busy.current = false; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, settings, isActive, rows.length]);

  return <>
    {/* TO_REMOVE: this panel is only a temporary control. The profit-watching effect above is the real feature, so keep or move it. */}
    <DevPanel id="autobuy" title="Wishlist auto-buy" className="autobuy">
      <div className="autobuy-row"><span>Realized profit</span><strong>{value === null ? '…' : money.format(value)}</strong></div>
      <div className="autobuy-row"><span>Buy at</span><input type="number" min="0.01" step="0.01" value={settings.threshold} onChange={(event) => update({ ...settings, threshold: Math.max(0.01, Number(event.target.value)) })} aria-label="Auto-buy threshold in dollars" /></div>
      <label className="autobuy-row"><span>{items.length} on wishlist</span><input type="checkbox" checked={settings.enabled} onChange={(event) => update({ ...settings, enabled: event.target.checked })} /></label>
    </DevPanel>
    <div className="toasts" aria-live="polite">{toasts.map((entry) => <div key={entry.id} className={`toast toast-${entry.tone}`}><strong>{entry.title}</strong><span>{entry.detail}</span><button onClick={() => setToasts((current) => current.filter((other) => other.id !== entry.id))} aria-label="Dismiss">×</button></div>)}</div>
  </>;
}
