import spacetimedb from "..";


export function requireCurrentUser(ctx: any) {
  const auth = ctx.db.userAuth.identity.find(ctx.sender);

  if (!auth) {
    throw new Error("You must create a user first");
  }

  const currentUser = ctx.db.user.id.find(auth.userId);

  if (!currentUser) {
    throw new Error("User record is missing");
  }

  return currentUser;
}

export function requireOwnedAgent(ctx: any, agentId: bigint) {
  const currentUser = requireCurrentUser(ctx);
  const currentAgent = ctx.db.agent.id.find(agentId);

  if (!currentAgent) {
    throw new Error("Agent not found");
  }

  if (currentAgent.userId !== currentUser.id) {
    throw new Error("You do not own this agent");
  }

  return { currentUser, currentAgent };
}

export function getMarket(ctx: any) {
  const setting = ctx.db.config.key.find("market_user_id");

  if (!setting) {
    throw new Error("Market has not been initialized");
  }

  const market = ctx.db.user.id.find(setting.userIdValue);

  if (!market) {
    throw new Error("Market user is missing");
  }

  return market;
}
