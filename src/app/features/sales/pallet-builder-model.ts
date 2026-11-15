import { cartonStanding, layerSlots, type CartonUp, type PalletSpec } from './pallet-calculator-model';

/**
 * The arithmetic of 3D laden (pallet-builder.ts), free of three.js: where an
 * omdoos lands, how a stack settles, the next free place and the computed
 * fill. Every size is in cm. The floor is the pallet's deck or the kar's base
 * plate: x runs along its length, z along its width, y up from the floor.
 */

/**
 * One colour of a product on the panel: its omdoos and what Palletberekening
 * asks for. The colours of one product (one card in Palletberekening) share
 * its group, its card colour, its omdoos and its quantity.
 */
export interface BuilderItem {
  /** The colour's product id. */
  key: number;
  /** The product it belongs to: the card's product id in Palletberekening. */
  group: number;
  /** The product's name without the colour: "Rose in Dome · 12x25". */
  groupTitle: string;
  /** groupTitle with the colour: "Rose in Dome · 12x25 · Navy". */
  title: string;
  /** The card's colour in Palletberekening: the product's mark in 3D. */
  colour: string;
  /** The colour's own name, swatch and SKU; null where the product has none. */
  colourName: string | null;
  colourHex: string | null;
  sku: string | null;
  photo: string | null;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  /** Omdozen on the product's card (all its colours together); null without a quantity. */
  wanted: number | null;
  /** The side Palletberekening stands it on. */
  up: CartonUp;
  /** Pieces in one omdoos and their word, for "36 stuks"; null when unknown. */
  units: { per: number; one: string; other: string } | null;
}

/** One omdoos on the floor or on others. */
export interface BuilderBox {
  id: number;
  key: number;
  x: number;
  y: number;
  z: number;
  up: CartonUp;
  /** A quarter turn on the floor. */
  turned: boolean;
}

export interface Extent { sx: number; sy: number; sz: number }

/** A box with its size: what stacking and drawing work with. */
export interface Solid extends Extent { id: number; x: number; y: number; z: number }

/** The floor and the room above it. */
export interface Deck { lengthCm: number; widthCm: number; usableCm: number }

/** One product's share of the computed carrier, bottom to top. */
export interface BuilderPart { key: number; cartons: number }

const EPSILON = 1e-6;

export function deckOf(spec: PalletSpec): Deck {
  return { lengthCm: spec.lengthCm, widthCm: spec.widthCm, usableCm: Math.max(0, spec.maxHeightCm - spec.baseHeightCm) };
}

export function sized(item: Pick<BuilderItem, 'lengthCm' | 'widthCm' | 'heightCm'>): boolean {
  return item.lengthCm > 0 && item.widthCm > 0 && item.heightCm > 0;
}

/** The space an omdoos takes standing on a side, turned or not. */
export function extentOf(item: Pick<BuilderItem, 'lengthCm' | 'widthCm' | 'heightCm'>, up: CartonUp, turned: boolean): Extent {
  const standing = cartonStanding(item, up);
  return turned
    ? { sx: standing.widthCm, sy: standing.heightCm, sz: standing.lengthCm }
    : { sx: standing.lengthCm, sy: standing.heightCm, sz: standing.widthCm };
}

/** The sides an omdoos can stand on, without repeats for a cube-like one. */
export function sidesOf(item: Pick<BuilderItem, 'lengthCm' | 'widthCm' | 'heightCm'>): CartonUp[] {
  const sides: CartonUp[] = ['h'];
  if (Math.abs(item.widthCm - item.heightCm) > EPSILON) sides.push('w');
  if (Math.abs(item.lengthCm - item.heightCm) > EPSILON && Math.abs(item.lengthCm - item.widthCm) > EPSILON) sides.push('l');
  return sides;
}

export function solidsOf(boxes: readonly BuilderBox[], items: ReadonlyMap<number, BuilderItem>): Solid[] {
  return boxes.flatMap((box) => {
    const item = items.get(box.key);
    if (!item) return [];
    return [{ id: box.id, x: box.x, y: box.y, z: box.z, ...extentOf(item, box.up, box.turned) }];
  });
}

