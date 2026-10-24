import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const PORT = Number(process.env.PORT || 8787);
const CREAO_API_KEY = process.env.CREAO_API_KEY;
const CREAO_APP_ID = process.env.CREAO_APP_ID || '1dba2b6d-dcfd-4e4d-84fd-a431a7ad8e1b';
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
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('CREAO did not return a JSON proposal');
  return JSON.parse(match[0]);
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
  const proposal = { symbol, asset_type: normalizedAssetType, action, amount_usd, confidence, rationale: `${String(value.rationale || value.reason || '')}${fallbackNote}${fallbackFields}`, risk };
  if (normalizedAssetType === 'crypto' && !/^[A-Z0-9]+-[A-Z0-9]+$/.test(proposal.symbol)) throw new Error('Invalid crypto symbol');
  if (normalizedAssetType === 'stock' && !/^[A-Z]{1,5}$/.test(proposal.symbol)) throw new Error('Invalid stock ticker');
  if (!['buy', 'sell'].includes(proposal.action)) throw new Error('Action must be buy or sell');
  if (!Number.isFinite(proposal.amount_usd) || proposal.amount_usd <= 0 || proposal.amount_usd > budget) throw new Error('Proposal amount exceeds the paper budget');
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) throw new Error('Confidence must be between 0 and 1');
  if (!['low', 'medium', 'high'].includes(proposal.risk)) throw new Error('Risk must be low, medium, or high');
  return proposal;
}

async function runCreao(budget) {
  return runCreaoForAsset(budget, 'crypto');
}

