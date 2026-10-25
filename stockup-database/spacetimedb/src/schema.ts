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
    personality: t.string(),
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

const wishlistProduct = table(
  {
    name: "wishlist_product",
    public: true,
    indexes: [
      {
        accessor: "wishlist_product_by_owner",
        algorithm: "btree",
        columns: ["owner"],
      },
      {
        accessor: "wishlist_product_by_user",
        algorithm: "btree",
        columns: ["userId"],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity(),
    url: t.string(),
    retailer: t.string(),
    title: t.string(),
    brand: t.option(t.string()),
    image: t.option(t.string()),
    priceCents: t.u64(),
    // The account that owns this row (rows from before accounts have 0 and belong to nobody).
    userId: t.u64().default(0n),
  }
);

const wishlistOrder = table(
  {
    name: "wishlist_order",
    public: true,
    indexes: [
      {
        accessor: "wishlist_order_by_owner",
        algorithm: "btree",
        columns: ["owner"],
      },
      {
        accessor: "wishlist_order_by_user",
        algorithm: "btree",
        columns: ["userId"],
      },
      {
        accessor: "wishlist_order_by_status",
        algorithm: "btree",
        columns: ["status"],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity(),
    url: t.string(),
    retailer: t.string(),
    title: t.string(),
    priceCents: t.u64(),
    // pending -> placing -> placed -> delivered, or failed. Only the order server moves it past pending.
    status: t.string(),
    zincOrderId: t.option(t.string()),
    totalCents: t.option(t.u64()),
    carrier: t.option(t.string()),
    trackingNumber: t.option(t.string()),
    trackingUrl: t.option(t.string()),
    estimatedDelivery: t.option(t.string()),
    error: t.option(t.string()),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    userId: t.u64().default(0n),
    // The realized-profit target (in cents) whose crossing unlocked this purchase; 0 if unknown.
    thresholdCents: t.u64().default(0n),
  }
);

// Singleton row naming the one identity (the API server) allowed to place and update orders.
const orderServer = table(
  {
    name: "order_server",
    public: false,
  },
  {
    id: t.u64().primaryKey(),
    identity: t.identity(),
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

/*
 * Login credentials. Private: no client can read it.
 *
 * The browser never sends the password itself, only a PBKDF2 proof derived from it
 * (see src/auth/password.ts). The module stores a salted, iterated SHA-256 of that proof.
 */
const credential = table(
  {
    name: "credential",
    public: false,
  },
  {
    username: t.string().primaryKey(), // lowercase, [a-z0-9_]{3,20}
    userId: t.u64().unique(),
    salt: t.string(),
    passwordHash: t.string(),
    createdAt: t.timestamp(),
  }
);

/*
 * Who is signed in on which connection identity. Public so a browser can see its own row
 * (filter by your identity); it reveals only identity -> username, never credentials.
 * Kept in step with user_auth by the account reducers.
 */
const session = table(
  {
    name: "session",
    public: true,
    indexes: [
      {
        accessor: "session_by_user",
        algorithm: "btree",
        columns: ["userId"],
      },
    ],
  },
  {
    identity: t.identity().primaryKey(),
    userId: t.u64(),
    username: t.string(),
    signedInAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  user,
  userAuth,
  coinbaseAccount,
  agent,
  wishlistItem,
  wishlistProduct,
  wishlistOrder,
  orderServer,
  agentPosition,
  marketPrice,
  trade,
  config,
  credential,
  session,
});

export default spacetimedb;