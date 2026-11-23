import type { Product, SalesOrderView } from '../../core/api/models';
import { productSalesUnit } from '../products/product-sales-unit';
import { deckOf, settle, type BuilderBox, type BuilderItem } from './pallet-builder-model';
import { cartonStanding, layerSlots, palletFit, productUnits, type CartonUp } from './pallet-calculator-model';
import { automaticPallets, normalizeManualPalletType, palletTypeLabel } from './pallet-stack';
import { autoPallets, palletCount, plannerLines, plannerSpec, type PlannerLine, type PlannerSpec } from './shipping-planner-model';

/**
 * A sales order's pallets in 3D (Emre, 2026-11-20: "3d pallet ook bij
 * verkoop order bij pallet indelen"), free of Angular and three.js: which
 * pallets the order has, and where every omdoos of one of them stands. The
 * order's count decides what stands on a pallet; this only lays it out the
 * way the count stacks it: every product in whole layers of its own pattern
 * (layerSlots, the pattern palletFit counts), bottom to top in the pallet's
 * order, a short layer as high as a full one and taking the pattern's first
 * places, then settled so nothing floats. On the side the count stands it:
 * upright, and on its side only when it fits no pallet upright (palletFit =
 * PalletCalculator.fit since 2026-11-20, "alleen als het moet").
 */

/** One pallet of the order as 3D shows it. */
export interface OrderPallet3d {
  /** "Pallet 2", or the name a hand-built pallet was given. */
  label: string;
  /** What stands on it, bottom to top. */
  items: readonly { productId: number; cartons: number }[];
  /** A hand-built pallet's measured height; null when it is estimated. */
  measuredCm: number | null;
  /** A hand-built pallet of another type than the order's ("Blokpallet 120×100"); the planner counts it on the order's pallet. */
  ownType: string | null;
}

/**
 * The order's pallets as the planner shows them: the hand-built ones (Zelf
 * indelen), else the server's automatic layout with every pallet of a run
 * on its own, and on an older server its strict count laid out the
 * planner's way. None for loose cartons, nor when the automatic pallets do
 * not add up to the server's count (the planner then shows none either).
 */
export function orderPallets3d(view: SalesOrderView, spec: PlannerSpec = plannerSpec(view),
  lines: readonly PlannerLine[] = plannerLines(view, spec)): OrderPallet3d[] {
  if ((view.order.loadMode ?? 'PALLETS') !== 'PALLETS') return [];
  if (view.order.pallets.length) {
    return view.order.pallets.map((pallet, index) => {
      const type = normalizeManualPalletType(pallet.type);
      return {
        label: pallet.label.trim() || `Pallet ${index + 1}`,
        items: pallet.items.map(({ productId, cartons }) => ({ productId, cartons })),
        measuredCm: pallet.heightCm ?? null,
        ownType: type && type !== palletTypeLabel(spec.profile) ? type : null,
      };
    });
  }
  const expected = automaticPallets(view.priced.totals);
  const server = view.priced.totals.autoPallets;
  if (server) {
    if (server.length !== expected) return [];
    return server.map((pallet, index) => ({
      label: `Pallet ${index + 1}`, items: pallet.items.map(({ productId, cartons }) => ({ productId, cartons })),
      measuredCm: null, ownType: null,
    }));
  }
  const rows = autoPallets(lines, spec);
  if (!rows.length || palletCount(rows) !== expected) return [];
  return rows.flatMap((row) => Array.from({ length: row.to - row.from + 1 }, (_, offset) => ({
    label: `Pallet ${row.from + offset}`, items: row.parts.map(({ productId, cartons }) => ({ productId, cartons })),
    measuredCm: null, ownType: null,
  })));
}

/** One pallet laid out for the 3D view. */
export interface PalletBuild {
  /** Every product on the pallet once: the panel and the labels. */
  items: BuilderItem[];
  boxes: BuilderBox[];
  /** Omdozen 3D cannot draw: without omdoos sizes, or too large for the pallet drawn (the planner's "Omdoos te groot"). */
  missing: { name: string; cartons: number; why: 'sizes' | 'size' }[];
  /** The catalogue's omdoos now lays more or fewer per layer than the order counted (sizes changed since). */
  differs: boolean;
}

export const EMPTY_BUILD: PalletBuild = { items: [], boxes: [], missing: [], differs: false };

/** A product's colour in the planner when the order no longer has its line. */
const LOST_COLOUR = '#8a8079';

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Where every omdoos of one pallet stands. The omdoos sizes come from the
 * catalogue (the priced line has none); per layer never more than the order
 * counted. A pallet higher than its maximum is drawn whole: what sticks out
 * shows in the builder's orange and red, as the planner says "te hoog".
 */
