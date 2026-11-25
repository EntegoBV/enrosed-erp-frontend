import { cartonStanding, type CartonUp } from './pallet-calculator-model';
import { packPallets, packUnits, type PackDeck, type PackKind, type PackedBox } from './pallet-pack';

/**
 * How one pallet of a PACKED list stands with its omdozen loaded as full as
 * they go (2026-11-25), free of Angular: a hand-built pallet (Zelf indelen),
 * or a pallet of the server's own list. The packer (pallet-pack.ts) is
 * greedy: what it lays on a pallet depends on what still waits, so the
 * omdozen of one of the server's pallets do not always go on one pallet
 * packed alone (2.6 % of them). A pallet is therefore tried
 * - with the pallets after it, as the server loads a list: this pallet
 *   first, every later one still waiting (what Zelf indelen copied is
 *   exactly that, so it stands as the server's pallet did);
 * - alone: its own omdozen only, the weight left to the caller's own check
 *   (a pallet too heavy reads "te zwaar", not "te hoog");
 * - with the later ones and omdozen put back (every waiting product one or
 *   two more, then one product 1 to MAX_BACK more or fewer, a few on every
 *   product first): a lowered quantity takes its omdozen off the last pallets
 *   (trimPallets) and a raised one puts its extra on later pallets, so the
 *   pallets before still stand as the server loaded them before the change.
 *   Any try that works is a real arrangement of this pallet's own omdozen,
 *   so more tries never make a pallet fit that does not.
 * Each kind weighs its heaviest colour over the whole order, as the server's
 * PalletCalculator.packedPallets weighs it. Where the packer lays more than
 * the pallet carries, the extra boxes come off the top and what stood on
 * them comes down (settled), so the top is the pallet's own. Null is no proof
 * of too much: the caller falls back on whole layers, which may say "te
 * hoog". The count stays the server's; this only judges and draws.
 */

/** One product's omdoos in cm and kg. */
export interface HandCarton { lengthCm: number; widthCm: number; heightCm: number; weightKg: number }

/** A box of the pallet: its product, where it stands in pack units (1/100 cm), on which side. */
export interface HandBox { productId: number; x: number; y: number; z: number; up: CartonUp; turned: boolean }

export interface HandLoad {
  boxes: HandBox[];
  /** The top of the load above the floor, in pack units. */
  top: number;
}

type Items = readonly { productId: number; cartons: number }[];

/** Omdozen of one product put back per product tried, at most. */
const MAX_BACK = 40;
/** Packs one pallet may spend on putting omdozen back: about 15-140 ms on a desk for a pallet none of them fits. */
const BUDGET = 320;
/** Pallets judged before, by everything a try reads: a planner re-renders often. */
const MEMO = new Map<string, HandLoad | null>();
const MEMO_SIZE = 300;

function count(items: Items, into = new Map<number, number>()): Map<number, number> {
  for (const item of items) if (item.cartons > 0) into.set(item.productId, (into.get(item.productId) ?? 0) + item.cartons);
  return into;
}

/** The same omdozen of each product on two pallets. */
export function sameItems(left: Items, right: Items): boolean {
  const a = count(left); const b = count(right);
  return a.size === b.size && [...a].every(([productId, cartons]) => b.get(productId) === cartons);
}

/** No more omdozen of any product than on the other pallet: what fits there fits here, at most as high. */
export function within(items: Items, of: Items): boolean {
  const a = count(items); const b = count(of);
  return a.size > 0 && [...a].every(([productId, cartons]) => (b.get(productId) ?? 0) >= cartons);
}

/**
 * A pallet carrying part of what a loaded pallet carries: per product the boxes standing lowest stay, what stood on a
 * box that came off comes down, the top is the settled one. Null when the load lacks omdozen or sizes.
 */
