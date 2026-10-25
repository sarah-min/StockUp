import { t } from "spacetimedb";
import { SenderError } from "spacetimedb/server";
import spacetimedb from "..";
import { requireCurrentUser } from "../helpers/auth";

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
  }
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
  }
);
