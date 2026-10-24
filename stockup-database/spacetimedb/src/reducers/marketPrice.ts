import { t } from "spacetimedb";
import spacetimedb from "../schema";

export const setMarketPrice = spacetimedb.reducer(
  {
    symbol: t.string(),
    priceCents: t.u64(),
  },
  (ctx, { symbol, priceCents }) => {
    const normalizedSymbol = symbol.trim().toUpperCase();

    if (normalizedSymbol === "") {
      throw new Error("Symbol cannot be empty");
    }

    if (priceCents === 0n) {
      throw new Error("Price must be greater than zero");
    }

    const existingPrice =
      ctx.db.marketPrice.symbol.find(normalizedSymbol);

    if (existingPrice) {
      existingPrice.priceCents = priceCents;
      existingPrice.updatedAt = ctx.timestamp;

      ctx.db.marketPrice.symbol.update(existingPrice);
    } else {
      ctx.db.marketPrice.insert({
        symbol: normalizedSymbol,
        priceCents,
        updatedAt: ctx.timestamp,
      });
    }
  }
);