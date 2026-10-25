import { useEffect, useState } from "react";
import "./App.css";
import { useReducer, useTable } from "spacetimedb/react";
import { reducers, tables } from "./module_bindings";
import Wishlist from "./Wishlist";
import Purchases from "./Purchases";
import ThemeToggle from "./ThemeToggle";
import type { Account } from "./AuthGate";
import { useMyUserId } from "./useMyUserId";

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
const QUANTITY_SCALE = 1_000_000;
const MAX_AGENTS = 10;
const BUDGET_PRESETS = [50, 100, 500, 1000];
const PERSONALITIES = [
  { value: "personality-1", label: "Personality 1" },
  { value: "personality-2", label: "Personality 2" },
  { value: "personality-3", label: "Personality 3" },
];
// One stable colour per agent slot, reused by the split bar and the agent cards.
const AGENT_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#db2777",
  "#0891b2",
  "#65a30d",
  "#e11d48",
  "#4f46e5",
  "#0d9488",
];
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

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function App({ account }: { account?: Account }) {
  const [budget, setBudget] = useState(100);
  const [agentNum, setAgentNum] = useState(1);
  const [assetType, setAssetType] = useState<AssetType>("crypto");
  const [health, setHealth] = useState<Health | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [trade, setTrade] = useState<Trade | null>(null);
  const [dbTrades] = useTable(tables.trade);
  const [loading, setLoading] = useState(false);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [purchasesOpen, setPurchasesOpen] = useState(false);
  const [error, setError] = useState("");
  const [realizedProfit, setRealizedProfit] = useState<number | null>(null);
  const [agentSettings, setAgentSettings] = useState<AgentSettings[]>([
    {
      allocation: MIN_AGENT_ALLOCATION,
      personality: "personality-1",
    },
  ]);
  const createAgent = useReducer(reducers.createAgent);
  const executeTrade = useReducer(reducers.executeTrade);
  const [agents] = useTable(tables.agent);
  const myUserId = useMyUserId();
  const [selectedAgentId, setSelectedAgentId] = useState<bigint | null>(null);
  const [agentsCreated, setAgentsCreated] = useState(false);

  async function saveAgents() {
    if (!allocationsValid) {
      setError(allocationError);
      return;
    }

    // Agent rows persist in SpacetimeDB, while this React state resets on a
    // page reload. Reuse this user's rows instead of inserting duplicates.
    const ownedAgents =
      myUserId === undefined
        ? []
        : agents
            .filter((agent) => agent.userId === myUserId)
            .sort((left, right) => (left.id < right.id ? -1 : 1));

    if (ownedAgents.length >= agentAllocations.length) {
      setAgentsCreated(true);
      if (selectedAgentId === null && ownedAgents[0]) {
        setSelectedAgentId(ownedAgents[0].id);
      }
      return;
    }

    const userScope = myUserId?.toString() ?? account?.username ?? "session";
    for (
      let index = ownedAgents.length;
      index < agentAllocations.length;
      index += 1
    ) {
      const agent = agentAllocations[index];
      if (!agent) continue;
      await createAgent({
        name: `Agent ${index + 1}`,
        // apiEndpoint is globally unique in the SpacetimeDB schema. Scope it
        // by user so two teammates/accounts can both have an Agent 1.
        apiEndpoint: `/api/agents/${userScope}/${index + 1}`,
        personality: agent.personality,
        initialBalanceCents: BigInt(Math.round(agent.allocation * 100)),
      });
    }

    setAgentsCreated(true);
  }

  // The subscription update after createAgent gives us the real database ID.
  // Select the first owned agent so the next “Place this trade” action knows
  // which ledger account should receive the simulated trade.
  useEffect(() => {
    if (myUserId === undefined) return;
    const ownedAgents = agents
      .filter((agent) => agent.userId === myUserId)
      .sort((left, right) => (left.id < right.id ? -1 : 1));
    if (ownedAgents.length >= agentNum) setAgentsCreated(true);
    if (selectedAgentId === null && ownedAgents[0]) {
      setSelectedAgentId(ownedAgents[0].id);
    }
  }, [agentNum, agents, myUserId, selectedAgentId]);

  useEffect(() => {
    request<Health>("/api/health")
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  // Scoreboard: realized paper profit, refreshed in the background.
  useEffect(() => {
    const load = () =>
      request<{ realized_profit: number }>("/api/portfolio")
        .then((result) => setRealizedProfit(result.realized_profit))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
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

  function changeAgentCount(next: number) {
    setAgentsCreated(false);
    setAgentNum(Math.min(MAX_AGENTS, Math.max(1, next)));
  }

  function changeBudget(next: number) {
    setAgentsCreated(false);
    setBudget(Number.isFinite(next) ? next : 0);
  }

  function chooseAsset(next: AssetType) {
    setAssetType(next);
    setProposal(null);
    setTrade(null);
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
        // The ledger stores millionths so crypto and fractional shares do not
        // get rounded down to zero (e.g. $10 of BTC).
        quantity: BigInt(
          Math.max(1, Math.round(result.trade.quantity * QUANTITY_SCALE)),
        ),
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

  const step = trade ? 3 : proposal ? 2 : 1;
  const steps = ["Set your play", "Agent pitch", "Ledger"];
  const sortedTrades = [...dbTrades].sort(
    (a, b) =>
      Number(b.executedAt.microsSinceUnixEpoch) -
      Number(a.executedAt.microsSinceUnixEpoch),
  );
  const sliderMax = Math.max(1000, budget);
  const confidencePct = proposal ? Math.round(proposal.confidence * 100) : 0;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                d="M4 17l5-5 4 4 7-8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          StockUp
        </div>
        <span className="mode-pill">
          <span className="live-dot" /> Live
        </span>
        <div className="topbar-actions">
          <button
            className="ghost-button"
            onClick={() => setWishlistOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
            Wishlist
          </button>
          <button
            className="ghost-button"
            onClick={() => setPurchasesOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M4 11h16v9H4zM3 7.5h18V11H3zM12 7.5V20M12 7.5C10 7.5 8 6.8 8 5.4 8 4.3 9 3.8 10 4.2c1.200.5 2 1.800 2 3.300zm0 0c2 0 4-.7 4-2.100 0-1.100-1-1.600-2-1.200-1.200.5-2 1.800-2 3.300z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>{" "}
            Purchases
          </button>
          <ThemeToggle />
          {account && (
            <span className="account-chip">
              <span className="account-avatar" aria-hidden="true">
                {account.username.slice(0, 1)}
              </span>
              {account.username}
              <button onClick={account.onLogout}>Log out</button>
            </span>
          )}
        </div>
      </header>

      <section className="intro">
        <div>
          <h1>
            Let an agent make the pitch. <span>You make the call.</span>
          </h1>
          <p className="intro-copy">
            Set a budget, deploy your agents and review their trade.
          </p>
        </div>
        <dl className="scoreboard">
          <div>
            <dt>Realized P/L</dt>
            <dd
              className={
                realizedProfit === null
                  ? ""
                  : realizedProfit >= 0
                    ? "positive"
                    : "negative"
              }
            >
              {realizedProfit === null ? "—" : money.format(realizedProfit)}
            </dd>
          </div>
          <div>
            <dt>Trades</dt>
            <dd>{dbTrades.length}</dd>
          </div>
          <div>
            <dt>Agents live</dt>
            <dd>{agents.length}</dd>
          </div>
        </dl>
      </section>

      <ol className="stepper" aria-label="Progress">
        {steps.map((label, index) => {
          const number = index + 1;
          const state =
            number < step ? "done" : number === step ? "active" : "upcoming";
          return (
            <li
              key={label}
              className={`step step-${state}`}
              aria-current={state === "active" ? "step" : undefined}
            >
              <span className="step-index">
                {state === "done" ? (
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  number
                )}
              </span>
              <span className="step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      <section className="workspace">
        <div className={`card setup-card ${step === 1 ? "is-active" : ""}`}>
          <div className="card-head">
            <span className="card-kicker">Step 1</span>
            <h2>Set your play</h2>
          </div>

          <div className="field">
            <span className="field-label" id="asset-label">
              Market
            </span>
            <div
              className="segmented"
              role="group"
              aria-labelledby="asset-label"
            >
              <button
                className={assetType === "crypto" ? "selected" : ""}
                aria-pressed={assetType === "crypto"}
                onClick={() => chooseAsset("crypto")}
              >
                Crypto
              </button>
              <button
                className={assetType === "stock" ? "selected" : ""}
                aria-pressed={assetType === "stock"}
                onClick={() => chooseAsset("stock")}
              >
                Stocks
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="budget">
              Budget
            </label>
            <div className="amount-input">
              <span>$</span>
              <input
                id="budget"
                type="number"
                min="5"
                max="10000"
                value={budget}
                onChange={(event) => changeBudget(Number(event.target.value))}
              />
            </div>
            <input
              className="range"
              type="range"
              min="5"
              max={sliderMax}
              step="5"
              value={budget}
              aria-label="Budget slider"
              onChange={(event) => changeBudget(Number(event.target.value))}
              style={
                {
                  "--fill": `${(Math.min(budget, sliderMax) / sliderMax) * 100}%`,
                } as React.CSSProperties
              }
            />
            <div className="chips">
              {BUDGET_PRESETS.map((preset) => (
                <button
                  key={preset}
                  className={`chip ${budget === preset ? "selected" : ""}`}
                  onClick={() => changeBudget(preset)}
                >
                  ${preset.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-row">
              <label className="field-label" htmlFor="agent_num">
                Agents
              </label>
              <div className="stepper-input">
                <button
                  aria-label="Remove an agent"
                  disabled={agentNum <= 1}
                  onClick={() => changeAgentCount(agentNum - 1)}
                >
                  −
                </button>
                <input
                  id="agent_num"
                  type="number"
                  min="1"
                  max={MAX_AGENTS}
                  value={agentNum}
                  onChange={(event) =>
                    changeAgentCount(Number(event.target.value) || 1)
                  }
                />
                <button
                  aria-label="Add an agent"
                  disabled={agentNum >= MAX_AGENTS}
                  onClick={() => changeAgentCount(agentNum + 1)}
                >
                  +
                </button>
              </div>
            </div>

            <div className="split-bar" aria-hidden="true">
              {agentAllocations.map((agent, index) => (
                <i
                  key={index}
                  style={{
                    flexGrow: Math.max(agent.allocation, 0),
                    background: AGENT_COLORS[index % AGENT_COLORS.length],
                  }}
                />
              ))}
            </div>

            <div className="agent-list">
              {agentAllocations.map((agent, index) => {
                const isRest =
                  index === lastAgentIndex && agentAllocations.length > 1;
                const color = AGENT_COLORS[index % AGENT_COLORS.length];
                const short = agent.allocation < MIN_AGENT_ALLOCATION;
                return (
                  <div
                    className={`agent-card ${short ? "is-short" : ""}`}
                    key={index}
                  >
                    <div className="agent-top">
                      <span
                        className="agent-avatar"
                        style={{ background: color }}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <label
                        className="agent-name"
                        htmlFor={`agent-${index}-allocation`}
                      >
                        Agent {index + 1}
                        {isRest && <em> · gets the rest</em>}
                      </label>
                      <div className="agent-amount">
                        <span>$</span>
                        <input
                          id={`agent-${index}-allocation`}
                          type="number"
                          min="0"
                          max={budget}
                          step="1"
                          readOnly={isRest}
                          value={agent.allocation === 0 ? "" : agent.allocation}
                          onChange={(event) =>
                            updateAgentAllocation(
                              index,
                              Number(event.target.value),
                            )
                          }
                        />
                      </div>
                    </div>
                    {!isRest && agentAllocations.length > 1 && (
                      <input
                        className="range range-sm"
                        type="range"
                        min="0"
                        max={Math.max(budget, 1)}
                        step="1"
                        value={Math.min(agent.allocation, budget)}
                        aria-label={`Agent ${index + 1} allocation slider`}
                        onChange={(event) =>
                          updateAgentAllocation(
                            index,
                            Number(event.target.value),
                          )
                        }
                        style={
                          {
                            "--fill": `${(Math.min(agent.allocation, budget) / Math.max(budget, 1)) * 100}%`,
                            "--thumb": color,
                          } as React.CSSProperties
                        }
                      />
                    )}
                    <div
                      className="personality"
                      role="radiogroup"
                      aria-label={`Agent ${index + 1} investment type`}
                    >
                      {PERSONALITIES.map((option, optionIndex) => (
                        <button
                          key={option.value}
                          role="radio"
                          aria-checked={agent.personality === option.value}
                          aria-label={option.label}
                          title={option.label}
                          className={
                            agent.personality === option.value ? "selected" : ""
                          }
                          onClick={() =>
                            updateAgentPersonality(index, option.value)
                          }
                        >
                          Type {optionIndex + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {!allocationsValid && (
              <p className="inline-error" role="alert">
                {allocationError}
              </p>
            )}
          </div>

          <p className="helper">
            Agents propose a{" "}
            {assetType === "crypto"
              ? "Coinbase-supported crypto asset"
              : "Coinbase-eligible US equity"}{" "}
            and never exceed your budget.
          </p>
          <button
            className="primary"
            onClick={generateProposal}
            disabled={loading || budget <= 0 || !allocationsValid}
          >
            {loading && !proposal ? (
              <>
                <Spinner /> Running CREAO…
              </>
            ) : (
              <>
                {proposal ? "Generate a new strategy" : "Generate strategy"} →
              </>
            )}
          </button>
          <div className="integration-status">
            <span>
              <span
                className={
                  health?.creaoConfigured ? "status-dot good" : "status-dot"
                }
              />
              {health?.creaoConfigured
                ? "CREAO connected"
                : health?.creaoError
                  ? "CREAO key needs attention"
                  : "CREAO demo mode"}
            </span>
            <span>
              <span className="status-dot good" />
              Coinbase{" "}
              {health?.coinbaseAgentMode === "auto"
                ? "agent path"
                : "public market"}
            </span>
          </div>
        </div>

        <div className={`card proposal-card ${step === 2 ? "is-active" : ""}`}>
          <div className="card-head">
            <span className="card-kicker">Step 2</span>
            <h2>Agent pitch</h2>
          </div>
          {!proposal ? (
            <div className="empty-state">
              <div className="empty-art" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p>Your agent’s next move appears here.</p>
              <span>Set your play, then generate a strategy.</span>
            </div>
          ) : (
            <div
              className="reveal"
              key={`${proposal.symbol}-${proposal.amount_usd}-${proposal.confidence}`}
            >
              <div className="proposal-heading">
                <div>
                  <span className="asset-symbol">{proposal.symbol}</span>
                  <span className="asset-type">
                    {proposal.asset_type === "crypto"
                      ? "Crypto · spot"
                      : "US equity · stock"}
                  </span>
                </div>
                <span className={`badge risk-${proposal.risk}`}>
                  {proposal.risk} risk
                </span>
              </div>
              <div className="proposal-number">
                <span className={`side side-${proposal.action}`}>
                  {proposal.action}
                </span>
                <strong>{money.format(proposal.amount_usd)}</strong>
              </div>
              <div className="confidence">
                <div className="confidence-head">
                  <span>Confidence</span>
                  <strong>{confidencePct}%</strong>
                </div>
                <div className="meter">
                  <i style={{ width: `${confidencePct}%` }} />
                </div>
              </div>
              <blockquote className="rationale">
                {proposal.rationale}
              </blockquote>
              <div className="button-row">
                <button
                  className="primary"
                  onClick={simulateTrade}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Spinner /> Getting{" "}
                      {proposal.asset_type === "crypto" ? "Coinbase" : "stock"}{" "}
                      price…
                    </>
                  ) : (
                    "Place this trade →"
                  )}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setProposal(null);
                    setTrade(null);
                    setError("");
                  }}
                  disabled={loading}
                >
                  Pass
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={`card result-card ${step === 3 ? "is-active" : ""}`}>
          <div className="card-head">
            <span className="card-kicker">Step 3</span>
            <h2>Ledger</h2>
          </div>
          {!trade ? (
            <div className="empty-state">
              <div className="empty-art empty-art-ledger" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p>No position yet.</p>
              <span>Nothing touches your Coinbase account.</span>
            </div>
          ) : (
            <div className="reveal">
              <div className="fill-banner">
                <span className="check-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                Fill recorded
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
              <ul className="safe-note">
                <li>
                  Coinbase product: {trade.coinbase?.product_id || trade.symbol}
                </li>
                <li>
                  Price source: {trade.coinbase?.price_source || "market quote"}
                </li>
                <li>Preview: {trade.coinbase?.preview_status || "preview"}</li>
              </ul>
              <button
                className="secondary full"
                onClick={() => {
                  setProposal(null);
                  setTrade(null);
                }}
              >
                Play another round
              </button>
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      <section className="card history">
        <div className="card-head row">
          <h2>Recent trades</h2>
          <span className="count">{dbTrades.length}</span>
        </div>
        {sortedTrades.length === 0 ? (
          <p className="history-empty">Your trades will show up here.</p>
        ) : (
          <div className="table">
            <div className="table-row table-head">
              <span>Asset</span>
              <span>Side</span>
              <span>Total</span>
              <span>Price</span>
              <span>Quantity</span>
            </div>
            {sortedTrades.map((item) => (
              <div className="table-row" key={item.id.toString()}>
                <strong>{item.symbol}</strong>
                <span>
                  <span className={`side side-${item.side}`}>{item.side}</span>
                </span>
                <span>{money.format(Number(item.totalCents) / 100)}</span>
                <span>@ {money.format(Number(item.priceCents) / 100)}</span>
                <span>
                  {(Number(item.quantity) / QUANTITY_SCALE).toFixed(6)} units
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      {wishlistOpen && <Wishlist onClose={() => setWishlistOpen(false)} />}
      {purchasesOpen && <Purchases onClose={() => setPurchasesOpen(false)} />}
      <footer>StockUp is not investment advice.</footer>
    </main>
  );
}

export default App;
