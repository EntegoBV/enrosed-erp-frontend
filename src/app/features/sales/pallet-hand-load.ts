import type { PalletProfile } from '../../core/api/models';
import { cartonStanding, loadFloor, specSpillCm, spillAxes, type CartonUp, type PalletSpec } from './pallet-calculator-model';
import { packDeck, packPallets, packUnits, type PackDeck, type PackKind, type PackedBox } from './pallet-pack';

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

/*
 * What Zelf indelen copied (OrderPallet.source, 2026-11-25). The server's PACKED run depends on everything still waiting,
 * so once a quantity is lowered or the pallets are put in another order, neither the server's new run nor a re-run of
 * the hand list (handLoader) may rebuild a copied pallet as the server loaded it (1 % false "te hoog" after a reorder
 * and a lowered quantity). Each copied pallet therefore remembers the run: the profile, the loaded height, the run's
 * omdozen per product in line order, its own place and its own omdozen. Loaded again from those omdozen, the run gives
 * the copied pallet box for box; it counts only when it does (same omdozen as copied: a run the server laid out in
 * layers instead, or catalogue sizes changed since the copy, give another pallet and nothing is taken from it). A hand
 * pallet that holds no more of any product than its copy is that part of it (partOf: the lowest boxes per product stay,
 * what stood on a box that came off comes down), never higher; one that holds more of any product gets nothing from it.
 * The run is loaded on the pallet as it is now (packDeck of today's spec, today's catalogue), so it is always a real load.
 * Since 2026-11-26 a run counted with a spill remembers that too, as a seventh part ("…|2", cm per side), written only
 * when it is not 0: the six parts of every source from before read as spill 0, byte for byte what they were. It is the
 * spill the run was COUNTED with (totals.palletSpillCm), never the document's stored pick: the server prices a document
 * without its spill when that saves a carrier, and the copy then is a run on the floor itself. The run is always loaded
 * again on the deck it was copied from (the floor plus the copy's spill). The copy counts while the document's spill is
 * at least the copy's: the floor only got larger, so the load still stands on it (a copy made without spill on a
 * document that later counts with 2 cm stays good, and so does one made at 2 when he sets 5). Below the copy's spill the
 * load would pass the edge by more than the document allows: the copy is not used, as for another profile or height.
 * Where the copy comes among the judges (shipping-planner-model.ts handPallets, order-pallets-3d-model.ts): a pallet the
 * server's own list names keeps the server's height; one copied on a smaller floor that still carries exactly what was
 * copied stands as it was copied (copiedOnSmallerFloor); any other is tried on today's deck first (handLoader) and only
 * then as a part of its copy.
 */

/** The longest source the backend keeps (sales_pallet.copy_source); a longer one is not written. */
export const COPY_SOURCE_MAX = 4000;

/** A hand pallet's source, read. */
export interface CopySource {
  profile: string;
  maxHeightCm: number;
  /** The spill the copied run was counted with, cm per side; 0 for a source of six parts. */
  spillCm: number;
  /** What the copied run loaded, per product in the order's line order (the server's kinds follow it). */
  totals: { productId: number; cartons: number }[];
  /** The pallet's place in that run, from 0. */
  index: number;
  /** What the pallet carried when it was copied. */
  items: { productId: number; cartons: number }[];
}

function entries(items: ReadonlyMap<number, number>, order: readonly number[]): string {
  return order.filter((productId) => Number.isSafeInteger(productId) && productId > 0 && (items.get(productId) ?? 0) > 0)
    .map((productId) => `${productId}:${items.get(productId)}`).join(',');
}

function readEntries(text: string): { productId: number; cartons: number }[] | null {
  const list: { productId: number; cartons: number }[] = [];
  const seen = new Set<number>();
  for (const entry of text.split(',')) {
    const match = /^(\d{1,12}):(\d{1,7})$/.exec(entry);
    if (!match) return null;
    const productId = Number(match[1]);
    const cartons = Number(match[2]);
    if (!(productId > 0) || !(cartons > 0) || seen.has(productId)) return null;
    seen.add(productId);
    list.push({ productId, cartons });
  }
  return list.length ? list : null;
}

/**
 * The source of every pallet of a PACKED run that Zelf indelen copies, by its place:
 * "PACKED|EURO_120X80|260|12:24,15:8|0|12:20,15:8" (rule, pallet profile, loaded height, the run's omdozen per product,
 * the pallet's place, its own omdozen), and for a run counted with a spill that spill as a seventh part:
 * "PACKED|EURO_120X80|260|12:24,15:8|0|12:20,15:8|2". `lineOrder` is the order's product order (the priced lines); a
 * product the run carries that no line names goes last. Null for a pallet without omdozen or whose source would be longer
 * than the backend keeps.
 */
