import { cartonStanding, type CartonUp } from './pallet-calculator-model';

/**
 * Zo vol mogelijk laden (Emre, 2026-11-25: "bij een order van 3 pallets
 * eerst de eerste proberen helemaal te vullen en je mag kantelen"), free of
 * Angular and three.js. The omdozen go pallet by pallet: each pallet is
 * filled as full as it gets from everything still to load before the next
 * one starts, so the last pallet takes what is left.
 *
 * How a pallet fills: its floor is a set of free rectangles, each carried in
 * full by the deck or by the flat top of omdozen under it. The lowest one is
 * filled first with a block: omdozen of one kind on one side, in rows along
 * the length, rows across, and layers up, as many as fit and are left. Its
 * top becomes a new floor, the rest of the rectangle two smaller ones; tops
 * at one height that meet edge to edge join. Of the blocks that fit, the one
 * that leaves the fullest pallet in the end wins: every candidate is tried
 * by filling the rest of the pallet the quick way (the largest block each
 * time); where they load the same (the last pallet takes all that is left),
 * the one that ends lowest, so a part pallet stands low and wide instead of
 * as a tower. An omdoos lies down only where that fills clearly more
 * (TIP_COST). Nothing hangs over an edge and nothing floats.
 *
 * Every size is in hundredths of a cm and every weight in hundredths of a kg,
 * whole numbers only: the same rounding everywhere, and a server port of
 * this file counts the same.
 */

/** Hundredths: sizes per cm, weights per kg. */
export const PACK_UNITS = 100;

export function packUnits(value: number): number {
  return Math.round(value * PACK_UNITS);
}

/** One kind of omdoos: the same size and weight (the colours of one product share it). */
export interface PackKind {
  key: number;
  length: number;
  width: number;
  height: number;
  /** One omdoos; 0 when unknown: the height alone decides. */
  weight: number;
  count: number;
  /** The sides it may stand on: 'h' upright, 'w' on its long side, 'l' on its end. */
  sides: readonly CartonUp[];
}

/** The floor of the pallet or the kar and the room above it. */
export interface PackDeck {
  length: number;
  width: number;
  /** The loading height above the floor. */
  height: number;
  /** 0: no weight limit. */
  maxWeight: number;
}

export interface PackedBox { key: number; x: number; y: number; z: number; up: CartonUp; turned: boolean }

export interface PackedPallet {
  boxes: PackedBox[];
  /** Omdozen of each kind on it, by the kind's key. */
  counts: Map<number, number>;
  weight: number;
  /** The top of the load above the floor. */
  top: number;
}

export interface PackResult {
  pallets: PackedPallet[];
  /** Omdozen of each kind that went on no pallet: too large or too heavy for it, or past the pallet limit. */
  left: Map<number, number>;
}

/** Candidates tried in full per decision: enough to see past the largest block, few enough for a phone. */
const PILOT = 8;

/**
 * An omdoos on its side counts this many hundredths of its volume less when the tries are
 * compared: it lies down where that fills clearly more, not for a few small boxes more
 * (2026-11-25, on VF-2026-0017: at 5 the 24 domes of pallet 1 stay upright, the 81 cm half
 * hearts and the 90 × 60 × 73 bears still lie down).
 */
const TIP_COST = 5;

interface Shape { up: CartonUp; turned: boolean; sx: number; sy: number; sz: number; rank: number }

interface Kind { key: number; weight: number; volume: number; shapes: Shape[] }

interface Floor { x: number; z: number; dx: number; dz: number; y: number; parked: boolean }

interface Block { kind: number; shape: Shape; nx: number; ny: number; nz: number; count: number; volume: number }

interface State {
  floors: Floor[];
  weight: number;
  left: number[];
  volume: number;
  /** The volume of the omdozen on a side. */
  tipped: number;
  /** The top of the load so far. */
  top: number;
}

/** How a try ends: the volume loaded, an omdoos on its side counting a little less. */
function worth(state: State): number {
  return state.volume * 100 - state.tipped * TIP_COST;
}

