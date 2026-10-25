import { useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import DevPanel from './DevPanel';
import { useMyUserId } from './useMyUserId';
import { useRealizedProfit } from './realizedProfit';

// TO_REMOVE: TEMPORARY: a bare-bones buy/sell box for demoing the wishlist auto-buy (which fires on realized profit).
// Trades are recorded in SpacetimeDB for the signed-in player, so they count toward that player's profit only.
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function DemoTrader() {
  const [symbol, setSymbol] = useState('BTC-USD');
  const [amount, setAmount] = useState(50);
  const [fillPrice, setFillPrice] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const executeSimulatedTrade = useReducer(reducers.executeSimulatedTrade);
  const myUserId = useMyUserId();
  const [trades] = useTable(tables.simulatedTrade);
  const profit = useRealizedProfit();

  // Net holdings per symbol from this player's own trades.
  const held = new Map<string, bigint>();
  for (const trade of trades) {
    if (trade.userId !== myUserId) continue;
    const current = held.get(trade.symbol) ?? 0n;
    const next = trade.side === 'buy' ? current + trade.quantityMicros : current - trade.quantityMicros;
    held.set(trade.symbol, next > 0n ? next : 0n);
  }
  const positions = [...held.entries()].filter(([, micros]) => micros > 0n);

  const trade = async (action: 'buy' | 'sell') => {
    setBusy(true); setMessage('');
    try {
      const wanted = symbol.trim().toUpperCase();
      const proposal = { symbol: wanted, asset_type: 'crypto', action, amount_usd: amount, confidence: 1, rationale: 'Manual demo trade', risk: 'low', source: 'demo' };
      const response = await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposal, demo_price: fillPrice ? Number(fillPrice) : undefined }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Trade failed');
      // Price is stored in whole cents; size the quantity from that price so the booked total matches the amount.
      const priceCents = BigInt(Math.max(1, Math.round(body.trade.price * 100)));
      let quantityMicros = (BigInt(Math.floor(amount * 100)) * 1_000_000n) / priceCents;
      if (action === 'sell') {
        const owned = held.get(body.trade.symbol) ?? 0n;
        if (owned === 0n) throw new Error(`You don't hold any ${body.trade.symbol}`);
        if (quantityMicros > owned) quantityMicros = owned;
      }
      if (quantityMicros <= 0n) throw new Error('Amount too small at this price');
      const totalCents = (quantityMicros * priceCents + 999_999n) / 1_000_000n;
      await executeSimulatedTrade({ side: action, symbol: body.trade.symbol, quantityMicros, priceCents, totalCents });
      setMessage(`${action === 'buy' ? 'Bought' : 'Sold'} ${money.format(Number(totalCents) / 100)} of ${body.trade.symbol} @ ${money.format(Number(priceCents) / 100)}`);
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Trade failed'); }
    finally { setBusy(false); }
  };

  return <DevPanel id="demo-trader" title="Demo trader" className="demo-trader">
    <div className="autobuy-row"><span>Symbol</span><input value={symbol} onChange={(event) => setSymbol(event.target.value)} aria-label="Symbol" /></div>
    <div className="autobuy-row"><span>Amount $</span><input type="number" min="1" value={amount} onChange={(event) => setAmount(Number(event.target.value))} aria-label="Amount in dollars" /></div>
    <div className="autobuy-row"><span>Fill price</span><input type="number" min="0" placeholder="live" value={fillPrice} onChange={(event) => setFillPrice(event.target.value)} aria-label="Optional fill price override" /></div>
    <div className="demo-buttons"><button className="primary" disabled={busy || amount <= 0} onClick={() => trade('buy')}>Buy</button><button className="secondary" disabled={busy || amount <= 0} onClick={() => trade('sell')}>Sell</button></div>
    {message && <p className="helper">{message}</p>}
    <div className="demo-holdings">{positions.length ? positions.map(([sym, micros]) => <div key={sym}>{sym}: {(Number(micros) / 1_000_000).toFixed(6)}</div>) : 'No open positions'}</div>
    <div className="autobuy-row"><span>Realized profit</span><strong>{money.format(profit ?? 0)}</strong></div>
  </DevPanel>;
}
