import { t } from "spacetimedb";
import { SenderError } from "spacetimedb/server";
import spacetimedb from "..";
import { requireCurrentUser } from "../helpers/auth";
import { realizedProfitCents, requireAffordable } from "../helpers/profit";

const ORDER_SERVER_ID = 0n;
const SERVER_STATUSES = ["placing", "placed", "delivered", "failed"];
const FINAL_STATUSES = ["delivered", "failed"];

function requireOrderServer(ctx: any) {
  const server = ctx.db.orderServer.id.find(ORDER_SERVER_ID);

  if (!server || !server.identity.equals(ctx.sender)) {
    throw new SenderError("Only the order server can do this");
  }
}

// First caller becomes the order server; later calls only succeed for that same identity.
export const claimOrderServer = spacetimedb.reducer((ctx) => {
  const existing = ctx.db.orderServer.id.find(ORDER_SERVER_ID);

  if (existing) {
    if (!existing.identity.equals(ctx.sender)) {
      throw new SenderError("Order server is already claimed");
    }
    return;
  }

  ctx.db.orderServer.insert({ id: ORDER_SERVER_ID, identity: ctx.sender });
});

// Turns a wishlist item into a pending order in one transaction. The wishlist row is deleted in the same
// transaction, so a second attempt for the same item (another tab, a retry) fails and can never buy it twice.
export const beginPurchase = spacetimedb.reducer(
  { productId: t.u64(), thresholdCents: t.u64() },
  (ctx, { productId, thresholdCents }) => {
    const currentUser = requireCurrentUser(ctx);
    const item = ctx.db.wishlistProduct.id.find(productId);

    if (!item || item.userId !== currentUser.id) {
      throw new SenderError("Wishlist item not found");
    }

    // Only this user's own realized profit can unlock their reward.
    if (BigInt(realizedProfitCents(ctx, currentUser.id)) < thresholdCents) {
      throw new SenderError(
        "Your realized profit hasn't reached this target yet",
      );
    }

    requireAffordable(ctx, currentUser.id, item.priceCents);

    ctx.db.wishlistProduct.id.delete(productId);
    ctx.db.wishlistOrder.insert({
      id: 0n,
      owner: ctx.sender,
      userId: currentUser.id,
      thresholdCents,
      url: item.url,
      retailer: item.retailer,
      title: item.title,
      priceCents: item.priceCents,
      status: "pending",
      zincOrderId: undefined,
      totalCents: undefined,
      carrier: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      estimatedDelivery: undefined,
      error: undefined,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
  },
);

// Auto-buy for a milestone: marks the milestone reached and turns the user's cheapest wishlist item into a pending order,
// all in one transaction, so a milestone can fire only once even if two tabs race. The client checks the profit
// from the user's own trades; this reducer re-checks that profit and guards ownership, acceptance and the once-only rule.
export const beginMilestonePurchase = spacetimedb.reducer(
  { milestoneId: t.u64() },
  (ctx, { milestoneId }) => {
    const currentUser = requireCurrentUser(ctx);
    const milestone = ctx.db.milestone.id.find(milestoneId);

    if (!milestone || milestone.userId !== currentUser.id) {
      throw new SenderError("Milestone not found");
    }

    if (!milestone.accepted) {
      throw new SenderError(
        "Accept your milestones before they can unlock rewards",
      );
    }

    if (milestone.reached) {
      throw new SenderError("Milestone already reached");
    }

    // Only this user's own realized profit can unlock their reward.
    if (
      BigInt(realizedProfitCents(ctx, currentUser.id)) - milestone.baselineCents <
      milestone.targetCents
    ) {
      throw new SenderError(
        "Your realized profit hasn't reached this milestone yet",
      );
    }

    const cheapest = Array.from(
      ctx.db.wishlistProduct.wishlist_product_by_user.filter(currentUser.id),
    ).sort((a, b) =>
      a.priceCents === b.priceCents
        ? Number(a.id - b.id)
        : a.priceCents < b.priceCents
          ? -1
          : 1,
    )[0];

    if (!cheapest) {
      throw new SenderError("Your wishlist is empty");
    }

    requireAffordable(ctx, currentUser.id, cheapest.priceCents);

    ctx.db.milestone.id.update({ ...milestone, reached: true });
    ctx.db.wishlistProduct.id.delete(cheapest.id);
    ctx.db.wishlistOrder.insert({
      id: 0n,
      owner: ctx.sender,
      userId: currentUser.id,
      thresholdCents: milestone.targetCents,
      url: cheapest.url,
      retailer: cheapest.retailer,
      title: cheapest.title,
      priceCents: cheapest.priceCents,
      status: "pending",
      zincOrderId: undefined,
      totalCents: undefined,
      carrier: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      estimatedDelivery: undefined,
      error: undefined,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
  },
);

// Maintenance, order server only: deletes a player's finished (delivered or failed) reward orders, e.g. to wipe test
// purchases so they stop counting against the player's profit.
export const clearFinishedOrders = spacetimedb.reducer(
  { userId: t.u64() },
  (ctx, { userId }) => {
    requireOrderServer(ctx);

    for (const order of Array.from(
      ctx.db.wishlistOrder.wishlist_order_by_user.filter(userId),
    )) {
      if (FINAL_STATUSES.includes(order.status)) {
        ctx.db.wishlistOrder.id.delete(order.id);
      }
    }
  },
);

// Called only by the order server to record progress. Delivered and failed orders are final.
export const syncOrder = spacetimedb.reducer(
  {
    id: t.u64(),
    status: t.string(),
    zincOrderId: t.option(t.string()),
    totalCents: t.option(t.u64()),
    carrier: t.option(t.string()),
    trackingNumber: t.option(t.string()),
    trackingUrl: t.option(t.string()),
    estimatedDelivery: t.option(t.string()),
    error: t.option(t.string()),
  },
  (ctx, { id, status, ...details }) => {
    requireOrderServer(ctx);

    if (!SERVER_STATUSES.includes(status)) {
      throw new SenderError(`Invalid order status: ${status}`);
    }

    const order = ctx.db.wishlistOrder.id.find(id);

    if (!order) {
      throw new SenderError("Order not found");
    }

    if (FINAL_STATUSES.includes(order.status)) {
      throw new SenderError(`Order is already ${order.status}`);
    }

    ctx.db.wishlistOrder.id.update({
      ...order,
      ...details,
      status,
      updatedAt: ctx.timestamp,
    });
  },
);
