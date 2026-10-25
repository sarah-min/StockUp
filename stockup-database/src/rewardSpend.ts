import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { useMyUserId } from './useMyUserId';

// The most a reward can cost: listed price + 15% (tax, fees, margin) + $6 shipping. Mirrors worstCaseCents in the module
// and the max_price in server/index.mjs.
export function worstCaseCents(priceCents: bigint): bigint {
  return (priceCents * 115n) / 100n + 600n;
}

// Dollars the signed-in player has spent on wishlist rewards. Same rule as the module: an order's real total once
// known, otherwise its worst case (the cap orders are placed with); failed orders cost nothing.
export function useRewardSpend(): number {
  const myUserId = useMyUserId();
  const [orders] = useTable(tables.wishlistOrder);
  if (myUserId === undefined) return 0;
  const cents = orders
    .filter((order) => order.userId === myUserId && order.status !== 'failed')
    .reduce((sum, order) => sum + Number(order.totalCents ?? worstCaseCents(order.priceCents)), 0);
  return cents / 100;
}
