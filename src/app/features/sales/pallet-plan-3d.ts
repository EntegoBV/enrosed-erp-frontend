import {
  carriedShare, deckOf, packedFill, packedPlace, settle, solidsOf, stackAbove, type BuilderBox, type BuilderItem, type LayerStock,
} from './pallet-builder-model';
import { type CartonUp, type PalletSpec, type PlanLine, type PlannedPallet } from './pallet-calculator-model';
import { bestPlan, packedLoads, shareFullPallet, type LoadedBox, type PackLine } from './pallet-packed-plan';

/**
 * Palletberekening's plan in 3D (2026-11-26), free of Angular and three.js.
 * Emre: "bij calculatie niet 3d zie ik ... dat past en als ik op 3d druk dan
 * heeft die geen ruimte". 3D laden filled one carrier with the packer, whatever
 * the plan was, so wherever the plan counted in whole layers (bestPlan's guard:
 * the layers stand when the packer needs more carriers) the view could not lay
 * what the cards said. Now every carrier of the plan is a page, laid as the
 * plan counts it:
 * - a carrier the packer planned: the packer's own boxes of that carrier
 *   (packedLoads, the plan's very run);
 * - a carrier counted in whole layers: its omdozen loaded as full as they go
 *   on one carrier when that takes all of them no higher than the plan says
 *   (every box then stands fully on the floor or on a flat top), else in whole
 *   layers bottom to top, as the count stacks them and the order's 3D draws
 *   them (stackAbove), then settled. So a page never stands higher than its
 *   row in the plan.
 *   In layers every omdoos of the plan stands under the height, but one layer
 *   need not carry the next in full: the count does not ask that either. The
 *   products' layers go in the order that leaves the fewest omdozen partly
 *   carried (the count's own order on a tie): the same layers, the same height.
 * Nothing here counts: the plan is the page's (bestPlan), the boxes only show it.
 */

/** One card of Palletberekening: its line as the plan counts it (fit, omdozen) and its omdoos as the packer takes it (the same omdozen). */
export interface PlanCard { plan: PlanLine; pack: PackLine }

/** The plan 3D laden shows. */
export interface Plan3d {
  /** The cards hold quantities: a page per carrier, each starting as counted. Without: one carrier that starts empty and Automatisch fills. */
  paged: boolean;
  plan: PlannedPallet[];
  /** What the packer was given for that plan: the boxes of its carriers come from the same run (planLoads). */
  packs: PackLine[];
}

/**
 * The plan 3D laden shows. With quantities on the cards: the page's own plan (`counted`, its bestPlan; empty
 * when it is not worked out). Without: one carrier as full as it goes (Emre, 2026-11-27: Automatisch "vergeet
 * er 4"): one product at its card's full load (fullCartons, pallet-full.ts; before, the layers' count, 12 where
 * 14 steelrozen go), several shared out as Verdeel does it (shareFullPallet: whole layers, then topped up while
 * the packer still loads it on one carrier), then counted as the page counts (bestPlan). Cards that fit no
 * carrier stay out, as in the page's plan.
 */
export function plan3d(cards: readonly PlanCard[], counted: () => PlannedPallet[], pallet: PalletSpec, sides: readonly CartonUp[]): Plan3d {
  const fitting = cards.filter((card) => card.plan.fit.cartonsPerPallet > 0);
  if (fitting.some((card) => card.plan.cartons > 0)) return { paged: true, plan: counted(), packs: fitting.map((card) => card.pack) };
  if (!fitting.length) return { paged: false, plan: [], packs: [] };
  const shared = fitting.length === 1
    ? new Map([[fitting[0].plan.key, Math.max(fitting[0].plan.fit.cartonsPerPallet, fitting[0].plan.fullCartons ?? 0)]])
    : shareFullPallet(fitting.map((card) => card.plan), fitting.map((card) => card.pack), pallet, sides);
  const filled = fitting.filter((card) => (shared.get(card.plan.key) ?? 0) > 0);
  const packs = filled.map((card) => ({ ...card.pack, cartons: shared.get(card.plan.key) ?? 0 }));
  const plan = bestPlan(filled.map((card) => ({ ...card.plan, cartons: shared.get(card.plan.key) ?? 0 })), packs, pallet, sides);
  return { paged: false, plan, packs };
}

/** The packer's boxes of that plan's carriers, where the plan is the packer's own; null where it is whole layers. */
export function planLoads(view: Plan3d, pallet: PalletSpec, sides: readonly CartonUp[]): LoadedBox[][] | null {
  return view.plan.some((planned) => planned.packed) ? packedLoads(view.packs, pallet, sides, Math.max(1, view.plan.length)) : null;
}

/** How a page was laid: the packer's own carrier, a layers carrier loaded as full as it goes, or whole layers stacked. */
export type PageHow = 'packed' | 'full' | 'layers';

export interface PlanPage { boxes: BuilderBox[]; how: PageHow }

/** The omdozen per product of a set of boxes are exactly the plan's parts. */
function carries(boxes: readonly { key: number }[], parts: readonly { key: number; cartons: number }[]): boolean {
  const counts = new Map<number, number>();
  for (const box of boxes) counts.set(box.key, (counts.get(box.key) ?? 0) + 1);
  return counts.size === parts.length && parts.every((part) => counts.get(part.key) === part.cartons);
}

