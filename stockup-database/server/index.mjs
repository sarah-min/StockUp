import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const PORT = Number(process.env.PORT || 8787);
const CREAO_API_KEY = process.env.CREAO_API_KEY;
const CREAO_APP_ID = process.env.CREAO_APP_ID || '1dba2b6d-dcfd-4e4d-84fd-a431a7ad8e1b';
const CREAO_AGRI_AGENT_ID = process.env.CREAO_AGRI_AGENT_ID || 'd8cf6a89-b74e-40a1-9bc6-6595e291a8dc';
const CREAO_AGRI_AGENT_VERSION = process.env.CREAO_AGRI_AGENT_VERSION || '44ffa454-a206-4a3a-9434-6c91c645b804';
const CREAO_ARTIST_AGENT_ID = process.env.CREAO_ARTIST_AGENT_ID || 'cd6605d4-2f11-4fad-9ae9-06b34fd10c2c';
const CREAO_ARTIST_AGENT_VERSION = process.env.CREAO_ARTIST_AGENT_VERSION || '5b78873c-617e-4949-aed3-bfb45fd504f7';
const CREAO_REALIST_AGENT_ID = process.env.CREAO_REALIST_AGENT_ID || '8b1813ab-1099-43f6-a64d-3b3ff7eddd44';
const CREAO_REALIST_AGENT_VERSION = process.env.CREAO_REALIST_AGENT_VERSION || '030a3507-4c30-4394-b331-0eb3bd43852e';
const CREAO_MILESTONE_AGENT_ID = process.env.CREAO_MILESTONE_AGENT_ID || '59fbfe03-06dc-4add-b42d-c2c6ec377a1b';
const CREAO_MILESTONE_AGENT_VERSION = process.env.CREAO_MILESTONE_AGENT_VERSION || 'a005d2f9-5809-4354-b7ff-355502c4ec28';
const STOCK_PRICE_API_KEY = process.env.STOCK_PRICE_API_KEY || 'demo';
const COINBASE_AGENT_MODE = process.env.COINBASE_AGENT_MODE || 'auto';
const COINBASE_CLI_BIN = process.env.COINBASE_CLI_BIN || 'coinbase';
const CREAO_IS_APP_KEY = CREAO_API_KEY?.startsWith('capi_');
const CREAO_RUNS_URL = process.env.CREAO_RUNS_URL || (CREAO_IS_APP_KEY ? 'https://agent.creao.ai/api/v1/runs' : 'https://developer.creao.ai/v2/runs');
const ZINC_API_KEY = process.env.ZINC_API_KEY;
const trades = [];
const execFile = promisify(execFileCallback);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

async function creaoHealth() {
  if (!CREAO_API_KEY) return { configured: false, error: null };
  if (CREAO_IS_APP_KEY) return { configured: true, error: null };
  const response = await fetch('https://developer.creao.ai/v2/me', { headers: { Authorization: `Bearer ${CREAO_API_KEY}` } });
  if (response.ok) return { configured: true, error: null };
  const detail = await response.json().catch(() => ({}));
  return { configured: false, error: detail.message || detail.error || `CREAO authentication failed (${response.status})` };
}

async function body(request) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('CREAO did not return a JSON proposal');
  return JSON.parse(match[0]);
}

