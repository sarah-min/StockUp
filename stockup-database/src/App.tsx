import { useEffect, useState } from "react";
import "./App.css";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import { reducers, tables } from "./module_bindings";
import Wishlist from "./Wishlist";

type AssetType = "crypto" | "stock";
type Proposal = {
  symbol: string;
  asset_type: AssetType;
  action: "buy" | "sell";
  amount_usd: number;
  confidence: number;
  rationale: string;
  risk: "low" | "medium" | "high";
  source: "creao" | "demo";
};
type Trade = Proposal & {
  id: string;
  price: number;
  quantity: number;
  simulated: true;
  createdAt: string;
  coinbase?: {
    product_id: string;
    price_source: string;
    preview_status: string;
    preview_source: string;
  };
};
type Health = {
  ok: boolean;
  creaoConfigured: boolean;
  creaoError?: string | null;
  mode: string;
  coinbase?: string;
  coinbaseAgentMode?: string;
  stockQuotes?: string;
};
type AgentSettings = {
  allocation: number;
  personality: string;
};
const MIN_AGENT_ALLOCATION = 1; // dollars every agent must get
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function App() {
  const [budget, setBudget] = useState(100);
  const [agentNum, setAgentNum] = useState(1);
  const [assetType, setAssetType] = useState<AssetType>("crypto");
  const [health, setHealth] = useState<Health | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [trade, setTrade] = useState<Trade | null>(null);
  const [dbTrades] = useTable(tables.trade);
  const [loading, setLoading] = useState(false);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [error, setError] = useState("");
  const [agentSettings, setAgentSettings] = useState<AgentSettings[]>([
    {
      allocation: MIN_AGENT_ALLOCATION,
      personality: "personality-1",
    },
  ]);
  const createAgent = useReducer(reducers.createAgent);
  const executeTrade = useReducer(reducers.executeTrade);
  const [agents] = useTable(tables.agent);
  const [selectedAgentId, setSelectedAgentId] = useState<bigint | null>(null);
  const [agentsCreated, setAgentsCreated] = useState(false);
  const createUser = useReducer(reducers.createUser); // use your actual reducer name
  const { identity, isActive } = useSpacetimeDB();

  // dummy user for testing: every browser identity needs its own user before it can create agents.
  // (The user table is public and shared, so "no users exist" is not the same as "this identity has no user".)
  // user_auth is private, so remember per identity that we already tried, and treat "already has a user" as success.
  useEffect(() => {
    if (!isActive || !identity) return;
    const flag = `stockup.userCreated.${identity.toHexString()}`;
    try {
      if (localStorage.getItem(flag)) return;
    } catch {
      /* storage unavailable: just try */
    }
    createUser({
      name: "Test User",
      startingBalanceCents: 100000n,
      // coinbaseAccountId is unique across users, so a shared "fake_id" makes every user after the first fail.
      coinbaseAccountId: `fake_${identity.toHexString().slice(0, 16)}`,
    })
      .then(() => true)
      .catch((err: unknown) => /already has a user/i.test(String(err)))
      .then((done) => {
        if (!done) return;
        try {
          localStorage.setItem(flag, "1");
        } catch {
          /* storage unavailable */
        }
      });
  }, [isActive, identity]);

  async function saveAgents() {
    if (!allocationsValid) {
      setError(allocationError);
      return;
    }

    for (const [index, agent] of agentAllocations.entries()) {
      await createAgent({
        name: `Agent ${index + 1}`,
        apiEndpoint: `/api/agents/${index + 1}`,
        personality: agent.personality,
        initialBalanceCents: BigInt(Math.round(agent.allocation * 100)),
      });
    }

    setAgentsCreated(true);
  }

  useEffect(() => {
    request<Health>("/api/health")
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const generateProposal = async () => {
    setLoading(true);
    setError("");
    setTrade(null);

    try {
      if (!allocationsValid) {
        throw new Error(allocationError);
      }

      if (!agentsCreated) {
        await saveAgents();
      }

      const result = await request<{ proposal: Proposal }>("/api/proposal", {
        method: "POST",
        body: JSON.stringify({
          budget,
          assetType,
          agents: agentAllocations.map((agent, index) => ({
            name: `Agent ${index + 1}`,
            allocation: agent.allocation,
            personality: agent.personality,
          })),
        }),
      });

      setProposal(result.proposal);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not generate proposal",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAgentSettings((current) =>
      Array.from(
        { length: agentNum },
        (_, index) =>
          current[index] ?? {
            allocation: MIN_AGENT_ALLOCATION,
            personality: "personality-1",
          },
      ),
    );
  }, [agentNum]);

  // The last agent always gets whatever the other agents leave over, so allocations always add up to the budget.
  // It goes negative (and is flagged as an error) if the other agents already exceed the budget.
  const lastAgentIndex = agentSettings.length - 1;
  const otherAllocations = agentSettings
    .slice(0, lastAgentIndex)
    .reduce((total, agent) => total + agent.allocation, 0);
  const remainingBudget = budget - otherAllocations;
  const agentAllocations = agentSettings.map((agent, index) =>
    index === lastAgentIndex
      ? { ...agent, allocation: remainingBudget }
      : agent,
  );
  const allocationError =
    remainingBudget < MIN_AGENT_ALLOCATION
      ? remainingBudget < 0
        ? "Agent allocations exceed your budget"
        : `The last agent only gets $${remainingBudget.toFixed(2)}; every agent needs at least $${MIN_AGENT_ALLOCATION}`
      : `Every agent needs at least $${MIN_AGENT_ALLOCATION}`;
  const allocationsValid = agentAllocations.every(
    (agent) => agent.allocation >= MIN_AGENT_ALLOCATION,
  );

  function updateAgentAllocation(index: number, allocation: number) {
    setAgentsCreated(false);

    setAgentSettings((current) =>
      current.map((agent, currentIndex) =>
        currentIndex === index
          ? { ...agent, allocation: Math.max(0, allocation) }
          : agent,
      ),
    );
  }

  function updateAgentPersonality(index: number, personality: string) {
    setAgentsCreated(false);

    setAgentSettings((current) =>
      current.map((agent, currentIndex) =>
        currentIndex === index ? { ...agent, personality } : agent,
      ),
    );
  }

  const simulateTrade = async () => {
    if (!proposal || selectedAgentId === null) {
      setError("Select an agent first");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // External API obtains the quote/preview.
      const result = await request<{ trade: Trade }>("/api/simulate", {
        method: "POST",
        body: JSON.stringify({ proposal }),
      });

      // SpacetimeDB records the trade and updates balances/positions.
      await executeTrade({
        agentId: selectedAgentId,
        side: result.trade.action,
        symbol: result.trade.symbol,
        quantity: BigInt(Math.floor(result.trade.quantity)),
        priceCents: BigInt(Math.round(result.trade.price * 100)),
      });

      setTrade(result.trade);

      // No setTrades call is needed. The trade-table subscription updates.
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not simulate trade",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">↗</span> StockUp
        </div>
        <button className="wish-open" onClick={() => setWishlistOpen(true)}>
          ♡ Wishlist
        </button>
        <div className="mode-pill">
          <span className="dot" /> SIMULATION MODE
        </div>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">CREAO × COINBASE FOR AGENTS</p>
          <h1>
            Let an agent make the pitch.
            <br />
            <em>You make the call.</em>
          </h1>
          <p className="hero-copy">
            CREAO generates a strategy. Coinbase checks the product and market
            when the agent CLI is connected, then StockUp previews and records
            the trade without sending a live order.
          </p>
        </div>
        <div className="hero-badge">
          ✦
          <span>
            Agent
            <br />
            trade preview
          </span>
        </div>
      </section>
      <section className="workspace">
        <div className="card setup-card">
          <div className="card-label">01 / SET YOUR PLAY</div>
          <label>Asset class</label>
          <div className="asset-toggle" role="group" aria-label="Asset class">
            <button
              className={assetType === "crypto" ? "selected" : ""}
              onClick={() => {
                setAssetType("crypto");
                setProposal(null);
              }}
            >
              Crypto
            </button>
            <button
              className={assetType === "stock" ? "selected" : ""}
              onClick={() => {
                setAssetType("stock");
                setProposal(null);
              }}
            >
              Stocks
            </button>
          </div>
          <label htmlFor="budget">Paper budget</label>
          <div className="budget-input">
            <span>$</span>
            <input
              id="budget"
              type="number"
              min="5"
              max="10000"
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
            />
          </div>
          <label htmlFor="agent_num">Number of Agents</label>
          <div className="budget-input">
            <span></span>
            <input
              id="agent_num"
              type="number"
              min="1"
              max="10"
              value={agentNum}
              onChange={(event) => setAgentNum(Number(event.target.value))}
            />
          </div>

          <div className="agent-allocations">
            <h3>Configure your agents</h3>

            <div className="agent-allocation-grid">
              {agentAllocations.map((agent, index) => (
                <div className="agent-allocation-card" key={index}>
                  <label htmlFor={`agent-${index}-allocation`}>
                    Agent {index + 1}
                    {index === lastAgentIndex && agentAllocations.length > 1
                      ? " (rest)"
                      : ""}
                  </label>

                  <div className="agent-allocation-input">
                    <span>$</span>

                    <input
                      id={`agent-${index}-allocation`}
                      type="number"
                      min="0"
                      max={budget}
                      step="1"
                      readOnly={
                        index === lastAgentIndex && agentAllocations.length > 1
                      }
                      value={agent.allocation === 0 ? "" : agent.allocation}
                      onChange={(event) =>
                        updateAgentAllocation(index, Number(event.target.value))
                      }
                    />
                  </div>

                  <label
                    className="personality-label"
                    htmlFor={`agent-${index}-personality`}
                  >
                    Investment Type
                  </label>

                  <select
                    id={`agent-${index}-personality`}
                    className="personality-select"
                    value={agent.personality}
                    onChange={(event) =>
                      updateAgentPersonality(index, event.target.value)
                    }
                  >
                    <option value="personality-1">Personality 1</option>
                    <option value="personality-2">Personality 2</option>
                    <option value="personality-3">Personality 3</option>
                  </select>
                </div>
              ))}
            </div>

            {!allocationsValid && (
              <p className="budget-error">{allocationError}</p>
            )}
          </div>

          <p className="helper">
            The agent will propose a{" "}
            {assetType === "crypto"
              ? "Coinbase-supported crypto asset"
              : "Coinbase-eligible US equity"}{" "}
            and never exceed this amount.
          </p>
          <button
            className="primary"
            onClick={generateProposal}
            disabled={loading || budget <= 0 || !allocationsValid}
          >
            {loading ? "Running CREAO…" : "Generate strategy →"}
          </button>
          <div className="integration-status">
            <span
              className={
                health?.creaoConfigured ? "status-dot good" : "status-dot"
              }
            />{" "}
            {health?.creaoConfigured
              ? "CREAO API connected"
              : health?.creaoError
                ? "CREAO key needs attention"
                : "CREAO demo mode"}
            <span className="status-separator">·</span>
            <span className="status-dot good" /> Coinbase{" "}
            {health?.coinbaseAgentMode === "auto"
              ? "agent path enabled"
              : "public market mode"}
          </div>
        </div>
        <div className="card proposal-card">
          <div className="card-label">02 / AGENT PROPOSAL</div>
          {!proposal ? (
            <div className="empty-state">
              <div className="empty-icon">◎</div>
              <p>Your agent’s next move will appear here.</p>
              <span>Click “Generate strategy” to start.</span>
            </div>
          ) : (
            <>
              <div className="proposal-heading">
                <div>
                  <span className="asset-symbol">{proposal.symbol}</span>
                  <span className="asset-type">
                    {proposal.asset_type === "crypto"
                      ? "CRYPTO / SPOT"
                      : "US EQUITY / STOCK"}
                  </span>
                </div>
                <span className={`risk risk-${proposal.risk}`}>
                  {proposal.risk} risk
                </span>
              </div>
              <div className="proposal-number">
                {proposal.action.toUpperCase()}{" "}
                <strong>{money.format(proposal.amount_usd)}</strong>
              </div>
              <div className="confidence">
                <span>Confidence</span>
                <div className="confidence-bar">
                  <i style={{ width: `${proposal.confidence * 100}%` }} />
                </div>
                <strong>{Math.round(proposal.confidence * 100)}%</strong>
              </div>
              <p className="rationale">“{proposal.rationale}”</p>
              <button
                className="secondary"
                onClick={simulateTrade}
                disabled={loading}
              >
                {loading
                  ? `Getting ${proposal.asset_type === "crypto" ? "Coinbase" : "stock"} price…`
                  : "Simulate this trade →"}
              </button>
            </>
          )}
        </div>
        <div className="card result-card">
          <div className="card-label">03 / PAPER LEDGER</div>
          {!trade ? (
            <div className="empty-state">
              <div className="empty-icon">◌</div>
              <p>No position yet.</p>
              <span>Nothing touches your Coinbase account.</span>
            </div>
          ) : (
            <>
              <div className="fill-banner">
                <span className="status-dot good" /> Simulated fill recorded
              </div>
              <div className="trade-grid">
                <div>
                  <span>Asset</span>
                  <strong>{trade.symbol}</strong>
                </div>
                <div>
                  <span>Fill price</span>
                  <strong>{money.format(trade.price)}</strong>
                </div>
                <div>
                  <span>Quantity</span>
                  <strong>{trade.quantity.toFixed(6)}</strong>
                </div>
                <div>
                  <span>Amount</span>
                  <strong>{money.format(trade.amount_usd)}</strong>
                </div>
              </div>
              <div className="safe-note">
                ✓ Coinbase product: {trade.coinbase?.product_id || trade.symbol}
                <br />✓ Price source:{" "}
                {trade.coinbase?.price_source || "paper quote"}
                <br />✓ Preview:{" "}
                {trade.coinbase?.preview_status || "paper-only"}
                <br />✓ No order was sent to Coinbase
                <br />✓ No money moved
              </div>
            </>
          )}
        </div>
      </section>
      {error && <div className="error">{error}</div>}
      <section className="history card">
        <div className="card-label">RECENT PAPER TRADES</div>
        {dbTrades.length === 0 ? (
          <p className="history-empty">
            Your simulated trades will show up here.
          </p>
        ) : (
          [...dbTrades]
            .sort(
              (a, b) =>
                Number(b.executedAt.microsSinceUnixEpoch) -
                Number(a.executedAt.microsSinceUnixEpoch),
            )
            .map((item) => (
              <div className="history-row" key={item.id.toString()}>
                <strong>{item.symbol}</strong>

                <span>
                  {item.side.toUpperCase()}{" "}
                  {money.format(Number(item.totalCents) / 100)}
                </span>

                <span>@ {money.format(Number(item.priceCents) / 100)}</span>

                <span>{item.quantity.toString()} shares</span>
              </div>
            ))
        )}
      </section>
      {wishlistOpen && <Wishlist onClose={() => setWishlistOpen(false)} />}
      <footer>
        StockUp is a simulation. Not investment advice. No live orders are
        enabled.
      </footer>
    </main>
  );
}

export default App;
