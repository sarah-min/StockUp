import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('StockUp paper-trading flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.endsWith('/api/health')) return new Response(JSON.stringify({ ok: true, mode: 'paper', creaoConfigured: false }));
      if (url.endsWith('/api/trades')) return new Response(JSON.stringify({ trades: [] }));
      if (url.endsWith('/api/proposal')) return new Response(JSON.stringify({ proposal: { symbol: 'BTC-USD', asset_type: 'crypto', action: 'buy', amount_usd: 25, confidence: 0.62, rationale: 'Test proposal', risk: 'high', source: 'demo' } }));
      if (url.endsWith('/api/simulate')) return new Response(JSON.stringify({ trade: { symbol: 'BTC-USD', asset_type: 'crypto', action: 'buy', amount_usd: 25, confidence: 0.62, rationale: 'Test proposal', risk: 'high', source: 'demo', id: '1', price: 80000, quantity: 0.0003125, simulated: true, createdAt: new Date().toISOString(), coinbase: { product_id: 'BTC-USD', price_source: 'coinbase-public-market-api', preview_status: 'paper-only', preview_source: 'local-simulation' } } }));
      return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), { status: 404 });
    });
  });

  it('generates a proposal and records a simulated Coinbase-priced fill', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /generate strategy/i }));
    expect(await screen.findByText('BTC-USD')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /simulate this trade/i }));
    await waitFor(() => expect(screen.getByText(/simulated fill recorded/i)).toBeInTheDocument());
    expect(screen.getByText('$80,000.00')).toBeInTheDocument();
    expect(screen.getByText(/no order was sent/i)).toBeInTheDocument();
  });
});