function overlaps(a: number, aSize: number, b: number, bSize: number): boolean {
  return a < b + bSize - EPSILON && b < a + aSize - EPSILON;
}

/** How high a footprint rests: on the floor or on the highest box under it. */
export function restingHeight(solids: readonly Solid[], x: number, z: number, sx: number, sz: number, skip: number | null = null): number {
  let y = 0;
  for (const solid of solids) {
    if (solid.id === skip) continue;
    if (overlaps(x, sx, solid.x, solid.sx) && overlaps(z, sz, solid.z, solid.sz)) y = Math.max(y, solid.y + solid.sy);
  }
  return y;
}

/** Every box drops onto what is under it, the lowest first: nothing floats after a box moves or goes. */
export function settle(boxes: readonly BuilderBox[], items: ReadonlyMap<number, BuilderItem>): BuilderBox[] {
  const solids = solidsOf(boxes, items);
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const settled: Solid[] = [];
  const result = new Map<number, BuilderBox>();
  for (const solid of [...solids].sort((left, right) => left.y - right.y || left.id - right.id)) {
    const y = restingHeight(settled, solid.x, solid.z, solid.sx, solid.sz);
    settled.push({ ...solid, y });
    result.set(solid.id, { ...(byId.get(solid.id) as BuilderBox), y: round(y) });
  }
  return boxes.filter((box) => result.has(box.id)).map((box) => result.get(box.id) as BuilderBox);
}

export interface Landing { x: number; y: number; z: number; fits: boolean; reason: 'hoogte' | 'maat' | null }

/**
 * Where a box of this size lands when its middle is aimed at (centreX,
 * centreZ): kept on the floor, pulled onto a nearby edge of the floor or of
 * another box (a few cm, so rows line up by hand), on top of what is under it.
 * It fits while it stays under the loading height.
 */
export function landing(solids: readonly Solid[], extent: Extent, centreX: number, centreZ: number, deck: Deck, skip: number | null): Landing {
  const others = solids.filter((solid) => solid.id !== skip);
  const x = snap(clamp(centreX - extent.sx / 2, 0, deck.lengthCm - extent.sx), extent.sx, deck.lengthCm,
    others.map((solid) => [solid.x, solid.sx]));
  const z = snap(clamp(centreZ - extent.sz / 2, 0, deck.widthCm - extent.sz), extent.sz, deck.widthCm,
    others.map((solid) => [solid.z, solid.sz]));
  const y = restingHeight(others, x, z, extent.sx, extent.sz);
  const high = y + extent.sy > deck.usableCm + EPSILON;
  const wide = extent.sx > deck.lengthCm + EPSILON || extent.sz > deck.widthCm + EPSILON;
  return { x: round(x), y: round(y), z: round(z), fits: !high && !wide, reason: wide ? 'maat' : high ? 'hoogte' : null };
}

const SNAP_CM = 4;

function snap(value: number, size: number, floor: number, edges: readonly (readonly [number, number])[]): number {
  const targets = [0, floor - size];
  for (const [start, length] of edges) targets.push(start, start + length, start - size, start + length - size);
  let best = value;
  let distance = SNAP_CM;
  for (const target of targets) {
    if (target < -EPSILON || target + size > floor + EPSILON) continue;
    const gap = Math.abs(target - value);
    if (gap < distance) { distance = gap; best = target; }
  }
  return best;
}

