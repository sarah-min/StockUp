import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { useMyUserId } from './useMyUserId';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const STATUS: Record<string, string> = {
  pending: 'getting ready',
  placing: 'placing order…',
  placed: 'on the way',
  delivered: 'delivered',
};

export default function Purchases({ onClose }: { onClose: () => void }) {
  const myUserId = useMyUserId();
  const [rows] = useTable(tables.wishlistOrder);
  // Public table: keep this account's orders; failed ones never arrived, so they are not purchases.
  const orders = rows.filter((row) => row.userId === myUserId && row.status !== 'failed').sort((a, b) => Number(b.id - a.id));
  const delivered = orders.filter((order) => order.status === 'delivered');
  const spent = delivered.reduce((sum, order) => sum + Number(order.totalCents ?? order.priceCents), 0);

  return <div className="modal-backdrop" onClick={onClose}><div className="modal card" role="dialog" aria-label="Purchases" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head">
      <div><h2>Purchases</h2><p className="modal-sub">{delivered.length} treat{delivered.length === 1 ? '' : 's'} delivered · {money.format(spent / 100)} earned your way</p></div>
      <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
    </div>
    {orders.length === 0 ? <p className="purchases-empty">Nothing unlocked yet. Hit your profit target and the cheapest wishlist item is yours.</p> : <div className="purchases-list">
      {orders.map((order) => <div className="purchase-card" key={String(order.id)}>
        <div className="purchase-main">
          <strong>{order.title}</strong>
          <span>{order.retailer}{order.carrier ? ` · ${order.carrier}${order.trackingNumber ? ` ${order.trackingNumber}` : ''}` : ''}</span>
          <span>{new Date(Number(order.createdAt.microsSinceUnixEpoch / 1000n)).toLocaleDateString()}</span>
          {order.thresholdCents > 0n && <span className="purchase-unlock">Unlocked at {money.format(Number(order.thresholdCents) / 100)} profit</span>}
        </div>
        <div className="purchase-side">
          <span className="wish-price">{money.format(Number(order.totalCents ?? order.priceCents) / 100)}</span>
          {order.totalCents !== undefined && <small className="purchase-sub">item {money.format(Number(order.priceCents) / 100)} + shipping &amp; taxes</small>}
          <span className={`badge order-${order.status}`}>{STATUS[order.status] ?? order.status}</span>
        </div>
      </div>)}
    </div>}
  </div></div>;
}
