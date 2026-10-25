import { t } from "spacetimedb";
import spacetimedb from "..";
import { getMarket, requireOwnedAgent } from "../helpers/auth";

const QUANTITY_SCALE = 1_000_000n;

export const executeSimulatedTrade = spacetimedb.reducer(
  {
    agentId: t.u64(),
    side: t.string(),
    symbol: t.string(),
    quantityMicros: t.u64(),
    priceCents: t.u64(),
    totalCents: t.u64(),
  },
  (
    ctx,
    { agentId, side, symbol, quantityMicros, priceCents, totalCents },
  ) => {
    const { currentUser, currentAgent } = requireOwnedAgent(ctx, agentId);

    if (!currentAgent.enabled) {
      throw new Error("Agent is disabled");
    }
    if (side !== "buy" && side !== "sell") {
      throw new Error('Side must be either "buy" or "sell"');
    }
    if (
      quantityMicros === 0n ||
      priceCents === 0n ||
      totalCents === 0n
    ) {
      throw new Error("Quantity, price, and total must be greater than zero");
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    const expectedTotalCents =
      (quantityMicros * priceCents + QUANTITY_SCALE - 1n) / QUANTITY_SCALE;
    if (totalCents !== expectedTotalCents) {
      throw new Error("Trade total does not match quantity and price");
    }

    const market = getMarket(ctx);
    const existingPosition = Array.from(
      ctx.db.simulatedPosition.simulated_positions_by_agent.filter(agentId),
    ).find((position) => position.symbol === normalizedSymbol);

    if (side === "buy") {
      if (currentAgent.balanceCents < totalCents) {
        throw new Error("Agent has insufficient funds");
      }

      currentAgent.balanceCents -= totalCents;
      market.balanceCents += totalCents;

      if (existingPosition) {
        existingPosition.quantityMicros += quantityMicros;
        ctx.db.simulatedPosition.id.update(existingPosition);
      } else {
        ctx.db.simulatedPosition.insert({
          id: 0n,
          agentId,
          symbol: normalizedSymbol,
          quantityMicros,
        });
      }
    } else {
      if (
        !existingPosition ||
        existingPosition.quantityMicros < quantityMicros
      ) {
        throw new Error("Agent does not own enough simulated quantity");
      }
      if (market.balanceCents < totalCents) {
        throw new Error("Market has insufficient funds");
      }

      existingPosition.quantityMicros -= quantityMicros;
      currentAgent.balanceCents += totalCents;
      market.balanceCents -= totalCents;

      if (existingPosition.quantityMicros === 0n) {
        ctx.db.simulatedPosition.id.delete(existingPosition.id);
      } else {
        ctx.db.simulatedPosition.id.update(existingPosition);
      }
    }

    ctx.db.agent.id.update(currentAgent);
    ctx.db.user.id.update(market);
    ctx.db.simulatedTrade.insert({
      id: 0n,
      userId: currentUser.id,
      agentId,
      marketUserId: market.id,
      side,
      symbol: normalizedSymbol,
      quantityMicros,
      priceCents,
      totalCents,
      executedAt: ctx.timestamp,
    });
  },
);