function findStructuredResult(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return findStructuredResult(extractJson(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredResult(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  if (
    value.milestones ||
    value.thresholds ||
    value.goals ||
    value.recommended_assets ||
    value.recommendations ||
    value.picks ||
    value.symbol ||
    value.ticker ||
    value.asset
  ) {
    return value;
  }
  for (const nested of Object.values(value)) {
    const found = findStructuredResult(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

async function extractAgentResult(result) {
  const structured = findStructuredResult(result);
  if (structured) return structured;
  const candidates = [
    result.result,
    result.output,
    result.data,
    result.response,
    result.message,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      if (candidate.symbol || candidate.ticker || candidate.asset || candidate.recommended_assets || candidate.recommendations || candidate.picks || candidate.milestones || candidate.thresholds || candidate.goals) {
        return candidate;
      }
      const nested = candidate.text || candidate.chatText || candidate.content || candidate.output;
      if (typeof nested === 'string' && nested.trim()) return extractJson(nested);
    }
    if (typeof candidate === 'string' && candidate.trim()) return extractJson(candidate);
  }
  for (const artifact of result.artifacts || result.result?.artifacts || []) {
    const artifactUrl = typeof artifact === 'string' ? artifact : artifact?.url;
    if (!artifactUrl) continue;
    const response = await fetch(artifactUrl, {
      headers: { Authorization: `Bearer ${CREAO_API_KEY}` },
    });
    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const artifactValue = contentType.includes('application/json')
        ? await response.json()
        : extractJson(await response.text());
      return artifactValue;
    }
  }
  const serialized = JSON.stringify(result);
  return extractJson(serialized);
}

function normalizeTraderResult(value, budget, assetType, traderName) {
  const rawRecommendations = value.recommended_assets
    || value.recommendations
    || value.picks
    || value.assets
    || value.stocks
    || value.crypto
    || [];
  const recommendations = (Array.isArray(rawRecommendations) ? rawRecommendations : [rawRecommendations])
    .flatMap((item) => typeof item === 'object' ? [item.symbol || item.ticker || item.asset] : String(item || '').split(/[,\n]/))
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean);
  const symbol = value.symbol || value.ticker || value.asset || recommendations[0];
  return {
    ...value,
    symbol,
    recommended_assets: recommendations,
    action: value.action || 'buy',
    amount_usd: value.amount_usd || budget,
    confidence: value.confidence ?? 0.62,
    risk: value.risk || 'medium',
    rationale: value.rationale || value.reason || value.strategy || `Typical ${assetType} picks from the ${traderName} strategy.`,
  };
}

function validateProposal(value, budget, assetType = value.asset_type || 'crypto') {
  const normalizedAssetType = assetType === 'stock' ? 'stock' : 'crypto';
  const rawSymbol = String(value.symbol || value.ticker || value.asset || '').trim().toUpperCase().replace(/[\/_\s]+/g, '-');
  const supportedAssets = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX', 'LTC', 'LINK', 'UNI', 'BCH'];
  const supportedStocks = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NFLX', 'AMD', 'IBM'];
  const detectedAsset = supportedAssets.find((asset) => rawSymbol.includes(asset));
  const stockTicker = rawSymbol.split('-')[0];
  const inferredSymbol = normalizedAssetType === 'stock'
    ? stockTicker
    : detectedAsset ? `${detectedAsset}-USD` : rawSymbol && !rawSymbol.includes('-') ? `${rawSymbol}-USD` : rawSymbol;
  const symbol = normalizedAssetType === 'stock'
    ? (/^[A-Z]{1,5}$/.test(inferredSymbol) && supportedStocks.includes(inferredSymbol) ? inferredSymbol : 'AAPL')
    : (/^[A-Z0-9]+-[A-Z0-9]+$/.test(inferredSymbol) ? inferredSymbol : 'BTC-USD');
  const fallbackNote = symbol === (normalizedAssetType === 'stock' ? 'AAPL' : 'BTC-USD') && inferredSymbol !== symbol
    ? ` CREAO returned an unsupported ${normalizedAssetType} ticker label, so StockUp safely used ${symbol} for this paper trade.`
    : '';
  const rawAction = String(value.action || '').toLowerCase();
  const text = `${rawAction} ${String(value.rationale || value.reason || '').toLowerCase()}`;
  const action = rawAction === 'buy' || rawAction === 'sell' ? rawAction : text.includes('sell') ? 'sell' : 'buy';
  const requestedAmount = Number(value.amount_usd ?? value.amount ?? value.usd_amount);
  const amount_usd = Number.isFinite(requestedAmount) && requestedAmount > 0 ? Math.min(requestedAmount, budget) : Math.min(25, budget);
  const requestedConfidence = Number(value.confidence);
  const confidence = Number.isFinite(requestedConfidence) && requestedConfidence >= 0 && requestedConfidence <= 1 ? requestedConfidence : 0.62;
  const rawRisk = String(value.risk || '').toLowerCase();
  const risk = ['low', 'medium', 'high'].includes(rawRisk) ? rawRisk : 'high';
  const fallbackFields = [
    rawAction !== action ? ` CREAO returned an unrecognized action, so StockUp safely used ${action}.` : '',
    !Number.isFinite(requestedAmount) || requestedAmount <= 0 ? ` CREAO omitted a valid amount, so StockUp used $${amount_usd} within the paper budget.` : '',
    !Number.isFinite(requestedConfidence) || requestedConfidence < 0 || requestedConfidence > 1 ? ' CREAO omitted a valid confidence score, so StockUp used 0.62.' : '',
    !['low', 'medium', 'high'].includes(rawRisk) ? ' CREAO omitted a valid risk level, so StockUp used high.' : ''
  ].join('');
  const recommendations = Array.isArray(value.recommended_assets || value.recommendations || value.picks)
    ? [...new Set((value.recommended_assets || value.recommendations || value.picks).map((item) => String(item).trim().toUpperCase()).filter(Boolean))]
    : [];
  const proposal = {
    symbol,
    asset_type: normalizedAssetType,
    action,
    amount_usd,
    confidence,
    rationale: `${String(value.rationale || value.reason || '')}${fallbackNote}${fallbackFields}`,
    risk,
    recommendations: recommendations.length > 0 ? recommendations : [symbol],
  };
  if (normalizedAssetType === 'crypto' && !/^[A-Z0-9]+-[A-Z0-9]+$/.test(proposal.symbol)) throw new Error('Invalid crypto symbol');
  if (normalizedAssetType === 'stock' && !/^[A-Z]{1,5}$/.test(proposal.symbol)) throw new Error('Invalid stock ticker');
  if (!['buy', 'sell'].includes(proposal.action)) throw new Error('Action must be buy or sell');
  if (!Number.isFinite(proposal.amount_usd) || proposal.amount_usd <= 0 || proposal.amount_usd > budget) throw new Error('Proposal amount exceeds the paper budget');
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) throw new Error('Confidence must be between 0 and 1');
  if (!['low', 'medium', 'high'].includes(proposal.risk)) throw new Error('Risk must be low, medium, or high');
  return proposal;
}

const TRADERS = {
  'personality-1': { id: CREAO_AGRI_AGENT_ID, version: CREAO_AGRI_AGENT_VERSION, name: 'agrarian-trader' },
  'agrarian-trader': { id: CREAO_AGRI_AGENT_ID, version: CREAO_AGRI_AGENT_VERSION, name: 'agrarian-trader' },
  'personality-2': { id: CREAO_ARTIST_AGENT_ID, version: CREAO_ARTIST_AGENT_VERSION, name: 'artist-trader' },
  'artist-trader': { id: CREAO_ARTIST_AGENT_ID, version: CREAO_ARTIST_AGENT_VERSION, name: 'artist-trader' },
  'personality-3': { id: CREAO_REALIST_AGENT_ID, version: CREAO_REALIST_AGENT_VERSION, name: 'realist-trader' },
  'realist-trader': { id: CREAO_REALIST_AGENT_ID, version: CREAO_REALIST_AGENT_VERSION, name: 'realist-trader' },
};

// Start one CREAO trader run with this prompt and return the agent's structured result.
async function runTraderAgent(trader, prompt) {
  const appId = trader.id;
  const startUrl = CREAO_IS_APP_KEY ? `https://agent.creao.ai/api/v1/apps/${encodeURIComponent(appId)}/runs` : CREAO_RUNS_URL;
  const startBody = CREAO_IS_APP_KEY
    ? { inputs: { prompt } }
    : { agent_id: appId, input: { prompt } };
  const start = await fetch(startUrl, { method: 'POST', headers: { Authorization: `Bearer ${CREAO_API_KEY}` }, body: JSON.stringify(startBody) });
  if (!start.ok) {
    const detail = await start.json().catch(() => ({}));
    throw new Error(detail.message || detail.error || `CREAO start failed (${start.status})`);
  }
  const run = await start.json();
  const runId = run.run_id || run.id;
  if (!runId) throw new Error('CREAO did not return a run id');
  const deadline = Date.now() + 120_000;
  let pollDelay = 1500;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollDelay));
    pollDelay = Math.min(Math.round(pollDelay * 1.3), 5000);
    const pollUrl = `${CREAO_RUNS_URL}/${runId}`;
    const response = await fetch(pollUrl, { headers: { Authorization: `Bearer ${CREAO_API_KEY}` } });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }
    if (!response.ok) throw new Error(`CREAO polling failed (${response.status})`);
    const result = await response.json();
    if (result.status === 'failed' || result.status === 'cancelled') throw new Error(`CREAO run ${result.status}`);
    if (result.status === 'completed' || result.status === 'succeeded' || result.status === 'success') {
      return extractAgentResult(result);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('CREAO run timed out');
}

