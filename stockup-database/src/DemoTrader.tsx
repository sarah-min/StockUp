import { useEffect, useState } from 'react';
import DevPanel from './DevPanel';

// TO_REMOVE: TEMPORARY: a bare-bones buy/sell box for demoing the wishlist auto-buy (which fires on realized profit).
// Self-contained and mounted from main.tsx so the real trading UI in App.tsx can change freely. Delete when no longer needed.
type Position = { symbol: string; quantity: number; cost: number; price: number; value: number };
type Portfolio = { positions: Position[]; realized_profit: number };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function DemoTrader() {
  const [symbol, setSymbol] = useState('BTC-USD');
  const [amount, setAmount] = useState(50);
  const [fillPrice, setFillPrice] = useState('');
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => fetch('/api/portfolio').then((response) => response.json()).then(setPortfolio).catch(() => undefined);
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 10_000); return () => clearInterval(timer); }, []);

  const trade = async (action: 'buy' | 'sell') => {
    setBusy(true); setMessage('');
    try {
      const proposal = { symbol: symbol.trim().toUpperCase(), asset_type: 'crypto', action, amount_usd: amount, confidence: 1, rationale: 'Manual demo trade', risk: 'low', source: 'demo' };
      const response = await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposal, demo_price: fillPrice ? Number(fillPrice) : undefined }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Trade failed');
      setMessage(`${action === 'buy' ? 'Bought' : 'Sold'} ${money.format(amount)} of ${body.trade.symbol} @ ${money.format(body.trade.price)}`);
      await refresh();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Trade failed'); }
    finally { setBusy(false); }
  };

  return <DevPanel id="demo-trader" title="Demo trader" className="demo-trader">
    <div className="autobuy-row"><span>Symbol</span><input value={symbol} onChange={(event) => setSymbol(event.target.value)} aria-label="Symbol" /></div>
    <div className="autobuy-row"><span>Amount $</span><input type="number" min="1" value={amount} onChange={(event) => setAmount(Number(event.target.value))} aria-label="Amount in dollars" /></div>
    <div className="autobuy-row"><span>Fill price</span><input type="number" min="0" placeholder="live" value={fillPrice} onChange={(event) => setFillPrice(event.target.value)} aria-label="Optional fill price override" /></div>
    <div className="demo-buttons"><button className="primary" disabled={busy || amount <= 0} onClick={() => trade('buy')}>Buy</button><button className="secondary" disabled={busy || amount <= 0} onClick={() => trade('sell')}>Sell</button></div>
    {message && <p className="helper">{message}</p>}
    <div className="demo-holdings">{portfolio?.positions?.length ? portfolio.positions.map((position) => <div key={position.symbol}>{position.symbol}: {position.quantity.toFixed(6)} ({money.format(position.value)})</div>) : 'No open positions'}</div>
    <div className="autobuy-row"><span>Realized profit</span><strong>{money.format(portfolio?.realized_profit ?? 0)}</strong></div>
  </DevPanel>;
}
