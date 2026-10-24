import { useEffect, useState } from 'react';
import './App.css';
import Wishlist from './Wishlist';

type AssetType = 'crypto' | 'stock';
type Proposal = { symbol: string; asset_type: AssetType; action: 'buy' | 'sell'; amount_usd: number; confidence: number; rationale: string; risk: 'low' | 'medium' | 'high'; source: 'creao' | 'demo' };
type Trade = Proposal & { id: string; price: number; quantity: number; simulated: true; createdAt: string; coinbase?: { product_id: string; price_source: string; preview_status: string; preview_source: string } };
type Health = { ok: boolean; creaoConfigured: boolean; creaoError?: string | null; mode: string; coinbase?: string; coinbaseAgentMode?: string; stockQuotes?: string };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function App() {
  const [budget, setBudget] = useState(100);
  const [assetType, setAssetType] = useState<AssetType>('crypto');
  const [health, setHealth] = useState<Health | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [trade, setTrade] = useState<Trade | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [wishlistOpen, setWishlistOpen] = useState(false);

  useEffect(() => {
    request<Health>('/api/health').then(setHealth).catch(() => setHealth(null));
    request<{ trades: Trade[] }>('/api/trades').then(({ trades: saved }) => setTrades(saved)).catch(() => undefined);
  }, []);

  const generateProposal = async () => {
    setLoading(true); setError(''); setTrade(null);
    try { const result = await request<{ proposal: Proposal }>('/api/proposal', { method: 'POST', body: JSON.stringify({ budget, assetType }) }); setProposal(result.proposal); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not generate proposal'); }
    finally { setLoading(false); }
  };

  const simulateTrade = async () => {
    if (!proposal) return;
    setLoading(true); setError('');
    try { const result = await request<{ trade: Trade }>('/api/simulate', { method: 'POST', body: JSON.stringify({ proposal }) }); setTrade(result.trade); setTrades((current) => [result.trade, ...current]); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not simulate trade'); }
    finally { setLoading(false); }
  };

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">↗</span> StockUp</div><button className="wish-open" onClick={() => setWishlistOpen(true)}>♡ Wishlist</button><div className="mode-pill"><span className="dot" /> SIMULATION MODE</div></header>
    <section className="hero"><div><p className="eyebrow">CREAO × COINBASE FOR AGENTS</p><h1>Let an agent make the pitch.<br /><em>You make the call.</em></h1><p className="hero-copy">CREAO generates a strategy. Coinbase checks the product and market when the agent CLI is connected, then StockUp previews and records the trade without sending a live order.</p></div><div className="hero-badge">✦<span>Agent<br />trade preview</span></div></section>
    <section className="workspace">
      <div className="card setup-card"><div className="card-label">01 / SET YOUR PLAY</div><label>Asset class</label><div className="asset-toggle" role="group" aria-label="Asset class"><button className={assetType === 'crypto' ? 'selected' : ''} onClick={() => { setAssetType('crypto'); setProposal(null); setTrade(null); }}>Crypto</button><button className={assetType === 'stock' ? 'selected' : ''} onClick={() => { setAssetType('stock'); setProposal(null); setTrade(null); }}>Stocks</button></div><label htmlFor="budget">Paper budget</label><div className="budget-input"><span>$</span><input id="budget" type="number" min="1" max="10000" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></div><p className="helper">The agent will propose a {assetType === 'crypto' ? 'Coinbase-supported crypto asset' : 'Coinbase-eligible US equity'} and never exceed this amount.</p><button className="primary" onClick={generateProposal} disabled={loading || budget <= 0}>{loading ? 'Running CREAO…' : 'Generate strategy →'}</button><div className="integration-status"><span className={health?.creaoConfigured ? 'status-dot good' : 'status-dot'} /> {health?.creaoConfigured ? 'CREAO API connected' : health?.creaoError ? 'CREAO key needs attention' : 'CREAO demo mode'}<span className="status-separator">·</span><span className="status-dot good" /> Coinbase {health?.coinbaseAgentMode === 'auto' ? 'agent path enabled' : 'public market mode'}</div></div>
      <div className="card proposal-card"><div className="card-label">02 / AGENT PROPOSAL</div>{!proposal ? <div className="empty-state"><div className="empty-icon">◎</div><p>Your agent’s next move will appear here.</p><span>Click “Generate strategy” to start.</span></div> : <><div className="proposal-heading"><div><span className="asset-symbol">{proposal.symbol}</span><span className="asset-type">{proposal.asset_type === 'crypto' ? 'CRYPTO / SPOT' : 'US EQUITY / STOCK'}</span></div><span className={`risk risk-${proposal.risk}`}>{proposal.risk} risk</span></div><div className="proposal-number">{proposal.action.toUpperCase()} <strong>{money.format(proposal.amount_usd)}</strong></div><div className="confidence"><span>Confidence</span><div className="confidence-bar"><i style={{ width: `${proposal.confidence * 100}%` }} /></div><strong>{Math.round(proposal.confidence * 100)}%</strong></div><p className="rationale">“{proposal.rationale}”</p><button className="secondary" onClick={simulateTrade} disabled={loading}>{loading ? `Getting ${proposal.asset_type === 'crypto' ? 'Coinbase' : 'stock'} price…` : 'Simulate this trade →'}</button></>}</div>
      <div className="card result-card"><div className="card-label">03 / PAPER LEDGER</div>{!trade ? <div className="empty-state"><div className="empty-icon">◌</div><p>No position yet.</p><span>Nothing touches your Coinbase account.</span></div> : <><div className="fill-banner"><span className="status-dot good" /> Simulated fill recorded</div><div className="trade-grid"><div><span>Asset</span><strong>{trade.symbol}</strong></div><div><span>Fill price</span><strong>{money.format(trade.price)}</strong></div><div><span>Quantity</span><strong>{trade.quantity.toFixed(6)}</strong></div><div><span>Amount</span><strong>{money.format(trade.amount_usd)}</strong></div></div><div className="safe-note">✓ Coinbase product: {trade.coinbase?.product_id || trade.symbol}<br />✓ Price source: {trade.coinbase?.price_source || 'paper quote'}<br />✓ Preview: {trade.coinbase?.preview_status || 'paper-only'}<br />✓ No order was sent to Coinbase<br />✓ No money moved</div></>}</div>
    </section>
    {error && <div className="error">{error}</div>}
    <section className="history card"><div className="card-label">RECENT PAPER TRADES</div>{trades.length === 0 ? <p className="history-empty">Your simulated trades will show up here.</p> : trades.map((item) => <div className="history-row" key={item.id}><strong>{item.symbol}</strong><span>{item.action.toUpperCase()} {money.format(item.amount_usd)}</span><span>@ {money.format(item.price)}</span><span>{new Date(item.createdAt).toLocaleTimeString()}</span></div>)}</section>
    {wishlistOpen && <Wishlist onClose={() => setWishlistOpen(false)} />}
    <footer>StockUp is a simulation. Not investment advice. No live orders are enabled.</footer>
  </main>;
}

export default App;
