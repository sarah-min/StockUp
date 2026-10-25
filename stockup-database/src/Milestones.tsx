import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { useMyUserId } from './useMyUserId';
import { isOutOfDate } from './wishlistSnapshot';
import { useRealizedProfit } from './realizedProfit';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// The signed-in user's saved earning milestones (written by the saveMilestones reducer when they generate or accept).
type Props = {
  onClose: () => void;
  canRegenerate: boolean; // a strategy is locked in and the wishlist has items
  regenerating: boolean;
  error: string;
  onRegenerate: () => void;
  onAccept: (rows: { name: string; target: string; rationale: string; wishlistSnapshot: string; productId: bigint }[]) => void;
};

export default function Milestones({ onClose, canRegenerate, regenerating, error, onRegenerate, onAccept }: Props) {
  const myUserId = useMyUserId();
  const profit = useRealizedProfit();
  const [rows] = useTable(tables.milestone);
  const [wishlistRows] = useTable(tables.wishlistProduct);
  const [orderRows] = useTable(tables.wishlistOrder);
  const milestones = rows.filter((row) => row.userId === myUserId).sort((a, b) => Number(a.targetCents - b.targetCents) || Number(a.id - b.id));
  // The item a milestone unlocks: still on the wishlist, or (once reached) the order it produced.
  const unlocks = (row: (typeof milestones)[number]) =>
    row.reached
      ? orderRows.find((order) => order.userId === myUserId && order.thresholdCents === row.targetCents)?.title
      : wishlistRows.find((item) => item.userId === myUserId && item.id === row.productId)?.title;
  const accepted = milestones.length > 0 && milestones.every((row) => row.accepted);
  const saved = milestones[0]?.createdAt;
  // Targets count from the profit the player had when the set was generated.
  const earned = profit === null || milestones.length === 0 ? null : profit - Number(milestones[0].baselineCents) / 100;
  const stale = milestones.length > 0 && isOutOfDate(milestones[0].wishlistSnapshot, wishlistRows.filter((row) => row.userId === myUserId));

  return <div className="modal-backdrop" onClick={onClose}><div className="modal card" role="dialog" aria-label="Milestones" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head">
      <div><h2>Milestones</h2><p className="modal-sub">{milestones.length === 0 ? 'Profit targets from your strategy.' : `${accepted ? 'Accepted' : 'Not accepted yet'} · saved ${new Date(Number(saved!.microsSinceUnixEpoch / 1000n)).toLocaleDateString()}`}</p></div>
      <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
    </div>
    <div className="milestones-toolbar">
      {earned !== null && <small className="wish-note">Earned since these were generated: <strong>{money.format(Math.max(0, earned))}</strong> (reaching each target unlocks a reward)</small>}
      {stale && <p className="stale-note">Your wishlist changed since these were generated. Regenerate to resize them.</p>}
      {error && <div className="error"><span>{error}</span></div>}
      <div className="milestones-actions">
        <button className="secondary" onClick={onRegenerate} disabled={!canRegenerate || regenerating}>{regenerating ? 'Planning milestones…' : milestones.length > 0 ? 'Regenerate milestones' : 'Generate milestones'}</button>
        {milestones.length > 0 && !accepted && <button className="primary" onClick={() => onAccept(milestones)} disabled={regenerating}>Accept milestones →</button>}
      </div>
      {!canRegenerate && <small className="wish-note">Add an item to your wishlist to generate milestones.</small>}
    </div>
    {milestones.length === 0 ? <p className="purchases-empty">No milestones yet.</p> : <div className="purchases-list">
      {milestones.map((row, index) => <div className="purchase-card" key={String(row.id)}>
        <div className="purchase-main">
          <strong>{index + 1}. {row.name}</strong>
          {unlocks(row) && <span className="purchase-unlock">{row.reached ? 'Unlocked' : 'Unlocks'}: {unlocks(row)}</span>}
          {row.rationale && <span>{row.rationale}</span>}
        </div>
        <div className="purchase-side"><span className="wish-price">{row.target}</span><span className={`badge ${row.reached ? 'order-delivered' : ''}`}>{row.reached ? 'reached' : 'profit target'}</span></div>
      </div>)}
    </div>}
  </div></div>;
}