export function copySources(profile: string, maxHeightCm: number, lineOrder: readonly number[], pallets: readonly Items[],
  spillCm = 0): (string | null)[] {
  const totals = count(pallets.flat());
  const order = [...new Set([...lineOrder.filter((productId) => totals.has(productId)), ...totals.keys()])];
  const run = entries(totals, order);
  const height = String(Math.round(maxHeightCm * 100) / 100);
  /* No seventh part at 0: a source without spill stays the text it always was. */
  const spill = spillCm > 0 ? Math.round(spillCm * 100) / 100 : 0;
  if (!run || !/^[A-Z0-9_]+$/.test(profile) || !(maxHeightCm > 0) || !(spill < 100)) return pallets.map(() => null);
  return pallets.map((items, index) => {
    const own = entries(count(items), order);
    const text = `PACKED|${profile}|${height}|${run}|${index}|${own}${spill > 0 ? `|${spill}` : ''}`;
    return own && text.length <= COPY_SOURCE_MAX ? text : null;
  });
}

/**
 * A source as copySources writes it; null for anything else (another rule, a malformed or overlong text). Six parts
 * read as spill 0; a seventh is the spill and is there only when it is above 0.
 */
export function readCopySource(text: string | null | undefined): CopySource | null {
  if (!text || text.length > COPY_SOURCE_MAX) return null;
  const parts = text.split('|');
  if ((parts.length !== 6 && parts.length !== 7) || parts[0] !== 'PACKED' || !/^[A-Z0-9_]+$/.test(parts[1])
      || !/^\d{1,4}(\.\d{1,2})?$/.test(parts[2]) || !/^\d{1,4}$/.test(parts[4])) return null;
  if (parts.length === 7 && !/^\d{1,2}(\.\d{1,2})?$/.test(parts[6])) return null;
  const totals = readEntries(parts[3]);
  const items = readEntries(parts[5]);
  const maxHeightCm = Number(parts[2]);
  const spillCm = parts.length === 7 ? Number(parts[6]) : 0;
  if (parts.length === 7 && !(spillCm > 0)) return null;
  return totals && items && maxHeightCm > 0 ? { profile: parts[1], maxHeightCm, spillCm, totals, index: Number(parts[4]), items } : null;
}

/**
 * A hand pallet that still carries exactly what Zelf indelen copied, from a run counted with a SMALLER spill than the
 * document counts with now (2026-11-26). The clearest case: the server priced a quote without its spill (with it the
 * automatic count needed a pallet more), Zelf indelen copied those pallets, and with a hand layout the server counts on
 * the stored spill again. Such a pallet stands as it was copied (copiedLoader gives it, on the floor of that day): the
 * rows he copied keep their heights and the 3D draws them where they stood, instead of each being packed again on
 * today's larger deck. With the same spill this never holds: there the server's own list still names the pallet.
 */
export function copiedOnSmallerFloor(source: string | null | undefined, items: Items, spillCm: number): boolean {
  const copy = readCopySource(source);
  return !!copy && copy.spillCm < spillCm - 1e-6 && sameItems(copy.items, items);
}

/** Runs loaded again, by everything the run reads: every hand pallet of one copy shares one. */
const RUNS = new Map<string, HandLoad[] | null>();
const RUNS_SIZE = 24;
/** A run of more omdozen than this is not loaded again (a copied run has what one order holds). */
const RUN_MAX_CARTONS = 50_000;

/**
 * The copied run loaded again as PalletCalculator.packedPallets loads it: one kind per omdoos size in line order, the
 * heaviest colour's weight for the size, every side allowed, the products of a size handing out its boxes in turn;
 * pallet by pallet, each box with its product. Null when a product lacks sizes.
 */
