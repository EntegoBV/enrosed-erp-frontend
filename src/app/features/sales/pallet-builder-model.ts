import { cartonStanding, layerSlots, loadFloor, type CartonUp, type PalletSpec } from './pallet-calculator-model';
import { PACK_UNITS, packPallets, packUnits, type PackKind } from './pallet-pack';

/**
 * The arithmetic of 3D laden (pallet-builder.ts), free of three.js: where an
 * omdoos lands, how a stack settles, the next free place, what stands on a
 * box, and the fill as full as it goes (pallet-pack.ts). Every size is in cm.
 * The floor is the pallet's deck or the kar's base plate: x runs along its
 * length, z along its width, y up from the floor.
 *
 * Spill (2026-11-26): a place may pass the real floor's edge by at most the
 * deck's allowance (spillXCm along the length, spillZCm across the width; on
 * the Deense kar only across the width). Every search here takes a place
 * inside the real floor first and hangs an omdoos over only where that gains
 * a place: one that stands lower, or the only one there is. Without spill
 * every function gives what it gave before there was one.
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
  /** The product's category, as the product list heads it; null without one. */
  section: string | null;
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

/**
 * The floor and the room above it. The floor is the real one, what is drawn (120 × 80); spillXCm and spillZCm
 * are the allowance (2026-11-26): how far an omdoos may stick out past it along the length (x, both ends) and
 * across the width (z, both sides). 0 without spill; on the Deense kar x is always 0.
 */
export interface Deck { lengthCm: number; widthCm: number; usableCm: number; spillXCm: number; spillZCm: number }

/** One product's share of the computed carrier, bottom to top. */
export interface BuilderPart { key: number; cartons: number }

const EPSILON = 1e-6;

export function deckOf(spec: PalletSpec): Deck {
  const floor = loadFloor(spec);
  return {
    lengthCm: spec.lengthCm, widthCm: spec.widthCm, usableCm: Math.max(0, spec.maxHeightCm - spec.baseHeightCm),
    spillXCm: floor.offsetXCm, spillZCm: floor.offsetZCm,
  };
}

/**
 * A packed box's place on the real floor, in cm. The packer (pallet-pack.ts) measures from the corner of the
 * deck it was given, the load floor (packDeck), which lies the spill before the real floor's corner on each
 * axis; it centres a load on its deck, so a load wider than the real floor hangs over evenly, never more than
 * the spill. Without spill the place is the packer's own.
 */
