import  { t } from "spacetimedb";
import spacetimedb from "..";
import { getMarket, requireOwnedAgent } from "../helpers/auth";

// Quantities are stored as millionths so the ledger supports fractional
// shares/coins (for example, $10 of BTC is much less than one whole BTC).
const QUANTITY_SCALE = 1_000_000n;

export const executeTrade = spacetimedb.reducer(
  {
    agentId: t.u64(),
    side: t.string(),
    symbol: t.string(),
    quantity: t.u64(),
    priceCents: t.u64(),
  },
  (ctx, { agentId, side, symbol, quantity, priceCents }) => {
    const { currentUser, currentAgent } =
      requireOwnedAgent(ctx, agentId);

    if (!currentAgent.enabled) {
      throw new Error("Agent is disabled");
    }

    if (side !== "buy" && side !== "sell") {
      throw new Error('Side must be either "buy" or "sell"');
    }

    if (quantity === 0n || priceCents === 0n) {
      throw new Error("Quantity and price must be greater than zero");
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    const totalCents =
      (quantity * priceCents + QUANTITY_SCALE / 2n) / QUANTITY_SCALE;
    const market = getMarket(ctx);

    const existingPosition = Array.from(
      ctx.db.agentPosition.positions_by_agent.filter(agentId)
    ).find((position) => position.symbol === normalizedSymbol);

    if (side === "buy") {
      if (currentAgent.balanceCents < totalCents) {
        throw new Error("Agent has insufficient funds");
      }

      currentAgent.balanceCents -= totalCents;
      market.balanceCents += totalCents;

      if (existingPosition) {
        existingPosition.quantity += quantity;
        ctx.db.agentPosition.id.update(existingPosition);
      } else {
        ctx.db.agentPosition.insert({
          id: 0n,
          agentId,
          symbol: normalizedSymbol,
          quantity,
        });
      }
    } else {
      if (!existingPosition || existingPosition.quantity < quantity) {
        throw new Error("Agent does not own enough shares");
      }

      if (market.balanceCents < totalCents) {
        throw new Error("Market has insufficient funds");
      }

      existingPosition.quantity -= quantity;
      currentAgent.balanceCents += totalCents;
      market.balanceCents -= totalCents;

      if (existingPosition.quantity === 0n) {
        ctx.db.agentPosition.id.delete(existingPosition.id);
      } else {
        ctx.db.agentPosition.id.update(existingPosition);
      }
    }

    ctx.db.agent.id.update(currentAgent);
    ctx.db.user.id.update(market);

    ctx.db.trade.insert({
      id: 0n,
      userId: currentUser.id,
      agentId,
      marketUserId: market.id,
      side,
      symbol: normalizedSymbol,
      quantity,
      priceCents,
      totalCents,
      executedAt: ctx.timestamp,
    });
  }
);
