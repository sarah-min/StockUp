import { schema, table, t } from "spacetimedb/server";

/*
 * Store money as integer cents.
 *
 * $123.45 => 12345n
 *
 * Avoid f32/f64 for monetary values because floating-point rounding can
 * eventually make balances inconsistent.
 */

const user = table(
  {
    name: "user",
    public: true,
  },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    balanceCents: t.u64(),
    balanceStock: t.u64(),
    isMarket: t.bool(),
  }
);

/*
 * Maps a SpacetimeDB login identity to an application user.
 *
 * The Market user intentionally has no user_auth row because it is a system
 * account rather than a human who signs in.
 */
const userAuth = table(
  {
    name: "user_auth",
    public: false,
  },
  {
    identity: t.identity().primaryKey(),
    userId: t.u64().unique(),
  }
);

/*
 * Keep financial-account information private.
 *
 * Store a Coinbase customer/account ID, not an API secret.
 */
const coinbaseAccount = table(
  {
    name: "coinbase_account",
    public: false,
  },
  {
    userId: t.u64().primaryKey(),
    coinbaseAccountId: t.string().unique(),
  }
);

const agent = table(
  {
    name: "agent",
    public: true,
    indexes: [
      {
        accessor: "agent_by_user",
        algorithm: "btree",
        columns: ["userId"],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    userId: t.u64(),
    name: t.string(),
    apiEndpoint: t.string().unique(),
    balanceCents: t.u64(),
    enabled: t.bool(),
  }
);

const wishlistItem = table(
  {
    name: "wishlist_item",
    public: true,
    indexes: [
      {
        accessor: "wishlist_by_user",
        algorithm: "btree",
        columns: ["userId"],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    userId: t.u64(),
    symbol: t.string(),
    targetPriceCents: t.u64(),
  }
);

const agentPosition = table(
  {
    name: "agent_position",
    public: true,
    indexes: [
      {
        accessor: "positions_by_agent",
        algorithm: "btree",
        columns: ["agentId"],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    agentId: t.u64(),
    symbol: t.string(),
    quantity: t.u64(),
  }
);

const marketPrice = table(
  {
    name: "market_price",
    public: true,
  },
  {
    symbol: t.string().primaryKey(),
    priceCents: t.u64(),
    updatedAt: t.timestamp(),
  }
);

/*
 * Immutable ledger of completed trades.
 *
 * side is from the agent's perspective:
 *   "buy"  => market sold to the agent
 *   "sell" => market bought from the agent
 */
const trade = table(
  {
    name: "trade",
    public: true,
    indexes: [
      {
        accessor: "trades_by_user",
        algorithm: "btree",
        columns: ["userId"],
      },
      {
        accessor: "trades_by_agent",
        algorithm: "btree",
        columns: ["agentId"],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    userId: t.u64(),
    agentId: t.u64(),
    marketUserId: t.u64(),
    side: t.string(),
    symbol: t.string(),
    quantity: t.u64(),
    priceCents: t.u64(),
    totalCents: t.u64(),
    executedAt: t.timestamp(),
  }
);

const config = table(
  {
    name: "config",
    public: false,
  },
  {
    key: t.string().primaryKey(),
    userIdValue: t.u64(),
  }
);

const spacetimedb = schema({
  user,
  userAuth,
  coinbaseAccount,
  agent,
  wishlistItem,
  agentPosition,
  marketPrice,
  trade,
  config,
});

export default spacetimedb;