async function runCreaoForAsset(budget, assetType, investmentType = 'personality-1') {
  if (!CREAO_API_KEY) return { ...validateProposal({ symbol: assetType === 'stock' ? 'AAPL' : 'BTC-USD', action: 'buy', amount_usd: Math.min(25, budget), confidence: 0.62, rationale: 'Demo proposal: add CREAO_API_KEY to run the real strategy agent.', risk: 'high' }, budget, assetType), source: 'demo' };
  const trader = TRADERS[investmentType] || TRADERS['personality-1'];
  const prompt = `For a paper-trading proposal, return exactly one JSON object listing the stocks or crypto assets that your ${trader.name} strategy typically picks. The requested asset class is ${assetType === 'stock' ? 'US stocks' : 'crypto pairs'}, and the paper budget is $${budget}. Use only ${assetType === 'stock' ? 'US tickers such as AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, NFLX, AMD, or IBM' : 'Coinbase-supported pairs such as BTC-USD, ETH-USD, SOL-USD, DOGE-USD, or XRP-USD'}. Required fields: recommended_assets (array of symbols), symbol (the first recommendation), action, amount_usd, confidence, rationale, risk. Do not place an order or use real money.`;
  const agentResult = await runTraderAgent(trader, prompt);
  const proposalInput = normalizeTraderResult(agentResult, budget, assetType, trader.name);
  return { ...validateProposal(proposalInput, budget, assetType), source: 'creao', agent: trader.name };
}

// ---- Per-agent advice: every agent looks at its own cash and holdings and says buy, sell or hold. ----

const assetTypeOf = (symbol) => (String(symbol).includes('-') ? 'crypto' : 'stock');
const baseSymbol = (symbol) => String(symbol || '').trim().toUpperCase().replace(/[\/_\s]+/g, '-').split('-')[0];
const roundCents = (value) => Math.floor(value * 100) / 100;

// Value each holding the agent reports at the current market price.
async function priceHoldings(holdings) {
  const valid = (Array.isArray(holdings) ? holdings : [])
    .map((holding) => ({ symbol: String(holding.symbol || '').toUpperCase(), quantity: Number(holding.quantity) }))
    .filter((holding) => holding.symbol && Number.isFinite(holding.quantity) && holding.quantity > 0);
  return Promise.all(valid.map(async (holding) => {
    const asset_type = assetTypeOf(holding.symbol);
    let price = null;
    try { price = (asset_type === 'stock' ? await stockPrice(holding.symbol) : await coinbasePrice(holding.symbol)).price; } catch { /* unpriced: it can't be sold this round */ }
    return { ...holding, asset_type, price, value: price ? roundCents(holding.quantity * price) : 0 };
  }));
}

const DEMO_PICKS = {
  'personality-1': { crypto: 'ADA-USD', stock: 'AMZN', share: 0.3, risk: 'low', why: 'Slow and steady: a steady-growth asset, sized small, the way a farmer plants a field.' },
  'personality-2': { crypto: 'SOL-USD', stock: 'NFLX', share: 0.45, risk: 'high', why: 'Momentum and culture: a bold bet on the asset with the most creative energy right now.' },
  'personality-3': { crypto: 'BTC-USD', stock: 'MSFT', share: 0.25, risk: 'medium', why: 'Fundamentals first: the most established asset, with a measured position size.' },
};