/**
 * One carrier of the plan as 3D lays it. `items` holds every card's omdoos by the card's product (its side
 * `up` is the side the card counts it on); `loaded` is this carrier's boxes of packedLoads when the plan is
 * the packer's, else null; `sides` are the sides the page's switch allows.
 */
export function planPage(planned: PlannedPallet, loaded: readonly LoadedBox[] | null, items: ReadonlyMap<number, BuilderItem>,
  spec: PalletSpec, sides: readonly CartonUp[]): PlanPage {
  const deck = deckOf(spec);
  const parts = planned.parts.filter((part) => part.cartons > 0);
  if (planned.packed && loaded && carries(loaded, parts)) {
    const boxes = loaded.map((box, index) => ({ id: index + 1, key: box.key, ...packedPlace(box, deck), up: box.up, turned: box.turned }));
    return { boxes: settle(boxes, items), how: 'packed' };
  }
  /* Counted in whole layers: as full as they go on this one carrier when that takes every omdoos of it and stands
     no higher than the plan says this carrier is (the packer can build a tower where the layers lie low and wide:
     the view would then read 234 cm beside a plan row of 156 cm). */
  const total = parts.reduce((sum, part) => sum + part.cartons, 0);
  const full = packedFill(items, parts, deck, spec.maxWeightKg, sides, 1);
  if (full.length === total && topOf(full, items) <= planned.heightCm - spec.baseHeightCm + 0.05) return { boxes: settle(full, items), how: 'full' };
  /* Else the layers the count stacked, each product on the side its card counts it, bottom to top in the order that carries them best. */
  const layers: LayerStock[] = parts.flatMap((part) => {
    const item = items.get(part.key);
    return item ? [{ key: part.key, cartons: part.cartons, lengthCm: item.lengthCm, widthCm: item.widthCm, heightCm: item.heightCm, up: item.up }] : [];
  });
  let best: { boxes: BuilderBox[]; loose: number; weak: number } | null = null;
  for (const order of layerOrders(layers)) {
    const stacked: BuilderBox[] = [];
    stackAbove(order, stacked, 0, spec);
    const boxes = settle(stacked, items);
    const { loose, weak } = carriedBy(boxes, items);
    if (!best || loose < best.loose || (loose === best.loose && weak < best.weak)) best = { boxes, loose, weak };
    if (!loose) break;
  }
  return { boxes: best?.boxes ?? [], how: 'layers' };
}

/** The top of a load above the floor, in cm. */
function topOf(boxes: readonly BuilderBox[], items: ReadonlyMap<number, BuilderItem>): number {
  let top = 0;
  for (const solid of solidsOf(boxes, items)) top = Math.max(top, solid.y + solid.sy);
  return top;
}

/**
 * The orders to try for the products of a whole-layers carrier, the count's own (tallest omdoos first) first.
 * Up to four products every order (24 at most); beyond that the count's order and the widest layer at the bottom.
 */
function layerOrders(layers: readonly LayerStock[]): LayerStock[][] {
  if (layers.length <= 1) return [[...layers]];
  if (layers.length > 4) {
    const area = (stock: LayerStock) => stock.lengthCm * stock.widthCm * stock.heightCm / Math.max(1e-9, stock.up === 'w' ? stock.widthCm : stock.up === 'l' ? stock.lengthCm : stock.heightCm);
    return [[...layers], [...layers].sort((left, right) => area(right) - area(left))];
  }
  const orders: LayerStock[][] = [];
  const walk = (taken: LayerStock[], rest: readonly LayerStock[]): void => {
    if (!rest.length) { orders.push(taken); return; }
    rest.forEach((stock, index) => walk([...taken, stock], [...rest.slice(0, index), ...rest.slice(index + 1)]));
  };
  walk([], layers);
  return orders;
}

/* carriedShare lives in pallet-builder-model since the tap reads it too; it stays exported here for the plan's readers. */
export { carriedShare };

/** Of these boxes, how many are not carried in full (loose) and how many by less than half (weak). */
function carriedBy(boxes: readonly BuilderBox[], items: ReadonlyMap<number, BuilderItem>): { loose: number; weak: number } {
  const solids = solidsOf(boxes, items);
  let loose = 0; let weak = 0;
  for (const solid of solids) {
    const share = carriedShare(solid, solids);
    if (share < 1 - 1e-6) loose += 1;
    if (share < 0.5) weak += 1;
  }
  return { loose, weak };
}

/** One card as the key of a kept build names it: its product, its omdoos (cm, kg) and its omdozen. */
export type KeptCard = readonly [productId: number, lengthCm: number, widthCm: number, heightCm: number, weightKg: number, cartons: number];

/**
 * The key a build of 3D laden is kept under on this device: everything the plan depends on. Another carrier
 * or pallet type, height, spill, switch, card, omdoos size, quantity or page gives another key, so the view
 * opens on the plan again and never on a load made for another count (before 2026-11-26 the key was the
 * carrier alone: a pallet built at 260 cm came back, red above the frame, at 220).
 */
export function builderStoreKey(settings: {
  carrier: string; type: string; maxHeightCm: number; spillCm: number; turnable: boolean; cards: readonly KeptCard[]; page: number;
}): string {
  return JSON.stringify(['pc', settings.carrier, settings.type, settings.maxHeightCm, settings.spillCm, settings.turnable ? 1 : 0, settings.cards, settings.page]);
}
