import type { Product, SalesOrderView } from '../../core/api/models';
import { productSalesUnit } from '../products/product-sales-unit';
import { deckOf, packedPlace, settle, stackAbove, type BuilderBox, type BuilderItem, type Deck, type LayerStock } from './pallet-builder-model';
import {
  MAX_PLANNED_PALLETS, carrierNoun, carrierWords, cartonStanding, palletFit, productUnits, specSpillCm, type CarrierWords,
} from './pallet-calculator-model';
import { copiedLoader, handLoader, partOf, readCopySource, sameItems, within } from './pallet-hand-load';
import { ALL_SIDES, packDeck, packPallets, packUnits, type PackKind, type PackedPallet } from './pallet-pack';
import { automaticPallets, normalizeManualPalletType, palletTypeLabel } from './pallet-stack';
import { autoPallets, palletCount, plannerLines, plannerSpec, type PlannerLine, type PlannerSpec } from './shipping-planner-model';

/**
 * A sales order's pallets in 3D (Emre, 2026-11-20: "3d pallet ook bij
 * verkoop order bij pallet indelen"), free of Angular and three.js: which
 * pallets the order has, and where every omdoos of one of them stands.
 *
 * Since 2026-11-25 ("bij een order van 3 pallets eerst de eerste proberen
 * helemaal te vullen en je mag kantelen eh") the order's omdozen are loaded
 * as full as they go (pallet-pack.ts): the automatic pallets of a document
 * that mixes (palletRule MIXED) pallet by pallet, the first as full as it
 * gets before the next one starts, an omdoos on its side where that fills
 * clearly more, the colours of one product in the same layers. That never
 * takes more pallets than the order counts; if it would, for a document
 * counted product by product (STRICT) and for a hand-built layout, every
 * pallet keeps what it carries and stands as the server would load the list
 * (pallet-hand-load.ts), else in whole layers per product, as the planner
 * estimates it. The count and the freight stay the server's. Nothing floats,
 * nothing hangs over an edge by more than the document's spill; what goes
 * past the height shows in the builder's orange and red, as the planner says
 * "te hoog".
 *
 * Spill (2026-11-26): every load here is counted on the document's load
 * floor (packDeck(spec) and layerSlots: the floor plus the spill the server
 * counted with) and drawn on the real floor. A packed box's place is
 * measured from the load floor's corner, so the spill comes off it
 * (packedPlace); a layer of layerSlots is centred on the real floor already.
 * A load wider than the floor hangs over evenly, never more than the spill.
 * The spill is the one the server counted with (plannerSpec), which is 0
 * where it priced the document without its stored spill. A hand pallet copied
 * while the document counted with a smaller spill is drawn as it was copied:
 * loaded on the floor of that day and put in its place on the real floor
 * (copiedLoader), so it hangs over no further than then.
 *
 * An order on the Deense kar shows its karren ("Kar 2"). The view-only
 * Pallet | Deense kar switch (2026-11-25) shows the other carrier too:
 * orderLoadOn loads all of the order's omdozen on it as full as they go, for
 * a look only; the order, its count and its freight do not change.
 */

