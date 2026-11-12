import type { OrderPallet, PalletProfile, PricedOrder } from '../../core/api/models';

/**
 * The arithmetic behind the pallet planner, kept free of Angular: how high
 * a hand-built pallet stacks, the colour each product keeps across the
 * pallets, how a hand layout keeps its names and follows the order, and
 * which pallet count an order ships on.
 */

type PalletTotals = PricedOrder['totals'];

/** The automatic count: the server's, under its rule; an older server counts every product on pallets of its own. */
export function automaticPallets(totals: Pick<PalletTotals, 'palletsStrict' | 'palletsAutomatic'>): number {
  return totals.palletsAutomatic ?? totals.palletsStrict;
}

/** What the order ships on, and the freight counts: its hand-built pallets, else the automatic count. */
export function shippedPallets(totals: Pick<PalletTotals, 'palletsManual' | 'palletsStrict' | 'palletsAutomatic'>): number {
  return totals.palletsManual || automaticPallets(totals);
}

/** The pallets one product stands on in the automatic layout; an older server sends the line's own count. */
export function automaticLinePallets(totals: Pick<PalletTotals, 'autoPallets'>, line: { productId: number; pallets: number }): number {
  const pallets = totals.autoPallets;
  return pallets ? pallets.filter((pallet) => pallet.items.some((item) => item.productId === line.productId)).length : line.pallets;
}

/** The type a new pallet of this profile carries (and the pakbon prints). */
export function palletTypeLabel(profile: PalletProfile | null | undefined): string {
  switch (profile) {
    case 'BLOCK_120X100': return 'Blokpallet 120×100';
    case 'HALF_80X60': return 'Halve pallet 80×60';
    default: return 'Europallet';
  }
}

const NUMBERED = /^Pallet \d+$/;

/** A pallet still called "Pallet n" follows its position; a name of its own stays. */
export function relabelPallets(pallets: OrderPallet[]): OrderPallet[] {
  return pallets.map((pallet, index) => {
    const label = `Pallet ${index + 1}`;
    return NUMBERED.test(pallet.label.trim()) && pallet.label !== label ? { ...pallet, label } : pallet;
  });
}

/** "Pallet n" for a pallet added at the end, never a number another pallet already carries. */
export function nextPalletLabel(pallets: readonly { label: string }[]): string {
  const taken = new Set(pallets.map((pallet) => pallet.label.trim()));
  let number = pallets.length + 1;
  while (taken.has(`Pallet ${number}`)) number++;
  return `Pallet ${number}`;
}

/**
 * The hand layout after the order changed: a product with more omdozen on
 * pallets than its limit loses the excess from the last pallets first, and
 * a pallet that this leaves empty goes. Products without a limit stay as
 * they are; the same list comes back when nothing changes.
 */
export function trimPallets(pallets: OrderPallet[], limits: ReadonlyMap<number, number>): OrderPallet[] {
  const excess = new Map<number, number>();
  for (const item of pallets.flatMap((pallet) => pallet.items)) {
    if (limits.has(item.productId)) excess.set(item.productId, (excess.get(item.productId) ?? 0) + item.cartons);
  }
  for (const [productId, placed] of excess) excess.set(productId, placed - Math.max(0, limits.get(productId) ?? 0));
  if (![...excess.values()].some((over) => over > 0)) return pallets;
  const kept: OrderPallet[] = [];
  for (let index = pallets.length - 1; index >= 0; index--) {
    const pallet = pallets[index];
    let changed = false;
    const items = pallet.items.flatMap((item) => {
      const over = excess.get(item.productId) ?? 0;
      if (over <= 0) return [item];
      const take = Math.min(over, item.cartons);
      excess.set(item.productId, over - take);
      changed = true;
      return item.cartons > take ? [{ ...item, cartons: item.cartons - take }] : [];
    });
    if (!changed) kept.unshift(pallet);
    else if (items.length) kept.unshift({ ...pallet, items });
  }
  return relabelPallets(kept);
}

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

/** The pallet types the planner offers, with the stored value first. */
export const PALLET_TYPES = [
  { value: 'Europallet', label: 'Europallet 120 × 80', short: 'Euro' },
  { value: 'Blokpallet 120×100', label: 'Blokpallet 120 × 100', short: 'Blok' },
  { value: 'Halve pallet 80×60', label: 'Halve pallet 80 × 60', short: 'Half' },
] as const;

/** One colour per product on the pallets, so a mixed pallet reads at a glance. */
export const PALLET_PRODUCT_COLOURS = [
  '#8f2942', '#2e7d4f', '#c6862f', '#3f6fb5', '#7a4fb8', '#d1553d', '#1f8a8a', '#8a6b2a',
] as const;
