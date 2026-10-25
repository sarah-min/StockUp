// Milestones are sized for the wishlist they were generated from. We remember which items that was (their ids)
// and call the milestones out of date once the wishlist contains an item that wasn't part of it. Items that
// disappeared (bought by auto-buy, or removed) don't count, so earning a reward doesn't flag them.
export function snapshotOf(items: { id: bigint }[]) {
  return items
    .map((item) => item.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join(",");
}

export function isOutOfDate(snapshot: string, items: { id: bigint }[]) {
  if (snapshot === "") return false; // saved before snapshots existed
  const known = new Set(snapshot.split(","));
  return items.some((item) => !known.has(String(item.id)));
}
