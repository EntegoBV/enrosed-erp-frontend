import type { Product, SalesOrderView } from '../../core/api/models';
import { productSalesUnit } from '../products/product-sales-unit';
import { settle, type BuilderBox, type BuilderItem } from './pallet-builder-model';
import { cartonStanding, layerSlots, palletFit, productUnits, type CartonUp } from './pallet-calculator-model';
import { ALL_SIDES, PACK_UNITS, packDeck, packPallets, packUnits, type PackKind, type PackedPallet } from './pallet-pack';
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
 * pallet keeps what it carries and only that is laid as full as it goes. The
 * count and the freight stay the server's. Nothing floats, nothing hangs
 * over an edge; what does not fit under the height stands on top, in the
 * builder's orange and red, as the planner says "te hoog".
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

/** The order's pallets as 3D lays them, with the build of each. */
export interface OrderLoad3d {
  pallets: OrderPallet3d[];
  builds: PalletBuild[];
  /** 'packed': the automatic pallets filled one after the other, each as full as it gets; 'listed': every pallet keeps what it carries. */
  source: 'packed' | 'listed';
  /** The pallets the order counts when 3D loads its omdozen on fewer; null when on as many. */
  counted: number | null;
}

export const EMPTY_LOAD: OrderLoad3d = { pallets: [], builds: [], source: 'listed', counted: null };

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
    const signature = `${length}|${width}|${height}|${weight}`;
    let kind = bySize.get(signature);
    if (!kind) {
      kind = { key: bySize.size + 1, length, width, height, weight, count: 0, sides: ALL_SIDES };
      bySize.set(signature, kind);
      members.set(kind.key, []);
    }
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

/** One pallet's boxes from what the packer laid on it, in cm, each with the product it stands for. */
function buildOf(packed: PackedPallet | undefined, members: Map<number, { productId: number; left: number }[]>):
  { boxes: BuilderBox[]; counts: Map<number, number> } {
  const boxes: BuilderBox[] = [];
  const counts = new Map<number, number>();
  for (const box of packed?.boxes ?? []) {
    const productId = take(members, box.key);
    if (productId === null) continue;
    counts.set(productId, (counts.get(productId) ?? 0) + 1);
    boxes.push({
      id: boxes.length + 1, key: productId, x: box.x / PACK_UNITS, y: box.y / PACK_UNITS, z: box.z / PACK_UNITS, up: box.up, turned: box.turned,
    });
  }
  return { boxes, counts };
}

/**
 * Omdozen that did not fit under the height (a hand-built pallet carrying
 * more than it takes): on top of the load in whole layers of their own
 * pattern, on the side the count stands them, so the view shows them past
 * the height.
 */