export function partOf(load: HandLoad, items: Items, cartonOf: (productId: number) => HandCarton | null): HandLoad | null {
  const need = count(items);
  const shaped: { box: HandBox; sx: number; sy: number; sz: number }[] = [];
  for (const box of load.boxes) {
    const carton = cartonOf(box.productId);
    if (!carton) return null;
    const kind = { key: 0, length: packUnits(carton.lengthCm), width: packUnits(carton.widthCm), height: packUnits(carton.heightCm),
      weight: 0, count: 0, sides: [] as CartonUp[] };
    shaped.push({ box, ...extent(kind, { key: 0, x: box.x, y: box.y, z: box.z, up: box.up, turned: box.turned }) });
  }
  const kept: typeof shaped = [];
  for (const [productId, cartons] of need) {
    const own = shaped.filter((entry) => entry.box.productId === productId)
      .sort((left, right) => left.box.y + left.sy - (right.box.y + right.sy) || left.box.y - right.box.y);
    if (own.length < cartons) return null;
    kept.push(...own.slice(0, cartons));
  }
  const settled: { x: number; z: number; sx: number; sz: number; top: number }[] = [];
  const boxes: HandBox[] = [];
  let top = 0;
  for (const entry of [...kept].sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x || left.box.z - right.box.z)) {
    let y = 0;
    for (const below of settled) {
      if (entry.box.x < below.x + below.sx && below.x < entry.box.x + entry.sx
          && entry.box.z < below.z + below.sz && below.z < entry.box.z + entry.sz) y = Math.max(y, below.top);
    }
    settled.push({ x: entry.box.x, z: entry.box.z, sx: entry.sx, sz: entry.sz, top: y + entry.sy });
    boxes.push({ ...entry.box, y });
    top = Math.max(top, y + entry.sy);
  }
  return { boxes, top };
}

function sizeOf(carton: HandCarton): string {
  return `${packUnits(carton.lengthCm)}|${packUnits(carton.widthCm)}|${packUnits(carton.heightCm)}`;
}

/** The kinds of a load as the server makes them: one per omdoos size, in the order's product order, the given weight per size. */
function kindsOf(stock: ReadonlyMap<number, number>, products: readonly number[], cartonOf: (productId: number) => HandCarton | null,
  weightOf: ReadonlyMap<string, number>, sides: readonly CartonUp[]): { kinds: PackKind[]; kindOf: Map<number, number> } {
  const bySize = new Map<string, PackKind>();
  const kindOf = new Map<number, number>();
  for (const productId of products) {
    const cartons = stock.get(productId) ?? 0;
    const carton = cartons > 0 ? cartonOf(productId) : null;
    if (!carton) continue;
    const size = sizeOf(carton);
    let kind = bySize.get(size);
    if (!kind) {
      kind = { key: bySize.size + 1, length: packUnits(carton.lengthCm), width: packUnits(carton.widthCm),
        height: packUnits(carton.heightCm), weight: weightOf.get(size) ?? packUnits(carton.weightKg), count: 0, sides };
      bySize.set(size, kind);
    }
    kind.count += cartons;
    kindOf.set(productId, kind.key);
  }
  return { kinds: [...bySize.values()], kindOf };
}

/** A box's extent on the deck, as the packer stands it (shapesOf). */
function extent(kind: PackKind, box: PackedBox): { sx: number; sy: number; sz: number } {
  const standing = cartonStanding({ lengthCm: kind.length, widthCm: kind.width, heightCm: kind.height }, box.up);
  return box.turned ? { sx: standing.widthCm, sy: standing.heightCm, sz: standing.lengthCm }
    : { sx: standing.lengthCm, sy: standing.heightCm, sz: standing.widthCm };
}

