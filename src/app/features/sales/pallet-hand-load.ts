import type { CartonUp } from './pallet-calculator-model';
import { packPallets, packUnits, type PackDeck, type PackKind, type PackedBox } from './pallet-pack';

/**
 * How one pallet of a list stands with its omdozen loaded as full as they
 * go (2026-11-25), free of Angular: a hand-built pallet (Zelf indelen), or a
 * pallet of the server's list that 3D does not load again. The packer
 * (pallet-pack.ts) is greedy: what it lays on a pallet depends on what still
 * waits, so the omdozen of one of the server's pallets do not always go on
 * one pallet packed alone (2.6 % of them). A pallet is therefore tried
 * - with the pallets after it, as the server loads a list: this pallet
 *   first, every later one still waiting (what Zelf indelen copied is
 *   exactly that, so it stands as the server's pallet did);
 * - alone: its own omdozen only;
 * - with the later ones and omdozen of one product back, up to MAX_BACK: a lowered
 *   quantity takes its omdozen off the last pallets (trimPallets), so the
 *   pallets before still stand as the server loaded them with those omdozen.
 * Where the packer lays more than the pallet carries, the extra boxes come
 * off the top. Null is no proof of too much: the caller falls back on whole
 * layers, which may then say "te hoog". The count stays the server's; this
 * only judges and draws a listed pallet.
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
/** Packs one pallet may spend on putting omdozen back (about 4 ms on a phone for a whole layout's worst pallet). */
const BUDGET = 320;
/** Pallets judged before, by their omdozen, what waited after them and the deck: a planner re-renders often. */
const MEMO = new Map<string, HandLoad | null>();
const MEMO_SIZE = 300;

/** The kinds of a load as the server makes them: one per omdoos size, in the order's product order, the heaviest weight. */
function kindsOf(stock: ReadonlyMap<number, number>, order: readonly number[], cartonOf: (productId: number) => HandCarton | null,
  sides: readonly CartonUp[]): { kinds: PackKind[]; kindOf: Map<number, number> } {
  const bySize = new Map<string, PackKind>();
  const kindOf = new Map<number, number>();
  for (const productId of order) {
    const cartons = stock.get(productId) ?? 0;
    const carton = cartons > 0 ? cartonOf(productId) : null;
    if (!carton) continue;
    const length = packUnits(carton.lengthCm); const width = packUnits(carton.widthCm); const height = packUnits(carton.heightCm);
    const size = `${length}|${width}|${height}`;
    let kind = bySize.get(size);
    if (!kind) {
      kind = { key: bySize.size + 1, length, width, height, weight: 0, count: 0, sides };
      bySize.set(size, kind);
    }
    kind.weight = Math.max(kind.weight, packUnits(carton.weightKg));
    kind.count += cartons;
    kindOf.set(productId, kind.key);
  }
  return { kinds: [...bySize.values()], kindOf };
}

