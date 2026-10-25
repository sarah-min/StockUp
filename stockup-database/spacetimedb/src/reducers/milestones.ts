import { t } from "spacetimedb";
import { SenderError } from "spacetimedb/server";
import spacetimedb from "..";
import { requireCurrentUser } from "../helpers/auth";

const MAX_MILESTONES = 10;

// "$1,200.50" -> 120050n; anything without a positive number is rejected.
function dollarsToCents(target: string) {
  const match = target.replace(/,/g, "").match(/\d+(\.\d+)?/);
  const dollars = match ? Number(match[0]) : 0;

  if (!(dollars > 0)) {
    throw new SenderError(`Milestone target needs a dollar amount: "${target}"`);
  }

  return BigInt(Math.round(dollars * 100));
}

// Replaces the signed-in user's milestones with this set.
export const saveMilestones = spacetimedb.reducer(
  {
    // Parallel arrays (one entry per milestone): the client bindings can't generate a type for an array of objects.
    names: t.array(t.string()),
    targets: t.array(t.string()),
    rationales: t.array(t.string()),
    accepted: t.bool(),
    wishlistSnapshot: t.string(),
  },
  (ctx, { names, targets, rationales, accepted, wishlistSnapshot }) => {
    const currentUser = requireCurrentUser(ctx);

    if (targets.length !== names.length || rationales.length !== names.length) {
      throw new SenderError("Milestone lists must be the same length");
    }

    if (names.length === 0 || names.length > MAX_MILESTONES) {
      throw new SenderError(`Save between 1 and ${MAX_MILESTONES} milestones`);
    }

    const rows = names.map((name, index) => ({
      name: name.trim(),
      target: targets[index],
      rationale: rationales[index],
      targetCents: dollarsToCents(targets[index]),
    }));

    if (rows.some((row) => row.name === "")) {
      throw new SenderError("Every milestone needs a name");
    }

    const previous = Array.from(
      ctx.db.milestone.milestone_by_user.filter(currentUser.id)
    );

    // Regenerating must not make already-rewarded profit buy again: targets at or below the highest
    // milestone that already fired count as reached.
    const highestReached = previous
      .filter((old) => old.reached)
      .reduce((max, old) => (old.targetCents > max ? old.targetCents : max), 0n);

    for (const old of previous) {
      ctx.db.milestone.id.delete(old.id);
    }

    for (const row of rows) {
      ctx.db.milestone.insert({
        id: 0n,
        userId: currentUser.id,
        name: row.name,
        target: row.target.trim(),
        targetCents: row.targetCents,
        rationale: row.rationale,
        accepted,
        createdAt: ctx.timestamp,
        reached: row.targetCents <= highestReached,
        wishlistSnapshot,
      });
    }
  }
);
