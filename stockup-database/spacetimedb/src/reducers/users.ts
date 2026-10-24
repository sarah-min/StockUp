import { t } from "spacetimedb";
import spacetimedb from "..";

export const createUser = spacetimedb.reducer(
  {
    name: t.string(),
    coinbaseAccountId: t.string().optional(),
    startingBalanceCents: t.u64(),
  },
  (ctx, { name, coinbaseAccountId, startingBalanceCents }) => {
    if (name.trim() === "") {
      throw new Error("Name cannot be empty");
    }

    if (ctx.db.userAuth.identity.find(ctx.sender)) {
      throw new Error("This identity already has a user");
    }

    const createdUser = ctx.db.user.insert({
      id: 0n,
      name: name.trim(),
      balanceCents: startingBalanceCents,
      balanceStock: 0n,
      isMarket: false,
    });

    ctx.db.userAuth.insert({
      identity: ctx.sender,
      userId: createdUser.id,
    });

    if (coinbaseAccountId !== undefined) {
      ctx.db.coinbaseAccount.insert({
        userId: createdUser.id,
        coinbaseAccountId,
      });
    }
  }
);