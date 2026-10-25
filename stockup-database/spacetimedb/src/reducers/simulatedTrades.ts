import { t } from "spacetimedb";
import { SenderError } from "spacetimedb/server";
import spacetimedb from "..";
import { requireCurrentUser } from "../helpers/auth";

const QUANTITY_SCALE = 1_000_000n;

// Records one executed (simulated) trade for the signed-in user. Trades stand on their own: there are no
// saved agents, balances or positions to check. How much a trade can be is decided in "Set your play"
// (the budget), which the API enforces when it builds the proposal.
export const executeSimulatedTrade = spacetimedb.reducer(
  {
    side: t.string(),
    symbol: t.string(),
    quantityMicros: t.u64(),
    priceCents: t.u64(),
    totalCents: t.u64(),
  },
  (ctx, { side, symbol, quantityMicros, priceCents, totalCents }) => {
    const currentUser = requireCurrentUser(ctx);

    if (side !== "buy" && side !== "sell") {
      throw new SenderError('Side must be either "buy" or "sell"');
    }
    if (quantityMicros === 0n || priceCents === 0n || totalCents === 0n) {
      throw new SenderError("Quantity, price, and total must be greater than zero");
    }

    const expectedTotalCents =
      (quantityMicros * priceCents + QUANTITY_SCALE - 1n) / QUANTITY_SCALE;
    if (totalCents !== expectedTotalCents) {
      throw new SenderError("Trade total does not match quantity and price");
    }

    ctx.db.simulatedTrade.insert({
      id: 0n,
      userId: currentUser.id,
      // Kept for the existing table shape; trades are no longer tied to an agent or the market account.
      agentId: 0n,
      marketUserId: 0n,
      side,
      symbol: symbol.trim().toUpperCase(),
      quantityMicros,
      priceCents,
      totalCents,
      executedAt: ctx.timestamp,
    });
  }
);