function demoAdvice(agent, assetType, cash, holdings) {
  const picks = DEMO_PICKS[agent.personality] || DEMO_PICKS['personality-1'];
  const sellable = holdings.filter((holding) => holding.value >= 1);
  if (sellable.length > 0 && (cash < 1 || Math.random() < 0.5)) {
    // Different agents look at different holdings first, so demo sells don't all pile onto one asset.
    const slot = (Number(String(agent.name || '').replace(/\D/g, '')) || 1) - 1;
    const holding = sellable[slot % sellable.length];
    return { symbol: holding.symbol, action: 'sell', amount_usd: roundCents(holding.value * 0.5), confidence: 0.58, risk: 'medium', rationale: `Demo advice: take profit on half of the ${holding.symbol} position and keep the rest working.` };
  }
  if (cash < 1) return { action: 'hold', rationale: 'Demo advice: no cash left and nothing worth selling yet, so sit tight this round.' };
  return { symbol: picks[assetType], action: 'buy', amount_usd: Math.max(1, roundCents(cash * picks.share)), confidence: 0.62, risk: picks.risk, rationale: `Demo advice: ${picks.why}` };
}

function advicePrompt(trader, assetType, cash, holdings) {
  const held = holdings.length
    ? holdings.map((holding) => `${holding.symbol}: ${holding.quantity} units${holding.price ? `, worth about $${holding.value.toFixed(2)}` : ''}`).join('; ')
    : 'nothing yet';
  return `You are the ${trader.name} agent in a paper-trading game. Decide your single next move and return exactly one JSON object, with no conversational text. `
    + `You have $${cash.toFixed(2)} of paper cash. Current holdings: ${held}. `
    + `Either BUY a ${assetType === 'stock' ? 'US stock (AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, NFLX, AMD or IBM)' : 'Coinbase crypto pair (BTC-USD, ETH-USD, SOL-USD, DOGE-USD, XRP-USD, ADA-USD, AVAX-USD, LTC-USD or LINK-USD)'} with amount_usd at most your cash, `
    + `or SELL part or all of one holding you own (symbol must be that holding, amount_usd at most its value), or HOLD if neither fits your strategy. `
    + `Required fields: action ("buy", "sell" or "hold"), symbol, amount_usd, confidence (0 to 1), risk ("low", "medium" or "high"), rationale (one or two sentences in your strategy's voice), recommended_assets (array of symbols). Do not place an order or use real money.`;
}

// Turn the agent's raw answer into a safe, checked advice card.
function finalizeAdvice(raw, { agent, assetType, cash, holdings, source, traderName }) {
  const base = { agent_name: agent.name, agent_id: agent.id ?? null, personality: agent.personality, cash_usd: cash, source, agent: traderName };
  const rawAction = String(raw.action || '').toLowerCase();
  const sellish = rawAction === 'sell' || (!rawAction && /\bsell\b/i.test(String(raw.rationale || '')));
  if (rawAction === 'hold') {
    return { ...base, action: 'hold', symbol: '', asset_type: assetType, amount_usd: 0, confidence: Number(raw.confidence) || 0.5, risk: 'low', rationale: String(raw.rationale || 'Holding this round.'), recommendations: [] };
  }
  if (sellish) {
    const wanted = baseSymbol(raw.symbol || raw.ticker || raw.asset);
    const holding = holdings.find((entry) => baseSymbol(entry.symbol) === wanted && entry.value > 0);
    if (holding) {
      const requested = Number(raw.amount_usd ?? raw.amount);
      const amount = Number.isFinite(requested) && requested > 0 ? Math.min(requested, holding.value) : roundCents(holding.value * 0.5);
      const proposal = validateProposal({ ...raw, symbol: holding.symbol, action: 'sell', amount_usd: amount }, holding.value, holding.asset_type);
      return { ...base, ...proposal, held_quantity: holding.quantity, held_value: holding.value, price: holding.price, sell_all: amount >= holding.value - 0.01 };
    }
    raw = { ...raw, action: 'buy', rationale: `${raw.rationale || ''} (The agent suggested selling ${wanted || 'an asset'} it doesn't hold, so StockUp turned it into a buy.)` };
  }
  if (cash < 1) {
    return { ...base, action: 'hold', symbol: '', asset_type: assetType, amount_usd: 0, confidence: 0.5, risk: 'low', rationale: 'Out of cash for new buys this round.', recommendations: [] };
  }
  const normalized = normalizeTraderResult(raw, Math.min(25, cash), assetType, traderName || 'demo');
  return { ...base, ...validateProposal({ ...normalized, action: 'buy' }, cash, assetType) };
}

async function adviseAgent(agent, assetType) {
  const cash = Math.max(0, roundCents(Number(agent.cash_usd) || 0));
  const holdings = await priceHoldings(agent.holdings);
  if (!CREAO_API_KEY) return finalizeAdvice(demoAdvice(agent, assetType, cash, holdings), { agent, assetType, cash, holdings, source: 'demo' });
  const trader = TRADERS[agent.personality] || TRADERS['personality-1'];
  const result = await runTraderAgent(trader, advicePrompt(trader, assetType, cash, holdings));
  return finalizeAdvice(result, { agent, assetType, cash, holdings, source: 'creao', traderName: trader.name });
}

// A milestone target is dollars of realized profit. Accepts 135, "$135", "1,200.50" or "35%" (of the invested amount);
// anything without a number in it is dropped, so the UI never shows wordy targets.
function profitTarget(raw, invested) {
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw);
  const match = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  let dollars = Number(match[0]);
  if (text.includes('%')) dollars = (dollars / 100) * invested;
  return dollars > 0 ? `$${Number(dollars.toFixed(2))}` : null;
}

