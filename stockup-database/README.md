# StockUp

StockUp is a CREAO-powered crypto and equity paper-trading game. CREAO proposes a trade, Coinbase for Agents can validate the product and preview the order, and StockUp records a simulated fill. Live orders are intentionally disabled.

## Run locally

```bash
npm install
cp .env.example .env
npm run api
```

In a second terminal:

```bash
cd stockup-database
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`). Without `CREAO_API_KEY`, the app uses a visible demo proposal. Without the Coinbase CLI, it uses Coinbase public market endpoints where available and clearly labels the fallback quote path.

## Coinbase for Agents integration

The app supports the official Coinbase for Agents CLI as an optional paper-trading adapter. Install and authenticate it using Coinbase's setup guide:

```bash
npm install -g @coinbase/coinbase-cli
coinbase env live --key-file ./coinbase_api_key.json
coinbase balance
```

Keep the key file outside the repository. With `COINBASE_AGENT_MODE=auto`, StockUp calls Coinbase's `products get` and `orders preview` commands for supported crypto and equity products, then records the result locally without calling `orders create`. If the CLI is not installed, the app remains usable and reports the fallback source in the paper ledger.

## Connect the real CREAO agent

Create a CREAO API key in CREAO, then add it to `.env`:

```bash
CREAO_API_KEY=your_key_here
CREAO_APP_ID=1dba2b6d-dcfd-4e4d-84fd-a431a7ad8e1b
```

Restart `npm run api`. The dashboard will change from `CREAO demo mode` to `CREAO API connected`. Clicking **Generate strategy** will start the agent, poll its run, parse its JSON, and validate it before showing it.

## How to verify the integration

1. Confirm `/api/health` reports `coinbase: agent-cli-when-configured`.
2. Click **Generate strategy** and confirm a proposal appears.
3. Click **Simulate this trade** and confirm the paper ledger shows a Coinbase product ID, price source, and preview status.
4. Confirm the footer and ledger say that no live order was sent.
5. With a real CREAO key, confirm the CREAO run appears in the CREAO dashboard and the UI says `CREAO API connected`.

The server intentionally keeps trades in memory for this first vertical slice. SpacetimeDB can become the durable ledger after the external API flow is proven.
