import { useState, type ReactNode } from 'react';
import { DEV_MODE } from './devMode';

// TO_REMOVE: collapsible corner wrapper shared by the temporary wishlist panels (DemoTrader, WishlistAutoBuy).
// Starts minimized as a pill; click it to open, click "–" to minimize again. The choice is remembered per panel.
export default function DevPanel({ id, title, className, children }: { id: string; title: string; className: string; children: ReactNode }) {
  const key = `stockup.devpanel.${id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const toggle = (next: boolean) => { setOpen(next); try { localStorage.setItem(key, next ? '1' : '0'); } catch { /* storage unavailable */ } };

  if (!DEV_MODE) return null;
  if (!open) return <button className="dev-pill" onClick={() => toggle(true)} aria-label={`Open ${title}`}><em>TO_REMOVE</em> {title} ▴</button>;
  return <div className={`${className} card dev-panel`}>
    <div className="dev-head"><span><em>TO_REMOVE</em> {title}</span><button onClick={() => toggle(false)} aria-label={`Minimize ${title}`}>–</button></div>
    {children}
  </div>;
}
