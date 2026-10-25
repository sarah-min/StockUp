import { t } from "spacetimedb";
import { SenderError } from "spacetimedb/server";
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
      throw new SenderError("Symbol cannot be empty");
    }

    const duplicate = Array.from(
      ctx.db.wishlistItem.wishlist_by_user.filter(currentUser.id)
    ).some((item) => item.symbol === normalizedSymbol);

    if (duplicate) {
      throw new SenderError(`${normalizedSymbol} is already in the wishlist`);
    }

    ctx.db.wishlistItem.insert({
      id: 0n,
      userId: currentUser.id,
      symbol: normalizedSymbol,
      targetPriceCents,
    });
  }
);

export const addWishlistProduct = spacetimedb.reducer(
  {
    url: t.string(),
    retailer: t.string(),
    title: t.string(),
    brand: t.option(t.string()),
    image: t.option(t.string()),
    priceCents: t.u64(),
  },
  (ctx, { url, retailer, title, brand, image, priceCents }) => {
    const trimmedUrl = url.trim();

    if (trimmedUrl === "") {
      throw new SenderError("Product URL cannot be empty");
    }

    const currentUser = requireCurrentUser(ctx);

    const duplicate = Array.from(
      ctx.db.wishlistProduct.wishlist_product_by_user.filter(currentUser.id)
    ).some((item) => item.url === trimmedUrl);

    if (duplicate) {
      throw new SenderError("That product is already in the wishlist");
    }

    ctx.db.wishlistProduct.insert({
      id: 0n,
      owner: ctx.sender,
      userId: currentUser.id,
      url: trimmedUrl,
      retailer,
      title,
      brand,
      image,
      priceCents,
    });
  }
);

export const removeWishlistProduct = spacetimedb.reducer(
  { id: t.u64() },
  (ctx, { id }) => {
    const currentUser = requireCurrentUser(ctx);
    const item = ctx.db.wishlistProduct.id.find(id);

    if (!item || item.userId !== currentUser.id) {
      throw new SenderError("Wishlist item not found");
    }

    ctx.db.wishlistProduct.id.delete(id);
  }
);