function normalizeMilestones(value, wishlist, proposal) {
  const raw = value.milestones || value.milestone || value.thresholds || value.goals || [];
  const entries = Array.isArray(raw)
    ? raw
    : Object.entries(raw || {}).map(([name, target]) => ({ name, target }));
  const milestones = entries.map((item, index) => {
    if (typeof item === 'string') return { name: item, target: null, rationale: '' };
    return {
      name: String(item.name || item.title || item.goal || `Milestone ${index + 1}`),
      target: profitTarget(item.target_profit_usd ?? item.target ?? item.profit_target ?? item.profitTarget ?? item.threshold ?? item.value, proposal.amount_usd),
      rationale: String(item.rationale || item.reason || item.description || item.why || ''),
    };
  }).filter((item) => item.name && item.target);
  if (milestones.length === 0) console.warn('Milestone agent returned nothing usable:', JSON.stringify(value).slice(0, 600));
  return {
    wishlist,
    invested_amount: proposal.amount_usd,
    recommendations: proposal.recommendations || [proposal.symbol],
    milestones,
  };
}

async function runMilestones(wishlist, proposal) {
  if (!CREAO_API_KEY) {
    const base = proposal.amount_usd;
    return normalizeMilestones({ milestones: [10, 25, 50].map((pct, index) => ({ name: `Demo milestone ${index + 1}`, target_profit_usd: (base * pct) / 100, rationale: 'Demo suggestion: add CREAO_API_KEY for milestones based on your wishlist.' })) }, wishlist, proposal);
  }
  // The agent occasionally answers in prose; try once more before giving up so the user never sees non-numeric targets.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runMilestonesOnce(wishlist, proposal);
    if (result.milestones.length > 0) return result;
  }
  throw new Error('The milestone agent did not return numeric profit targets. Please try again.');
}

async function runMilestonesOnce(wishlist, proposal) {
  const prompt = `Create paper-trading earning milestones now. Do not ask follow-up questions and do not return conversational text. Infer reasonable assumptions from the information provided. Wishlist: ${wishlist}. The user invested exactly $${proposal.amount_usd} in these assets: ${(proposal.recommendations || [proposal.symbol]).join(', ')}. Return only valid JSON in this exact shape: {"milestones":[{"name":"...","target_profit_usd":0,"rationale":"..."}]}. Include 3 milestones. target_profit_usd must be a plain number of US dollars of realized PROFIT to earn (the gain, not the total portfolio value), never words, never a percentage. State in each rationale that it is a suggestion only, not a guarantee or financial advice.`;
  const startUrl = `https://agent.creao.ai/api/v1/apps/${CREAO_MILESTONE_AGENT_ID}/runs`;
  const start = await fetch(startUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CREAO_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: { prompt } }),
  });
  if (!start.ok) {
    const detail = await start.json().catch(() => ({}));
    throw new Error(detail.message || detail.error || `CREAO milestone start failed (${start.status})`);
  }
  const run = await start.json();
  const runId = run.run_id || run.id;
  if (!runId) throw new Error('CREAO milestone agent did not return a run id');
  const deadline = Date.now() + 120_000;
  let pollDelay = 1500;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollDelay));
    pollDelay = Math.min(Math.round(pollDelay * 1.3), 5000);
    const response = await fetch(`https://agent.creao.ai/api/v1/runs/${runId}`, {
      headers: { Authorization: `Bearer ${CREAO_API_KEY}` },
    });
    if (response.status === 429) continue;
    if (!response.ok) throw new Error(`CREAO milestone polling failed (${response.status})`);
    const result = await response.json();
    if (result.status === 'failed' || result.status === 'cancelled') throw new Error(`CREAO milestone run ${result.status}`);
    if (result.status === 'completed' || result.status === 'succeeded' || result.status === 'success') {
      return normalizeMilestones(await extractAgentResult(result), wishlist, proposal);
    }
  }
  throw new Error('CREAO milestone run timed out');
}

async function runCoinbaseCli(args) {
  if (COINBASE_AGENT_MODE === 'public') return null;
  try {
    const result = await execFile(COINBASE_CLI_BIN, args, { timeout: 15_000, maxBuffer: 1_000_000 });
    return JSON.parse(result.stdout);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return null;
    throw new Error(`Coinbase agent CLI failed: ${error.stderr?.trim() || error.message}`);
  }
}

function productIdFor(symbol, assetType) {
  return assetType === 'stock' ? `${symbol}-USD` : symbol;
}

async function coinbaseProduct(productId, assetType) {
  const cliResult = await runCoinbaseCli(['products', 'get', productId, `product_type=${assetType === 'stock' ? 'EQUITY' : 'SPOT'}`]);
  if (cliResult) return { product: cliResult, source: 'coinbase-agent-cli' };

  const response = await fetch(`https://api.coinbase.com/api/v3/brokerage/market/products/${encodeURIComponent(productId)}`);
  if (response.ok) return { product: await response.json(), source: 'coinbase-public-market-api' };
  return null;
}

function priceFromCoinbaseProduct(product) {
  const price = Number(product?.price ?? product?.price_string ?? product?.last_trade_price);
  return Number.isFinite(price) ? price : null;
}

async function coinbasePrice(symbol) {
  const result = await coinbaseProduct(symbol, 'crypto');
  const price = priceFromCoinbaseProduct(result?.product);
  if (Number.isFinite(price)) return { price, source: result.source, product: result.product };

  const response = await fetch(`https://api.coinbase.com/v2/prices/${encodeURIComponent(symbol)}/spot`);
  if (!response.ok) throw new Error(`Coinbase price lookup failed (${response.status})`);
  const fallback = await response.json();
  const fallbackPrice = Number(fallback.data?.amount);
  if (!Number.isFinite(fallbackPrice)) throw new Error('Coinbase returned an invalid price');
  return { price: fallbackPrice, source: 'coinbase-public-spot-api', product: null };
}

