import { useEffect, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import { openPositions } from './positions';
import { useMyUserId } from './useMyUserId';
import { DEMO_STUP, STUP_BUY_PRICE, STUP_SELL_PRICE } from './devMode';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

async function quoteFor(symbol: string): Promise<number> {
  const response = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not get a price');
  return body.price;
}

// What the signed-in player currently holds (from their own trades) with a sell control per position.
// A sell is just another trade at the live quote, so it counts toward realized profit and milestones.
export default function OpenPositions() {
  const myUserId = useMyUserId();
  const [trades] = useTable(tables.simulatedTrade);
  const executeSimulatedTrade = useReducer(reducers.executeSimulatedTrade);
  const positions = myUserId === undefined ? [] : openPositions(trades, myUserId);
  const symbols = positions.map((position) => position.symbol).sort().join(',');
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pct, setPct] = useState<Record<string, number>>({});
  const [selling, setSelling] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const stupPct = pct.STUP ?? 100;

  useEffect(() => {
    if (!symbols) return;
    let cancelled = false;
    const load = () => symbols.split(',').forEach((symbol) => quoteFor(symbol).then((price) => { if (!cancelled) setPrices((current) => ({ ...current, [symbol]: price })); }).catch(() => undefined));
    load();
    const timer = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [symbols]);

  const sell = async (symbol: string, percent: number) => {
    const position = positions.find((entry) => entry.symbol === symbol);
    if (!position) return;
    setSelling(symbol); setError(''); setNotice('');
    try {
      const price = await quoteFor(symbol);
      const priceCents = BigInt(Math.max(1, Math.round(price * 100)));
      const quantityMicros = percent === 100 ? position.quantityMicros : (position.quantityMicros * BigInt(percent)) / 100n;
      if (quantityMicros <= 0n) throw new Error('That amount is too small to sell');
      const totalCents = (quantityMicros * priceCents + 999_999n) / 1_000_000n;
      await executeSimulatedTrade({ side: 'sell', symbol, quantityMicros, priceCents, totalCents });
      const costOfSold = (position.costCents * Number(quantityMicros)) / Number(position.quantityMicros);
      const gain = (Number(totalCents) - costOfSold) / 100;
      setNotice(`Sold ${money.format(Number(totalCents) / 100)} of ${symbol} · ${gain >= 0 ? 'profit' : 'loss'} ${money.format(Math.abs(gain))}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not sell'); }
    finally { setSelling(null); }
  };

  // TO_REMOVE: demo-only. One STUP unit "held" at the buy price; selling a share of it books a buy at the buy price and a
  // sell at the sell price for that share, so the profit is real as far as realized profit and milestones are concerned.
  const sellStup = async (percent: number) => {
    setSelling('STUP'); setError(''); setNotice('');
    try {
      const quantityMicros = BigInt(percent) * 10_000n; // percent of one whole unit
      const buyCents = BigInt(STUP_BUY_PRICE * 100);
      const sellCents = BigInt(STUP_SELL_PRICE * 100);
      const buyTotal = (quantityMicros * buyCents + 999_999n) / 1_000_000n;
      const sellTotal = (quantityMicros * sellCents + 999_999n) / 1_000_000n;
      await executeSimulatedTrade({ side: 'buy', symbol: 'STUP', quantityMicros, priceCents: buyCents, totalCents: buyTotal });
      await executeSimulatedTrade({ side: 'sell', symbol: 'STUP', quantityMicros, priceCents: sellCents, totalCents: sellTotal });
      setNotice(`Sold ${money.format(Number(sellTotal) / 100)} of STUP · profit ${money.format(Number(sellTotal - buyTotal) / 100)}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not sell'); }
    finally { setSelling(null); }
  };

  return <section className="card positions">
    <div className="card-head row"><h2>Open positions</h2><span className="count">{positions.length}</span></div>
    {notice && <p className="sell-notice">{notice}</p>}
    {error && <div className="error"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {positions.length === 0 && !DEMO_STUP && <p className="history-empty">No open positions yet. Execute a trade and it will show up here with a Sell control.</p>}
    {DEMO_STUP === 1 && <div className="position-row">
      <div className="position-main">
        <strong>STUP <span className="demo-tag">demo boost</span></strong>
        <span>1.000000 units · avg {money.format(STUP_BUY_PRICE)} · now {money.format(STUP_SELL_PRICE)}</span>
      </div>
      <div className="position-value">
        <strong>{money.format(STUP_SELL_PRICE)}</strong>
        <span className="gain">+{money.format(STUP_SELL_PRICE - STUP_BUY_PRICE)}</span>
      </div>
      <div className="position-sell">
        <div className="sell-slider">
          <input className="range range-sm" type="range" min="25" max="100" step="25" value={stupPct} aria-label="Percent of STUP to sell" onChange={(event) => setPct((current) => ({ ...current, STUP: Number(event.target.value) }))} style={{ '--fill': `${((stupPct - 25) / 75) * 100}%` } as React.CSSProperties} />
          <div className="sell-ticks" aria-hidden="true"><span>25%</span><span>50%</span><span>75%</span><span>All</span></div>
        </div>
        <span className="sell-amount"><strong>{stupPct === 100 ? 'All' : `${stupPct}%`}</strong><small>{money.format((STUP_SELL_PRICE * stupPct) / 100)}</small></span>
        <button className="sell-button" disabled={selling !== null} onClick={() => sellStup(stupPct)}>{selling === 'STUP' ? 'Selling…' : 'Sell'}</button>
      </div>
    </div>}
    {positions.map((position) => {
      const units = Number(position.quantityMicros) / 1_000_000;
      const price = prices[position.symbol];
      const value = price === undefined ? undefined : units * price;
      const gain = value === undefined ? undefined : value - position.costCents / 100;
      const percent = pct[position.symbol] ?? 100;
      return <div className="position-row" key={position.symbol}>
        <div className="position-main">
          <strong>{position.symbol}</strong>
          <span>{units.toFixed(6)} units · avg {money.format(position.costCents / 100 / units)}{price === undefined ? '' : ` · now ${money.format(price)}`}</span>
        </div>
        <div className="position-value">
          <strong>{value === undefined ? '…' : money.format(value)}</strong>
          {gain !== undefined && <span className={gain >= 0 ? 'gain' : 'loss'}>{gain >= 0 ? '+' : '−'}{money.format(Math.abs(gain))}</span>}
        </div>
        <div className="position-sell">
          <div className="sell-slider">
            <input className="range range-sm" type="range" min="25" max="100" step="25" value={percent} aria-label={`Percent of ${position.symbol} to sell`} onChange={(event) => setPct((current) => ({ ...current, [position.symbol]: Number(event.target.value) }))} style={{ '--fill': `${((percent - 25) / 75) * 100}%` } as React.CSSProperties} />
            <div className="sell-ticks" aria-hidden="true"><span>25%</span><span>50%</span><span>75%</span><span>All</span></div>
          </div>
          <span className="sell-amount"><strong>{percent === 100 ? 'All' : `${percent}%`}</strong>{value !== undefined && <small>{money.format((value * percent) / 100)}</small>}</span>
          <button className="sell-button" disabled={selling !== null} onClick={() => sell(position.symbol, percent)}>{selling === position.symbol ? 'Selling…' : 'Sell'}</button>
        </div>
      </div>;
    })}
  </section>;
}
