import { t } from "spacetimedb";
import spacetimedb from "..";
import { requireCurrentUser } from "../helpers/auth";

export const createAgent = spacetimedb.reducer(
  {
    name: t.string(),
    apiEndpoint: t.string(),
    personality: t.string(),
    initialBalanceCents: t.u64(),
  },
  (ctx, { name, apiEndpoint, personality, initialBalanceCents }) => {
    const currentUser = requireCurrentUser(ctx);

    if (initialBalanceCents > currentUser.balanceCents) {
      throw new Error("User does not have enough unallocated balance");
    }

    currentUser.balanceCents -= initialBalanceCents;
    ctx.db.user.id.update(currentUser);

    ctx.db.agent.insert({
      id: 0n,
      userId: currentUser.id,
      name,
      apiEndpoint,
      personality,
      balanceCents: initialBalanceCents,
      enabled: true,
    });
  }
);