function clamp(value: number, low: number, high: number): number {
  return high < low ? low : Math.min(high, Math.max(low, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The next place for one more omdoos: the lowest spot, then the back, then
 * the left, against the floor's edges or the boxes already there, on the
 * sides given (each also turned). Null when it goes nowhere under the height.
 */
export function nextSpot(
  solids: readonly Solid[], item: Pick<BuilderItem, 'lengthCm' | 'widthCm' | 'heightCm'>, sides: readonly CartonUp[], deck: Deck,
): { x: number; y: number; z: number; up: CartonUp; turned: boolean } | null {
  let best: { x: number; y: number; z: number; up: CartonUp; turned: boolean } | null = null;
  for (const up of sides) {
    for (const turned of [false, true]) {
      const extent = extentOf(item, up, turned);
      if (extent.sx > deck.lengthCm + EPSILON || extent.sz > deck.widthCm + EPSILON) continue;
      /* Against the floor's edges or the far side of a box: rounded, so boxes in rows give few places to try. */
      const xs = new Set([0, round(deck.lengthCm - extent.sx)]);
      const zs = new Set([0, round(deck.widthCm - extent.sz)]);
      for (const solid of solids) { xs.add(round(solid.x + solid.sx)); zs.add(round(solid.z + solid.sz)); }
      for (const x of xs) {
        if (x < -EPSILON || x + extent.sx > deck.lengthCm + EPSILON) continue;
        for (const z of zs) {
          if (z < -EPSILON || z + extent.sz > deck.widthCm + EPSILON) continue;
          const y = restingHeight(solids, x, z, extent.sx, extent.sz);
          if (y + extent.sy > deck.usableCm + EPSILON) continue;
          const better = !best || y < best.y - EPSILON
            || (Math.abs(y - best.y) <= EPSILON && (z < best.z - EPSILON || (Math.abs(z - best.z) <= EPSILON && x < best.x - EPSILON)));
          if (better) best = { x: round(x), y: round(y), z: round(z), up, turned };
        }
      }
    }
  }
  return best;
}

/**
 * The carrier as Palletberekening counts it: each product in whole layers of
 * its computed pattern (layerSlots), on the side the count chose, the parts
 * from the bottom up as the plan stacks them. A last layer that is short
 * takes the first places of the pattern.
 */
export function computedFill(items: ReadonlyMap<number, BuilderItem>, parts: readonly BuilderPart[], deck: Deck, firstId: number): BuilderBox[] {
  const boxes: BuilderBox[] = [];
  let id = firstId;
  let height = 0;
  for (const part of parts) {
    const item = items.get(part.key);
    if (!item || !sized(item) || part.cartons <= 0) continue;
    const standing = cartonStanding(item, item.up);
    const slots = layerSlots({ lengthCm: standing.lengthCm, widthCm: standing.widthCm }, deck);
    if (!slots.length) continue;
    for (let left = part.cartons; left > 0; left -= slots.length) {
      if (height + standing.heightCm > deck.usableCm + EPSILON) return boxes;
      for (const slot of slots.slice(0, Math.min(left, slots.length))) {
        const turned = Math.abs(slot.lengthCm - standing.lengthCm) > EPSILON;
        boxes.push({ id: id++, key: item.key, x: round(slot.x), y: round(height), z: round(slot.z), up: item.up, turned });
      }
      height += standing.heightCm;
    }
  }
  return boxes;
}

/* ----------------------------------------------------------------- storage */

const STORAGE_KEY = 'enrosed.palletBuilder';
const MAX_BOXES = 600;

function storedBox(value: unknown): value is BuilderBox {
  const box = value as Partial<BuilderBox> | null;
  return !!box && Number.isSafeInteger(box.id) && Number.isSafeInteger(box.key)
    && [box.x, box.y, box.z].every((n) => typeof n === 'number' && Number.isFinite(n))
    && (box.up === 'h' || box.up === 'w' || box.up === 'l') && typeof box.turned === 'boolean';
}

/** The boxes last built on this carrier on this device; boxes of products no longer on the tray drop out. */
export function loadBuild(carrierKey: string, items: ReadonlyMap<number, BuilderItem>): BuilderBox[] {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    const boxes = all?.[carrierKey];
    if (!Array.isArray(boxes)) return [];
    return boxes.filter(storedBox).filter((box) => {
      const item = items.get(box.key);
      return !!item && sized(item);
    }).slice(0, MAX_BOXES);
  } catch {
    return [];
  }
}

export function saveBuild(carrierKey: string, boxes: readonly BuilderBox[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    const next = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    next[carrierKey] = boxes.slice(0, MAX_BOXES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* private mode: the build lives as long as the screen */ }
}

export const MAX_BUILDER_BOXES = MAX_BOXES;
