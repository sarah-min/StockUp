import { describe, expect, it } from "vitest";
import { realizedProfit } from "./realizedProfit";

const t = (
  id: number,
  userId: number,
  side: string,
  micros: number,
  cents: number,
  symbol = "BTC-USD",
) => ({
  id: BigInt(id),
  userId: BigInt(userId),
  side,
  symbol,
  quantityMicros: BigInt(micros),
  totalCents: BigInt(cents),
  executedAt: { microsSinceUnixEpoch: BigInt(id) },
});

describe("realizedProfit", () => {
  const trades = [
    t(1, 7, "buy", 1_000_000, 10000), // player 7 buys 1 BTC for $100
    t(2, 8, "buy", 1_000_000, 10000), // player 8 buys 1 BTC for $100
    t(3, 7, "sell", 500_000, 6000), // player 7 sells half for $60: +$10
    t(4, 8, "sell", 1_000_000, 9000), // player 8 sells all for $90: -$10
  ];

  it("counts only that player's own trades", () => {
    expect(realizedProfit(trades, 7n)).toBe(10);
    expect(realizedProfit(trades, 8n)).toBe(-10);
    expect(realizedProfit(trades, 9n)).toBe(0);
  });

  it("ignores sells of things never bought", () => {
    expect(
      realizedProfit([t(1, 7, "sell", 1_000_000, 5000, "ETH-USD")], 7n),
    ).toBe(0);
  });
});
