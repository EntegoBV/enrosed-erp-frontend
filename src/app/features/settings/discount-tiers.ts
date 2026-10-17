/**
 * The dirty model of Kortingen: what changed against the saved tiers, per
 * order and per product. Pure (node-tested): a tier is compared by its
 * threshold and percentage, never by id, so a removed last tier counts as a
 * change and an untouched list never does.
 */

export interface TierLike {
  productId: number | null;
  minQuantity: number;
  percent: number;
}

const key = (tier: TierLike): string => `${Number(tier.minQuantity)}|${Number(tier.percent)}`;

/** How many rows differ between two tier lists (order of rows does not matter). */
export function tierChanges(saved: readonly TierLike[], draft: readonly TierLike[]): number {
  const left = new Map<string, number>();
  for (const tier of saved) left.set(key(tier), (left.get(key(tier)) ?? 0) + 1);
  let matches = 0;
  for (const tier of draft) {
    const count = left.get(key(tier)) ?? 0;
    if (count > 0) { matches++; left.set(key(tier), count - 1); }
  }
  return Math.max(saved.length, draft.length) - matches;
}

/** Per product (line tiers with a product), the number of changed rows; products without a change are left out. */
export function lineTierChanges(saved: readonly TierLike[], draft: readonly TierLike[]): Map<number, number> {
  const group = (tiers: readonly TierLike[]) => {
    const map = new Map<number, TierLike[]>();
    for (const tier of tiers) {
      if (tier.productId == null) continue;
      map.set(tier.productId, [...(map.get(tier.productId) ?? []), tier]);
    }
    return map;
  };
  const before = group(saved);
  const after = group(draft);
  const changes = new Map<number, number>();
  for (const productId of new Set([...before.keys(), ...after.keys()])) {
    const count = tierChanges(before.get(productId) ?? [], after.get(productId) ?? []);
    if (count > 0) changes.set(productId, count);
  }
  return changes;
}

/** Sorted by threshold (a copy). */
export function sortedTiers<T extends TierLike>(tiers: readonly T[]): T[] {
  return [...tiers].sort((left, right) => left.minQuantity - right.minQuantity);
}

/** Why a list cannot be saved: an empty or zero threshold, a percentage outside 0–100, or a threshold twice. */
export function tierProblem(tiers: readonly TierLike[]): string | null {
  if (tiers.some((tier) => !Number.isFinite(tier.minQuantity) || tier.minQuantity < 1)) return 'Elke drempel heeft een aantal van minstens 1.';
  if (tiers.some((tier) => !Number.isFinite(tier.percent) || tier.percent < 0 || tier.percent > 100)) return 'Een korting ligt tussen 0 en 100 %.';
  const seen = new Set<number>();
  for (const tier of tiers) {
    if (seen.has(tier.minQuantity)) return `De drempel ${tier.minQuantity} staat er twee keer.`;
    seen.add(tier.minQuantity);
  }
  return null;
}
