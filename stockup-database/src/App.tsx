import { useEffect, useState } from "react";
import "./App.css";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import { reducers, tables } from "./module_bindings";
import Wishlist from "./Wishlist";
import Purchases from "./Purchases";
import Milestones from "./Milestones";
import OpenPositions from "./OpenPositions";
import { isOutOfDate, snapshotOf } from "./wishlistSnapshot";
import ThemeToggle from "./ThemeToggle";
import { useRealizedProfit } from "./realizedProfit";
import { useRewardSpend } from "./rewardSpend";
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
// One agent's advice for this round. Agents look at their own cash and your holdings, so they may buy, sell or hold.
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
  status: "thinking" | "ready" | "error" | "filling" | "filled" | "skipped";
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
const HISTORY_PAGE_SIZE = 10;
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
  const [milestoneRows] = useTable(tables.milestone);
  const [loading, setLoading] = useState(false); // agents are generating advice
  const [planning, setPlanning] = useState(false); // milestone agent is running
  const [executing, setExecuting] = useState(false); // locked-in trades are being filled
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [purchasesOpen, setPurchasesOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  const [milestonesSnapshot, setMilestonesSnapshot] = useState("");
  const [error, setError] = useState("");
  const earnedProfit = useRealizedProfit();
  // Buying a reward spends profit: what's shown is trading profit minus what rewards have cost. Milestones still unlock
  // on the profit you've earned in total, so spending never pushes you back below a target you already passed.
  const rewardSpend = useRewardSpend();
  const realizedProfit =
    earnedProfit === null ? null : earnedProfit - rewardSpend;
  const [agentSettings, setAgentSettings] = useState<AgentSettings[]>([
    {
      allocation: MIN_AGENT_ALLOCATION,
      personality: "personality-1",
    },
  ]);
  const { identity } = useSpacetimeDB();
  const executeSimulatedTrade = useReducer(reducers.executeSimulatedTrade);
  const saveMilestones = useReducer(reducers.saveMilestones);
  const [sessions] = useTable(tables.session);
  const currentSession = sessions.find(
    (session) => session.identity.toHexString() === identity?.toHexString(),
  );
  // This player's own simulated trades, and what they still hold (net micro-units per symbol).
  const mySimulatedTrades = simulatedTrades.filter(
    (item) => currentSession && item.userId === currentSession.userId,
  );
  const holdings = new Map<string, bigint>();
  for (const item of [...mySimulatedTrades].sort(
    (x, y) =>
      Number(
        x.executedAt.microsSinceUnixEpoch - y.executedAt.microsSinceUnixEpoch,
      ) || Number(x.id - y.id),
  )) {
    const held = holdings.get(item.symbol) ?? 0n;
    const next =
      item.side === "buy"
        ? held + item.quantityMicros
        : held - item.quantityMicros;
    holdings.set(item.symbol, next > 0n ? next : 0n);
  }
  const holdingList = [...holdings.entries()]
    .filter(([, micros]) => micros > 0n)
    .map(([symbol, micros]) => ({
      symbol,
      quantity: Number(micros) / QUANTITY_SCALE,
    }));
  const savedWishlist = wishlistItems.filter(
    (item) => currentSession && item.userId === currentSession.userId,
  );
  // Milestones live across plays: the saved, accepted set is reused until the user regenerates it.
  const savedMilestones = milestoneRows
    .filter((row) => currentSession && row.userId === currentSession.userId)
    .sort(
      (a, b) => Number(a.targetCents - b.targetCents) || Number(a.id - b.id),
    );
  const savedMilestonesAccepted =
    savedMilestones.length > 0 && savedMilestones.every((row) => row.accepted);
  const usingSavedMilestones =
    milestones.length === 0 && savedMilestones.length > 0;
  const milestonesReady =
    milestones.length > 0 ? milestonesAccepted : savedMilestonesAccepted;
  const wishlistSummary = savedWishlist
    .map(
      (item) =>
        `${item.title} (${money.format(Number(item.priceCents) / 100)})`,
    )
    .join(", ");
  useEffect(() => {
    request<Health>("/api/health")
      .then(setHealth)
      .catch(() => setHealth(null));
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
    setError("");
    if (!allocationsValid) {
      setError(allocationError);
      return;
    }
    setLoading(true);

    const roster = agentAllocations.map((agent, index) => ({
      name: `Agent ${index + 1}`,
      personality: agent.personality,
      cash_usd: agent.allocation,
      holdings: holdingList,
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
          const result = await request<{ proposal: Advice }>("/api/proposal", {
            method: "POST",
            body: JSON.stringify({ assetType, agent }),
          });
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
    setLoading(false);
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
    setAgentSettings((current) =>
      current.map((agent, currentIndex) =>
        currentIndex === index
          ? { ...agent, allocation: Math.max(0, allocation) }
          : agent,
      ),
    );
  }

  function updateAgentPersonality(index: number, personality: string) {
    setAgentSettings((current) =>
      current.map((agent, currentIndex) =>
        currentIndex === index ? { ...agent, personality } : agent,
      ),
    );
  }

  function changeAgentCount(next: number) {
    setAgentNum(Math.min(MAX_AGENTS, Math.max(1, next)));
  }

  function changeBudget(next: number) {
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
    setRound((current) =>
      current.map((entry) =>
        entry.name === name ? { ...entry, approved: !entry.approved } : entry,
      ),
    );
  }

  // Execute every approved card, one after another, on this player's account.
  const simulateTrade = async () => {
    if (approvedEntries.length === 0) {
      setError("Lock in at least one agent's advice first");
      return;
    }
    if (!milestonesReady) {
      setError(
        "Generate and accept your wishlist milestones before executing the trades",
      );
      return;
    }
    setExecuting(true);
    setError("");

    // Only the locked-in cards run. Advice the player didn't lock in is skipped; agents still thinking keep going
    // and can be locked in and executed afterwards.
    const toRun = new Set(approvedEntries.map((entry) => entry.name));
    setRound((current) =>
      current.map((entry) =>
        entry.status === "ready" && !toRun.has(entry.name)
          ? { ...entry, status: "skipped" }
          : entry,
      ),
    );

    // Several agents may advise selling the same holding: never sell more than is left.
    const remaining = new Map(holdings);
    for (const entry of approvedEntries) {
      const advice = entry.advice!;
      patchRound(entry.name, { status: "filling" });
      try {
        // External API obtains the quote/preview.
        const result = await request<{ trade: Trade }>("/api/simulate", {
          method: "POST",
          body: JSON.stringify({ proposal: advice }),
        });

        // Price is stored in whole cents: size the quantity from that stored price so the booked total
        // matches the advised amount (sizing from the unrounded quote over-books cheap coins).
        const priceCents = BigInt(
          Math.max(1, Math.round(result.trade.price * 100)),
        );
        let quantityMicros =
          (BigInt(Math.floor(advice.amount_usd * 100)) * 1_000_000n) /
          priceCents;
        if (advice.action === "sell") {
          const left = remaining.get(result.trade.symbol) ?? 0n;
          if (quantityMicros > left) quantityMicros = left;
        }
        if (quantityMicros <= 0n) {
          throw new Error(
            advice.action === "sell"
              ? `Nothing left of ${result.trade.symbol} to sell`
              : "That amount is too small to trade at this price",
          );
        }
        const totalCents =
          (quantityMicros * priceCents + 999_999n) / 1_000_000n;
        await executeSimulatedTrade({
          side: result.trade.action,
          symbol: result.trade.symbol,
          quantityMicros,
          priceCents,
          totalCents,
        });
        const left = remaining.get(result.trade.symbol) ?? 0n;
        remaining.set(
          result.trade.symbol,
          advice.action === "sell"
            ? left - quantityMicros
            : left + quantityMicros,
        );
        patchRound(entry.name, {
          status: "filled",
          fill: {
            ...result.trade,
            quantity: Number(quantityMicros) / QUANTITY_SCALE,
            price: Number(priceCents) / 100,
            amount_usd: Number(totalCents) / 100,
          },
        });
      } catch (err) {
        patchRound(entry.name, {
          status: "error",
          error: err instanceof Error ? err.message : "Could not execute trade",
        });
      }
    }
    setExecuting(false);
  };

  const fills = round.filter((entry) => entry.status === "filled");
  const step = fills.length > 0 ? 3 : round.length > 0 ? 2 : 1;
  const steps = ["Configure strategy", "Agent advice", "Ledger"];
  const thinking = round.some((entry) => entry.status === "thinking");
  // Cards the player could still lock in (or already did) this round.
  const lockable = round.filter(
    (entry) =>
      entry.status === "ready" &&
      entry.advice &&
      entry.advice.action !== "hold",
  );
  const approvedBuyUsd = approvedEntries
    .filter((e) => e.advice!.action === "buy")
    .reduce((sum, e) => sum + e.advice!.amount_usd, 0);
  const approvedSellUsd = approvedEntries
    .filter((e) => e.advice!.action === "sell")
    .reduce((sum, e) => sum + e.advice!.amount_usd, 0);
  const personalityLabel = (value?: string) =>
    PERSONALITIES.find((option) => option.value === value)?.label ?? "Trader";
  // The legacy trade table is public: keep only this player's rows.
  const myLegacyTrades = dbTrades.filter(
    (item) => currentSession && item.userId === currentSession.userId,
  );
  const sortedTrades = [...myLegacyTrades].sort(
    (a, b) =>
      Number(b.executedAt.microsSinceUnixEpoch) -
      Number(a.executedAt.microsSinceUnixEpoch),
  );
  const visibleSimulatedTrades = mySimulatedTrades;
  const sortedSimulatedTrades = [...visibleSimulatedTrades].sort(
    (a, b) =>
      Number(b.executedAt.microsSinceUnixEpoch) -
      Number(a.executedAt.microsSinceUnixEpoch),
  );
  // One newest-first list of both kinds of trade, shown HISTORY_PAGE_SIZE at a time.
  const historyRows = [
    ...sortedTrades.map((item) => ({
      key: item.id.toString(),
      symbol: item.symbol,
      side: item.side,
      totalCents: item.totalCents,
      priceCents: item.priceCents,
      units: Number(item.quantity) / QUANTITY_SCALE,
      at: Number(item.executedAt.microsSinceUnixEpoch),
    })),
    ...sortedSimulatedTrades.map((item) => ({
      key: `simulated-${item.id.toString()}`,
      symbol: item.symbol,
      side: item.side,
      totalCents: item.totalCents,
      priceCents: item.priceCents,
      units: Number(item.quantityMicros) / 1_000_000,
      at: Number(item.executedAt.microsSinceUnixEpoch),
    })),
  ].sort((a, b) => b.at - a.at);
  const historyPages = Math.max(
    1,
    Math.ceil(historyRows.length / HISTORY_PAGE_SIZE),
  );
  const currentHistoryPage = Math.min(historyPage, historyPages - 1);
  const pageStart = currentHistoryPage * HISTORY_PAGE_SIZE;
  const visibleHistory = historyRows.slice(
    pageStart,
    pageStart + HISTORY_PAGE_SIZE,
  );
  const sliderMax = Math.max(1000, budget);

  // Keeps the user's latest milestones in SpacetimeDB so they can be reviewed later from the Milestones pop-up.
  const persistMilestones = async (
    items: Milestone[],
    accepted: boolean,
    snapshot: string,
  ) => {
    try {
      await saveMilestones({
        names: items.map((item) => item.name),
        targets: items.map((item) => item.target),
        rationales: items.map((item) => item.rationale),
        accepted,
        wishlistSnapshot: snapshot,
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save milestones",
      );
    }
  };

  // Accepting from the Milestones pop-up: use the freshly generated set if there is one, otherwise the saved rows.
  const acceptSavedMilestones = (
    rows: (Milestone & { wishlistSnapshot?: string })[],
  ) => {
    const items = milestones.length > 0 ? milestones : rows;
    const snapshot =
      milestones.length > 0
        ? milestonesSnapshot
        : ((rows[0] as { wishlistSnapshot?: string })?.wishlistSnapshot ?? "");
    setMilestonesAccepted(true);
    setError("");
    void persistMilestones(items, true, snapshot);
  };

  const generateMilestones = async () => {
    if (!wishlistSummary) {
      setError("Add something to your Wishlist first");
      return;
    }
    // The milestone agent plans around the whole locked-in round. Without one (after a reload, say) it falls back to
    // the budget and the assets the player has already traded, so milestones can still be regenerated.
    const symbols =
      approvedEntries.length > 0
        ? [...new Set(approvedEntries.map((e) => e.advice!.symbol))]
        : [...new Set(visibleSimulatedTrades.map((item) => item.symbol))].slice(
            0,
            5,
          );
    const proposal =
      approvedEntries.length > 0
        ? {
            ...approvedEntries[0].advice!,
            symbol: symbols[0],
            amount_usd:
              Math.round(
                (approvedBuyUsd > 0 ? approvedBuyUsd : approvedSellUsd) * 100,
              ) / 100,
            recommendations: symbols,
          }
        : {
            symbol: symbols[0] ?? "a mix of crypto and stocks",
            amount_usd: budget,
            recommendations:
              symbols.length > 0 ? symbols : ["a mix of crypto and stocks"],
          };
    const snapshotNow = snapshotOf(savedWishlist);
    setPlanning(true);
    setError("");
    setMilestonesAccepted(false);
    try {
      const result = await request<{ milestones: { milestones: Milestone[] } }>(
        "/api/milestones",
        {
          method: "POST",
          body: JSON.stringify({
            wishlist: `${wishlistSummary}. Shipping and taxes are not included in these prices yet.`,
            proposal,
          }),
        },
      );
      setMilestones(result.milestones.milestones);
      setMilestonesSnapshot(snapshotNow);
      void persistMilestones(result.milestones.milestones, false, snapshotNow);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not generate milestones",
      );
    } finally {
      setPlanning(false);
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
          <button
            className="ghost-button"
            onClick={() => setMilestonesOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M5 21V4m0 0h11l-2 4 2 4H5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>{" "}
            Milestones
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
            Agents recommend. <span>You decide.</span>
          </h1>
          <p className="intro-copy">
            Set a budget, deploy your agents and compare their advice.
          </p>
        </div>
        <dl className="scoreboard">
          <div>
            <dt title="Profit from your trades, minus what you've spent on rewards">
              Realized P/L
            </dt>
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
            <dd>{visibleSimulatedTrades.length}</dd>
          </div>
          <div>
            <dt>Agents</dt>
            <dd>{agentAllocations.length}</dd>
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
            <h2>Configure your strategy</h2>
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
                      {PERSONALITIES.map((option) => (
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

          {holdingList.length > 0 && (
            <div className="field">
              <span className="field-label">Your holdings</span>
              <div className="holding-chips">
                {holdingList.map((holding) => (
                  <span className="holding-chip" key={holding.symbol}>
                    {holding.symbol} <b>{holding.quantity.toFixed(4)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="helper">
            Each agent picks its own{" "}
            {assetType === "crypto" ? "crypto asset" : "US stock"} within its
            share of the budget, or sells something you already hold.
          </p>
          <button
            className="primary"
            onClick={generateProposal}
            disabled={loading || executing || budget <= 0 || !allocationsValid}
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
          </div>
          {round.length === 0 ? (
            <div className="empty-state">
              <div className="empty-art" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p>Each agent’s recommendation appears here.</p>
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
                                your {advice.held_quantity?.toFixed(6)}{" "}
                                {advice.symbol}
                                {advice.held_value
                                  ? ` (worth ${money.format(advice.held_value)})`
                                  : ""}
                              </>
                            ) : (
                              <>
                                Uses{" "}
                                {advice.cash_usd
                                  ? `${Math.round((advice.amount_usd / advice.cash_usd) * 100)}% of its ${money.format(advice.cash_usd)}`
                                  : "its budget"}
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
                        ) : entry.status === "skipped" ? (
                          <span className="advice-skipped">Skipped</span>
                        ) : entry.status === "error" && advice ? (
                          <span className="advice-error">{entry.error}</span>
                        ) : canApprove ? (
                          <button
                            className={`approve-toggle ${entry.approved ? "on" : ""}`}
                            aria-pressed={entry.approved}
                            onClick={() => toggleApproval(entry.name)}
                            disabled={executing}
                          >
                            {entry.approved ? "✓ Locked in" : "Lock in"}
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
                  <div className="wish-block">
                    {savedWishlist.length > 0 ? (
                      <>
                        <div className="wish-block-head">
                          <span className="wish-block-title">
                            Based on your wishlist
                          </span>
                          <button
                            className="link-button"
                            onClick={() => setWishlistOpen(true)}
                          >
                            Edit
                          </button>
                        </div>
                        <ul className="wish-summary">
                          {[...savedWishlist]
                            .sort(
                              (a, b) =>
                                Number(a.priceCents - b.priceCents) ||
                                Number(a.id - b.id),
                            )
                            .map((item) => (
                              <li key={String(item.id)}>
                                <span>{item.title}</span>
                                <strong>
                                  {money.format(Number(item.priceCents) / 100)}
                                </strong>
                              </li>
                            ))}
                        </ul>
                        <small className="wish-note">
                          Prices don’t include shipping or taxes yet.
                        </small>
                      </>
                    ) : (
                      <>
                        <p className="helper">
                          Add an item to your wishlist before generating
                          milestones.
                        </p>
                        <button
                          className="secondary"
                          onClick={() => setWishlistOpen(true)}
                        >
                          Add to wishlist →
                        </button>
                      </>
                    )}
                  </div>
                  <button
                    className="secondary"
                    onClick={generateMilestones}
                    disabled={planning || !wishlistSummary}
                  >
                    {planning
                      ? "Planning milestones…"
                      : milestones.length > 0 || usingSavedMilestones
                        ? "Regenerate milestones"
                        : "Suggest earning milestones →"}
                  </button>
                  {usingSavedMilestones && (
                    <div className="milestone-list">
                      <span className="milestone-list-heading">
                        Your milestones ·{" "}
                        {savedMilestonesAccepted
                          ? "accepted ✓"
                          : "not accepted yet"}
                      </span>
                      <ul className="wish-summary">
                        {savedMilestones.map((row) => (
                          <li key={String(row.id)}>
                            <span>{row.name}</span>
                            <strong>{row.target}</strong>
                          </li>
                        ))}
                      </ul>
                      {!savedMilestonesAccepted && (
                        <button
                          className="secondary"
                          onClick={() => acceptSavedMilestones(savedMilestones)}
                        >
                          Accept milestones →
                        </button>
                      )}
                    </div>
                  )}
                  {(milestones.length > 0
                    ? isOutOfDate(milestonesSnapshot, savedWishlist)
                    : usingSavedMilestones &&
                      isOutOfDate(
                        savedMilestones[0].wishlistSnapshot,
                        savedWishlist,
                      )) && (
                    <p className="stale-note">
                      Your wishlist changed since these were generated.
                      Regenerate to resize them.
                    </p>
                  )}
                  {milestones.length > 0 && (
                    <div className="milestone-list">
                      <span className="milestone-list-heading">
                        Milestones · review or edit ({milestones.length})
                      </span>
                      {milestones.map((milestone, index) => (
                        <div
                          className="milestone-row"
                          key={`${milestone.name}-${index}`}
                        >
                          <span className="milestone-number">{index + 1}</span>
                          <div className="milestone-content">
                            <div className="milestone-fields">
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
                                          ? {
                                              ...item,
                                              name: event.target.value,
                                            }
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
                            </div>
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
                          void persistMilestones(
                            milestones,
                            true,
                            milestonesSnapshot,
                          );
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
                    ? "Lock in the recommendations you agree with. Only those are executed."
                    : `${approvedEntries.length} of ${lockable.length} locked in · ${money.format(approvedBuyUsd)} to buy${approvedSellUsd > 0 ? ` · ${money.format(approvedSellUsd)} to sell` : ""}${lockable.length > approvedEntries.length ? " · the rest are skipped" : ""}`}
                </span>
                <button
                  className="primary execute-trade"
                  onClick={simulateTrade}
                  disabled={
                    executing || planning || approvedEntries.length === 0
                  }
                >
                  {executing
                    ? "Executing trades…"
                    : approvedEntries.length > 1
                      ? `Execute ${approvedEntries.length} trades →`
                      : "Execute this trade →"}
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
              <p>No executed trades yet.</p>
              <span>Locked-in trades are filled at the live market price.</span>
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
              <button className="secondary full" onClick={() => setRound([])}>
                Start a new strategy
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

      <OpenPositions />

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
              <span>Asset</span>
              <span>Side</span>
              <span>Total</span>
              <span>Price</span>
              <span>Quantity</span>
            </div>
            {visibleHistory.map((item) => (
              <div className="table-row" key={item.key}>
                <strong>{item.symbol}</strong>
                <span>
                  <span className={`side side-${item.side}`}>{item.side}</span>
                </span>
                <span>{money.format(Number(item.totalCents) / 100)}</span>
                <span>@ {money.format(Number(item.priceCents) / 100)}</span>
                <span>{item.units.toFixed(6)} units</span>
              </div>
            ))}
          </div>
        )}
        {historyRows.length > HISTORY_PAGE_SIZE && (
          <div className="pager">
            <span>
              {pageStart + 1}–
              {Math.min(pageStart + HISTORY_PAGE_SIZE, historyRows.length)} of{" "}
              {historyRows.length}
            </span>
            <div>
              <button
                className="secondary"
                disabled={currentHistoryPage === 0}
                onClick={() => setHistoryPage(currentHistoryPage - 1)}
              >
                ← Newer
              </button>
              <button
                className="secondary"
                disabled={currentHistoryPage >= historyPages - 1}
                onClick={() => setHistoryPage(currentHistoryPage + 1)}
              >
                Older →
              </button>
            </div>
          </div>
        )}
      </section>
      {wishlistOpen && <Wishlist onClose={() => setWishlistOpen(false)} />}
      {purchasesOpen && <Purchases onClose={() => setPurchasesOpen(false)} />}
      {milestonesOpen && (
        <Milestones
          onClose={() => setMilestonesOpen(false)}
          canRegenerate={savedWishlist.length > 0}
          regenerating={planning}
          error={error}
          onRegenerate={generateMilestones}
          onAccept={acceptSavedMilestones}
        />
      )}
      <footer>StockUp is not investment advice.</footer>
    </main>
  );
}

export default App;