function copyRun(copy: CopySource, cartonOf: (productId: number) => HandCarton | null, deck: PackDeck,
  sides: readonly CartonUp[]): HandLoad[] | null {
  const cartons = copy.totals.map((total) => cartonOf(total.productId));
  if (cartons.some((carton) => !carton) || copy.totals.reduce((sum, total) => sum + total.cartons, 0) > RUN_MAX_CARTONS) return null;
  const key = [deck.length, deck.width, deck.height, deck.maxWeight, sides.join(''), copy.totals.map((total, at) => {
    const carton = cartons[at] as HandCarton;
    return `${total.productId}:${total.cartons}:${sizeOf(carton)}/${packUnits(carton.weightKg)}`;
  }).join(',')].join('|');
  if (RUNS.has(key)) return RUNS.get(key) as HandLoad[] | null;
  const bySize = new Map<string, PackKind>();
  const members = new Map<number, { productId: number; left: number }[]>();
  copy.totals.forEach((total, at) => {
    const carton = cartons[at] as HandCarton;
    const size = sizeOf(carton);
    let kind = bySize.get(size);
    if (!kind) {
      kind = { key: bySize.size + 1, length: packUnits(carton.lengthCm), width: packUnits(carton.widthCm),
        height: packUnits(carton.heightCm), weight: 0, count: 0, sides };
      bySize.set(size, kind);
      members.set(kind.key, []);
    }
    kind.weight = Math.max(kind.weight, packUnits(carton.weightKg));
    kind.count += total.cartons;
    (members.get(kind.key) as { productId: number; left: number }[]).push({ productId: total.productId, left: total.cartons });
  });
  const run = packPallets([...bySize.values()], deck).pallets.map((packed) => {
    const boxes: HandBox[] = [];
    for (const box of packed.boxes) {
      const member = members.get(box.key)?.find((candidate) => candidate.left > 0);
      if (!member) continue;
      member.left -= 1;
      boxes.push({ productId: member.productId, x: box.x, y: box.y, z: box.z, up: box.up, turned: box.turned });
    }
    return { boxes, top: packed.top };
  });
  if (RUNS.size >= RUNS_SIZE) RUNS.delete(RUNS.keys().next().value as string);
  RUNS.set(key, run);
  return run;
}

/**
 * The copied pallet of a hand pallet's source, loaded again as it was copied: null without a source, for another rule,
 * when the order's profile or loaded height changed since the copy or its spill is now SMALLER than the copy's (Indeling
 * opnieuw maken copies again), when a product of the run lacks sizes, or when the run loaded again does not give the
 * pallet that was copied. Judge a hand pallet with partOf(copied, its items): null there when it holds more of any
 * product than the copied pallet. `spec` is the order's carrier as it counts now and `deck` its packDeck. A copy made
 * with the same spill is loaded on that deck. One made with a smaller spill is loaded on the deck of its own spill (the
 * packer is a search: on a larger deck the same omdozen can end higher, which read "te hoog" on a load that fits) and
 * its boxes are then moved to where they stand seen from today's load floor: both floors lie centred on the real one,
 * so a box keeps its place on the real floor and hangs over no further than the copy's spill.
 */
export function copiedLoader(spec: PalletSpec & { profile: PalletProfile },
  cartonOf: (productId: number) => HandCarton | null,
  deck: PackDeck, sides: readonly CartonUp[]): (source: string | null | undefined) => HandLoad | null {
  const spill = specSpillCm(spec);
  const floor = loadFloor(spec);
  return (source) => {
    const copy = readCopySource(source);
    if (!copy || copy.profile !== spec.profile || Math.abs(copy.maxHeightCm - spec.maxHeightCm) > 1e-6
        || copy.spillCm > spill + 1e-6) return null;
    const own = Math.abs(copy.spillCm - spill) <= 1e-6;
    /* The carrier as the copy counted it: the same floor, base, height and weight limit, with the copy's spill. */
    const copySpec: PalletSpec = own ? spec : {
      lengthCm: spec.lengthCm, widthCm: spec.widthCm, baseHeightCm: spec.baseHeightCm, maxHeightCm: spec.maxHeightCm,
      maxWeightKg: spec.maxWeightKg, ...spillAxes(spec.profile, copy.spillCm),
    };
    const copied = copyRun(copy, cartonOf, own ? deck : packDeck(copySpec), sides)?.[copy.index];
    if (!copied) return null;
    const carried = new Map<number, number>();
    for (const box of copied.boxes) carried.set(box.productId, (carried.get(box.productId) ?? 0) + 1);
    if (!sameItems([...carried].map(([productId, cartons]) => ({ productId, cartons })), copy.items)) return null;
    if (own) return copied;
    /* A place is measured from the corner of the load floor it was packed on; today's corner lies further out. */
    const from = loadFloor(copySpec);
    const dx = packUnits(floor.offsetXCm) - packUnits(from.offsetXCm);
    const dz = packUnits(floor.offsetZCm) - packUnits(from.offsetZCm);
    return { boxes: copied.boxes.map((box) => ({ ...box, x: box.x + dx, z: box.z + dz })), top: copied.top };
  };
}
