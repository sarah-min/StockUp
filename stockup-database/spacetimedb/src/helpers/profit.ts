import { SenderError } from "spacetimedb/server";

type TradeRow = {
  id: bigint;
  side: string;
  symbol: string;
  quantityMicros: bigint;
  totalCents: bigint;
  executedAt: { microsSinceUnixEpoch: bigint };
};

// Realized profit in cents for one user, from their own simulated trades only (average-cost method per symbol).
// A sell realizes its proceeds minus the average cost of the units sold; sells beyond what was bought are ignored.
export function realizedProfitCents(ctx: any, userId: bigint): number {
  const trades: TradeRow[] = Array.from(
    ctx.db.simulatedTrade.simulated_trades_by_user.filter(userId),
  );
  trades.sort((a, b) =>
    a.executedAt.microsSinceUnixEpoch === b.executedAt.microsSinceUnixEpoch
      ? Number(a.id - b.id)
      : a.executedAt.microsSinceUnixEpoch < b.executedAt.microsSinceUnixEpoch
        ? -1
        : 1,
  );
  const books = new Map<string, { micros: number; cost: number }>();
  let realized = 0;
  for (const trade of trades) {
    const book = books.get(trade.symbol) ?? { micros: 0, cost: 0 };
    const micros = Number(trade.quantityMicros);
    const total = Number(trade.totalCents);
    if (trade.side === "buy") {
      book.micros += micros;
      book.cost += total;
    } else if (book.micros > 0 && micros > 0) {
      const sold = Math.min(micros, book.micros);
      const costOfSold = (book.cost * sold) / book.micros;
      realized += (total * sold) / micros - costOfSold;
      book.micros -= sold;
      book.cost -= costOfSold;
    }
    books.set(trade.symbol, book);
  }
  return Math.round(realized);
}

// The most a reward can cost, and the max_price orders are placed with: the listed price plus 15% (tax, fees and a margin)
// plus $6 of shipping. Zinc refuses an order whose total would go over it. Keep in step with worstCaseCents in
// src/rewardSpend.ts and the max_price in server/index.mjs.
export function worstCaseCents(priceCents: bigint): bigint {
  return (priceCents * 115n) / 100n + 600n;
}

// Profit already spent on rewards: the real total once Zinc reports it, otherwise the worst case, so a pending
// order always keeps its money reserved. Failed orders cost nothing.
export function rewardSpendCents(ctx: any, userId: bigint): bigint {
  let spent = 0n;
  for (const order of ctx.db.wishlistOrder.wishlist_order_by_user.filter(userId)) {
    if (order.status === "failed") continue;
    spent += order.totalCents ?? worstCaseCents(order.priceCents);
  }
  return spent;
}

// A reward is only bought when the profit still available (earned minus already spent) covers its worst-case cost,
// so buying never leaves the player in the red.
export function requireAffordable(ctx: any, userId: bigint, priceCents: bigint) {
  const available = BigInt(realizedProfitCents(ctx, userId)) - rewardSpendCents(ctx, userId);
  const needed = worstCaseCents(priceCents);

  if (available < needed) {
    throw new SenderError(
      `Not enough profit left to cover this reward yet (up to $${(Number(needed) / 100).toFixed(2)} with shipping and taxes)`,
    );
  }
}
