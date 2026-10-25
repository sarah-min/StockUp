import { useTable } from "spacetimedb/react";
import { tables } from "./module_bindings";
import { useMyUserId } from "./useMyUserId";

type TradeRow = {
  id: bigint;
  userId: bigint;
  side: string;
  symbol: string;
  quantityMicros: bigint;
  totalCents: bigint;
  executedAt: { microsSinceUnixEpoch: bigint };
};

// Realized profit in dollars from one user's own trades, average-cost per symbol.
// Mirrors realizedProfitCents in spacetimedb/src/helpers/profit.ts, which re-checks it before any reward is bought.
export function realizedProfit(
  trades: readonly TradeRow[],
  userId: bigint,
): number {
  const mine = trades
    .filter((trade) => trade.userId === userId)
    .sort(
      (a, b) =>
        Number(
          a.executedAt.microsSinceUnixEpoch - b.executedAt.microsSinceUnixEpoch,
        ) || Number(a.id - b.id),
    );
  const books = new Map<string, { micros: number; cost: number }>();
  let realized = 0;
  for (const trade of mine) {
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
  return Math.round(realized) / 100;
}

// The signed-in player's realized profit (null until their session loads). Updates live as their trades arrive.
export function useRealizedProfit(): number | null {
  const myUserId = useMyUserId();
  const [trades] = useTable(tables.simulatedTrade);
  return myUserId === undefined ? null : realizedProfit(trades, myUserId);
}