async function stockPrice(symbol) {
  const productId = productIdFor(symbol, 'stock');
  const result = await coinbaseProduct(productId, 'stock');
  const coinbasePriceValue = priceFromCoinbaseProduct(result?.product);
  if (Number.isFinite(coinbasePriceValue)) return { price: coinbasePriceValue, source: result.source, product: result.product };

  const nasdaq = await fetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`, { headers: { 'User-Agent': 'StockUp paper-trading simulator/1.0' } });
  if (nasdaq.ok) {
    const result = await nasdaq.json();
    const rawPrice = result.data?.primaryData?.lastSalePrice;
    const price = Number(String(rawPrice || '').replace(/[$,]/g, ''));
    if (Number.isFinite(price)) return { price, source: 'nasdaq-fallback', product: null };
  }
  const response = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(STOCK_PRICE_API_KEY)}`);
  if (!response.ok) throw new Error(`Stock price lookup failed (${response.status})`);
  const fallbackResult = await response.json();
  const price = Number(fallbackResult['Global Quote']?.['05. price']);
  if (!Number.isFinite(price)) throw new Error('Stock price provider returned no quote');
  return { price, source: 'alphavantage-fallback', product: null };
}

async function coinbasePreview({ productId, assetType, action, amountUsd, price }) {
  if (COINBASE_AGENT_MODE === 'public') return { status: 'paper-only', source: 'local-simulation', message: 'Coinbase agent tools are disabled in public-only mode.' };
  const args = ['orders', 'preview', `product_id=${productId}`, `side=${action.toUpperCase()}`, 'type=market'];
  if (action === 'buy') args.push(`quote_size=${amountUsd}`);
  else args.push(`base_size=${amountUsd / price}`);
  try {
    const preview = await runCoinbaseCli(args);
    if (!preview) return { status: 'paper-only', source: 'local-simulation', message: 'Install and authenticate the Coinbase CLI to enable Coinbase order previews.' };
    return { status: 'previewed', source: 'coinbase-agent-cli', preview };
  } catch (error) {
    // StockUp is paper-only: Coinbase order previews can still reject a
    // request because the connected portfolio has no funds, even though no
    // live order would ever be created here. Preserve the simulation by
    // recording the Coinbase error as diagnostic metadata instead of making
    // Generate Trade fail.
    return {
      status: 'paper-only',
      source: 'local-simulation',
      message: `Coinbase order preview unavailable; simulated locally: ${error.message}`,
    };
  }
}

