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
