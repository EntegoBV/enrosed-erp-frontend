/**
 * The arithmetic behind the pallet planner, kept free of Angular so the
 * node tests can read it: how high a hand-built pallet stacks, and the
 * colour each product keeps across the pallets.
 */

/** Canonical B × D labels; also upgrades the two historical D × B values. */
export function normalizeManualPalletType(value: string): string {
  const trimmed = value.trim();
  const key = trimmed.toLocaleLowerCase('nl-BE').replace(/\s+/g, '').replace(/x/g, '×');
  if (key === 'blokpallet120×100' || key === 'blokpallet100×120') {
    return 'Blokpallet 120×100';
  }
  if (key === 'halvepallet80×60' || key === 'halvepallet60×80') {
    return 'Halve pallet 80×60';
  }
  if (key === 'europallet' || key === 'europallet120×80') return 'Europallet';
  return trimmed;
}

/**
 * The height a hand-built pallet reaches, estimated from the calculator's
 * stacking of each product on it: the base pallet plus, per product, the
 * layers its cartons need. A measured height always wins over the estimate.
 */
export function estimatePalletHeightCm(
  pallet: { items: { productId: number; cartons: number }[]; heightCm: number | null },
  lines: readonly { productId: number; cartonsPerLayer?: number; palletLayers?: number;
    calculatedPalletHeightCm?: number }[],
  baseHeightCm: number,
): { heightCm: number | null; measured: boolean } {
  if (pallet.heightCm != null) return { heightCm: pallet.heightCm, measured: true };
  let height = baseHeightCm;
  let known = false;
  for (const item of pallet.items) {
    const line = lines.find((candidate) => candidate.productId === item.productId);
    if (!line || !line.cartonsPerLayer || !line.palletLayers || !line.calculatedPalletHeightCm
        || item.cartons <= 0) continue;
    const layerHeight = (line.calculatedPalletHeightCm - baseHeightCm) / line.palletLayers;
    height += Math.ceil(item.cartons / line.cartonsPerLayer) * layerHeight;
    known = true;
  }
  return { heightCm: known ? Math.round(height) : null, measured: false };
}

/** One colour per product on the pallets, so a mixed pallet reads at a glance. */
export const PALLET_PRODUCT_COLOURS = [
  '#8f2942', '#2e7d4f', '#c6862f', '#3f6fb5', '#7a4fb8', '#d1553d', '#1f8a8a', '#8a6b2a',
] as const;