/** The pallet's own omdozen out of one packed pallet of this stock, settled; null when that pallet does not carry them all. */
function tryLoad(items: Items, stock: ReadonlyMap<number, number>, products: readonly number[],
  cartonOf: (productId: number) => HandCarton | null, weightOf: ReadonlyMap<string, number>, deck: PackDeck,
  sides: readonly CartonUp[]): HandLoad | null {
  const { kinds, kindOf } = kindsOf(stock, products, cartonOf, weightOf, sides);
  const need = new Map<number, number>();
  for (const item of items) {
    if (!(item.cartons > 0)) continue;
    const kind = kindOf.get(item.productId);
    if (kind === undefined) return null;
    need.set(kind, (need.get(kind) ?? 0) + item.cartons);
  }
  if (!need.size) return { boxes: [], top: 0 };
  const packed = packPallets(kinds, deck, 1).pallets[0];
  if (!packed || [...need].some(([kind, cartons]) => (packed.counts.get(kind) ?? 0) < cartons)) return null;
  const byKey = new Map(kinds.map((kind) => [kind.key, kind]));
  const shaped = packed.boxes.map((box) => ({ box, ...extent(byKey.get(box.key) as PackKind, box) }));
  /* Per kind the boxes standing lowest stay; the extra ones of a larger load come off the top. */
  const perKind = new Map<number, typeof shaped>();
  for (const entry of shaped) {
    const list = perKind.get(entry.box.key) ?? [];
    list.push(entry);
    perKind.set(entry.box.key, list);
  }
  const kept = new Set<(typeof shaped)[number]>();
  for (const [kind, list] of perKind) {
    [...list].sort((left, right) => left.box.y + left.sy - (right.box.y + right.sy) || left.box.y - right.box.y)
      .slice(0, need.get(kind) ?? 0).forEach((entry) => kept.add(entry));
  }
  /* What stood on a box that came off comes down onto what stays under it (nothing floats); the top is the settled one. */
  const settled: { x: number; z: number; sx: number; sz: number; top: number }[] = [];
  const lowered = new Map<(typeof shaped)[number], number>();
  for (const entry of [...kept].sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x || left.box.z - right.box.z)) {
    let y = 0;
    for (const below of settled) {
      if (entry.box.x < below.x + below.sx && below.x < entry.box.x + entry.sx
          && entry.box.z < below.z + below.sz && below.z < entry.box.z + entry.sz) y = Math.max(y, below.top);
    }
    settled.push({ x: entry.box.x, z: entry.box.z, sx: entry.sx, sz: entry.sz, top: y + entry.sy });
    lowered.set(entry, y);
  }
  /* Each kind's boxes go to the pallet's products of that size in the pallet's own order, a colour kept together. */
  const members = new Map<number, { productId: number; left: number }[]>();
  for (const item of items) {
    if (!(item.cartons > 0)) continue;
    const kind = kindOf.get(item.productId) as number;
    const list = members.get(kind) ?? [];
    const known = list.find((member) => member.productId === item.productId);
    if (known) known.left += item.cartons; else list.push({ productId: item.productId, left: item.cartons });
    members.set(kind, list);
  }
  const boxes: HandBox[] = [];
  let top = 0;
  for (const entry of shaped) {
    if (!kept.has(entry)) continue;
    const member = members.get(entry.box.key)?.find((candidate) => candidate.left > 0);
    if (!member) continue;
    member.left -= 1;
    const y = lowered.get(entry) ?? entry.box.y;
    boxes.push({ productId: member.productId, x: entry.box.x, y, z: entry.box.z, up: entry.box.up, turned: entry.box.turned });
    top = Math.max(top, y + entry.sy);
  }
  return { boxes, top };
}

/**
 * The loads of a PACKED list, worked out per pallet when asked (a pallet the
 * caller decides otherwise costs nothing): the load, or null where none of
 * the tries takes its omdozen on one pallet or a product has no sizes.
 * `order` is the order's product order (the server's kinds follow it);
 * `joins` says which pallets the server would load together: a hand pallet
 * of another type is tried alone only, and waits for no other.
 */