export function packedPlace(box: { x: number; y: number; z: number }, deck: Pick<Deck, 'spillXCm' | 'spillZCm'>): { x: number; y: number; z: number } {
  return {
    x: (box.x - packUnits(deck.spillXCm)) / PACK_UNITS, y: box.y / PACK_UNITS, z: (box.z - packUnits(deck.spillZCm)) / PACK_UNITS,
  };
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

/**
 * How far a box goes past the carrier: over the floor's edge (side) and above
 * the loading height (top), in cm. A little (up to SPILL_LITTLE_CM, Emre
 * 2026-11-15: "als het net spilt oranje, te veel in het rood") shows orange,
 * more shows red; the box stands either way. Over an edge only what is past
 * the deck's allowance is judged (pastCm; 2026-11-26: a spill of 2 cm is
 * allowed, so a box 2 cm over the edge is no warning, one 4 cm over is 2 cm
 * past and orange, more than 7 cm over is red). The height keeps its own rule.
 */
export interface Spill {
  /** Past the real floor's edge, the allowed part included. */
  sideCm: number;
  /** Of that, what is past the allowance: the same as sideCm on a deck without spill. */
  pastCm: number;
  topCm: number;
  level: SpillLevel;
}
export type SpillLevel = 'none' | 'little' | 'much';
export const SPILL_LITTLE_CM = 5;

export function spillOf(solid: Pick<Solid, 'x' | 'y' | 'z' | 'sx' | 'sy' | 'sz'>, deck: Deck): Spill {
  const overX = Math.max(0, -solid.x, solid.x + solid.sx - deck.lengthCm);
  const overZ = Math.max(0, -solid.z, solid.z + solid.sz - deck.widthCm);
  const side = Math.max(overX, overZ);
  const past = Math.max(0, overX - deck.spillXCm, overZ - deck.spillZCm);
  const top = Math.max(0, solid.y + solid.sy - deck.usableCm);
  const worst = Math.max(past, top);
  const level: SpillLevel = worst <= 0.05 ? 'none' : worst <= SPILL_LITTLE_CM + EPSILON ? 'little' : 'much';
  return { sideCm: round(side), pastCm: round(past), topCm: round(top), level };
}

export interface Landing { x: number; y: number; z: number; spill: Spill }

/**
 * Where a box of this size lands when its middle is aimed at (centreX,
 * centreZ): kept on the floor, pulled onto a nearby edge of the floor or of
 * another box (a few cm, so rows line up by hand), on top of what is under it.
 * With a spill the place inside the real floor stands unless the place within
 * the allowance rests lower (the box then goes beside its neighbour instead
 * of on top of it). A box larger than the floor and its allowance stays
 * centred and sticks out on both sides; its spill says how far, over the edge
 * and over the height.
 */
export function landing(solids: readonly Solid[], extent: Extent, centreX: number, centreZ: number, deck: Deck, skip: number | null): Landing {
  const others = solids.filter((solid) => solid.id !== skip);
  const xs = aimed(centreX - extent.sx / 2, extent.sx, deck.lengthCm, deck.spillXCm, others.map((solid) => [solid.x, solid.sx]));
  const zs = aimed(centreZ - extent.sz / 2, extent.sz, deck.widthCm, deck.spillZCm, others.map((solid) => [solid.z, solid.sz]));
  let best: { x: number; y: number; z: number } | null = null;
  for (const [x, z] of insideFirst(xs, zs)) {
    const y = restingHeight(others, x, z, extent.sx, extent.sz);
    if (!best || y < best.y - EPSILON) best = { x, y, z };
  }
  const placed = { x: round(best?.x ?? 0), y: round(best?.y ?? 0), z: round(best?.z ?? 0) };
  return { ...placed, spill: spillOf({ ...placed, ...extent }, deck) };
}

/**
 * The places along one axis for a box aimed at `value` (its corner): the one inside the real floor, and where
 * the deck has a spill and it differs, the one within the allowance. A box wider than the floor has only the
 * second; one wider than the floor and its allowance stays centred.
 */
function aimed(value: number, size: number, floor: number, spill: number, edges: readonly (readonly [number, number])[]): number[] {
  if (size > floor + 2 * spill + EPSILON) return [(floor - size) / 2];
  const inside = size > floor + EPSILON ? null : snap(clamp(value, 0, floor - size), size, floor, 0, edges);
  if (!(spill > 0) && inside !== null) return [inside];
  const allowed = snap(clamp(value, -spill, floor + spill - size), size, floor, spill, edges);
  return inside === null || Math.abs(allowed - inside) <= EPSILON ? [allowed] : [inside, allowed];
}

/** The places of both axes together, the first of each (inside the real floor) first: both inside, x within the allowance, z, both. */
export function insideFirst(xs: readonly number[], zs: readonly number[]): [number, number][] {
  const places: [number, number][] = [];
  for (const z of zs) for (const x of xs) places.push([x, z]);
  return places;
}

const SNAP_CM = 4;

/** Pulled onto the nearest edge within SNAP_CM: the real floor's edges first, then (with a spill) the allowance's, then the boxes around. */
function snap(value: number, size: number, floor: number, spill: number, edges: readonly (readonly [number, number])[]): number {
  const targets = [0, floor - size];
  if (spill > 0) targets.push(-spill, floor + spill - size);
  for (const [start, length] of edges) targets.push(start, start + length, start - size, start + length - size);
  let best = value;
  let distance = SNAP_CM;
  for (const target of targets) {
    if (target < -spill - EPSILON || target + size > floor + spill + EPSILON) continue;
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

/** Two boxes take some of the same space; touching faces do not. */
export function collides(a: Pick<Solid, 'x' | 'y' | 'z' | 'sx' | 'sy' | 'sz'>, b: Pick<Solid, 'x' | 'y' | 'z' | 'sx' | 'sy' | 'sz'>): boolean {
  return overlaps(a.x, a.sx, b.x, b.sx) && overlaps(a.y, a.sy, b.y, b.sy) && overlaps(a.z, a.sz, b.z, b.sz);
}

/** The boxes standing on this one, and on those, up to the top: what goes up or down with it. */
export function ridersOf(solids: readonly Solid[], id: number): Set<number> {
  const riders = new Set<number>();
  const queue = [id];
  while (queue.length) {
    const baseId = queue.pop();
    const base = solids.find((solid) => solid.id === baseId);
    if (!base) continue;
    const top = base.y + base.sy;
    for (const solid of solids) {
      if (solid.id === id || riders.has(solid.id)) continue;
      if (Math.abs(solid.y - top) < 0.05 && overlaps(solid.x, solid.sx, base.x, base.sx) && overlaps(solid.z, solid.sz, base.z, base.sz)) {
        riders.add(solid.id);
        queue.push(solid.id);
      }
    }
  }
  return riders;
}

/** How far a place of this size passes the real floor along one axis; 0 inside it. */
function over(at: number, size: number, floor: number): number {
  return Math.max(0, -at, at + size - floor);
}

/** The place hangs over an edge of the real floor (within the allowance: no search here gives a place past it). */
function hangs(x: number, z: number, extent: Pick<Extent, 'sx' | 'sz'>, deck: Deck): boolean {
  return over(x, extent.sx, deck.lengthCm) > EPSILON || over(z, extent.sz, deck.widthCm) > EPSILON;
}

/**
 * Turned or tipped where it stands: the places along one axis that keep the box's middle (its corner at
 * `value`), the one inside the real floor first, then, where the deck has a spill and it differs, the one within
 * the allowance. A box wider than the floor and its allowance stays centred and sticks out.
 */
export function placesNear(value: number, size: number, floor: number, spill: number): number[] {
  if (size > floor + 2 * spill + EPSILON) return [(floor - size) / 2];
  const allowed = clamp(value, -spill, floor + spill - size);
  if (size > floor + EPSILON) return [allowed];
  const inside = clamp(value, 0, floor - size);
  return Math.abs(allowed - inside) <= EPSILON ? [inside] : [inside, allowed];
}

/**
 * The free place for a box of this size nearest to where it stood: at its
 * own level first, then inside the real floor before a place that hangs over
 * (within the spill), then the nearest one, against the floor's edges or the
 * boxes around, on what is under it, under the height. Null when none.
 */
export function nearestSpot(solids: readonly Solid[], extent: Extent, centreX: number, centreZ: number, level: number, deck: Deck):
  { x: number; y: number; z: number } | null {
  const spillX = deck.spillXCm; const spillZ = deck.spillZCm;
  if (extent.sx > deck.lengthCm + 2 * spillX + EPSILON || extent.sz > deck.widthCm + 2 * spillZ + EPSILON) return null;
  const xs = new Set([0, round(deck.lengthCm - extent.sx), round(clamp(centreX - extent.sx / 2, 0, deck.lengthCm - extent.sx))]);
  const zs = new Set([0, round(deck.widthCm - extent.sz), round(clamp(centreZ - extent.sz / 2, 0, deck.widthCm - extent.sz))]);
  if (spillX > 0) {
    xs.add(round(-spillX)); xs.add(round(deck.lengthCm + spillX - extent.sx));
    xs.add(round(clamp(centreX - extent.sx / 2, -spillX, deck.lengthCm + spillX - extent.sx)));
  }
  if (spillZ > 0) {
    zs.add(round(-spillZ)); zs.add(round(deck.widthCm + spillZ - extent.sz));
    zs.add(round(clamp(centreZ - extent.sz / 2, -spillZ, deck.widthCm + spillZ - extent.sz)));
  }
  for (const solid of solids) {
    xs.add(round(solid.x + solid.sx)); xs.add(round(solid.x - extent.sx));
    zs.add(round(solid.z + solid.sz)); zs.add(round(solid.z - extent.sz));
  }
  let best: { x: number; y: number; z: number; score: number } | null = null;
  for (const x of xs) {
    if (x < -spillX - EPSILON || x + extent.sx > deck.lengthCm + spillX + EPSILON) continue;
    for (const z of zs) {
      if (z < -spillZ - EPSILON || z + extent.sz > deck.widthCm + spillZ + EPSILON) continue;
      const y = restingHeight(solids, x, z, extent.sx, extent.sz);
      if (y + extent.sy > deck.usableCm + EPSILON) continue;
      const placed = { x, y, z, ...extent };
      if (solids.some((solid) => collides(solid, placed))) continue;
      /* A cm of level outweighs everything; hanging over outweighs any distance on the floor (never more than a few hundred cm). */
      const score = Math.abs(y - level) * 1000 + (hangs(x, z, extent, deck) ? HANG_COST : 0)
        + Math.hypot(x + extent.sx / 2 - centreX, z + extent.sz / 2 - centreZ);
      if (!best || score < best.score - EPSILON) best = { x: round(x), y: round(y), z: round(z), score };
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z } : null;
}

/** What a place that hangs over costs in nearestSpot's score: more than any distance across a floor, less than 1 cm of level. */
const HANG_COST = 500;

export interface Spot { x: number; y: number; z: number; up: CartonUp; turned: boolean }

/**
 * The next place for one more omdoos: the lowest spot, then one inside the
 * real floor before one that hangs over (within the spill), then the back,
 * then the left, against the floor's edges or the boxes already there, on the
 * sides given (each also turned). Null when it goes nowhere under the height.
 */
export function nextSpot(
  solids: readonly Solid[], item: Pick<BuilderItem, 'lengthCm' | 'widthCm' | 'heightCm'>, sides: readonly CartonUp[], deck: Deck,
): Spot | null {
  const spillX = deck.spillXCm; const spillZ = deck.spillZCm;
  let best: (Spot & { hangs: boolean }) | null = null;
  for (const up of sides) {
    for (const turned of [false, true]) {
      const extent = extentOf(item, up, turned);
      if (extent.sx > deck.lengthCm + 2 * spillX + EPSILON || extent.sz > deck.widthCm + 2 * spillZ + EPSILON) continue;
      /* Against the floor's edges or the far side of a box: rounded, so boxes in rows give few places to try. */
      const xs = new Set([0, round(deck.lengthCm - extent.sx)]);
      const zs = new Set([0, round(deck.widthCm - extent.sz)]);
      if (spillX > 0) { xs.add(round(-spillX)); xs.add(round(deck.lengthCm + spillX - extent.sx)); }
      if (spillZ > 0) { zs.add(round(-spillZ)); zs.add(round(deck.widthCm + spillZ - extent.sz)); }
      for (const solid of solids) { xs.add(round(solid.x + solid.sx)); zs.add(round(solid.z + solid.sz)); }
      for (const x of xs) {
        if (x < -spillX - EPSILON || x + extent.sx > deck.lengthCm + spillX + EPSILON) continue;
        for (const z of zs) {
          if (z < -spillZ - EPSILON || z + extent.sz > deck.widthCm + spillZ + EPSILON) continue;
          const y = restingHeight(solids, x, z, extent.sx, extent.sz);
          if (y + extent.sy > deck.usableCm + EPSILON) continue;
          const out = hangs(x, z, extent, deck);
          const level = !best ? -1 : y < best.y - EPSILON ? -1 : y > best.y + EPSILON ? 1 : 0;
          const better = level < 0 || (level === 0 && (out !== best!.hangs ? !out
            : z < best!.z - EPSILON || (Math.abs(z - best!.z) <= EPSILON && x < best!.x - EPSILON)));
          if (better) best = { x: round(x), y: round(y), z: round(z), up, turned, hangs: out };
        }
      }
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z, up: best.up, turned: best.turned } : null;
}

/** A carrier's floor and allowance as layerSlots reads them. */
function floorOf(deck: Deck): Pick<PalletSpec, 'lengthCm' | 'widthCm' | 'spillLengthCm' | 'spillWidthCm'> {
  return { lengthCm: deck.lengthCm, widthCm: deck.widthCm, spillLengthCm: deck.spillXCm, spillWidthCm: deck.spillZCm };
}

/**
 * The next place of the count's own layer for one more omdoos on this side
 * (2026-11-26, Emre: "bij calculatie ... dat past en als ik op 3d druk dan
 * heeft die geen ruimte"): the places of layerSlots, the very rows the card's
 * "per laag" counts, each where it rests on the floor or on what stands under
 * it; the lowest one first, so a layer fills before the next starts, in the
 * layer's own order on a tie. From an empty carrier that reaches the card's
 * count; a search by corners (nextSpot) stopped below it wherever the layer
 * needs both turns (two bears a quarter turned, where the first one straight
 * left no room for a second). Null when no place of the layer is free under
 * the height.
 */
export function patternSpot(
  solids: readonly Solid[], item: Pick<BuilderItem, 'lengthCm' | 'widthCm' | 'heightCm'>, up: CartonUp, deck: Deck,
): Spot | null {
  const standing = cartonStanding(item, up);
  if (!(standing.lengthCm > 0 && standing.widthCm > 0 && standing.heightCm > 0)) return null;
  let best: Spot | null = null;
  for (const slot of layerSlots({ lengthCm: standing.lengthCm, widthCm: standing.widthCm }, floorOf(deck))) {
    const x = round(slot.x); const z = round(slot.z);
    const y = restingHeight(solids, x, z, slot.lengthCm, slot.widthCm);
    if (y + standing.heightCm > deck.usableCm + EPSILON) continue;
    if (!best || y < best.y - EPSILON) best = { x, y: round(y), z, up, turned: Math.abs(slot.lengthCm - standing.lengthCm) > EPSILON };
  }
  return best;
}

/** One product's omdozen for a stack of whole layers: its omdoos and the side the count stands it on. */
export interface LayerStock { key: number; cartons: number; lengthCm: number; widthCm: number; heightCm: number; up: CartonUp }

/**
 * Omdozen in whole layers of their own pattern (layerSlots), each product on
 * the side the count stands it, bottom to top in the order given, the first
 * layer at `fromY` above the floor: a carrier as the layer count estimates
 * it (planPallets, the server's mixedPallets). The order's 3D lays a pallet
 * so when no fuller load takes it, and Palletberekening's 3D a carrier its
 * plan counted in layers. Nothing here checks that a layer is carried by the
 * one under it, as the count does not: settle the boxes after, and what has
 * nothing under it comes down. Returns how many omdozen of each key it laid.
 */
export function stackAbove(rest: readonly LayerStock[], boxes: BuilderBox[], fromY: number,
  spec: Pick<PalletSpec, 'lengthCm' | 'widthCm' | 'spillLengthCm' | 'spillWidthCm'>): Map<number, number> {
  const laid = new Map<number, number>();
  let y = fromY;
  for (const entry of rest) {
    if (!sized(entry) || entry.cartons <= 0) continue;
    const standing = cartonStanding(entry, entry.up);
    const slots = layerSlots({ lengthCm: standing.lengthCm, widthCm: standing.widthCm }, spec);
    if (!slots.length) continue;
    for (let left = entry.cartons; left > 0; left -= slots.length) {
      for (const slot of slots.slice(0, Math.min(left, slots.length))) {
        boxes.push({
          id: boxes.length + 1, key: entry.key, x: round(slot.x), y: round(y), z: round(slot.z), up: entry.up,
          turned: Math.abs(slot.lengthCm - standing.lengthCm) > 1e-6,
        });
        laid.set(entry.key, (laid.get(entry.key) ?? 0) + 1);
      }
      y += standing.heightCm;
    }
  }
  return laid;
}

/** The same boxes at the same places, whatever their ids and order: a build as it was laid, nothing moved, turned, added or gone. */
export function sameBuild(left: readonly BuilderBox[], right: readonly BuilderBox[]): boolean {
  if (left.length !== right.length) return false;
  const sign = (box: BuilderBox) => `${box.key}|${box.up}|${box.turned ? 1 : 0}|${Math.round(box.x * 100)}|${Math.round(box.y * 100)}|${Math.round(box.z * 100)}`;
  const a = left.map(sign).sort();
  const b = right.map(sign).sort();
  return a.every((value, index) => value === b[index]);
}

/**
 * One carrier as full as it goes (pallet-pack.ts) from these omdozen: what
 * Automatisch lays since 2026-11-25 ("eerst de eerste proberen helemaal te
 * vullen"). The colours of one omdoos share its layers, each colour's boxes
 * kept together; an omdoos lies on its side only on the sides given, and
 * where that fills clearly more. Whatever does not fit stays on the panel.
 */
export function packedFill(items: ReadonlyMap<number, BuilderItem>, parts: readonly BuilderPart[], deck: Deck, maxWeightKg: number,
  sides: readonly CartonUp[], firstId: number): BuilderBox[] {
  const bySize = new Map<string, PackKind>();
  const members = new Map<number, { key: number; left: number }[]>();
  for (const part of parts) {
    const item = items.get(part.key);
    const cartons = Math.floor(part.cartons);
    if (!item || !sized(item) || !(cartons > 0)) continue;
    const length = packUnits(item.lengthCm); const width = packUnits(item.widthCm); const height = packUnits(item.heightCm);
    const weight = packUnits(item.weightKg);
    /* One omdoos size is one kind, its heaviest colour's weight for all. */
    const signature = `${length}|${width}|${height}`;
    let kind = bySize.get(signature);
    if (!kind) {
      kind = { key: bySize.size + 1, length, width, height, weight, count: 0, sides };
      bySize.set(signature, kind);
      members.set(kind.key, []);
    }
    kind.weight = Math.max(kind.weight, weight);
    kind.count += cartons;
    members.get(kind.key)?.push({ key: item.key, left: cartons });
  }
  /* The packer's deck is the load floor, as packDeck gives it: the real floor plus the allowance on both sides. */
  const pack = packPallets([...bySize.values()], {
    length: packUnits(deck.lengthCm + 2 * deck.spillXCm), width: packUnits(deck.widthCm + 2 * deck.spillZCm),
    height: packUnits(deck.usableCm), maxWeight: Math.max(0, packUnits(maxWeightKg)),
  }, 1);
  const boxes: BuilderBox[] = [];
  let id = firstId;
  for (const box of pack.pallets[0]?.boxes ?? []) {
    const member = members.get(box.key)?.find((candidate) => candidate.left > 0);
    if (!member) continue;
    member.left -= 1;
    boxes.push({ id: id++, key: member.key, ...packedPlace(box, deck), up: box.up, turned: box.turned });
  }
  return boxes;
}

/* ----------------------------------------------------------------- storage */

const STORAGE_KEY = 'enrosed.palletBuilder';
const MAX_BOXES = 600;
/** How many builds a device keeps, the newest first, and how many boxes in all. */
const MAX_KEPT = 8;
const MAX_KEPT_BOXES = 2400;

function storedBox(value: unknown): value is BuilderBox {
  const box = value as Partial<BuilderBox> | null;
  return !!box && Number.isSafeInteger(box.id) && Number.isSafeInteger(box.key)
    && [box.x, box.y, box.z].every((n) => typeof n === 'number' && Number.isFinite(n))
    && (box.up === 'h' || box.up === 'w' || box.up === 'l') && typeof box.turned === 'boolean';
}

interface KeptBuild { key: string; boxes: BuilderBox[] }

/**
 * The builds kept on this device, the newest first: `{ v: 2, builds: [{ key, boxes }] }`. Before 2026-11-26
 * the value was a build per carrier (`{ kar: [...], EURO_120X80: [...] }`), whatever the height, the switch
 * and the cards it was made for, so 3D laden opened on an older load that no longer fitted what the cards
 * said; anything of that shape reads as nothing kept and is removed.
 */
function readKept(): KeptBuild[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  let stored: { v?: unknown; builds?: unknown } | null = null;
  try { stored = JSON.parse(raw) as { v?: unknown; builds?: unknown } | null; } catch { /* unreadable: nothing kept */ }
  if (!stored || typeof stored !== 'object' || stored.v !== 2 || !Array.isArray(stored.builds)) {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
  return (stored.builds as Partial<KeptBuild>[])
    .filter((build): build is KeptBuild => !!build && typeof build.key === 'string' && Array.isArray(build.boxes))
    .map((build) => ({ key: build.key, boxes: build.boxes.filter(storedBox) }));
}

function writeKept(builds: readonly KeptBuild[]): void {
  const kept: KeptBuild[] = [];
  let boxes = 0;
  for (const build of builds) {
    if (kept.length >= MAX_KEPT || boxes + build.boxes.length > MAX_KEPT_BOXES) break;
    kept.push(build);
    boxes += build.boxes.length;
  }
  if (kept.length) localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, builds: kept }));
  else localStorage.removeItem(STORAGE_KEY);
}

/**
 * The boxes kept on this device under this key; none when nothing was kept under it. The key names
 * everything the count depends on (the host's: the carrier and its type, the height, the spill, the switch,
 * the cards' omdozen and the page), so a build only comes back for the very plan it was made on. Boxes of
 * products no longer on the tray drop out.
 */
export function loadBuild(buildKey: string, items: ReadonlyMap<number, BuilderItem>): BuilderBox[] {
  try {
    const boxes = readKept().find((build) => build.key === buildKey)?.boxes ?? [];
    return boxes.filter((box) => {
      const item = items.get(box.key);
      return !!item && sized(item);
    }).slice(0, MAX_BOXES);
  } catch {
    return [];
  }
}

/** Keeps a build under its key as the newest; the oldest go beyond MAX_KEPT builds or MAX_KEPT_BOXES boxes. */
export function saveBuild(buildKey: string, boxes: readonly BuilderBox[]): void {
  try {
    writeKept([{ key: buildKey, boxes: boxes.slice(0, MAX_BOXES) }, ...readKept().filter((build) => build.key !== buildKey)]);
  } catch { /* private mode: the build lives as long as the screen */ }
}

/** Nothing is kept under this key any more: the view opens on what the host gives again. */
export function dropBuild(buildKey: string): void {
  try {
    const kept = readKept();
    if (kept.some((build) => build.key === buildKey)) writeKept(kept.filter((build) => build.key !== buildKey));
  } catch { /* private mode */ }
}

export const MAX_BUILDER_BOXES = MAX_BOXES;
