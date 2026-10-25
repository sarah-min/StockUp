type TradeRow = {
  id: bigint;
  userId: bigint;
  side: string;
  symbol: string;
  quantityMicros: bigint;
  totalCents: bigint;
  executedAt: { microsSinceUnixEpoch: bigint };
};

export type OpenPosition = {
  symbol: string;
  quantityMicros: bigint;
  costCents: number; // what is still invested in the units left, average-cost
};

// A user's open positions from their own trades, using the same average-cost bookkeeping as realizedProfit.ts.
export function openPositions(
  trades: readonly TradeRow[],
  userId: bigint,
): OpenPosition[] {
  const mine = trades
    .filter((trade) => trade.userId === userId)
    .sort(
      (a, b) =>
        Number(
          a.executedAt.microsSinceUnixEpoch - b.executedAt.microsSinceUnixEpoch,
        ) || Number(a.id - b.id),
    );
  const books = new Map<string, { micros: number; cost: number }>();
  for (const trade of mine) {
    const book = books.get(trade.symbol) ?? { micros: 0, cost: 0 };
    const micros = Number(trade.quantityMicros);
    if (trade.side === "buy") {
      book.micros += micros;
      book.cost += Number(trade.totalCents);
    } else if (book.micros > 0 && micros > 0) {
      const sold = Math.min(micros, book.micros);
      const costOfSold = (book.cost * sold) / book.micros;
      book.micros -= sold;
      book.cost -= costOfSold;
    }
    books.set(trade.symbol, book);
  }
  return [...books.entries()]
    .filter(([, book]) => book.micros > 0)
    .map(([symbol, book]) => ({
      symbol,
      quantityMicros: BigInt(Math.round(book.micros)),
      costCents: book.cost,
    }));
}
