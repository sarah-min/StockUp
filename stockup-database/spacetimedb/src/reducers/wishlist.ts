import { t } from "spacetimedb";
import spacetimedb from "..";
import { requireCurrentUser } from "../helpers/auth";

export const addWishlistItem = spacetimedb.reducer(
  {
    symbol: t.string(),
    targetPriceCents: t.u64(),
  },
  (ctx, { symbol, targetPriceCents }) => {
    const currentUser = requireCurrentUser(ctx);
    const normalizedSymbol = symbol.trim().toUpperCase();

    if (normalizedSymbol === "") {
      throw new Error("Symbol cannot be empty");
    }

    const duplicate = Array.from(
      ctx.db.wishlistItem.wishlist_by_user.filter(currentUser.id)
    ).some((item) => item.symbol === normalizedSymbol);

    if (duplicate) {
      throw new Error(`${normalizedSymbol} is already in the wishlist`);
    }

    ctx.db.wishlistItem.insert({
      id: 0n,
      userId: currentUser.id,
      symbol: normalizedSymbol,
      targetPriceCents,
    });
  }
);
