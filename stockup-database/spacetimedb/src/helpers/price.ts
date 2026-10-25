const QUANTITY_SCALE = 1_000_000n;

function getUserHoldings(ctx: any, userId: bigint) {
  const holdings = new Map<
    string,
    {
      symbol: string;
      quantity: bigint;
      priceCents: bigint;
      valueCents: bigint;
    }
  >();

  for (const currentAgent of ctx.db.agent.agent_by_user.filter(userId)) {
    for (
      const position of
      ctx.db.agentPosition.positions_by_agent.filter(currentAgent.id)
    ) {
      const price =
        ctx.db.marketPrice.symbol.find(position.symbol)?.priceCents ?? 0n;

      const existing = holdings.get(position.symbol);

      if (existing) {
        existing.quantity += position.quantity;
        existing.valueCents =
          (existing.quantity * price) / QUANTITY_SCALE;
      } else {
        holdings.set(position.symbol, {
          symbol: position.symbol,
          quantity: position.quantity,
          priceCents: price,
          valueCents:
            (BigInt(position.quantity) * BigInt(price)) / QUANTITY_SCALE,
        });
      }
    }
  }

  return Array.from(holdings.values());
}