export function palletBuild(pallet: OrderPallet3d, spec: PlannerSpec, lines: readonly PlannerLine[],
  products: ReadonlyMap<number, Product>): PalletBuild {
  const deck = deckOf(spec);
  const lineOf = new Map(lines.map((line) => [line.productId, line]));
  const items = new Map<number, BuilderItem>();
  const boxes: BuilderBox[] = [];
  const missing: PalletBuild['missing'] = [];
  let differs = false;
  let id = 1;
  let y = 0;
  for (const entry of pallet.items) {
    const cartons = Math.floor(entry.cartons);
    if (!(cartons > 0)) continue;
    const line = lineOf.get(entry.productId);
    const product = products.get(entry.productId);
    const name = line?.name ?? product?.name ?? 'Verwijderd product';
    const carton = product?.carton;
    const lengthCm = carton?.lengthCm ?? 0;
    const widthCm = carton?.widthCm ?? 0;
    const heightCm = carton?.heightCm ?? 0;
    const measured = lengthCm > 0 && widthCm > 0 && heightCm > 0;
    /* The side the count stands it on: an omdoos that fits no pallet upright lies on its side (81 × 81 cm half hearts). */
    const fit = measured ? palletFit({ lengthCm, widthCm, heightCm, weightKg: carton?.weightKg ?? null }, spec) : null;
    const up: CartonUp = fit && fit.cartonsPerPallet > 0 ? fit.up : 'h';
    const standing = cartonStanding({ lengthCm, widthCm, heightCm }, up);
    const slots = measured ? layerSlots({ lengthCm: standing.lengthCm, widthCm: standing.widthCm }, deck) : [];
    if (!slots.length) { missing.push({ name, cartons, why: measured ? 'size' : 'sizes' }); continue; }
    const counted = line && line.perLayer > 0 ? line.perLayer : slots.length;
    if (counted !== slots.length) differs = true;
    const perLayer = Math.min(counted, slots.length);
    const known = items.get(entry.productId);
    if (known) known.wanted = (known.wanted ?? 0) + cartons;
    else {
      const units = product ? productUnits(product).piecesPerCarton : null;
      const piece = product ? productSalesUnit(product).piece : null;
      items.set(entry.productId, {
        key: entry.productId, group: entry.productId, section: null,
        groupTitle: product?.name?.trim() || name, title: name,
        colour: line?.colour ?? LOST_COLOUR,
        colourName: product?.colour?.trim() || null, colourHex: product?.colourHex?.trim() || null,
        sku: line?.sku || product?.sku?.trim() || null, photo: line?.photoUrl ?? null,
        lengthCm, widthCm, heightCm,
        weightKg: carton?.weightKg && carton.weightKg > 0 ? carton.weightKg : line?.cartonWeightKg ?? 0,
        wanted: cartons, up,
        units: units && piece ? { per: units, one: piece.one, other: piece.other } : null,
      });
    }
    for (let left = cartons; left > 0; left -= perLayer) {
      for (const slot of slots.slice(0, Math.min(left, perLayer))) {
        boxes.push({
          id: id++, key: entry.productId, x: round(slot.x), y: round(y), z: round(slot.z), up,
          turned: Math.abs(slot.lengthCm - standing.lengthCm) > 1e-6,
        });
      }
      y += standing.heightCm;
    }
  }
  return { items: [...items.values()], boxes: settle(boxes, items), missing, differs };
}

/** "Europallet 120 × 80 · max 260 cm": what the 3D stands on. */
export function palletLabel3d(spec: PlannerSpec): string {
  return `${spec.name} · max ${Math.round(spec.maxHeightCm).toLocaleString('nl-BE')} cm`;
}

/** The line over the view: what it does not draw, and where it differs from the order. */
export function palletNotice3d(pallet: OrderPallet3d | undefined, build: PalletBuild, spec: PlannerSpec): string | null {
  if (!pallet) return null;
  const notes: string[] = [];
  const count = (why: PalletBuild['missing'][number]['why']) => build.missing.filter((part) => part.why === why)
    .reduce((sum, part) => sum + part.cartons, 0);
  const omdozen = (n: number) => `${n.toLocaleString('nl-BE')} ${n === 1 ? 'omdoos' : 'omdozen'}`;
  const unmeasured = count('sizes');
  const tooLarge = count('size');
  if (unmeasured) notes.push(`${omdozen(unmeasured)} zonder maten niet getekend`);
  if (tooLarge) notes.push(`${omdozen(tooLarge)} te groot voor deze pallet, niet getekend`);
  if (build.differs) notes.push('Omdoosmaten gewijzigd sinds de berekening');
  if (pallet.measuredCm !== null) notes.push(`Gemeten ${Math.round(pallet.measuredCm).toLocaleString('nl-BE')} cm`);
  if (pallet.ownType) notes.push(`${pallet.ownType}, getekend als ${spec.name}`);
  return notes.length ? notes.join(' · ') : null;
}
