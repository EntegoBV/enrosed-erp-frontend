import {
  MAX_PLANNED_PALLETS, planPallets, specSpillCm, type CartonUp, type PalletPart, type PalletSpec, type PlanLine, type PlannedPallet,
} from './pallet-calculator-model';
import { packDeck, packPallets, packUnits, type PackKind, type PackResult, type PackedBox } from './pallet-pack';

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

/** The omdozen as the packer takes them, and which product each of its boxes stands for. */
interface PackedRun {
  /** A product once, its omdozen added up, in line order. */
  byKey: Map<number, PackLine>;
  plan: PackResult;
  /** Per kind, its products and how many of each still go to a box, in line order: the boxes of a kind go to its products in turn. */
  members: Map<number, { key: number; left: number }[]>;
  /** The loading height above the floor, in pack units. */
  usable: number;
}

/**
 * These omdozen loaded pallet by pallet (pallet-pack.ts on packDeck): one kind per omdoos size, the heaviest
 * colour's weight for all. Null when an omdoos has no sizes; an empty plan when nothing is to load.
 */
function packedRun(lines: readonly PackLine[], pallet: PalletSpec, sides: readonly CartonUp[], limit: number): PackedRun | null {
  const byKey = new Map<number, PackLine>();
  for (const line of lines) {
    if (!(line.cartons > 0)) continue;
    if (!(line.lengthCm > 0 && line.widthCm > 0 && line.heightCm > 0)) return null;
    const known = byKey.get(line.key);
    byKey.set(line.key, known ? { ...known, cartons: known.cartons + line.cartons } : line);
  }
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
  const plan = byKey.size ? packPallets([...bySize.values()], deck, limit) : { pallets: [], left: new Map<number, number>() };
  return { byKey, plan, members, usable: deck.height };
}

/** The product the next box of a kind stands for: the kind's products in turn, so the plan's parts and the 3D's boxes agree. */
function memberOf(run: PackedRun, kind: number): number | null {
  const member = run.members.get(kind)?.find((candidate) => candidate.left > 0);
  if (!member) return null;
  member.left -= 1;
  return member.key;
}

/**
 * The pallets these omdozen are loaded on, as full as each goes; null when an
 * omdoos has no sizes or fits no pallet, or when more than `limit` pallets
 * would be needed. A pallet's parts come in the order their first omdoos was
 * laid; a part's layers are the heights its omdozen start at.
 */
export function packedPlan(lines: readonly PackLine[], pallet: PalletSpec, sides: readonly CartonUp[],
  fullAt: (key: number) => number, limit = MAX_PLANNED_PALLETS): PlannedPallet[] | null {
  const run = packedRun(lines, pallet, sides, limit);
  if (!run) return null;
  if (!run.byKey.size) return [];
  const { byKey, plan, usable } = run;
  if (plan.left.size) return null;
  return plan.pallets.map((packed) => {
    const parts = new Map<number, PalletPart>();
    const starts = new Map<number, Set<number>>();
    for (const box of packed.boxes) {
      const key = memberOf(run, box.key);
      if (key === null) continue;
      const part = parts.get(key);
      if (part) part.cartons += 1; else parts.set(key, { key, cartons: 1, layers: 0 });
      const at = starts.get(key) ?? new Set<number>();
      at.add(box.y);
      starts.set(key, at);
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

/** A packed box with the product it stands for; its place is the packer's, in pack units from the load floor's corner. */
export interface LoadedBox extends Omit<PackedBox, 'key'> { key: number }

/**
 * The boxes of packedPlan's pallets, pallet by pallet (2026-11-26: Palletberekening's 3D draws the very carriers
 * its plan counts): the same run of the packer on the same deck, every box given to the same product as the
 * plan's parts count it. Null where packedPlan gives no plan.
 */
export function packedLoads(lines: readonly PackLine[], pallet: PalletSpec, sides: readonly CartonUp[],
  limit = MAX_PLANNED_PALLETS): LoadedBox[][] | null {
  const run = packedRun(lines, pallet, sides, limit);
  if (!run || run.plan.left.size) return null;
  return run.plan.pallets.map((packed) => packed.boxes.flatMap((box) => {
    const key = memberOf(run, box.key);
    return key === null ? [] : [{ ...box, key }];
  }));
}

/** As the server counts a PACKED document: loaded as full as it goes, unless whole layers need fewer pallets. */
export function bestPlan(layers: readonly PlanLine[], packs: readonly PackLine[], pallet: PalletSpec, sides: readonly CartonUp[]): PlannedPallet[] {
  const stacked = planPallets(layers, pallet);
  const fullAt = new Map(layers.map((line) => [line.key, line.fit.cartonsPerPallet]));
  const packed = packedPlan(packs, pallet, sides, (key) => fullAt.get(key) ?? Number.POSITIVE_INFINITY, Math.max(1, stacked.length));
  return packed && packed.length && packed.length <= stacked.length ? packed : stacked;
}

/** What a plan is counted from: the cards as whole layers count them, the same omdozen as the packer takes them, and the carrier. */
export interface PlanBasis { layers: readonly PlanLine[]; packs: readonly PackLine[]; pallet: PalletSpec }

/** A plan with the basis it was counted on. */
export interface CountedPlan extends PlanBasis {
  plan: PlannedPallet[];
  /** Carriers the spill would have cost: the plan is the one without spill, and `layers`, `packs` and `pallet` are the bare ones. 0: counted on its own basis. */
  saved: number;
}

/** The omdozen per product on the carriers of a plan. */
function carried(plan: readonly PlannedPallet[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const planned of plan) for (const part of planned.parts) counts.set(part.key, (counts.get(part.key) ?? 0) + part.cartons);
  return counts;
}

/**
 * bestPlan, never on more carriers with a spill than without (2026-11-26). A spill gives every layer more room, yet
 * the plan can need a carrier more with it: the packer is a search and on a slightly larger deck another first block
 * can win; the whole layers are first-fit, and an omdoos that stands on another side changes their order (about 4 % of
 * the 1 cm steps of mixed loads in the proof round). No load gets worse by leaving room unused, so where the plan on
 * the bare floor carries the very same omdozen on fewer carriers, that plan stands, with the basis it was counted on:
 * whatever shows or draws the plan (the rows, the room hints, 3D laden's pages) must read `pallet` and `layers` from
 * the answer, not the spec that was asked. The server prices a document the same way (it drops the spill for the
 * whole document). `bare` gives the same cards on the same carrier without spill, or null when that is not to be
 * worked out; it is asked only when the plan has two or more carriers (one cannot be bettered) and its spec a spill.
 * A plan without spill that leaves omdozen behind (an omdoos that fits only with the spill) never stands.
 */
export function countedPlan(own: PlanBasis, bare: () => PlanBasis | null, sides: readonly CartonUp[]): CountedPlan {
  const plan = bestPlan(own.layers, own.packs, own.pallet, sides);
  if (plan.length < 2 || !(specSpillCm(own.pallet) > 0)) return { ...own, plan, saved: 0 };
  const without = bare();
  if (!without) return { ...own, plan, saved: 0 };
  const lean = bestPlan(without.layers, without.packs, without.pallet, sides);
  if (!lean.length || lean.length >= plan.length) return { ...own, plan, saved: 0 };
  const asked = carried(plan);
  const taken = carried(lean);
  const same = asked.size === taken.size && [...asked].every(([key, cartons]) => taken.get(key) === cartons);
  return same ? { ...without, plan: lean, saved: plan.length - lean.length } : { ...own, plan, saved: 0 };
}
