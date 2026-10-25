import { useEffect, useState } from "react";
import "./App.css";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import { reducers, tables } from "./module_bindings";
import Wishlist from "./Wishlist";
import Purchases from "./Purchases";
import ThemeToggle from "./ThemeToggle";
import type { Account } from "./AuthGate";

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
  recommendations?: string[];
  agent?: string;
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
// One agent's advice for this round. Agents look at their own cash and holdings, so they may buy, sell or hold.
type Advice = Omit<Proposal, "action"> & {
  action: "buy" | "sell" | "hold";
  agent_name: string;
  personality?: string;
  cash_usd?: number;
  held_quantity?: number;
  held_value?: number;
  price?: number;
  sell_all?: boolean;
};
type RoundEntry = {
  name: string;
  personality: string;
  color: string;
  status: "thinking" | "ready" | "error" | "filling" | "filled";
  approved: boolean;
  advice?: Advice;
  fill?: Trade;
  error?: string;
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
  { value: "personality-1", label: "Agrarian Trader" },
  { value: "personality-2", label: "Artist Trader" },
  { value: "personality-3", label: "Realist Trader" },
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
type Milestone = {
  name: string;
  target: string;
  rationale: string;
};
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
  const [round, setRound] = useState<RoundEntry[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [milestonesAccepted, setMilestonesAccepted] = useState(false);
  const [dbTrades] = useTable(tables.trade);
  const [simulatedTrades] = useTable(tables.simulatedTrade);
  const [wishlistItems] = useTable(tables.wishlistProduct);
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
  const { identity } = useSpacetimeDB();
  const createAgent = useReducer(reducers.createAgent);
  const executeSimulatedTrade = useReducer(reducers.executeSimulatedTrade);
  const [agents] = useTable(tables.agent);
  const [sessions] = useTable(tables.session);
  const currentSession = sessions.find(
    (session) => session.identity.toHexString() === identity?.toHexString(),
  );
  const ownedAgents = agents.filter(
    (agent) => currentSession && agent.userId === currentSession.userId,
  );
  const savedWishlist = wishlistItems.filter(
    (item) => currentSession && item.userId === currentSession.userId,
  );
  const wishlistSummary = savedWishlist
    .map(
      (item) =>
        `${item.title} (${money.format(Number(item.priceCents) / 100)})`,
    )
    .join(", ");
  const [positions] = useTable(tables.simulatedPosition);
  const [agentsCreated, setAgentsCreated] = useState(false);
  const holdingsFor = (agentId: bigint) =>
    positions
      .filter((position) => position.agentId === agentId)
      .map((position) => ({
        symbol: position.symbol,
        quantity: Number(position.quantityMicros) / QUANTITY_SCALE,
        quantityMicros: position.quantityMicros,
      }));
  const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]));
  const personalityLabel = (value?: string) =>
    PERSONALITIES.find((option) => option.value === value)?.label ?? "Trader";

  async function saveAgents() {
    if (ownedAgents.length > 0) {
      setAgentsCreated(true);
      return;
    }

    if (!allocationsValid) {
      setError(allocationError);
      return;
    }

    for (const [index, agent] of agentAllocations.entries()) {
      await createAgent({
        name: `Agent ${index + 1}`,
        apiEndpoint: `/api/agents/${identity?.toHexString()}/${index + 1}`,
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

  function patchRound(name: string, patch: Partial<RoundEntry>) {
    setRound((current) =>
      current.map((entry) =>
        entry.name === name ? { ...entry, ...patch } : entry,
      ),
    );
  }

  // Ask every agent for its own move at once; each card fills in as its agent answers.
  const generateProposal = async () => {
    setLoading(true);
    setError("");
    setMilestones([]);
    setMilestonesAccepted(false);

    try {
      const deployed = ownedAgents.length > 0;
      if (!deployed) {
        if (!allocationsValid) throw new Error(allocationError);
        await saveAgents();
      }

      const roster = deployed
        ? [...ownedAgents]
            .sort((a, b) => Number(a.id - b.id))
            .map((agent) => ({
              id: agent.id.toString(),
              name: agent.name,
              personality: agent.personality,
              cash_usd: Number(agent.balanceCents) / 100,
              holdings: holdingsFor(agent.id).map(({ symbol, quantity }) => ({
                symbol,
                quantity,
              })),
            }))
        : agentAllocations.map((agent, index) => ({
            id: null,
            name: `Agent ${index + 1}`,
            personality: agent.personality,
            cash_usd: agent.allocation,
            holdings: [],
          }));

      setRound(
        roster.map((agent, index) => ({
          name: agent.name,
          personality: agent.personality,
          color: AGENT_COLORS[index % AGENT_COLORS.length],
          status: "thinking",
          approved: false,
        })),
      );

      await Promise.all(
        roster.map(async (agent) => {
          try {
            const result = await request<{ proposal: Advice }>(
              "/api/proposal",
              {
                method: "POST",
                body: JSON.stringify({ assetType, agent }),
              },
            );
            patchRound(agent.name, {
              status: "ready",
              advice: { ...result.proposal, agent_name: agent.name },
            });
          } catch (err) {
            patchRound(agent.name, {
              status: "error",
              error: err instanceof Error ? err.message : "No advice",
            });
          }
        }),
      );
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
    setRound([]);
  }

  const approvedEntries = round.filter(
    (entry) =>
      entry.approved &&
      entry.status === "ready" &&
      entry.advice &&
      entry.advice.action !== "hold",
  );

  function toggleApproval(name: string) {
    setMilestonesAccepted(false);
    setMilestones([]);
    setRound((current) =>
      current.map((entry) =>
        entry.name === name ? { ...entry, approved: !entry.approved } : entry,
      ),
    );
  }

  // Fill every approved card, one after another, each on its own agent's account.
  const simulateTrade = async () => {
    if (approvedEntries.length === 0) {
      setError("Approve at least one agent's advice first");
      return;
    }
    if (!milestonesAccepted) {
      setError(
        "Generate and accept your wishlist milestones before simulating the trades",
      );
      return;
    }

    setLoading(true);
    setError("");

    for (const entry of approvedEntries) {
      const advice = entry.advice!;
      const agent = ownedAgents.find((row) => row.name === entry.name);
      if (!agent) {
        patchRound(entry.name, {
          status: "error",
          error: "This agent isn't deployed yet. Try again in a moment.",
        });
        continue;
      }
      patchRound(entry.name, { status: "filling" });
      try {
        // External API obtains the quote/preview.
        const result = await request<{ trade: Trade }>("/api/simulate", {
          method: "POST",
          body: JSON.stringify({ proposal: advice }),
        });

        // SpacetimeDB records the simulated trade and updates its fixed-point position.
        let quantityMicros = BigInt(
          Math.round(result.trade.quantity * QUANTITY_SCALE),
        );
        if (advice.action === "sell") {
          // Never sell more than the agent holds (price moves and rounding can overshoot by a hair).
          const held =
            holdingsFor(agent.id).find((h) => h.symbol === advice.symbol)
              ?.quantityMicros ?? 0n;
          if (quantityMicros > held) quantityMicros = held;
        }
        const priceCents = BigInt(Math.round(result.trade.price * 100));
        const totalCents =
          (quantityMicros * priceCents + 999_999n) / 1_000_000n;
        await executeSimulatedTrade({
          agentId: agent.id,
          side: result.trade.action,
          symbol: result.trade.symbol,
          quantityMicros,
          priceCents,
          totalCents,
        });
        patchRound(entry.name, { status: "filled", fill: result.trade });
      } catch (err) {
        patchRound(entry.name, {
          status: "error",
          error:
            err instanceof Error ? err.message : "Could not simulate trade",
        });
      }
    }
    setLoading(false);
  };

  const fills = round.filter((entry) => entry.status === "filled");
  const step = fills.length > 0 ? 3 : round.length > 0 ? 2 : 1;
  const steps = ["Set your play", "Agent advice", "Ledger"];
  const thinking = round.some((entry) => entry.status === "thinking");
  const readyAdvice = round.filter((entry) => entry.advice);
  const buyCount = readyAdvice.filter((e) => e.advice!.action === "buy").length;
  const sellCount = readyAdvice.filter(
    (e) => e.advice!.action === "sell",
  ).length;
  const approvedBuyUsd = approvedEntries
    .filter((e) => e.advice!.action === "buy")
    .reduce((sum, e) => sum + e.advice!.amount_usd, 0);
  const approvedSellUsd = approvedEntries
    .filter((e) => e.advice!.action === "sell")
    .reduce((sum, e) => sum + e.advice!.amount_usd, 0);
  const sortedTrades = [...dbTrades].sort(
    (a, b) =>
      Number(b.executedAt.microsSinceUnixEpoch) -
      Number(a.executedAt.microsSinceUnixEpoch),
  );
  const visibleSimulatedTrades = simulatedTrades.filter(
    (item) => !currentSession || item.userId === currentSession.userId,
  );
  const sortedSimulatedTrades = [...visibleSimulatedTrades].sort(
    (a, b) =>
      Number(b.executedAt.microsSinceUnixEpoch) -
      Number(a.executedAt.microsSinceUnixEpoch),
  );
  const sliderMax = Math.max(1000, budget);

  const generateMilestones = async () => {
    if (approvedEntries.length === 0 || !wishlistSummary) {
      setError("Approve some advice and add something to your Wishlist first");
      return;
    }
    // The milestone agent plans around the whole approved round.
    const symbols = [...new Set(approvedEntries.map((e) => e.advice!.symbol))];
    const proposal = {
      ...approvedEntries[0].advice!,
      symbol: symbols[0],
      amount_usd: Math.round(approvedBuyUsd * 100) / 100,
      recommendations: symbols,
    };
    setLoading(true);
    setError("");
    setMilestonesAccepted(false);
    try {
      const result = await request<{ milestones: { milestones: Milestone[] } }>(
        "/api/milestones",
        {
          method: "POST",
          body: JSON.stringify({ wishlist: wishlistSummary, proposal }),
        },
      );
      setMilestones(result.milestones.milestones);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not generate milestones",
      );
    } finally {
      setLoading(false);
    }
  };

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
            Set a budget, deploy your agents and compare their advice.
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
            <dd>{dbTrades.length + visibleSimulatedTrades.length}</dd>
          </div>
          <div>
            <dt>Agents live</dt>
            <dd>{ownedAgents.length}</dd>
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

          {ownedAgents.length > 0 ? (
            <div className="field">
              <span className="field-label">Your agents</span>
              <div className="agent-list">
                {[...ownedAgents]
                  .sort((x, y) => Number(x.id - y.id))
                  .map((agent, index) => {
                    const holdings = holdingsFor(agent.id);
                    return (
                      <div
                        className="agent-card roster-card"
                        key={agent.id.toString()}
                      >
                        <div className="agent-top">
                          <span
                            className="agent-avatar"
                            style={{
                              background:
                                AGENT_COLORS[index % AGENT_COLORS.length],
                            }}
                            aria-hidden="true"
                          >
                            {index + 1}
                          </span>
                          <div className="agent-name">
                            {agent.name}
                            <em> · {personalityLabel(agent.personality)}</em>
                          </div>
                          <strong className="roster-cash">
                            {money.format(Number(agent.balanceCents) / 100)}
                          </strong>
                        </div>
                        <div className="holding-chips">
                          {holdings.length === 0 ? (
                            <span className="holding-chip empty">
                              No holdings yet
                            </span>
                          ) : (
                            holdings.map((holding) => (
                              <span
                                className="holding-chip"
                                key={holding.symbol}
                              >
                                {holding.symbol}{" "}
                                <b>{holding.quantity.toFixed(4)}</b>
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
              <p className="helper roster-note">
                Cash shown on the right. Agents can sell what they hold.
              </p>
            </div>
          ) : (
            <>
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
                    onChange={(event) =>
                      changeBudget(Number(event.target.value))
                    }
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
                              value={
                                agent.allocation === 0 ? "" : agent.allocation
                              }
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
                          {PERSONALITIES.map((option) => (
                            <button
                              key={option.value}
                              role="radio"
                              aria-checked={agent.personality === option.value}
                              aria-label={option.label}
                              title={option.label}
                              className={
                                agent.personality === option.value
                                  ? "selected"
                                  : ""
                              }
                              onClick={() =>
                                updateAgentPersonality(index, option.value)
                              }
                            >
                              {option.label}
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
            </>
          )}

          <p className="helper">
            Each agent picks its own{" "}
            {assetType === "crypto" ? "crypto asset" : "US stock"} to buy, or
            sells something it already holds.
          </p>
          <button
            className="primary"
            onClick={generateProposal}
            disabled={
              loading ||
              (ownedAgents.length === 0 && (budget <= 0 || !allocationsValid))
            }
          >
            {thinking ? (
              <>
                <Spinner /> Agents are thinking…
              </>
            ) : (
              <>
                {round.length > 0
                  ? "Generate a new strategy"
                  : "Generate strategy"}{" "}
                →
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

        <div className={`card advice-board ${step === 2 ? "is-active" : ""}`}>
          <div className="card-head advice-head">
            <div>
              <span className="card-kicker">Step 2</span>
              <h2>Agent advice</h2>
            </div>
            {readyAdvice.length > 0 && (
              <div className="advice-tally" aria-label="Advice summary">
                <span className="side side-buy">{buyCount} buy</span>
                <span className="side side-sell">{sellCount} sell</span>
                {readyAdvice.length - buyCount - sellCount > 0 && (
                  <span className="side side-hold">
                    {readyAdvice.length - buyCount - sellCount} hold
                  </span>
                )}
              </div>
            )}
          </div>
          {round.length === 0 ? (
            <div className="empty-state">
              <div className="empty-art" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p>Each agent’s next move appears here.</p>
              <span>
                Every agent follows its own strategy, so expect different picks.
              </span>
            </div>
          ) : (
            <>
              <div className="advice-grid">
                {round.map((entry) => {
                  const advice = entry.advice;
                  const pct = advice ? Math.round(advice.confidence * 100) : 0;
                  const canApprove =
                    entry.status === "ready" &&
                    !!advice &&
                    advice.action !== "hold";
                  return (
                    <article
                      key={entry.name}
                      className={`advice-card advice-${advice?.action ?? entry.status} ${entry.approved ? "is-approved" : ""} status-${entry.status}`}
                      style={{ "--agent": entry.color } as React.CSSProperties}
                    >
                      <header className="advice-agent">
                        <span className="agent-avatar" aria-hidden="true">
                          {entry.name.replace(/\D/g, "") || entry.name[0]}
                        </span>
                        <div>
                          <strong>{entry.name}</strong>
                          <span>{personalityLabel(entry.personality)}</span>
                        </div>
                      </header>

                      {entry.status === "thinking" && (
                        <div className="advice-thinking" role="status">
                          <span className="spinner" aria-hidden="true" />
                          Studying the market…
                          <i className="shimmer" />
                          <i className="shimmer short" />
                        </div>
                      )}

                      {entry.status === "error" && !advice && (
                        <p className="advice-error">{entry.error}</p>
                      )}

                      {advice && advice.action === "hold" && (
                        <div className="advice-body">
                          <div className="advice-move">
                            <span className="side side-hold">hold</span>
                          </div>
                          <p className="advice-why">{advice.rationale}</p>
                        </div>
                      )}

                      {advice && advice.action !== "hold" && (
                        <div className="advice-body">
                          <div className="advice-move">
                            <span className={`side side-${advice.action}`}>
                              {advice.action}
                            </span>
                            <strong className="advice-symbol">
                              {advice.symbol}
                            </strong>
                            <span className={`badge risk-${advice.risk}`}>
                              {advice.risk}
                            </span>
                          </div>
                          <div className="advice-amount">
                            {money.format(advice.amount_usd)}
                          </div>
                          <p className="advice-context">
                            {advice.action === "sell" ? (
                              <>
                                {advice.sell_all
                                  ? "Sells all of"
                                  : "Sells part of"}{" "}
                                {advice.held_quantity?.toFixed(6)}{" "}
                                {advice.symbol}
                                {advice.held_value
                                  ? ` (worth ${money.format(advice.held_value)})`
                                  : ""}
                              </>
                            ) : (
                              <>
                                Uses{" "}
                                {advice.cash_usd
                                  ? `${Math.round((advice.amount_usd / advice.cash_usd) * 100)}% of ${money.format(advice.cash_usd)} cash`
                                  : "its cash"}
                              </>
                            )}
                          </p>
                          <div className="confidence">
                            <div className="confidence-head">
                              <span>Confidence</span>
                              <strong>{pct}%</strong>
                            </div>
                            <div className="meter">
                              <i style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                          <p className="advice-why">{advice.rationale}</p>
                        </div>
                      )}

                      <footer className="advice-foot">
                        {entry.status === "filled" && entry.fill ? (
                          <span className="advice-filled">
                            ✓ Filled {entry.fill.quantity.toFixed(6)} @{" "}
                            {money.format(entry.fill.price)}
                          </span>
                        ) : entry.status === "filling" ? (
                          <span className="advice-filled">
                            <span className="spinner" aria-hidden="true" />{" "}
                            Filling…
                          </span>
                        ) : entry.status === "error" && advice ? (
                          <span className="advice-error">{entry.error}</span>
                        ) : canApprove ? (
                          <button
                            className={`approve-toggle ${entry.approved ? "on" : ""}`}
                            aria-pressed={entry.approved}
                            onClick={() => toggleApproval(entry.name)}
                            disabled={loading && !thinking}
                          >
                            {entry.approved ? "✓ Approved" : "Approve"}
                          </button>
                        ) : null}
                      </footer>
                    </article>
                  );
                })}
              </div>

              {approvedEntries.length > 0 && (
                <div className="milestone-panel">
                  <span className="section-label">Investment milestones</span>
                  {wishlistSummary ? (
                    <p className="helper">
                      Based on your saved Wishlist: {wishlistSummary}
                    </p>
                  ) : (
                    <p className="helper">
                      Add an item to your Wishlist before generating milestones.
                    </p>
                  )}
                  <button
                    className="secondary"
                    onClick={generateMilestones}
                    disabled={loading || !wishlistSummary}
                  >
                    {loading
                      ? "Planning milestones…"
                      : "Suggest earning milestones →"}
                  </button>
                  {milestones.length > 0 && (
                    <div className="milestone-list">
                      <span className="milestone-list-heading">
                        Review or edit the suggestions
                      </span>
                      {milestones.map((milestone, index) => (
                        <div
                          className="milestone-row"
                          key={`${milestone.name}-${index}`}
                        >
                          <span className="milestone-number">{index + 1}</span>
                          <div className="milestone-content">
                            <label>
                              <span>Milestone</span>
                              <input
                                aria-label={`Milestone ${index + 1} name`}
                                value={milestone.name}
                                onChange={(event) => {
                                  setMilestonesAccepted(false);
                                  setMilestones((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, name: event.target.value }
                                        : item,
                                    ),
                                  );
                                }}
                              />
                            </label>
                            <label>
                              <span>Profit target</span>
                              <input
                                className="milestone-target"
                                aria-label={`Milestone ${index + 1} target`}
                                value={milestone.target}
                                onChange={(event) => {
                                  setMilestonesAccepted(false);
                                  setMilestones((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                            ...item,
                                            target: event.target.value,
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                              />
                            </label>
                            {milestone.rationale && (
                              <small>{milestone.rationale}</small>
                            )}
                          </div>
                        </div>
                      ))}
                      <button
                        className="secondary"
                        onClick={() => {
                          setMilestonesAccepted(true);
                          setError("");
                        }}
                      >
                        {milestonesAccepted
                          ? "Milestones accepted ✓"
                          : "Accept milestones →"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="advice-actions">
                <span className="advice-summary">
                  {approvedEntries.length === 0
                    ? "Approve the moves you agree with."
                    : `${approvedEntries.length} approved · ${money.format(approvedBuyUsd)} to buy${approvedSellUsd > 0 ? ` · ${money.format(approvedSellUsd)} to sell` : ""}`}
                </span>
                <button
                  className="primary"
                  onClick={simulateTrade}
                  disabled={loading || approvedEntries.length === 0}
                >
                  {loading && round.some((e) => e.status === "filling")
                    ? "Filling trades…"
                    : approvedEntries.length > 1
                      ? `Simulate ${approvedEntries.length} trades →`
                      : "Simulate this trade →"}
                </button>
              </div>
            </>
          )}
        </div>

        <div className={`card result-card ${step === 3 ? "is-active" : ""}`}>
          <div className="card-head">
            <span className="card-kicker">Step 3</span>
            <h2>Ledger</h2>
          </div>
          {fills.length === 0 ? (
            <div className="empty-state compact">
              <p>No fills this round yet.</p>
              <span>Approved trades are filled at the live market price.</span>
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
                {fills.length === 1
                  ? "1 fill recorded"
                  : `${fills.length} fills recorded`}
              </div>
              <div className="round-fills">
                {fills.map((entry) => (
                  <div className="round-fill" key={entry.name}>
                    <span
                      className="agent-dot"
                      style={{ background: entry.color }}
                      aria-hidden="true"
                    />
                    <strong>{entry.name}</strong>
                    <span className={`side side-${entry.fill!.action}`}>
                      {entry.fill!.action}
                    </span>
                    <span>{entry.fill!.symbol}</span>
                    <span>{money.format(entry.fill!.amount_usd)}</span>
                    <span className="muted">
                      {entry.fill!.quantity.toFixed(6)} @{" "}
                      {money.format(entry.fill!.price)}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="secondary full"
                onClick={() => {
                  setRound([]);
                  setMilestones([]);
                  setMilestonesAccepted(false);
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
          <span className="count">
            {sortedTrades.length + sortedSimulatedTrades.length}
          </span>
        </div>
        {sortedTrades.length === 0 && sortedSimulatedTrades.length === 0 ? (
          <p className="history-empty">Your trades will show up here.</p>
        ) : (
          <div className="table">
            <div className="table-row table-head">
              <span>Agent</span>
              <span>Asset</span>
              <span>Side</span>
              <span>Total</span>
              <span>Price</span>
              <span>Quantity</span>
            </div>
            {sortedTrades.map((item) => (
              <div className="table-row" key={item.id.toString()}>
                <span>{agentNameById.get(item.agentId) ?? "—"}</span>
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
            {sortedSimulatedTrades.map((item) => (
              <div
                className="table-row"
                key={`simulated-${item.id.toString()}`}
              >
                <span>{agentNameById.get(item.agentId) ?? "—"}</span>
                <strong>{item.symbol}</strong>
                <span>
                  <span className={`side side-${item.side}`}>{item.side}</span>
                </span>
                <span>{money.format(Number(item.totalCents) / 100)}</span>
                <span>@ {money.format(Number(item.priceCents) / 100)}</span>
                <span>
                  {(Number(item.quantityMicros) / 1_000_000).toFixed(6)} units
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