/** The pallet's own omdozen out of one packed pallet of this stock; null when that pallet does not carry them all. */
function tryLoad(items: Items, stock: ReadonlyMap<number, number>, order: readonly number[],
  cartonOf: (productId: number) => HandCarton | null, deck: PackDeck, sides: readonly CartonUp[]): HandLoad | null {
  const { kinds, kindOf } = kindsOf(stock, order, cartonOf, sides);
  const need = new Map<number, number>();
  for (const item of items) {
    if (!(item.cartons > 0)) continue;
    const kind = kindOf.get(item.productId);
    if (kind === undefined) return null;
    need.set(kind, (need.get(kind) ?? 0) + item.cartons);
  }
  if (!need.size) return { boxes: [], top: 0 };
  const packed = packPallets(kinds, deck, 1).pallets[0];
  if (!packed || [...need].some(([kind, count]) => (packed.counts.get(kind) ?? 0) < count)) return null;
  const byKey = new Map(kinds.map((kind) => [kind.key, kind]));
  const rise = (box: PackedBox) => {
    const kind = byKey.get(box.key);
    return !kind ? 0 : box.up === 'w' ? kind.width : box.up === 'l' ? kind.length : kind.height;
  };
  /* Per kind the boxes standing lowest stay; the extra ones of a larger load come off the top. */
  const kept = new Set<PackedBox>();
  const perKind = new Map<number, PackedBox[]>();
  for (const box of packed.boxes) {
    const list = perKind.get(box.key) ?? [];
    list.push(box);
    perKind.set(box.key, list);
  }
  for (const [kind, list] of perKind) {
    [...list].sort((left, right) => left.y + rise(left) - (right.y + rise(right)) || left.y - right.y)
      .slice(0, need.get(kind) ?? 0).forEach((box) => kept.add(box));
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
  for (const box of packed.boxes) {
    if (!kept.has(box)) continue;
    const member = members.get(box.key)?.find((candidate) => candidate.left > 0);
    if (!member) continue;
    member.left -= 1;
    boxes.push({ productId: member.productId, x: box.x, y: box.y, z: box.z, up: box.up, turned: box.turned });
    top = Math.max(top, box.y + rise(box));
  }
  return { boxes, top };
}

/** The same omdozen of each product on two pallets. */
export function sameItems(left: Items, right: Items): boolean {
  const a = count(left); const b = count(right);
  return a.size === b.size && [...a].every(([productId, cartons]) => b.get(productId) === cartons);
}

function count(items: Items, into = new Map<number, number>()): Map<number, number> {
  for (const item of items) if (item.cartons > 0) into.set(item.productId, (into.get(item.productId) ?? 0) + item.cartons);
  return into;
}

/**
 * Every pallet of the list loaded as full as it goes, or null where none of
 * the tries takes its omdozen on one pallet (or a product has no sizes).
 * `order` is the order's product order (the server's kinds follow it);
 * `joins` says which pallets the server would load together: a hand pallet
 * of another type is tried alone only, and waits for no other.
 */
export function handLoads(pallets: readonly Items[], order: readonly number[], cartonOf: (productId: number) => HandCarton | null,
  deck: PackDeck, sides: readonly CartonUp[], joins: (index: number) => boolean = () => true): (HandLoad | null)[] {
  const products = [...new Set([...order, ...pallets.flatMap((items) => items.map((item) => item.productId))])];
  const sizeOf = (productId: number) => {
    const carton = cartonOf(productId);
    return carton ? `${carton.lengthCm}x${carton.widthCm}x${carton.heightCm}/${carton.weightKg}` : '-';
  };
  return pallets.map((items, index) => {
    const own = count(items);
    if (!own.size) return { boxes: [], top: 0 };
    if ([...own.keys()].some((productId) => !cartonOf(productId))) return null;
    /* More omdoos volume or weight than the pallet holds goes on no pallet: no search. */
    let volume = 0; let weight = 0;
    for (const [productId, cartons] of own) {
      const carton = cartonOf(productId) as HandCarton;
      volume += cartons * packUnits(carton.lengthCm) * packUnits(carton.widthCm) * packUnits(carton.heightCm);
      weight += cartons * packUnits(carton.weightKg);
    }
    if (volume > deck.length * deck.width * deck.height || (deck.maxWeight > 0 && weight > deck.maxWeight)) return null;
    const later = new Map<number, number>();
    if (joins(index)) for (let next = index; next < pallets.length; next++) if (joins(next)) count(pallets[next], later);
    const key = [deck.length, deck.width, deck.height, deck.maxWeight, sides.join(''), joins(index) ? 1 : 0,
      items.map((item) => `${item.productId}:${item.cartons}`).join(','),
      products.filter((productId) => later.has(productId) || own.has(productId))
        .map((productId) => `${productId}:${later.get(productId) ?? 0}:${sizeOf(productId)}`).join(',')].join('|');
    if (MEMO.has(key)) return MEMO.get(key) as HandLoad | null;
    const more = joins(index) && [...later].some(([productId, cartons]) => cartons !== own.get(productId));
    let load = more ? tryLoad(items, later, products, cartonOf, deck, sides) : null;
    if (!load) load = tryLoad(items, own, products, cartonOf, deck, sides);
    let budget = BUDGET;
    if (!load && joins(index) && later.size) {
      /* Products still waiting first: the one a lowered quantity took omdozen off is most likely among them. */
      const tried = [...products.filter((productId) => later.has(productId)), ...products.filter((productId) => !later.has(productId))];
      /* A few omdozen back on every product before more on one: most changes are small. */
      for (let back = 1; back <= MAX_BACK && budget > 0 && !load; back++) {
        for (const productId of tried) {
          if (load || budget <= 0) break;
          if (!cartonOf(productId)) continue;
          budget -= 1;
          const stock = new Map(later);
          stock.set(productId, (stock.get(productId) ?? 0) + back);
          load = tryLoad(items, stock, products, cartonOf, deck, sides);
        }
      }
    }
    if (MEMO.size >= MEMO_SIZE) MEMO.delete(MEMO.keys().next().value as string);
    MEMO.set(key, load);
    return load;
  });
}