async function zincSearch(query) {
  if (!ZINC_API_KEY) throw new Error('ZINC_API_KEY is not set. Mint a sandbox key with: curl -X POST https://api.zinc.com/sandbox/keys');
  const response = await fetch(`https://api.zinc.com/search?${new URLSearchParams({ q: query, limit: '12' })}`, { headers: { Authorization: `Bearer ${ZINC_API_KEY}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Zinc search failed (${response.status})`);
  return (data.results || []).filter((item) => item.url && item.available !== false).map((item) => ({ url: item.url, retailer: item.retailer, title: item.title, image: item.image, brand: item.brand, price_cents: item.price, stars: item.stars }));
}

const SANDBOX_ADDRESS = { first_name: 'Sandbox', last_name: 'Agent', address_line1: '101 Market St', city: 'San Francisco', state: 'CA', postal_code: '94105', phone_number: '4155552671', country: 'US' };
const ZINC_SHIPPING_ADDRESS = process.env.ZINC_SHIPPING_ADDRESS ? JSON.parse(process.env.ZINC_SHIPPING_ADDRESS) : SANDBOX_ADDRESS;

async function zincFetch(path, options = {}) {
  if (!ZINC_API_KEY) throw new Error('ZINC_API_KEY is not set');
  const response = await fetch(`https://api.zinc.com${path}`, { ...options, headers: { Authorization: `Bearer ${ZINC_API_KEY}`, 'Content-Type': 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const failure = new Error(data.error?.message || data.message || (typeof data.error === 'string' && data.error) || `Zinc request failed (${response.status}): ${JSON.stringify(data).slice(0, 300)}`); failure.code = data.error?.code; throw failure; }
  return data;
}

function orderSummary(order) {
  const tracking = order.tracking_numbers?.[0];
  return {
    order_id: order.id,
    status: order.status,
    delivered: Boolean(order.tracking_numbers?.some((entry) => entry.status === 'delivered')),
    total_cents: order.job_result?.price_components?.total ?? null,
    estimated_delivery: tracking?.estimated_delivery_date || order.job_result?.estimated_delivery || null,
    carrier: tracking?.carrier || null,
    tracking_number: tracking?.tracking_number || null,
    tracking_url: tracking?.zinc_tracking_url || null,
    error: order.job_result?.error || null,
  };
}

const STDB_HTTP = process.env.SPACETIMEDB_HTTP || 'https://maincloud.spacetimedb.com';
const STDB_DB = process.env.SPACETIMEDB_DB_NAME || 'stockup-db';
const TOKEN_FILE = new URL('../.stockup-server-token', import.meta.url);
let serverToken;

// The API server has its own SpacetimeDB identity. It is the only identity the module lets place and update orders.
async function stdbToken() {
  if (serverToken) return serverToken;
  serverToken = process.env.SPACETIMEDB_SERVER_TOKEN || (await readFile(TOKEN_FILE, 'utf8').catch(() => '')).trim();
  if (!serverToken) {
    const minted = await (await fetch(`${STDB_HTTP}/v1/identity`, { method: 'POST' })).json();
    serverToken = minted.token;
    await writeFile(TOKEN_FILE, serverToken, { mode: 0o600 });
  }
  return serverToken;
}

async function stdbCall(reducer, args) {
  const response = await fetch(`${STDB_HTTP}/v1/database/${STDB_DB}/call/${reducer}`, { method: 'POST', headers: { Authorization: `Bearer ${await stdbToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!response.ok) throw new Error(`${reducer} failed: ${(await response.text()).trim()}`);
}

async function stdbRows(query) {
  const response = await fetch(`${STDB_HTTP}/v1/database/${STDB_DB}/sql`, { method: 'POST', headers: { Authorization: `Bearer ${await stdbToken()}` }, body: query });
  if (!response.ok) throw new Error(`SQL failed: ${(await response.text()).trim()}`);
  const [result] = await response.json();
  const names = result.schema.elements.map((element) => element.name.some);
  return result.rows.map((row) => Object.fromEntries(row.map((value, index) => [names[index], value])));
}

const optional = (value) => (value === null || value === undefined ? { none: [] } : { some: value });
// SQL results encode Option as [0, value] (some) or [1, []] (none) and Timestamp as [micros].
const unwrap = (value) => (Array.isArray(value) && value[0] === 0 ? value[1] : null);

async function syncOrder(id, status, summary = {}) {
  await stdbCall('sync_order', [id, status, optional(summary.order_id), optional(summary.total_cents), optional(summary.carrier), optional(summary.tracking_number), optional(summary.tracking_url), optional(summary.estimated_delivery), optional(summary.error)]);
}

// Stable per order row, so retrying after a crash makes Zinc return the existing order instead of buying again.
function idempotencyKey(row) {
  return createHash('sha256').update(`${STDB_DB}:${row.id}:${JSON.stringify(row.owner)}:${JSON.stringify(row.created_at)}`).digest('hex').slice(0, 36);
}

async function placeOrder(row) {
  const key = idempotencyKey(row);
  let created;
  try {
    // Headroom over the listed price: tax and shipping are added at checkout.
    created = await zincFetch('/orders', { method: 'POST', body: JSON.stringify({ products: [{ url: row.url, quantity: 1 }], shipping_address: ZINC_SHIPPING_ADDRESS, max_price: Math.round(Number(row.price_cents) * 2), idempotency_key: key, metadata: { stockup_order: key } }) });
  } catch (error) {
    if (error.code !== 'already_exists') throw error;
    // An earlier attempt already created it (e.g. we crashed before saving the result): find it instead of buying again.
    const found = await zincFetch(`/orders?${new URLSearchParams({ metadata_key: 'stockup_order', metadata_value: key, limit: '1' })}`);
    if (!found.orders?.[0]) throw new Error('Zinc says this order exists but it could not be found');
    created = found.orders[0];
  }
  const deadline = Date.now() + 20_000;
  let order = created;
  while (Date.now() < deadline && !['order_placed', 'order_failed'].includes(order.status)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    order = await zincFetch(`/orders/${created.id}`);
  }
  return order;
}

async function recordZincOrder(row, order) {
  const summary = orderSummary(order);
  if (order.status === 'order_failed') return syncOrder(row.id, 'failed', { ...summary, error: summary.error || 'Zinc could not place the order' });
  if (order.status === 'order_placed') return syncOrder(row.id, summary.delivered ? 'delivered' : 'placed', summary);
  // Still pending after the wait: leave it as "placing"; the next tick retries with the same idempotency key.
}

const lastPolled = new Map();
let workerBusy = false;

async function orderWorkerTick() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const rows = await stdbRows("SELECT * FROM wishlist_order WHERE status = 'pending' OR status = 'placing' OR status = 'placed'");
    for (const row of rows) {
      try {
        const zincId = unwrap(row.zinc_order_id);
        if (row.status === 'pending') await syncOrder(row.id, 'placing');
        if (row.status === 'pending' || (row.status === 'placing' && !zincId)) {
          await recordZincOrder(row, await placeOrder(row));
        } else if (row.status === 'placing' || row.status === 'placed') {
          // Young orders are checked every tick, older ones about once a minute.
          const age = Date.now() - Number(row.created_at?.[0] ?? 0) / 1000;
          const due = !lastPolled.has(row.id) || Date.now() - lastPolled.get(row.id) > (age < 120_000 ? 4_000 : 60_000);
          if (!zincId || !due) continue;
          lastPolled.set(row.id, Date.now());
          const order = await zincFetch(`/orders/${zincId}`);
          const summary = orderSummary(order);
          const changed = summary.delivered || summary.tracking_number !== unwrap(row.tracking_number);
          if (changed) await recordZincOrder(row, order);
        }
      } catch (error) { console.error(`Order ${row.id}:`, error.message); }
    }
  } catch (error) { console.error('Order worker:', error.message); }
  finally { workerBusy = false; }
}

async function startOrderWorker() {
  if (!ZINC_API_KEY) return console.log('Order worker disabled (no ZINC_API_KEY)');
  try { await stdbCall('claim_order_server', []); } catch (error) { return console.error('Order worker disabled:', error.message); }
  console.log('Order worker running');
  setInterval(orderWorkerTick, 5000);
}

// Realized profit uses the average-cost method: a sell realizes (sell price - average cost) x quantity sold.
// Trades are stored newest-first, so replay them oldest-first. Sells beyond the quantity held are ignored (no shorting).
async function portfolio() {
  const holdings = new Map();
  let realizedProfit = 0;
  for (const trade of [...trades].reverse()) {
    const entry = holdings.get(trade.symbol) || { symbol: trade.symbol, asset_type: trade.asset_type, quantity: 0, cost: 0, last_price: trade.price };
    entry.last_price = trade.price;
    if (trade.action === 'sell') {
      const sold = Math.min(trade.quantity, entry.quantity);
      if (sold > 0) {
        const averageCost = entry.cost / entry.quantity;
        realizedProfit += sold * (trade.price - averageCost);
        entry.quantity -= sold; entry.cost -= sold * averageCost;
      }
    } else { entry.quantity += trade.quantity; entry.cost += trade.amount_usd; }
    holdings.set(trade.symbol, entry);
  }
  const positions = await Promise.all([...holdings.values()].filter((entry) => entry.quantity > 1e-9).map(async (entry) => {
    let price = entry.last_price;
    try { price = (entry.asset_type === 'stock' ? await stockPrice(entry.symbol) : await coinbasePrice(entry.symbol)).price; } catch { /* fall back to the last fill price */ }
    return { symbol: entry.symbol, quantity: entry.quantity, cost: entry.cost, price, value: entry.quantity * price };
  }));
  const totalValue = positions.reduce((sum, entry) => sum + entry.value, 0);
  const totalCost = positions.reduce((sum, entry) => sum + entry.cost, 0);
  return { positions, total_value: totalValue, total_cost: totalCost, realized_profit: realizedProfit, unrealized_profit: totalValue - totalCost };
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') return json(response, 204, {});
    if (request.method === 'GET' && request.url === '/api/health') { const creao = await creaoHealth(); return json(response, 200, { ok: true, mode: 'paper', creaoConfigured: creao.configured, creaoError: creao.error, coinbase: COINBASE_AGENT_MODE === 'public' ? 'public-market-api' : 'agent-cli-when-configured', coinbaseAgentMode: COINBASE_AGENT_MODE, stockQuotes: 'coinbase-equities-when-configured-with-nasdaq-fallback' }); }
    if (request.method === 'GET' && request.url === '/api/trades') return json(response, 200, { trades });
    if (request.method === 'POST' && request.url === '/api/proposal') { const { budget = 100, assetType = 'crypto', investmentType = 'personality-1', agent } = await body(request); const market = assetType === 'stock' ? 'stock' : 'crypto'; if (agent) return json(response, 200, { proposal: await adviseAgent(agent, market) }); return json(response, 200, { proposal: await runCreaoForAsset(Number(budget), market, investmentType) }); }
    if (request.method === 'POST' && request.url === '/api/milestones') { const { wishlist = '', proposal } = await body(request); if (!String(wishlist).trim() || !proposal) throw new Error('Wishlist and approved proposal are required'); return json(response, 200, { milestones: await runMilestones(String(wishlist).trim(), proposal) }); }
    if (request.method === 'POST' && request.url === '/api/simulate') { const { proposal, demo_price: demoPrice } = await body(request); const validated = validateProposal(proposal, Number(proposal.amount_usd), proposal.asset_type); const quote = Number(demoPrice) > 0 ? { price: Number(demoPrice), source: 'manual-demo-price' } : validated.asset_type === 'stock' ? await stockPrice(validated.symbol) : await coinbasePrice(validated.symbol); const productId = productIdFor(validated.symbol, validated.asset_type); const preview = await coinbasePreview({ productId, assetType: validated.asset_type, action: validated.action, amountUsd: validated.amount_usd, price: quote.price }); const trade = { ...validated, id: randomUUID(), price: quote.price, quantity: validated.amount_usd / quote.price, simulated: true, createdAt: new Date().toISOString(), coinbase: { product_id: productId, price_source: quote.source, preview_status: preview.status, preview_source: preview.source } }; trades.unshift(trade); return json(response, 200, { trade, preview }); }
    if (request.method === 'GET' && request.url.startsWith('/api/wishlist/search')) { const q = new URL(request.url, 'http://localhost').searchParams.get('q')?.trim(); if (!q) throw new Error('Enter something to search for'); return json(response, 200, { results: await zincSearch(q), sandbox: ZINC_API_KEY?.startsWith('zn_test_') ?? false }); }
    if (request.method === 'GET' && request.url.startsWith('/api/quote')) { const symbol = (new URL(request.url, 'http://localhost').searchParams.get('symbol') || '').trim().toUpperCase(); if (!symbol) throw new Error('Symbol is required'); const quote = symbol.includes('-') ? await coinbasePrice(symbol) : await stockPrice(symbol); return json(response, 200, { symbol, price: quote.price, source: quote.source }); }
    if (request.method === 'GET' && request.url === '/api/portfolio') return json(response, 200, await portfolio());
    if (request.method === 'POST' && request.url === '/api/simulate') { const { proposal, demo_price: demoPrice } = await body(request); const validated = validateProposal(proposal, Number(proposal.amount_usd), proposal.asset_type); const quote = Number(demoPrice) > 0 ? { price: Number(demoPrice), source: 'manual-demo-price' } : validated.asset_type === 'stock' ? await stockPrice(validated.symbol) : await coinbasePrice(validated.symbol); const productId = productIdFor(validated.symbol, validated.asset_type); const preview = await coinbasePreview({ productId, assetType: validated.asset_type, action: validated.action, amountUsd: validated.amount_usd, price: quote.price }); const trade = { ...validated, id: randomUUID(), price: quote.price, quantity: validated.amount_usd / quote.price, simulated: true, createdAt: new Date().toISOString(), coinbase: { product_id: productId, price_source: quote.source, preview_status: preview.status, preview_source: preview.source } }; trades.unshift(trade); return json(response, 200, { trade, preview }); }
    return json(response, 404, { error: 'Not found' });
  } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : 'Unknown error' }); }
});

server.listen(PORT, () => { console.log(`StockUp API listening on http://localhost:${PORT}`); void startOrderWorker(); });