function stackAbove(rest: readonly { productId: number; cartons: number }[], boxes: BuilderBox[], stocks: ReadonlyMap<number, Stock>,
  spec: PlannerSpec, counts: Map<number, number>): void {
  let y = 0;
  for (const box of boxes) {
    const stock = stocks.get(box.key);
    if (!stock) continue;
    const standing = cartonStanding(stock, box.up);
    y = Math.max(y, box.y + standing.heightCm);
  }
  for (const entry of rest) {
    const stock = stocks.get(entry.productId);
    if (!stock?.measured || entry.cartons <= 0) continue;
    const fit = palletFit({ lengthCm: stock.lengthCm, widthCm: stock.widthCm, heightCm: stock.heightCm, weightKg: stock.weightKg || null }, spec);
    const up: CartonUp = fit.cartonsPerPallet > 0 ? fit.up : 'h';
    const standing = cartonStanding(stock, up);
    const slots = layerSlots({ lengthCm: standing.lengthCm, widthCm: standing.widthCm }, spec);
    if (!slots.length) continue;
    for (let left = entry.cartons; left > 0; left -= slots.length) {
      for (const slot of slots.slice(0, Math.min(left, slots.length))) {
        boxes.push({
          id: boxes.length + 1, key: entry.productId, x: round(slot.x), y: round(y), z: round(slot.z), up,
          turned: Math.abs(slot.lengthCm - standing.lengthCm) > 1e-6,
        });
        counts.set(entry.productId, (counts.get(entry.productId) ?? 0) + 1);
      }
      y += standing.heightCm;
    }
  }
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
  const deck = packDeck(spec);
  const lineOf = new Map(lines.map((line) => [line.productId, line]));
  const stocks = new Map<number, Stock>();
  for (const pallet of listed) {
    for (const item of pallet.items) if (!stocks.has(item.productId)) stocks.set(item.productId, stockOf(item.productId, lineOf, products));
  }

  /* Loaded again only where Automatisch mixes (new and concept documents): a document counted product by product (STRICT, sent
     before mixing) shows the pallets it went out on. */
  if (!view.order.pallets.length && view.priced.totals.palletRule === 'MIXED') {
    /* Everything the automatic pallets carry, in the order's line order. */
    const totals = new Map<number, number>();
    for (const pallet of listed) for (const item of pallet.items) totals.set(item.productId, (totals.get(item.productId) ?? 0) + Math.max(0, item.cartons));
    const order = [...lines.map((line) => line.productId).filter((id) => totals.has(id)), ...[...totals.keys()].filter((id) => !lineOf.has(id))];
    const goods = loadable(order.map((productId) => ({ productId, cartons: totals.get(productId) ?? 0 })), stocks);
    const plan = goods.unmeasured.length ? null : packPallets(goods.kinds, deck, listed.length);
    /* Never on more pallets than the order counts, and only with every omdoos drawn (else "past op" would not hold). */
    if (plan && !plan.left.size && plan.pallets.length && plan.pallets.length <= listed.length) {
      const pallets: OrderPallet3d[] = [];
      const builds: PalletBuild[] = [];
      plan.pallets.forEach((packed, index) => {
        const { boxes, counts } = buildOf(packed, goods.members);
        pallets.push({ label: `Pallet ${index + 1}`, items: [...counts].map(([productId, cartons]) => ({ productId, cartons })), measuredCm: null, ownType: null });
        builds.push(finished(boxes, counts, stocks, goods.unmeasured, [], spec));
      });
      return { pallets, builds, source: 'packed', counted: plan.pallets.length < listed.length ? listed.length : null };
    }
  }

  /* Every pallet keeps its own omdozen, laid as full as they go on it. */
  const builds = listed.map((pallet) => {
    const goods = loadable(pallet.items, stocks);
    const plan = packPallets(goods.kinds, deck, 1);
    const { boxes, counts } = buildOf(plan.pallets[0], goods.members);
    /* What one pallet does not take stands on top; an omdoos too large for any side is left out. */
    const rest: { productId: number; cartons: number }[] = [];
    const tooLarge: { name: string; cartons: number }[] = [];
    for (const [kindKey, list] of goods.members) {
      const kind = goods.kinds.find((candidate) => candidate.key === kindKey);
      for (const member of list) {
        if (member.left <= 0) continue;
        const stock = stocks.get(member.productId);
        const fits = !!kind && packPallets([{ ...kind, count: 1 }], deck, 1).pallets.length > 0;
        if (fits) rest.push({ productId: member.productId, cartons: member.left });
        else tooLarge.push({ name: stock?.name ?? 'Product', cartons: member.left });
      }
    }
    stackAbove(rest, boxes, stocks, spec, counts);
    return finished(boxes, counts, stocks, goods.unmeasured, tooLarge, spec);
  });
  return { pallets: listed, builds, source: 'listed', counted: null };
}

/** "Europallet 120 × 80 · max 260 cm": what the 3D stands on. */
export function palletLabel3d(spec: PlannerSpec): string {
  return `${spec.name} · max ${Math.round(spec.maxHeightCm).toLocaleString('nl-BE')} cm`;
}

/** The line over the view: what it does not draw, and where it differs from the order. */
export function palletNotice3d(pallet: OrderPallet3d | undefined, build: PalletBuild, spec: PlannerSpec, load?: Pick<OrderLoad3d, 'pallets' | 'counted'>): string | null {
  if (!pallet) return null;
  const notes: string[] = [];
  const count = (why: PalletBuild['missing'][number]['why']) => build.missing.filter((part) => part.why === why)
    .reduce((sum, part) => sum + part.cartons, 0);
  const omdozen = (n: number) => `${n.toLocaleString('nl-BE')} ${n === 1 ? 'omdoos' : 'omdozen'}`;
  const unmeasured = count('sizes');
  const tooLarge = count('size');
  if (load?.counted) notes.push(`Past op ${load.pallets.length} ${load.pallets.length === 1 ? 'pallet' : 'pallets'} · de order telt er ${load.counted}`);
  if (unmeasured) notes.push(`${omdozen(unmeasured)} zonder maten niet getekend`);
  if (tooLarge) notes.push(`${omdozen(tooLarge)} te groot voor deze pallet, niet getekend`);
  if (build.differs) notes.push('Omdoosmaten gewijzigd sinds de berekening');
  if (pallet.measuredCm !== null) notes.push(`Gemeten ${Math.round(pallet.measuredCm).toLocaleString('nl-BE')} cm`);
  if (pallet.ownType) notes.push(`${pallet.ownType}, getekend als ${spec.name}`);
  return notes.length ? notes.join(' · ') : null;
}
