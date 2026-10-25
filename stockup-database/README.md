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

## Connect the real CREAO agents

Create a CREAO API key in CREAO, then add it to `.env`:

```bash
CREAO_API_KEY=your_key_here
CREAO_APP_ID=1dba2b6d-dcfd-4e4d-84fd-a431a7ad8e1b
CREAO_AGRI_AGENT_ID=d8cf6a89-b74e-40a1-9bc6-6595e291a8dc
CREAO_AGRI_AGENT_VERSION=44ffa454-a206-4a3a-9434-6c91c645b804
CREAO_ARTIST_AGENT_ID=cd6605d4-2f11-4fad-9ae9-06b34fd10c2c
CREAO_ARTIST_AGENT_VERSION=5b78873c-617e-4949-aed3-bfb45fd504f7
CREAO_REALIST_AGENT_ID=8b1813ab-1099-43f6-a64d-3b3ff7eddd44
CREAO_REALIST_AGENT_VERSION=030a3507-4c30-4394-b331-0eb3bd43852e
CREAO_MILESTONE_AGENT_ID=59fbfe03-06dc-4add-b42d-c2c6ec377a1b
CREAO_MILESTONE_AGENT_VERSION=a005d2f9-5809-4354-b7ff-355502c4ec28
```

Restart `npm run api`. The dashboard will change from `CREAO demo mode` to `CREAO API connected`. Selecting a trader and clicking **Generate strategy** runs the corresponding CREAO agent. After approving the picks, enter a wishlist to receive suggested earning milestones from the milestone agent; you can edit and accept them before simulating the paper trade.

## How to verify the integration

1. Confirm `/api/health` reports `coinbase: agent-cli-when-configured`.
2. Click **Generate strategy** and confirm a proposal appears.
3. Click **Simulate this trade** and confirm the paper ledger shows a Coinbase product ID, price source, and preview status.
4. Confirm the footer and ledger say that no live order was sent.
5. With a real CREAO key, confirm the CREAO run appears in the CREAO dashboard and the UI says `CREAO API connected`.

The server intentionally keeps trades in memory for this first vertical slice. SpacetimeDB can become the durable ledger after the external API flow is proven.
