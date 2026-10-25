import { SenderError } from "spacetimedb/server";
import spacetimedb from "..";


export function requireCurrentUser(ctx: any) {
  const auth = ctx.db.userAuth.identity.find(ctx.sender);

  if (!auth) {
    throw new SenderError("You must create a user first");
  }

  const currentUser = ctx.db.user.id.find(auth.userId);

  if (!currentUser) {
    throw new SenderError("User record is missing");
  }

  return currentUser;
}

export function requireOwnedAgent(ctx: any, agentId: bigint) {
  const currentUser = requireCurrentUser(ctx);
  const currentAgent = ctx.db.agent.id.find(agentId);

  if (!currentAgent) {
    throw new SenderError("Agent not found");
  }

  if (currentAgent.userId !== currentUser.id) {
    throw new SenderError("You do not own this agent");
  }

  return { currentUser, currentAgent };
}

export function getMarket(ctx: any) {
  const setting = ctx.db.config.key.find("market_user_id");

  if (!setting) {
    throw new SenderError("Market has not been initialized");
  }

  const market = ctx.db.user.id.find(setting.userIdValue);

  if (!market) {
    throw new SenderError("Market user is missing");
  }

  return market;
}