/** One pallet of the order as 3D shows it. */
export interface OrderPallet3d {
  /** "Pallet 2" ("Kar 2" on the kar), or the name a hand-built pallet was given. */
  label: string;
  /** What stands on it, bottom to top. */
  items: readonly { productId: number; cartons: number }[];
  /** A hand-built pallet's measured height; null when it is estimated. */
  measuredCm: number | null;
  /** A hand-built pallet of another type than the order's ("Blokpallet 120×100"); the planner counts it on the order's pallet. */
  ownType: string | null;
  /** What Zelf indelen copied a hand-built pallet from (OrderPallet.source); absent on automatic pallets. */
  source?: string | null;
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
  const word = carrierWords(spec.profile).label;
  if (view.order.pallets.length) {
    return view.order.pallets.map((pallet, index) => {
      const type = normalizeManualPalletType(pallet.type);
      return {
        label: pallet.label.trim() || `${word} ${index + 1}`,
        items: pallet.items.map(({ productId, cartons }) => ({ productId, cartons })),
        measuredCm: pallet.heightCm ?? null,
        ownType: type && type !== palletTypeLabel(spec.profile) ? type : null,
        source: pallet.source ?? null,
      };
    });
  }
  const expected = automaticPallets(view.priced.totals);
  const server = view.priced.totals.autoPallets;
  if (server) {
    if (server.length !== expected) return [];
    return server.map((pallet, index) => ({
      label: `${word} ${index + 1}`, items: pallet.items.map(({ productId, cartons }) => ({ productId, cartons })),
      measuredCm: null, ownType: null,
    }));
  }
  const rows = autoPallets(lines, spec);
  if (!rows.length || palletCount(rows) !== expected) return [];
  return rows.flatMap((row) => Array.from({ length: row.to - row.from + 1 }, (_, offset) => ({
    label: `${word} ${row.from + offset}`, items: row.parts.map(({ productId, cartons }) => ({ productId, cartons })),
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

/** The order's pallets as 3D lays them, with the build of each. */
export interface OrderLoad3d {
  pallets: OrderPallet3d[];
  builds: PalletBuild[];
  /** 'packed': the automatic pallets filled one after the other, each as full as it gets; 'listed': every pallet keeps what it carries. */
  source: 'packed' | 'listed';
  /** The pallets the order counts when 3D loads its omdozen on fewer; null when on as many. */
  counted: number | null;
  /** The pallets as the planner lists them: a 3D button on one of its rows opens on the pallet carrying most of it. */
  listed: OrderPallet3d[];
  /** Loaded again, every pallet carries what the list says it does (a PACKED document): a row opens on its own page. */
  matchesList: boolean;
}

export const EMPTY_LOAD: OrderLoad3d = { pallets: [], builds: [], source: 'listed', counted: null, listed: [], matchesList: true };

/**
 * The page for a pallet of the planner's list: itself where 3D keeps the list's pallets; loaded
 * again, the pallet that carries most of its omdozen (the first on a tie).
 */
export function pageForListed(load: OrderLoad3d, index: number): number {
  /* The first pallet is also where "Pallets in 3D bekijken" starts: loaded again, that is the fullest one, pallet 1. */
  if (load.source !== 'packed' || load.matchesList || index <= 0) return index;
  const asked = load.listed[index];
  if (!asked) return 0;
  let best = 0; let most = -1;
  load.pallets.forEach((pallet, page) => {
    const shared = asked.items.reduce((sum, item) => sum
      + Math.min(item.cartons, pallet.items.find((other) => other.productId === item.productId)?.cartons ?? 0), 0);
    if (shared > most) { most = shared; best = page; }
  });
  return best;
}

/** A product's colour in the planner when the order no longer has its line. */
const LOST_COLOUR = '#8a8079';

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** What 3D knows of one product of the order: its line, the catalogue's omdoos, its weight. */
interface Stock {
  productId: number;
  line: PlannerLine | undefined;
  product: Product | undefined;
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  measured: boolean;
}

function stockOf(productId: number, lineOf: ReadonlyMap<number, PlannerLine>, products: ReadonlyMap<number, Product>): Stock {
  const line = lineOf.get(productId);
  const product = products.get(productId);
  const carton = product?.carton;
  const lengthCm = carton?.lengthCm ?? 0; const widthCm = carton?.widthCm ?? 0; const heightCm = carton?.heightCm ?? 0;
  return {
    productId, line, product, name: line?.name ?? product?.name ?? 'Verwijderd product', lengthCm, widthCm, heightCm,
    weightKg: carton?.weightKg && carton.weightKg > 0 ? carton.weightKg : line?.cartonWeightKg ?? 0,
    measured: lengthCm > 0 && widthCm > 0 && heightCm > 0,
  };
}

/** The panel's entry for a product on this pallet. */
function itemOf(stock: Stock, cartons: number): BuilderItem {
  const { product, line } = stock;
  const units = product ? productUnits(product).piecesPerCarton : null;
  const piece = product ? productSalesUnit(product).piece : null;
  return {
    key: stock.productId, group: stock.productId, section: null,
    groupTitle: product?.name?.trim() || stock.name, title: stock.name,
    colour: line?.colour ?? LOST_COLOUR,
    colourName: product?.colour?.trim() || null, colourHex: product?.colourHex?.trim() || null,
    sku: line?.sku || product?.sku?.trim() || null, photo: line?.photoUrl ?? null,
    lengthCm: stock.lengthCm, widthCm: stock.widthCm, heightCm: stock.heightCm, weightKg: stock.weightKg,
    wanted: cartons, up: 'h',
    units: units && piece ? { per: units, one: piece.one, other: piece.other } : null,
  };
}

/**
 * The omdozen to load, as kinds of one size and weight (the colours of a
 * product share one, so they share layers), each kind's products in the
 * order given. What 3D cannot draw (no sizes) is set apart.
 */
interface Loadable {
  kinds: PackKind[];
  /** Per kind's key, its products and how many of each still go to a box, in order. */
  members: Map<number, { productId: number; left: number }[]>;
  unmeasured: { name: string; cartons: number }[];
}

function loadable(entries: readonly { productId: number; cartons: number }[], stocks: ReadonlyMap<number, Stock>): Loadable {
  const bySize = new Map<string, PackKind>();
  const members = new Map<number, { productId: number; left: number }[]>();
  const unmeasured: Loadable['unmeasured'] = [];
  for (const entry of entries) {
    const cartons = Math.floor(entry.cartons);
    if (!(cartons > 0)) continue;
    const stock = stocks.get(entry.productId);
    if (!stock) continue;
    if (!stock.measured) { unmeasured.push({ name: stock.name, cartons }); continue; }
    const length = packUnits(stock.lengthCm); const width = packUnits(stock.widthCm); const height = packUnits(stock.heightCm);
    const weight = packUnits(stock.weightKg);
    /* One omdoos size is one kind, its heaviest colour's weight for all: colours a few grams apart still share layers. */
    const signature = `${length}|${width}|${height}`;
    let kind = bySize.get(signature);
    if (!kind) {
      kind = { key: bySize.size + 1, length, width, height, weight, count: 0, sides: ALL_SIDES };
      bySize.set(signature, kind);
      members.set(kind.key, []);
    }
    kind.weight = Math.max(kind.weight, weight);
    kind.count += cartons;
    const list = members.get(kind.key) as { productId: number; left: number }[];
    const known = list.find((member) => member.productId === entry.productId);
    if (known) known.left += cartons; else list.push({ productId: entry.productId, left: cartons });
  }
  return { kinds: [...bySize.values()], members, unmeasured };
}

/** The product of the next box of a kind: its products in turn, so a colour keeps together. */
function take(members: Map<number, { productId: number; left: number }[]>, kind: number): number | null {
  const list = members.get(kind);
  const member = list?.find((candidate) => candidate.left > 0);
  if (!member) return null;
  member.left -= 1;
  return member.productId;
}

/** One pallet's boxes from what the packer laid on it, in cm on the real floor (packedPlace), each with the product it stands for. */
function buildOf(packed: PackedPallet | undefined, members: Map<number, { productId: number; left: number }[]>, floor: Deck):
  { boxes: BuilderBox[]; counts: Map<number, number> } {
  const boxes: BuilderBox[] = [];
  const counts = new Map<number, number>();
  for (const box of packed?.boxes ?? []) {
    const productId = take(members, box.key);
    if (productId === null) continue;
    counts.set(productId, (counts.get(productId) ?? 0) + 1);
    boxes.push({ id: boxes.length + 1, key: productId, ...packedPlace(box, floor), up: box.up, turned: box.turned });
  }
  return { boxes, counts };
}

/**
 * Omdozen in whole layers of their own pattern, on the side the count stands
 * them (palletFit: upright, lying only when it must), on top of what is
 * already laid (from the floor when nothing is): a pallet the packer cannot
 * show on one pallet stands as the planner estimates it, past the height
 * where it says "te hoog". The layers themselves are the builder's stackAbove
 * (pallet-builder-model.ts), shared with Palletberekening's 3D.
 */
function stackListed(rest: readonly { productId: number; cartons: number }[], boxes: BuilderBox[], stocks: ReadonlyMap<number, Stock>,
  spec: PlannerSpec, counts: Map<number, number>): void {
  let y = 0;
  for (const box of boxes) {
    const stock = stocks.get(box.key);
    if (!stock) continue;
    const standing = cartonStanding(stock, box.up);
    y = Math.max(y, box.y + standing.heightCm);
  }
  const layers: LayerStock[] = [];
  for (const entry of rest) {
    const stock = stocks.get(entry.productId);
    if (!stock?.measured || entry.cartons <= 0) continue;
    const fit = palletFit({ lengthCm: stock.lengthCm, widthCm: stock.widthCm, heightCm: stock.heightCm, weightKg: stock.weightKg || null }, spec);
    layers.push({
      key: entry.productId, cartons: entry.cartons, lengthCm: stock.lengthCm, widthCm: stock.widthCm, heightCm: stock.heightCm,
      up: fit.cartonsPerPallet > 0 ? fit.up : 'h',
    });
  }
  for (const [productId, cartons] of stackAbove(layers, boxes, y, spec)) counts.set(productId, (counts.get(productId) ?? 0) + cartons);
}

/** The catalogue's omdoos lays another number per layer than the order counted with: its sizes changed since. */
function sizesChanged(stock: Stock, spec: PlannerSpec): boolean {
  const line = stock.line;
  if (!line || !(line.perLayer > 0) || !stock.measured) return false;
  const fit = palletFit({ lengthCm: stock.lengthCm, widthCm: stock.widthCm, heightCm: stock.heightCm, weightKg: stock.weightKg || null }, spec);
  return fit.cartonsPerPallet > 0 && fit.perLayer !== line.perLayer;
}

function finished(boxes: BuilderBox[], counts: ReadonlyMap<number, number>, stocks: ReadonlyMap<number, Stock>,
  unmeasured: Loadable['unmeasured'], tooLarge: { name: string; cartons: number }[], spec: PlannerSpec): PalletBuild {
  const items = new Map<number, BuilderItem>();
  for (const [productId, cartons] of counts) {
    const stock = stocks.get(productId);
    if (stock) items.set(productId, itemOf(stock, cartons));
  }
  const missing: PalletBuild['missing'] = [
    ...unmeasured.map((part) => ({ ...part, why: 'sizes' as const })),
    ...tooLarge.map((part) => ({ ...part, why: 'size' as const })),
  ];
  const differs = [...counts.keys()].some((productId) => {
    const stock = stocks.get(productId);
    return !!stock && sizesChanged(stock, spec);
  });
  return { items: [...items.values()], boxes: settle(boxes, items), missing, differs };
}

/**
 * The order's pallets laid out in 3D. The automatic pallets are loaded
 * again as full as they go, the first before the next; when that would take
 * more pallets than the order counts, or for a hand-built layout, every
 * pallet keeps its own omdozen, laid as full as they go on it.
 */
export function orderLoad3d(view: SalesOrderView, spec: PlannerSpec, lines: readonly PlannerLine[],
  products: ReadonlyMap<number, Product>): OrderLoad3d {
  const listed = orderPallets3d(view, spec, lines);
  if (!listed.length) return EMPTY_LOAD;
  /* The packer's deck is the load floor; `floor` is the real one with its allowance, where the boxes are drawn. */
  const deck = packDeck(spec);
  const floor = deckOf(spec);
  const lineOf = new Map(lines.map((line) => [line.productId, line]));
  const stocks = new Map<number, Stock>();
  for (const pallet of listed) {
    for (const item of pallet.items) if (!stocks.has(item.productId)) stocks.set(item.productId, stockOf(item.productId, lineOf, products));
  }
  /* A copied pallet's run is loaded again with every omdoos it held, also of a product no hand pallet carries any more. */
  for (const pallet of listed) {
    for (const total of readCopySource(pallet.source)?.totals ?? []) {
      if (!stocks.has(total.productId)) stocks.set(total.productId, stockOf(total.productId, lineOf, products));
    }
  }

  /* Loaded again only where Automatisch mixes: PACKED (since 2026-11-25 the server counts these very pallets, PalletPacker) and
     MIXED (the server stacks whole layers; 3D shows how full they go). A document counted product by product (STRICT, sent
     before mixing) shows the pallets it went out on. */
  const rule = view.priced.totals.palletRule;
  /* PACKED loaded otherwise here than the server listed: the catalogue's omdoos sizes changed since the pricing. */
  let stale = false;
  if (!view.order.pallets.length && (rule === 'MIXED' || rule === 'PACKED')) {
    /* Everything the automatic pallets carry, in the order's line order, a product on two lines once (as the server merges it). */
    const totals = new Map<number, number>();
    for (const pallet of listed) for (const item of pallet.items) totals.set(item.productId, (totals.get(item.productId) ?? 0) + Math.max(0, item.cartons));
    const order = [...new Set([...lines.map((line) => line.productId).filter((id) => totals.has(id)), ...totals.keys()])];
    const goods = loadable(order.map((productId) => ({ productId, cartons: totals.get(productId) ?? 0 })), stocks);
    const plan = goods.unmeasured.length ? null : packPallets(goods.kinds, deck, listed.length);
    /* Never on more pallets than the order counts, and only with every omdoos drawn (else "past op" would not hold). */
    if (plan && !plan.left.size && plan.pallets.length && plan.pallets.length <= listed.length) {
      const pallets: OrderPallet3d[] = [];
      const builds: PalletBuild[] = [];
      const word = carrierWords(spec.profile).label;
      plan.pallets.forEach((packed, index) => {
        const { boxes, counts } = buildOf(packed, goods.members, floor);
        pallets.push({ label: `${word} ${index + 1}`, items: [...counts].map(([productId, cartons]) => ({ productId, cartons })), measuredCm: null, ownType: null });
        builds.push(finished(boxes, counts, stocks, goods.unmeasured, [], spec));
      });
      const matchesList = pallets.length === listed.length && pallets.every((pallet, index) => sameItems(pallet.items, listed[index].items));
      /* PACKED: the server listed these very pallets. Loaded otherwise here (a catalogue size changed since pricing), the list
         stands, so a row and its 3D page always carry the same omdozen. */
      if (rule !== 'PACKED' || matchesList) {
        return { pallets, builds, source: 'packed', counted: plan.pallets.length < listed.length ? listed.length : null, listed, matchesList };
      }
      stale = true;
    }
  }

  /* Every pallet keeps its own omdozen. On a PACKED document a pallet of the order's own type stands as the server loads it:
     one that carries what a server pallet carries as that pallet within the server's own list (whatever its place in a hand
     list), one that holds no more than the pallet Zelf indelen copied it from as that part of the copied pallet (its source's
     run loaded again), any other as the server would load this list (pallet-hand-load.ts). Any other pallet is packed on its
     own. Where no try takes it, in whole layers per product from the floor, as the planner estimates it (past the height in
     orange and red). An omdoos without sizes, or too large for the pallet on any side, is left out and named. */
  const drawable = new Map<number, boolean>();
  for (const [productId, stock] of stocks) {
    drawable.set(productId, stock.measured && packPallets([{ key: 1, length: packUnits(stock.lengthCm), width: packUnits(stock.widthCm),
      height: packUnits(stock.heightCm), weight: packUnits(stock.weightKg), count: 1, sides: ALL_SIDES }], deck, 1).pallets.length > 0);
  }
  const drawn = listed.map((pallet) => pallet.items.filter((item) => item.cartons > 0 && drawable.get(item.productId)));
  const packedDoc = rule === 'PACKED';
  const order = [...new Set(lines.map((line) => line.productId))];
  const cartonOf = (productId: number) => {
    const stock = stocks.get(productId);
    return stock?.measured ? { lengthCm: stock.lengthCm, widthCm: stock.widthCm, heightCm: stock.heightCm, weightKg: stock.weightKg } : null;
  };
  const server = packedDoc ? view.priced.totals.autoPallets ?? [] : [];
  const serverLoad = server.length
    ? handLoader(server.map((pallet) => pallet.items.filter((item) => item.cartons > 0 && drawable.get(item.productId))), order, cartonOf, deck, ALL_SIDES)
    : null;
  /* Joined as the server loads a list only on PACKED and on the order's own pallet type; any other pallet is packed on its own
     (as before 2026-11-25: a STRICT part pallet stays low, a MIXED hand pallet as full as it goes). */
  const listLoad = handLoader(drawn, order, cartonOf, deck, ALL_SIDES, (index) => packedDoc && !listed[index].ownType);
  /* The pallet Zelf indelen copied a hand pallet from, its run loaded again on the floor it was copied on and given in today's
     load floor's places, so packedPlace below draws it where it stood (the planner judges it the same way). */
  const copiedOf = packedDoc ? copiedLoader(spec, cartonOf, deck, ALL_SIDES) : null;
  const builds = listed.map((pallet, index) => {
    const unmeasured: Loadable['unmeasured'] = [];
    const tooLarge: { name: string; cartons: number }[] = [];
    for (const item of pallet.items) {
      const stock = stocks.get(item.productId);
      if (!stock || !(item.cartons > 0) || drawable.get(item.productId)) continue;
      (stock.measured ? tooLarge : unmeasured).push({ name: stock.name, cartons: Math.floor(item.cartons) });
    }
    const boxes: BuilderBox[] = [];
    const counts = new Map<number, number>();
    let load = null;
    if (packedDoc && !pallet.ownType) {
      const twin = server[index] && sameItems(server[index].items, pallet.items) ? index
        : server.findIndex((candidate) => sameItems(candidate.items, pallet.items));
      load = twin >= 0 && serverLoad ? serverLoad(twin) : null;
    }
    if (!load) load = listLoad(index);
    /* Holding no more of any product than the pallet Zelf indelen copied it from: drawn as that part of it. */
    if (!load && packedDoc && !pallet.ownType && copiedOf) {
      const copied = copiedOf(pallet.source);
      load = copied ? partOf(copied, drawn[index], cartonOf) : null;
    }
    /* No more of any product than a server pallet carries: drawn as that part of the server's pallet. */
    if (!load && packedDoc && !pallet.ownType && serverLoad) {
      const holder = server.findIndex((candidate) => within(pallet.items, candidate.items));
      const whole = holder >= 0 ? serverLoad(holder) : null;
      load = whole ? partOf(whole, drawn[index], cartonOf) : null;
    }
    if (load) {
      for (const box of load.boxes) {
        boxes.push({ id: boxes.length + 1, key: box.productId, ...packedPlace(box, floor), up: box.up, turned: box.turned });
        counts.set(box.productId, (counts.get(box.productId) ?? 0) + 1);
      }
    } else stackListed(drawn[index], boxes, stocks, spec, counts);
    const build = finished(boxes, counts, stocks, unmeasured, tooLarge, spec);
    return stale ? { ...build, differs: true } : build;
  });
  return { pallets: listed, builds, source: 'listed', counted: null, listed, matchesList: true };
}

/**
 * The order's omdozen on another carrier than its own (the 3D's view-only Pallet | Deense kar switch), for a look:
 * every carrier as full as it goes, the first before the next, as a new PACKED document on that carrier would count,
 * apart from the server's guard that keeps whole layers when those need fewer. The order, its count, its freight and
 * the planner's rows stay as they are.
 */
export interface OtherLoad3d extends OrderLoad3d {
  /** Omdozen without sizes, and omdozen this carrier takes on no side: not drawn. */
  unmeasured: number;
  tooLarge: number;
  /** More omdozen than MAX_PLANNED_PALLETS carriers take: the rest is not drawn. */
  capped: boolean;
}

/**
 * All of the order's omdozen on the carrier of spec, as full as they go (pallet-pack.ts, every side allowed, as the
 * order's own 3D and PACKED): every line with omdozen, also one the order's own carrier cannot take (it may go on this
 * one on its side) and the loose omdozen of a hand layout. At most MAX_PLANNED_PALLETS carriers. No sizes-changed check:
 * the order's per-layer counts belong to its own carrier. The spec carries the document's own spill (standardSpec), so
 * the look counts on the same allowance as the document.
 */
export function orderLoadOn(lines: readonly PlannerLine[], products: ReadonlyMap<number, Product>, spec: PlannerSpec): OtherLoad3d {
  const lineOf = new Map(lines.map((line) => [line.productId, line]));
  const totals = new Map<number, number>();
  for (const line of lines) if (line.cartons > 0) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.cartons);
  const stocks = new Map<number, Stock>();
  for (const productId of totals.keys()) stocks.set(productId, stockOf(productId, lineOf, products));
  const goods = loadable([...totals].map(([productId, cartons]) => ({ productId, cartons })), stocks);
  const deck = packDeck(spec);
  const floor = deckOf(spec);
  const plan = packPallets(goods.kinds, deck, MAX_PLANNED_PALLETS);
  const word = carrierWords(spec.profile).label;
  const placed = plan.pallets.map((packed) => buildOf(packed, goods.members, floor));
  /* What the plan left: a kind that fits no side of this carrier (or weighs more than it carries) is too large; any
     other was left over the limit of carriers. */
  const tooLarge: { name: string; cartons: number }[] = [];
  let capped = false;
  for (const kind of goods.kinds) {
    if (!(plan.left.get(kind.key) ?? 0)) continue;
    if (packPallets([{ ...kind, count: 1 }], deck, 1).pallets.length) { capped = true; continue; }
    for (const member of goods.members.get(kind.key) ?? []) {
      if (member.left > 0) tooLarge.push({ name: stocks.get(member.productId)?.name ?? 'Verwijderd product', cartons: member.left });
    }
  }
  const pallets: OrderPallet3d[] = placed.map(({ counts }, index) => ({
    label: `${word} ${index + 1}`, items: [...counts].map(([productId, cartons]) => ({ productId, cartons })), measuredCm: null, ownType: null,
  }));
  const builds = placed.map(({ boxes, counts }) => ({ ...finished(boxes, counts, stocks, goods.unmeasured, tooLarge, spec), differs: false }));
  return {
    pallets, builds, source: 'packed', counted: null, listed: pallets, matchesList: true,
    unmeasured: goods.unmeasured.reduce((sum, part) => sum + part.cartons, 0),
    tooLarge: tooLarge.reduce((sum, part) => sum + part.cartons, 0), capped,
  };
}

function omdozenText(n: number): string {
  return `${n.toLocaleString('nl-BE')} ${n === 1 ? 'omdoos' : 'omdozen'}`;
}

/**
 * The line over the other carrier's view: that it is a look only and what the order counts ("Alleen bekijken · de
 * order telt 3 pallets"), then what it does not draw. Also when nothing could be drawn at all.
 */
export function otherNotice3d(load: OtherLoad3d, shown: CarrierWords, own: CarrierWords, ownCount: number): string {
  const notes = [`Alleen bekijken · de order telt ${ownCount.toLocaleString('nl-BE')} ${carrierNoun(ownCount, own)}`];
  if (load.capped) notes.push(`meer dan ${MAX_PLANNED_PALLETS} ${shown.other}, niet alles getekend`);
  if (load.tooLarge) notes.push(`${omdozenText(load.tooLarge)} te groot voor deze ${shown.one}, niet getekend`);
  if (load.unmeasured) notes.push(`${omdozenText(load.unmeasured)} zonder maten niet getekend`);
  return notes.join(' · ');
}

/** "Europallet 120 × 80 · max 260 cm": what the 3D stands on; with a spill above 0 also that ("… · max 260 cm · spill 2 cm"). */
export function palletLabel3d(spec: PlannerSpec): string {
  const spill = specSpillCm(spec);
  return `${spec.name} · max ${Math.round(spec.maxHeightCm).toLocaleString('nl-BE')} cm${spill > 0 ? ` · spill ${spill.toLocaleString('nl-BE')} cm` : ''}`;
}

/** The line over the view: what it does not draw, and where it differs from the order. */
export function palletNotice3d(pallet: OrderPallet3d | undefined, build: PalletBuild, spec: PlannerSpec, load?: Pick<OrderLoad3d, 'pallets' | 'counted'>): string | null {
  if (!pallet) return null;
  const notes: string[] = [];
  const count = (why: PalletBuild['missing'][number]['why']) => build.missing.filter((part) => part.why === why)
    .reduce((sum, part) => sum + part.cartons, 0);
  const words = carrierWords(spec.profile);
  const unmeasured = count('sizes');
  const tooLarge = count('size');
  if (load?.counted) notes.push(`Past op ${load.pallets.length} ${carrierNoun(load.pallets.length, words)} · de order telt er ${load.counted}`);
  if (unmeasured) notes.push(`${omdozenText(unmeasured)} zonder maten niet getekend`);
  if (tooLarge) notes.push(`${omdozenText(tooLarge)} te groot voor deze ${words.one}, niet getekend`);
  if (build.differs) notes.push('Omdoosmaten gewijzigd sinds de berekening');
  if (pallet.measuredCm !== null) notes.push(`Gemeten ${Math.round(pallet.measuredCm).toLocaleString('nl-BE')} cm`);
  if (pallet.ownType) notes.push(`${pallet.ownType}, getekend als ${spec.name}`);
  return notes.length ? notes.join(' · ') : null;
}
