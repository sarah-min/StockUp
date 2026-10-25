import { t } from "spacetimedb";
import spacetimedb from "..";

export const init = spacetimedb.init((ctx) => {
  const market = ctx.db.user.insert({
    id: 0n,
    name: "Market",
    balanceCents: 1_000_000_000_000n,
    balanceStock: 0n,
    isMarket: true,
  });

  ctx.db.config.insert({
    key: "market_user_id",
    userIdValue: market.id,
  });
});