import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tables } from "./module_bindings";
import App from "./App";

// A signed-in user (id 7) with $200 of undeployed cash, plus another user's trade that must never be counted.
const me = { toHexString: () => "aa" };
const fixtures = new Map<unknown, unknown[]>();
const at = (micros: number) => ({ microsSinceUnixEpoch: BigInt(micros) });

vi.mock("spacetimedb/react", () => ({
  useTable: (table: unknown) => [fixtures.get(table) ?? [], true],
  useReducer: () => () => Promise.resolve(),
  useSpacetimeDB: () => ({
    isActive: true,
    identity: me,
    getConnection: () => null,
  }),
}));

describe("StockUp scoreboard and cash", () => {
  beforeEach(() => {
    fixtures.clear();
    fixtures.set(tables.session, [
      { identity: me, userId: 7n, username: "sarah" },
    ]);
    fixtures.set(tables.user, [
      {
        id: 7n,
        name: "sarah",
        balanceCents: 20000n,
        balanceStock: 0n,
        isMarket: false,
      },
    ]);
    fixtures.set(tables.simulatedTrade, [
      // Buy 1 unit for $100, sell half for $60: realized +$10.
      {
        id: 1n,
        userId: 7n,
        agentId: 1n,
        marketUserId: 1n,
        side: "buy",
        symbol: "BTC-USD",
        quantityMicros: 1_000_000n,
        priceCents: 10000n,
        totalCents: 10000n,
        executedAt: at(1),
      },
      {
        id: 2n,
        userId: 7n,
        agentId: 1n,
        marketUserId: 1n,
        side: "sell",
        symbol: "BTC-USD",
        quantityMicros: 500_000n,
        priceCents: 12000n,
        totalCents: 6000n,
        executedAt: at(2),
      },
      // Someone else's trade.
      {
        id: 3n,
        userId: 99n,
        agentId: 9n,
        marketUserId: 1n,
        side: "sell",
        symbol: "BTC-USD",
        quantityMicros: 1_000_000n,
        priceCents: 999999n,
        totalCents: 999999n,
        executedAt: at(3),
      },
    ]);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ ok: true })),
    );
  });

  it("computes realized P/L and the trade count from this user's trades only", () => {
    render(<App />);
    expect(screen.getByText("$10.00")).toBeInTheDocument();
    expect(screen.getByText("Trades").nextElementSibling?.textContent).toBe(
      "2",
    );
  });

  it("won't deploy a budget larger than the available cash", () => {
    render(<App />);
    expect(
      screen.getByText(/\$200\.00 available to deploy/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$500" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "$1,000" })).toBeDisabled();
  });
});
