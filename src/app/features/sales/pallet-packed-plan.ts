import {
  MAX_PLANNED_PALLETS, planPallets, type CartonUp, type PalletPart, type PalletSpec, type PlanLine, type PlannedPallet,
} from './pallet-calculator-model';
import { packDeck, packPallets, packUnits, type PackKind } from './pallet-pack';

/**
 * The pallet count of a PACKED document (2026-11-25) for the screens that
 * work it out themselves, free of Angular: Palletberekening's plan and the
 * planner's "+22 past". The server's PalletCalculator.packedPallets step for
 * step: the products in line order (a product once), one kind per omdoos size
 * (the heaviest colour's weight), loaded pallet by pallet as full as it goes
 * (pallet-pack.ts); where that would take more pallets than whole layers
 * stacked (planPallets), or leave omdozen over, the layers stand.
 */

/** One product as the packer counts it: its omdozen and the omdoos's own sizes and weight in cm and kg. */
export interface PackLine { key: number; cartons: number; lengthCm: number; widthCm: number; heightCm: number; weightKg: number }

/**
 * The pallets these omdozen are loaded on, as full as each goes; null when an
 * omdoos has no sizes or fits no pallet, or when more than `limit` pallets
 * would be needed. A pallet's parts come in the order their first omdoos was
 * laid; a part's layers are the heights its omdozen start at.
 */
export function packedPlan(lines: readonly PackLine[], pallet: PalletSpec, sides: readonly CartonUp[],
  fullAt: (key: number) => number, limit = MAX_PLANNED_PALLETS): PlannedPallet[] | null {
  const byKey = new Map<number, PackLine>();
  for (const line of lines) {
    if (!(line.cartons > 0)) continue;
    if (!(line.lengthCm > 0 && line.widthCm > 0 && line.heightCm > 0)) return null;
    const known = byKey.get(line.key);
    byKey.set(line.key, known ? { ...known, cartons: known.cartons + line.cartons } : line);
  }
  if (!byKey.size) return [];
  const bySize = new Map<string, PackKind>();
  const members = new Map<number, { key: number; left: number }[]>();
  for (const line of byKey.values()) {
    const length = packUnits(line.lengthCm); const width = packUnits(line.widthCm); const height = packUnits(line.heightCm);
    const weight = packUnits(line.weightKg);
    const size = `${length}|${width}|${height}`;
    let kind = bySize.get(size);
    if (!kind) {
      kind = { key: bySize.size + 1, length, width, height, weight, count: 0, sides };
      bySize.set(size, kind);
      members.set(kind.key, []);
    }
    kind.weight = Math.max(kind.weight, weight);
    kind.count += line.cartons;
    members.get(kind.key)?.push({ key: line.key, left: line.cartons });
  }
  const deck = packDeck(pallet);
  const plan = packPallets([...bySize.values()], deck, limit);
  if (plan.left.size) return null;
  const usable = deck.height;
  return plan.pallets.map((packed) => {
    const parts = new Map<number, PalletPart>();
    const starts = new Map<number, Set<number>>();
    for (const box of packed.boxes) {
      const member = members.get(box.key)?.find((candidate) => candidate.left > 0);
      if (!member) continue;
      member.left -= 1;
      const part = parts.get(member.key);
      if (part) part.cartons += 1; else parts.set(member.key, { key: member.key, cartons: 1, layers: 0 });
      const at = starts.get(member.key) ?? new Set<number>();
      at.add(box.y);
      starts.set(member.key, at);
    }
    let weightKg = 0;
    for (const part of parts.values()) {
      part.layers = starts.get(part.key)?.size ?? 0;
      weightKg += part.cartons * (byKey.get(part.key)?.weightKg ?? 0);
    }
    const list = [...parts.values()];
    const fill = Math.min(1, Math.max(usable > 0 ? packed.top / usable : 0, pallet.maxWeightKg > 0 ? weightKg / pallet.maxWeightKg : 0));
    const full = (list.length === 1 && list[0].cartons >= fullAt(list[0].key)) || fill >= 0.995;
    return { parts: list, heightCm: pallet.baseHeightCm + packed.top / 100, weightKg, fill: full ? 1 : fill, full, packed: true };
  });
}

/** As the server counts a PACKED document: loaded as full as it goes, unless whole layers need fewer pallets. */
export function bestPlan(layers: readonly PlanLine[], packs: readonly PackLine[], pallet: PalletSpec, sides: readonly CartonUp[]): PlannedPallet[] {
  const stacked = planPallets(layers, pallet);
  const fullAt = new Map(layers.map((line) => [line.key, line.fit.cartonsPerPallet]));
  const packed = packedPlan(packs, pallet, sides, (key) => fullAt.get(key) ?? Number.POSITIVE_INFINITY, Math.max(1, stacked.length));
  return packed && packed.length && packed.length <= stacked.length ? packed : stacked;
}
