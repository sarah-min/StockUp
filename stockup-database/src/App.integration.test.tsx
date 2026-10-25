import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// App reads from SpacetimeDB through hooks, so give it an empty, always-ready database instead of a live connection.
vi.mock("spacetimedb/react", () => ({
  useTable: () => [[], true],
  useReducer: () => () => Promise.resolve(),
  useSpacetimeDB: () => ({
    isActive: false,
    identity: undefined,
    getConnection: () => null,
  }),
}));

describe("StockUp paper-trading flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/health"))
        return new Response(
          JSON.stringify({ ok: true, mode: "paper", creaoConfigured: false }),
        );
      if (url.endsWith("/api/proposal")) {
        const { agent } = JSON.parse(String(init?.body ?? "{}"));
        // Each agent answers for itself: Agent 2 holds ETH and advises selling part of it.
        if (agent?.name === "Agent 2")
          return new Response(
            JSON.stringify({
              proposal: {
                agent_name: "Agent 2",
                symbol: "ETH-USD",
                asset_type: "crypto",
                action: "sell",
                amount_usd: 40,
                confidence: 0.55,
                rationale: "Take some profit",
                risk: "medium",
                source: "demo",
                held_quantity: 0.02,
                held_value: 80,
                sell_all: false,
              },
            }),
          );
        return new Response(
          JSON.stringify({
            proposal: {
              agent_name: agent?.name ?? "Agent 1",
              symbol: "BTC-USD",
              asset_type: "crypto",
              action: "buy",
              amount_usd: 25,
              confidence: 0.62,
              rationale: "Test proposal",
              risk: "high",
              source: "demo",
              cash_usd: 50,
            },
          }),
        );
      }
      return new Response(
        JSON.stringify({ error: `Unexpected request: ${url}` }),
        { status: 404 },
      );
    });
  });

  it("generates a proposal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: /generate strategy/i }),
    );
    expect(await screen.findByText("BTC-USD")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^approve$/i }),
    ).toBeInTheDocument();
  });

  it("shows every agent's advice side by side, including sells of holdings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /add an agent/i }));
    await user.click(
      screen.getByRole("button", { name: /generate strategy/i }),
    );
    expect(await screen.findByText("BTC-USD")).toBeInTheDocument();
    expect(await screen.findByText("ETH-USD")).toBeInTheDocument();
    expect(screen.getByText(/sells part of/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^approve$/i })).toHaveLength(
      2,
    );
    await user.click(screen.getAllByRole("button", { name: /^approve$/i })[1]);
    expect(
      screen.getByText(/1 approved · \$0\.00 to buy · \$40\.00 to sell/i),
    ).toBeInTheDocument();
  });

  it.todo("records a simulated Coinbase-priced fill for the selected agent");

  it("opens the wishlist from the header", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /wishlist/i }));
    expect(
      screen.getByRole("dialog", { name: /wishlist/i }),
    ).toBeInTheDocument();
  });

  it("opens the purchases pop-up from the header", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /purchases/i }));
    expect(
      screen.getByRole("dialog", { name: /purchases/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing unlocked yet/i)).toBeInTheDocument();
  });
});