export function handLoader(pallets: readonly Items[], order: readonly number[], cartonOf: (productId: number) => HandCarton | null,
  deck: PackDeck, sides: readonly CartonUp[], joins: (index: number) => boolean = () => true): (index: number) => HandLoad | null {
  const products = [...new Set([...order, ...pallets.flatMap((items) => items.map((item) => item.productId))])];
  /* The server weighs one size by its heaviest colour among the order's products. */
  const weightOf = new Map<string, number>();
  for (const productId of products) {
    const carton = cartonOf(productId);
    if (!carton) continue;
    const size = sizeOf(carton);
    weightOf.set(size, Math.max(weightOf.get(size) ?? 0, packUnits(carton.weightKg)));
  }
  const catalogue = products.map((productId) => {
    const carton = cartonOf(productId);
    return `${productId}:${carton ? `${sizeOf(carton)}/${packUnits(carton.weightKg)}` : '-'}`;
  }).join(',');
  const settledAt = new Map<number, HandLoad | null>();
  return (index: number) => {
    if (settledAt.has(index)) return settledAt.get(index) as HandLoad | null;
    const items = pallets[index] ?? [];
    const own = count(items);
    let load: HandLoad | null = null;
    if (!own.size) load = { boxes: [], top: 0 };
    else if (![...own.keys()].some((productId) => !cartonOf(productId))) {
      /* More omdoos volume than the pallet holds goes on no pallet: no search. */
      let volume = 0;
      for (const [productId, cartons] of own) {
        const carton = cartonOf(productId) as HandCarton;
        volume += cartons * packUnits(carton.lengthCm) * packUnits(carton.widthCm) * packUnits(carton.heightCm);
      }
      if (volume <= deck.length * deck.width * deck.height) load = search(index, items, own);
    }
    settledAt.set(index, load);
    return load;
  };

  function search(index: number, items: Items, own: Map<number, number>): HandLoad | null {
    const later = new Map<number, number>();
    if (joins(index)) for (let next = index; next < pallets.length; next++) if (joins(next)) count(pallets[next], later);
    const key = [deck.length, deck.width, deck.height, deck.maxWeight, sides.join(''), catalogue, joins(index) ? 1 : 0,
      items.map((item) => `${item.productId}:${item.cartons}`).join(','),
      [...later].map(([productId, cartons]) => `${productId}:${cartons}`).join(',')].join('|');
    if (MEMO.has(key)) return MEMO.get(key) as HandLoad | null;
    const more = joins(index) && [...later].some(([productId, cartons]) => cartons !== own.get(productId));
    let load = more ? tryLoad(items, later, products, cartonOf, weightOf, deck, sides) : null;
    if (!load) load = tryLoad(items, own, products, cartonOf, weightOf, { ...deck, maxWeight: 0 }, sides);
    if (!load && joins(index) && later.size) {
      /* Products still waiting first: the one a lowered quantity took omdozen off is most likely among them. */
      const tried = [...products.filter((productId) => later.has(productId)), ...products.filter((productId) => !later.has(productId))]
        .filter((productId) => !!cartonOf(productId));
      let budget = BUDGET;
      const attempt = (stock: ReadonlyMap<number, number>) => {
        budget -= 1;
        return tryLoad(items, stock, products, cartonOf, weightOf, deck, sides);
      };
      /* Every waiting product one or two more at once: each line lowered a little. */
      for (let back = 1; back <= 2 && !load; back++) {
        const stock = new Map(later);
        for (const [productId, cartons] of later) stock.set(productId, cartons + back);
        load = attempt(stock);
      }
      /* A few omdozen back on, or off, every product before more on one: most changes are small. Off is a raised
         quantity whose extra omdozen went onto later pallets; never below what this pallet carries itself. */
      for (let back = 1; back <= MAX_BACK && budget > 0 && !load; back++) {
        for (const productId of tried) {
          if (load || budget <= 0) break;
          const now = later.get(productId) ?? 0;
          const stock = new Map(later);
          stock.set(productId, now + back);
          load = attempt(stock);
          if (load || budget <= 0 || now - back < (own.get(productId) ?? 0) || now - back < 0 || !later.has(productId)) continue;
          const fewer = new Map(later);
          if (now - back > 0) fewer.set(productId, now - back); else fewer.delete(productId);
          load = attempt(fewer);
        }
      }
    }
    if (MEMO.size >= MEMO_SIZE) MEMO.delete(MEMO.keys().next().value as string);
    MEMO.set(key, load);
    return load;
  }
}