/** The sides an omdoos stands on, each also a quarter turned on the floor, without repeats: upright first. */
function shapesOf(kind: PackKind, deck: PackDeck): Shape[] {
  const shapes: Shape[] = [];
  const seen = new Set<string>();
  let rank = 0;
  for (const up of ['h', 'w', 'l'] as const) {
    if (!kind.sides.includes(up)) continue;
    const standing = cartonStanding({ lengthCm: kind.length, widthCm: kind.width, heightCm: kind.height }, up);
    for (const turned of [false, true]) {
      const sx = turned ? standing.widthCm : standing.lengthCm;
      const sz = turned ? standing.lengthCm : standing.widthCm;
      const sy = standing.heightCm;
      const id = `${sx}|${sy}|${sz}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (sx <= deck.length && sz <= deck.width && sy <= deck.height) shapes.push({ up, turned, sx, sy, sz, rank });
      rank += 1;
    }
  }
  return shapes;
}

function placeable(kind: PackKind): boolean {
  return kind.count > 0 && kind.length > 0 && kind.width > 0 && kind.height > 0;
}

/** The largest block of one kind on one side for a floor: full layers of rows, or one short layer. */
function blockFor(floor: Floor, index: number, kind: Kind, shape: Shape, most: number, deck: PackDeck): Block | null {
  if (shape.sx > floor.dx || shape.sz > floor.dz || floor.y + shape.sy > deck.height) return null;
  const ax = Math.floor(floor.dx / shape.sx);
  const az = Math.floor(floor.dz / shape.sz);
  const ay = Math.floor((deck.height - floor.y) / shape.sy);
  const layer = ax * az;
  if (most >= layer) {
    const ny = Math.min(ay, Math.floor(most / layer));
    const count = layer * ny;
    return { kind: index, shape, nx: ax, ny, nz: az, count, volume: count * kind.volume };
  }
  /* Less than a layer: the fullest rectangle, the longest rows first. */
  let nx = 0; let nz = 0;
  for (let rows = 1; rows <= az; rows++) {
    const across = Math.min(ax, Math.floor(most / rows));
    if (across <= 0) break;
    if (across * rows > nx * nz) { nx = across; nz = rows; }
  }
  if (!nx) return null;
  const count = nx * nz;
  return { kind: index, shape, nx, ny: 1, nz, count, volume: count * kind.volume };
}

/** The largest block first, upright before a side, then the kind's order: the quick way, and the order the tries go in. */
function quick(left: Block, right: Block): number {
  return right.volume - left.volume || left.shape.rank - right.shape.rank || left.kind - right.kind;
}

function candidates(floor: Floor, state: State, kinds: readonly Kind[], deck: PackDeck): Block[] {
  const blocks: Block[] = [];
  for (let index = 0; index < kinds.length; index++) {
    const left = state.left[index];
    if (left <= 0) continue;
    const kind = kinds[index];
    const room = kind.weight > 0 && deck.maxWeight > 0 ? Math.floor((deck.maxWeight - state.weight) / kind.weight) : left;
    const most = Math.min(left, room);
    if (most <= 0) continue;
    for (const shape of kind.shapes) {
      const block = blockFor(floor, index, kind, shape, most, deck);
      if (block) blocks.push(block);
    }
  }
  return blocks.sort(quick);
}

/** The lowest free rectangle, then the one furthest back, then the one furthest left. */
function lowest(floors: readonly Floor[]): number {
  let best = -1;
  for (let index = 0; index < floors.length; index++) {
    const floor = floors[index];
    if (floor.parked) continue;
    if (best < 0) { best = index; continue; }
    const other = floors[best];
    if (floor.y < other.y || (floor.y === other.y && (floor.z < other.z || (floor.z === other.z && floor.x < other.x)))) best = index;
  }
  return best;
}

/** Rectangles at one height that meet along a whole edge become one, so a larger omdoos finds room across them. */
function join(floors: Floor[]): Floor[] {
  for (let changed = true; changed;) {
    changed = false;
    search: for (let i = 0; i < floors.length; i++) {
      for (let j = i + 1; j < floors.length; j++) {
        const a = floors[i]; const b = floors[j];
        if (a.y !== b.y) continue;
        let joined: Floor | null = null;
        if (a.x === b.x && a.dx === b.dx && (a.z + a.dz === b.z || b.z + b.dz === a.z)) {
          joined = { x: a.x, dx: a.dx, z: Math.min(a.z, b.z), dz: a.dz + b.dz, y: a.y, parked: false };
        } else if (a.z === b.z && a.dz === b.dz && (a.x + a.dx === b.x || b.x + b.dx === a.x)) {
          joined = { x: Math.min(a.x, b.x), dx: a.dx + b.dx, z: a.z, dz: a.dz, y: a.y, parked: false };
        }
        if (joined) {
          floors.splice(j, 1);
          floors[i] = joined;
          changed = true;
          break search;
        }
      }
    }
  }
  return floors;
}

/** The block in the floor's back left corner: its top is a new floor, the rest of the floor two rectangles. */
function apply(state: State, at: number, block: Block, kinds: readonly Kind[], deck: PackDeck, boxes?: PackedBox[]): void {
  const floor = state.floors[at];
  const { shape, nx, ny, nz } = block;
  const width = nx * shape.sx; const depth = nz * shape.sz; const height = ny * shape.sy;
  if (boxes) {
    const key = kinds[block.kind].key;
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          boxes.push({ key, x: floor.x + ix * shape.sx, y: floor.y + iy * shape.sy, z: floor.z + iz * shape.sz, up: shape.up, turned: shape.turned });
        }
      }
    }
  }
  state.left[block.kind] -= block.count;
  state.weight += block.count * kinds[block.kind].weight;
  state.volume += block.volume;
  if (shape.up !== 'h') state.tipped += block.volume;
  state.top = Math.max(state.top, floor.y + height);
  const next = state.floors.filter((_, index) => index !== at);
  if (floor.y + height < deck.height) next.push({ x: floor.x, z: floor.z, dx: width, dz: depth, y: floor.y + height, parked: false });
  /* The rest of the floor as two rectangles, cut so the larger one is as large as it gets. */
  const restX = floor.dx - width; const restZ = floor.dz - depth;
  const along = Math.max(restX * floor.dz, width * restZ);
  const across = Math.max(restX * depth, floor.dx * restZ);
  const pieces = along >= across
    ? [{ x: floor.x + width, z: floor.z, dx: restX, dz: floor.dz }, { x: floor.x, z: floor.z + depth, dx: width, dz: restZ }]
    : [{ x: floor.x + width, z: floor.z, dx: restX, dz: depth }, { x: floor.x, z: floor.z + depth, dx: floor.dx, dz: restZ }];
  for (const piece of pieces) if (piece.dx > 0 && piece.dz > 0) next.push({ ...piece, y: floor.y, parked: false });
  state.floors = join(next);
}

function copy(state: State): State {
  return {
    floors: state.floors.map((floor) => ({ ...floor })), weight: state.weight, left: [...state.left], volume: state.volume, tipped: state.tipped,
    top: state.top,
  };
}

/** A rectangle nothing fits on is set aside; it only comes back joined to a neighbour. */
function park(state: State, at: number): void {
  state.floors[at] = { ...state.floors[at], parked: true };
}

/** The rest of the pallet the quick way: how full it ends. */
function finish(state: State, kinds: readonly Kind[], deck: PackDeck): number {
  for (;;) {
    const at = lowest(state.floors);
    if (at < 0) return worth(state);
    const blocks = candidates(state.floors[at], state, kinds, deck);
    if (blocks.length) apply(state, at, blocks[0], kinds, deck);
    else park(state, at);
  }
}

function fillOne(kinds: readonly Kind[], pool: readonly number[], deck: PackDeck): { boxes: PackedBox[]; state: State } {
  const state: State = {
    floors: [{ x: 0, z: 0, dx: deck.length, dz: deck.width, y: 0, parked: false }], weight: 0, left: [...pool], volume: 0, tipped: 0, top: 0,
  };
  const boxes: PackedBox[] = [];
  for (;;) {
    const at = lowest(state.floors);
    if (at < 0) break;
    const blocks = candidates(state.floors[at], state, kinds, deck);
    if (!blocks.length) { park(state, at); continue; }
    let chosen = blocks[0];
    if (blocks.length > 1) {
      /* The fullest pallet wins; where several load the same (the last pallet, which takes all that is left), the lowest. */
      let best = Number.NEGATIVE_INFINITY;
      let lowestTop = Number.POSITIVE_INFINITY;
      for (const block of blocks.slice(0, PILOT)) {
        const trial = copy(state);
        apply(trial, at, block, kinds, deck);
        const full = finish(trial, kinds, deck);
        if (full > best || (full === best && trial.top < lowestTop)) { best = full; lowestTop = trial.top; chosen = block; }
      }
    }
    apply(state, at, chosen, kinds, deck, boxes);
  }
  return { boxes, state };
}

/** The load in the middle of the floor, as the pallet's own pattern stands (layerSlots). */
function centred(boxes: PackedBox[], kinds: ReadonlyMap<number, Kind>, deck: PackDeck): PackedBox[] {
  let usedX = 0; let usedZ = 0;
  const extent = (box: PackedBox) => kinds.get(box.key)?.shapes.find((shape) => shape.up === box.up && shape.turned === box.turned);
  for (const box of boxes) {
    const shape = extent(box);
    if (!shape) continue;
    usedX = Math.max(usedX, box.x + shape.sx);
    usedZ = Math.max(usedZ, box.z + shape.sz);
  }
  const dx = Math.max(0, Math.floor((deck.length - usedX) / 2));
  const dz = Math.max(0, Math.floor((deck.width - usedZ) / 2));
  return dx || dz ? boxes.map((box) => ({ ...box, x: box.x + dx, z: box.z + dz })) : boxes;
}

/**
 * The omdozen pallet by pallet, each as full as it gets; at most maxPallets.
 * Kinds that fit no pallet on any allowed side (too large, too heavy, no
 * sizes) stay in left, as do omdozen past the limit.
 */
export function packPallets(input: readonly PackKind[], deck: PackDeck, maxPallets = 200): PackResult {
  const kinds: Kind[] = input.map((kind) => ({
    key: kind.key, weight: Math.max(0, kind.weight), volume: kind.length * kind.width * kind.height,
    shapes: placeable(kind) && !(deck.maxWeight > 0 && kind.weight > deck.maxWeight) ? shapesOf(kind, deck) : [],
  }));
  const byKey = new Map(kinds.map((kind) => [kind.key, kind]));
  const pool = input.map((kind, index) => (kinds[index].shapes.length ? Math.max(0, kind.count) : 0));
  const pallets: PackedPallet[] = [];
  while (pallets.length < maxPallets && pool.some((count) => count > 0)) {
    const { boxes, state } = fillOne(kinds, pool, deck);
    if (!boxes.length) break;
    const counts = new Map<number, number>();
    let top = 0;
    for (const box of boxes) {
      counts.set(box.key, (counts.get(box.key) ?? 0) + 1);
      const shape = byKey.get(box.key)?.shapes.find((candidate) => candidate.up === box.up && candidate.turned === box.turned);
      if (shape) top = Math.max(top, box.y + shape.sy);
    }
    for (let index = 0; index < pool.length; index++) pool[index] = state.left[index];
    pallets.push({ boxes: centred(boxes, byKey, deck), counts, weight: state.weight, top });
  }
  const left = new Map<number, number>();
  input.forEach((kind, index) => {
    const rest = kinds[index].shapes.length ? pool[index] : Math.max(0, kind.count);
    if (rest > 0) left.set(kind.key, (left.get(kind.key) ?? 0) + rest);
  });
  return { pallets, left };
}

/** The deck of a pallet or kar spec in pack units: its floor, the height above the wood, the weight limit. */
export function packDeck(spec: { lengthCm: number; widthCm: number; baseHeightCm: number; maxHeightCm: number; maxWeightKg: number }): PackDeck {
  return {
    length: packUnits(spec.lengthCm), width: packUnits(spec.widthCm),
    height: Math.max(0, packUnits(spec.maxHeightCm) - packUnits(spec.baseHeightCm)), maxWeight: Math.max(0, packUnits(spec.maxWeightKg)),
  };
}

/** Every side an omdoos can stand on: what "kantelen mag" allows. */
export const ALL_SIDES: readonly CartonUp[] = ['h', 'w', 'l'];
export const UPRIGHT: readonly CartonUp[] = ['h'];