async function runCreaoForAsset(budget, assetType) {
  if (!CREAO_API_KEY) return { ...validateProposal({ symbol: assetType === 'stock' ? 'AAPL' : 'BTC-USD', action: 'buy', amount_usd: Math.min(25, budget), confidence: 0.62, rationale: 'Demo proposal: add CREAO_API_KEY to run the real strategy agent.', risk: 'high' }, budget, assetType), source: 'demo' };
  const prompt = assetType === 'stock'
    ? `Return exactly one JSON object for a paper stock trade. Use only US stock tickers such as AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, NFLX, AMD, or IBM. Never use crypto. Budget: $${budget}. Required fields: symbol, action, amount_usd, confidence, rationale, risk. Do not place an order or use real money.`
    : `Return exactly one JSON object for a paper crypto trade. Use only Coinbase-supported crypto pairs such as BTC-USD, ETH-USD, SOL-USD, DOGE-USD, or XRP-USD. Never use stocks. Budget: $${budget}. Required fields: symbol, action, amount_usd, confidence, rationale, risk. Do not place an order or use real money.`;
  const startUrl = CREAO_IS_APP_KEY ? `https://agent.creao.ai/api/v1/apps/${encodeURIComponent(CREAO_APP_ID)}/runs` : CREAO_RUNS_URL;
  const startBody = CREAO_IS_APP_KEY ? { inputs: { prompt } } : { agent_id: CREAO_APP_ID, input: { prompt } };
  const start = await fetch(startUrl, { method: 'POST', headers: { Authorization: `Bearer ${CREAO_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(startBody) });
  if (!start.ok) {
    const detail = await start.json().catch(() => ({}));
    throw new Error(detail.message || detail.error || `CREAO start failed (${start.status})`);
  }
  const run = await start.json();
  const runId = run.run_id || run.id;
  if (!runId) throw new Error('CREAO did not return a run id');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const pollUrl = CREAO_IS_APP_KEY ? `${CREAO_RUNS_URL}/${runId}` : `${CREAO_RUNS_URL}/${runId}`;
    const response = await fetch(pollUrl, { headers: { Authorization: `Bearer ${CREAO_API_KEY}` } });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }
    if (!response.ok) throw new Error(`CREAO polling failed (${response.status})`);
    const result = await response.json();
    if (result.status === 'failed' || result.status === 'cancelled') throw new Error(`CREAO run ${result.status}`);
    if (result.status === 'completed') {
      const output = typeof result.result === 'string' ? result.result : result.result?.text || result.result?.chatText || JSON.stringify(result.result || '');
      return { ...validateProposal(extractJson(output), budget, assetType), source: 'creao' };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('CREAO run timed out');
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
    if (assetType === 'stock') return { status: 'unavailable', source: 'coinbase-agent-cli', message: error.message };
    throw error;
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
const purchasedKeys = new Set();

async function zincFetch(path, options = {}) {
  if (!ZINC_API_KEY) throw new Error('ZINC_API_KEY is not set');
  const response = await fetch(`https://api.zinc.com${path}`, { ...options, headers: { Authorization: `Bearer ${ZINC_API_KEY}`, 'Content-Type': 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Zinc request failed (${response.status})`);
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

async function zincPurchase(item) {
  const priceCents = Number(item?.price_cents);
  if (!/^https:\/\//.test(String(item?.url)) || !Number.isInteger(priceCents) || priceCents <= 0) throw new Error('Invalid wishlist item');
  const key = String(item.id ?? item.url);
  if (purchasedKeys.has(key)) throw new Error('This item was already purchased');
  purchasedKeys.add(key);
  try {
    // Headroom over the listed price: tax and shipping are added at checkout.
    const created = await zincFetch('/orders', { method: 'POST', body: JSON.stringify({ products: [{ url: item.url, quantity: 1 }], shipping_address: ZINC_SHIPPING_ADDRESS, max_price: Math.round(priceCents * 2) }) });
    const deadline = Date.now() + 20_000;
    let order = created;
    while (Date.now() < deadline && !['order_placed', 'order_failed'].includes(order.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      order = await zincFetch(`/orders/${created.id}`);
    }
    if (order.status === 'order_failed') throw new Error(order.job_result?.error || 'Zinc could not place the order');
    return orderSummary(order);
  } catch (error) {
    purchasedKeys.delete(key);
    throw error;
  }
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
    if (request.method === 'POST' && request.url === '/api/proposal') { const { budget = 100, assetType = 'crypto' } = await body(request); return json(response, 200, { proposal: await runCreaoForAsset(Number(budget), assetType) }); }
    if (request.method === 'POST' && request.url === '/api/simulate') { const { proposal, demo_price: demoPrice } = await body(request); const validated = validateProposal(proposal, Number(proposal.amount_usd), proposal.asset_type); const quote = Number(demoPrice) > 0 ? { price: Number(demoPrice), source: 'manual-demo-price' } : validated.asset_type === 'stock' ? await stockPrice(validated.symbol) : await coinbasePrice(validated.symbol); const productId = productIdFor(validated.symbol, validated.asset_type); const preview = await coinbasePreview({ productId, assetType: validated.asset_type, action: validated.action, amountUsd: validated.amount_usd, price: quote.price }); const trade = { ...validated, id: randomUUID(), price: quote.price, quantity: validated.amount_usd / quote.price, simulated: true, createdAt: new Date().toISOString(), coinbase: { product_id: productId, price_source: quote.source, preview_status: preview.status, preview_source: preview.source } }; trades.unshift(trade); return json(response, 200, { trade, preview }); }
    if (request.method === 'GET' && request.url.startsWith('/api/wishlist/search')) { const q = new URL(request.url, 'http://localhost').searchParams.get('q')?.trim(); if (!q) throw new Error('Enter something to search for'); return json(response, 200, { results: await zincSearch(q), sandbox: ZINC_API_KEY?.startsWith('zn_test_') ?? false }); }
    if (request.method === 'GET' && request.url === '/api/portfolio') return json(response, 200, await portfolio());
    if (request.method === 'POST' && request.url === '/api/wishlist/purchase') { const { item } = await body(request); return json(response, 200, { order: await zincPurchase(item) }); }
    if (request.method === 'GET' && request.url.startsWith('/api/wishlist/order/')) return json(response, 200, { order: orderSummary(await zincFetch(`/orders/${encodeURIComponent(request.url.split('/').pop())}`)) });
    return json(response, 404, { error: 'Not found' });
  } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : 'Unknown error' }); }
});

server.listen(PORT, () => console.log(`StockUp API listening on http://localhost:${PORT}`));
