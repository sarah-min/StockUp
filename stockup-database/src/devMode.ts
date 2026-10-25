// Developer switch: 1 shows the temporary dev panels (demo buy/sell box, auto-buy settings), 0 hides them.
// The wishlist auto-buy itself keeps running either way; only its panel is hidden.
export const DEV_MODE: 0 | 1 = 0;

// TO_REMOVE: demo-only "STUP" position in Open positions. 1 shows it, 0 hides it. Selling it records a buy at
// STUP_BUY_PRICE and a sell at STUP_SELL_PRICE, so each full sell books a guaranteed profit (handy for showing the
// wishlist rewards without waiting on real prices). Delete this and the STUP code in OpenPositions.tsx before real use.
export const DEMO_STUP: 0 | 1 = 1;
export const STUP_BUY_PRICE = 100; // dollars per STUP unit
export const STUP_SELL_PRICE = 250;
