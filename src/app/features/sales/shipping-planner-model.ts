import type {
  Carrier, FreightPricingStrategy, OrderPallet, PalletProfile, Product, SalesOrder, SalesOrderView,
} from '../../core/api/models';
import { copiedLoader, copiedOnSmallerFloor, copySources, handLoader, partOf, sameItems, within, type HandCarton } from './pallet-hand-load';
import { ALL_SIDES, packDeck } from './pallet-pack';
import {
  CARRIER_WORDS, KAR_BASE_HEIGHT_CM, KAR_MAX_HEIGHT_CM, KAR_MAX_WEIGHT_KG, MAX_PLANNED_PALLETS, PALLET_BASE_HEIGHT_CM,
  PALLET_LEGACY_MAX_HEIGHT_CM, PALLET_MAX_WEIGHT_KG, carrierWords, loadChoice, palletSpec, planPallets, roomWithoutExtraPallet,
  separatePallets, specSpillCm, spillAxes, standardHeightCm, type CarrierKind, type CarrierWords, type PalletSpec, type PlanLine,
} from './pallet-calculator-model';
import {
  PALLET_PRODUCT_COLOURS, automaticPallets, carrierTypes, estimatePalletHeightCm, normalizeManualPalletType, palletTypeLabel,
} from './pallet-stack';
import { salesLineUnavailable } from './sales-line-availability';

/**
 * What the pallet planner shows, worked out from the priced order without
 * Angular: the pallets of the automatic count (the server's layout under
 * its palletRule; on an older server every product on pallets of its own,
 * palletsStrict, laid out here), the hand-built pallets with their
 * estimated height and weight, the mixed layout Palletberekening would
 * make, and where every omdoos stands. The backend stays the one that
 * counts fits, m³ and freight; this only lays its answer out.
 */

export interface PlannerSpec extends PalletSpec {
  profile: PalletProfile;
  /** "Europallet 120 × 80", "Deense kar 127 × 54,5". */
  name: string;
  /** The loaded height left above the wood (the kar's base plate). */
  usableCm: number;
}

/**
 * The order's carrier as the server priced it: a pallet type, or the Deense kar (DEENSE_KAR: 127 ×
 * 54,5 cm, base 16,5 cm, 450 kg). The server sends the base, the height and the spill it counted with.
 */
export function plannerSpec(view: SalesOrderView): PlannerSpec {
  const profile = view.order.palletProfile ?? 'EURO_120X80';
  const kar = profile === 'DEENSE_KAR';
  const base = view.priced.totals.palletBaseHeightCm ?? (kar ? KAR_BASE_HEIGHT_CM : PALLET_BASE_HEIGHT_CM);
  /* The server's effective height; an older server without it priced a document without a height on 260 (a kar has no
     such past: it reads its own standard, 230). */
  const max = view.priced.totals.palletMaxHeightCm ?? view.order.maxPalletHeightCm ?? (kar ? KAR_MAX_HEIGHT_CM : PALLET_LEGACY_MAX_HEIGHT_CM);
  /* The spill the server counted with (2026-11-26): 0 for a document that stores none, and for one it priced without its
     stored spill (with it the automatic count would need a carrier more). A server that does not say counted without one.
     Never the draft's pick (order.palletSpillCm): what this screen works out itself must stand on the floor the figures
     came from. */
  return specFor(profile, base, max, view.priced.totals.palletSpillCm ?? 0);
}

/**
 * The spill picked for the document, in cm per side: what it stores (order.palletSpillCm), 0 for a document that
 * stores none, and 0 on a server that does not know spill. The Spill stepper shows this and "Standaard" compares it;
 * it is the only spill a write carries. Never the spill the figures were counted with (plannerSpec), which can be 0
 * under a pick of 2 (spillSetAside): shown as the pick, that 0 would be stored with the next step.
 */
export function pickedSpillCm(view: SalesOrderView): number {
  return view.priced.totals.palletSpillCm != null ? view.order.palletSpillCm ?? 0 : 0;
}

/**
 * The server priced this document WITHOUT the spill it stores (2026-11-26): with it the automatic count would need a
 * carrier more than without, so the figures stand on the floor itself (totals.palletSpillCm 0) while the pick stays
 * stored. The planner says so in one line by the Spill row.
 */
export function spillSetAside(view: SalesOrderView): boolean {
  return (view.order.loadMode ?? 'PALLETS') === 'PALLETS' && pickedSpillCm(view) > 0 && !((view.priced.totals.palletSpillCm ?? 0) > 0);
}

/**
 * The hand layout "Zelf indelen" starts from: the automatic pallets of `figures`, one to one. The server's layout
 * under its rule (products stacked together on a new or concept document), or on an older server every product
 * on pallets of its own. A product that fits no pallet stays loose (the planner lists it under Nakijken); when
 * nothing fits, the layout is one empty pallet, since an empty list is Automatisch itself. On a PACKED document
 * every copied pallet remembers the run it comes from (OrderPallet.source), with the profile, the height and the
 * spill THOSE figures were counted with (the spec of `figures`: 0 where the server priced the document without
 * its pick), so the planner and the 3D judge it as that pallet whatever edits follow. The document's own pick is
 * not touched. `figures` is the answer the caller copies from: the one on screen, or for a remake under a hand
 * layout the answer for the same draft without it (the editor's layoutFigures says why).
 */
export function copiedLayout(order: Pick<SalesOrder, 'palletProfile'>, figures: SalesOrderView | null): OrderPallet[] {
  const type = palletTypeLabel(order.palletProfile);
  const word = carrierWords(order.palletProfile).label;
  const priced = figures?.priced;
  const pallets: OrderPallet[] = [];
  const add = (items: OrderPallet['items'], source: string | null = null) =>
    pallets.push({ id: null, label: `${word} ${pallets.length + 1}`, type, heightCm: null, items, source });
  const automatic = priced?.totals.autoPallets;
  if (figures && priced && automatic && automatic.length === automaticPallets(priced.totals)) {
    const spec = plannerSpec(figures);
    const sources = priced.totals.palletRule === 'PACKED'
      ? copySources(spec.profile, spec.maxHeightCm, priced.lines.map((line) => line.productId), automatic.map((pallet) => pallet.items),
        specSpillCm(spec))
      : [];
    automatic.forEach((pallet, index) => add(pallet.items.map(({ productId, cartons }) => ({ productId, cartons })), sources[index] ?? null));
  } else {
    for (const line of priced?.lines ?? []) {
      const per = line.cartonsPerPallet;
      if (per <= 0 || salesLineUnavailable(line)) continue;
      for (let left = line.cartons; left > 0; left -= per) add([{ productId: line.productId, cartons: Math.min(per, left) }]);
    }
  }
  if (!pallets.length) add([]);
  return pallets;
}

/**
 * A carrier's spec as the planner and the 3D read it: the profile's floor, name and weight limit at this base and height,
 * with this spill (cm per side; on the kar across the width only, spillAxes). The name stays the real floor's.
 */
export function specFor(profile: PalletProfile, baseHeightCm: number, maxHeightCm: number, spillCm = 0): PlannerSpec {
  const choice = loadChoice(profile);
  return {
    profile, name: `${choice.label} ${choice.size}`, lengthCm: choice.lengthCm, widthCm: choice.widthCm,
    baseHeightCm, maxHeightCm, maxWeightKg: profile === 'DEENSE_KAR' ? KAR_MAX_WEIGHT_KG : PALLET_MAX_WEIGHT_KG,
    usableCm: Math.max(1, maxHeightCm - baseHeightCm), ...spillAxes(profile, spillCm),
  };
}

/**
 * The other carrier at its standard height, for the 3D's view-only switch: a Deense kar at 230 cm, a europallet at
 * 260 cm, with the spill given: the document's own (0 without one), so the look counts as the document does.
 */
export function standardSpec(kind: CarrierKind, spillCm = 0): PlannerSpec {
  const profile: PalletProfile = kind === 'kar' ? 'DEENSE_KAR' : 'EURO_120X80';
  const spec = palletSpec(profile, standardHeightCm(profile));
  return specFor(profile, spec.baseHeightCm, spec.maxHeightCm, spillCm);
}

/** An order on the Deense kar (2026-11-25): its freight is set by hand (Vast bedrag), its screens say kar and karren. */
export function isKarOrder(order: Pick<SalesOrder, 'palletProfile'>): boolean {
  return order.palletProfile === 'DEENSE_KAR';
}

/** One product of the order as the planner sees it. */
export interface PlannerLine {
  productId: number;
  name: string;
  sku: string;
  photoUrl: string | null;
  colour: string;
  cartons: number;
  cbm: number;
  weightKg: number;
  perLayer: number;
  perPallet: number;
  /** One layer's height; null on a server that does not say. */
  cartonHeightCm: number | null;
  /** 0 when unknown. */
  cartonWeightKg: number;
  /** Layers of a full pallet. */
  fullLayers: number;
  weightLimited: boolean;
  /** Pallets of its own (the strict count). */
  pallets: number;
  /** Omdozen that still go on its own last pallet. */
  room: number;
  /** Why it fits no pallet, in Palletberekening's words; null when it fits. */
  problem: string | null;
}

const EPSILON = 1e-9;

export function plannerLines(view: SalesOrderView, spec: PlannerSpec): PlannerLine[] {
  const palletised = (view.order.loadMode ?? 'PALLETS') === 'PALLETS';
  const missing = new Set(view.priced.validation.productsWithoutCartonDimensions ?? []);
  const words = carrierWords(spec.profile);
  return view.priced.lines.flatMap((line, index) => {
    /* The order line's flag too: a product just set unavailable drops at once, before the new figures arrive. */
    const ordered = view.order.lines.find((item) => item.productId === line.productId);
    if (line.quantity <= 0 || salesLineUnavailable(line) || salesLineUnavailable(ordered)) return [];
    const perLayer = line.cartonsPerLayer ?? 0;
    const perPallet = palletised ? line.cartonsPerPallet : 0;
    const fullLayers = perLayer > 0 && perPallet > 0 ? Math.ceil(perPallet / perLayer) : 0;
    const used = line.palletLayers ?? 0;
    const height = line.calculatedPalletHeightCm ?? 0;
    /* The server rounds a pallet's height to 0.1 cm: a full pallet of one product must still fit the plan. */
    const derived = used > 0 && height > spec.baseHeightCm ? (height - spec.baseHeightCm) / used : null;
    const cartonHeightCm = derived !== null && fullLayers > 0 ? Math.min(derived, spec.usableCm / fullLayers) : derived;
    const cartons = line.cartons;
    let problem: string | null = null;
    if (palletised && cartons > 0 && perPallet <= 0) {
      problem = missing.has(line.sku) ? 'Omdoosmaten ontbreken'
        : perLayer <= 0 ? `Omdoos te groot voor deze ${words.one}` : 'Omdoos te hoog of te zwaar';
    } else if (!palletised && missing.has(line.sku)) problem = 'Omdoosmaten ontbreken';
    const rest = perPallet > 0 ? cartons % perPallet : 0;
    return [{
      productId: line.productId, name: line.description, sku: line.sku, photoUrl: line.photoUrl,
      colour: PALLET_PRODUCT_COLOURS[index % PALLET_PRODUCT_COLOURS.length],
      cartons, cbm: line.cbm, weightKg: line.weightKg, perLayer, perPallet, cartonHeightCm,
      cartonWeightKg: cartons > 0 && line.weightKg > 0 ? line.weightKg / cartons : 0,
      fullLayers,
      weightLimited: cartonHeightCm !== null && perPallet > 0
        && perPallet < perLayer * Math.floor(spec.usableCm / cartonHeightCm + EPSILON),
      pallets: perPallet > 0 ? Math.ceil(cartons / perPallet) : 0,
      room: rest > 0 ? perPallet - rest : 0,
      problem,
    }];
  });
}

export interface GlyphBlock { colour: string; pct: number }

export type PalletStatus = 'nakijken' | 'te hoog' | 'te zwaar' | 'leeg' | 'vol' | 'pct';

export interface PalletPart { productId: number; name: string; colour: string; photoUrl: string | null; cartons: number }

/** One pallet row, or a run of equal full pallets ("Pallet 1–2", on the kar "Kar 1–2") of the automatic count. */
export interface PalletVm {
  /** Position in the list (hand) or of the first pallet of the run (automatic), from 0. */
  index: number;
  from: number;
  to: number;
  label: string;
  /** The product name, or "3 producten". */
  contents: string;
  parts: PalletPart[];
  /** Omdozen on one pallet of the run. */
  cartons: number;
  heightCm: number | null;
  measured: boolean;
  weightKg: number;
  fill: number;
  full: boolean;
  /** Higher than the maximum: the glyph gets a red top edge. */
  over: boolean;
  heavy: boolean;
  status: PalletStatus;
  blocks: GlyphBlock[];
  /** The stored type ("Blokpallet 120×100"); null for an automatic pallet. */
  type: string | null;
  /** The short type when it differs from the order's pallet: "Blok", "Half" or the own text. */
  typeNote: string | null;
}

function contents(parts: readonly PalletPart[]): string {
  if (parts.length === 1) return parts[0].name;
  return parts.length ? `${parts.length} producten` : '';
}

function block(line: PlannerLine | undefined, layers: number, spec: PlannerSpec): GlyphBlock {
  const height = line?.cartonHeightCm ?? 0;
  return { colour: line?.colour ?? 'var(--muted-2)', pct: Math.min(100, (layers * height / spec.usableCm) * 100) };
}

/**
 * The glyph of a pallet loaded as full as it goes (PACKED, or a hand pallet packed): its products stand side by side,
 * so each block is the product's share of the load's volume, all together as high as the load.
 */
function shareBlocks(items: readonly { productId: number; cartons: number }[], byId: ReadonlyMap<number, PlannerLine>,
  heightCm: number | null, spec: PlannerSpec): GlyphBlock[] {
  const volumes = items.map((item) => {
    const line = byId.get(item.productId);
    return line && line.cartons > 0 ? Math.max(0, item.cartons) * (line.cbm / line.cartons) : 0;
  });
  const total = volumes.reduce((sum, volume) => sum + volume, 0);
  const fill = heightCm === null ? 0 : Math.min(100, Math.max(0, ((heightCm - spec.baseHeightCm) / spec.usableCm) * 100));
  return items.map((item, index) => ({
    colour: byId.get(item.productId)?.colour ?? 'var(--muted-2)',
    pct: total > 0 ? fill * (volumes[index] / total) : 0,
  }));
}

/**
 * A pallet's glyph at its height: whole layers per product where those add up to the height (a MIXED pallet, PACKED's
 * fallback to layers, a hand pallet estimated in layers), else each product's share of the load (side by side).
 */
function glyphBlocks<T extends { productId: number; cartons: number }>(items: readonly T[], byId: ReadonlyMap<number, PlannerLine>,
  heightCm: number | null, spec: PlannerSpec, layersOf: (item: T) => number): GlyphBlock[] {
  const layered = items.map((item) => block(byId.get(item.productId), layersOf(item), spec));
  if (heightCm === null) return layered;
  const sum = layered.reduce((total, part) => total + part.pct, 0);
  const fill = ((heightCm - spec.baseHeightCm) / spec.usableCm) * 100;
  return Math.abs(sum - fill) <= 0.5 ? layered : shareBlocks(items, byId, heightCm, spec);
}

function weightShare(weightKg: number, spec: PlannerSpec): number {
  return spec.maxWeightKg > 0 ? weightKg / spec.maxWeightKg : 0;
}

/**
 * The server's automatic layout (totals.autoPallets, under its palletRule),
 * numbered the way "Zelf indelen" copies it, with the server's height and
 * weight per pallet; a run of equal full pallets of one product reads as
 * one row ("Pallet 1–2"). Null on an older server, which sends no layout.
 */
export function serverPallets(view: SalesOrderView, lines: readonly PlannerLine[], spec: PlannerSpec): PalletVm[] | null {
  const pallets = view.priced.totals.autoPallets;
  if (!pallets) return null;
  const byId = new Map(lines.map((line) => [line.productId, line]));
  const word = carrierWords(spec.profile).label;
  const rows: PalletVm[] = [];
  pallets.forEach((pallet, index) => {
    const parts = pallet.items.map((item) => {
      const line = byId.get(item.productId);
      return { productId: item.productId, name: line?.name ?? 'Verwijderd product', colour: line?.colour ?? 'var(--muted-2)',
        photoUrl: line?.photoUrl ?? null, cartons: item.cartons };
    });
    const cartons = pallet.items.reduce((sum, item) => sum + item.cartons, 0);
    const only = pallet.items.length === 1 ? byId.get(pallet.items[0].productId) : undefined;
    const fill = Math.min(1, Math.max((pallet.heightCm - spec.baseHeightCm) / spec.usableCm, weightShare(pallet.weightKg, spec)));
    const full = (!!only && only.perPallet > 0 && cartons >= only.perPallet) || fill >= 0.995;
    const run = rows.at(-1);
    if (full && only && run?.full && run.parts.length === 1 && run.parts[0].productId === only.productId
        && run.cartons === cartons && run.heightCm === pallet.heightCm && run.weightKg === pallet.weightKg) {
      run.to = index + 1;
      run.label = `${word} ${run.from}–${run.to}`;
      return;
    }
    rows.push({
      index, from: index + 1, to: index + 1, label: `${word} ${index + 1}`, contents: contents(parts), parts, cartons,
      heightCm: pallet.heightCm, measured: false, weightKg: pallet.weightKg, fill: full ? 1 : fill, full,
      over: false, heavy: false, status: full ? 'vol' : 'pct',
      blocks: glyphBlocks(pallet.items, byId, pallet.heightCm, spec, (item) => item.layers),
      type: null, typeNote: null,
    });
  });
  return rows;
}

/** An older server's automatic count, laid out the way "Zelf indelen" copies it: per product, its full pallets, then the rest. */
export function autoPallets(lines: readonly PlannerLine[], spec: PlannerSpec): PalletVm[] {
  const rows: PalletVm[] = [];
  const word = carrierWords(spec.profile).label;
  let next = 0;
  for (const line of lines) {
    if (line.problem || line.perPallet <= 0 || line.cartons <= 0) continue;
    const h = line.cartonHeightCm;
    const full = Math.floor(line.cartons / line.perPallet);
    const rest = line.cartons % line.perPallet;
    const part = (cartons: number): PalletPart =>
      ({ productId: line.productId, name: line.name, colour: line.colour, photoUrl: line.photoUrl, cartons });
    const row = (from: number, to: number, cartons: number, layers: number, isFull: boolean): PalletVm => {
      const heightCm = h === null ? null : spec.baseHeightCm + h * layers;
      const weightKg = cartons * line.cartonWeightKg;
      const fill = isFull ? 1 : Math.min(1, Math.max(h === null ? cartons / line.perPallet : (h * layers) / spec.usableCm,
        weightShare(weightKg, spec)));
      const parts = [part(cartons)];
      return {
        index: from - 1, from, to, label: from === to ? `${word} ${from}` : `${word} ${from}–${to}`,
        contents: line.name, parts, cartons, heightCm, measured: false, weightKg, fill, full: isFull,
        over: false, heavy: false, status: isFull ? 'vol' : 'pct', blocks: h === null ? [] : [block(line, layers, spec)],
        type: null, typeNote: null,
      };
    };
    if (full > 0) rows.push(row(next + 1, next + full, line.perPallet, line.fullLayers, true));
    next += full;
    if (rest > 0) rows.push(row(next + 1, next + 1, rest, Math.ceil(rest / Math.max(1, line.perLayer)), false));
    if (rest > 0) next += 1;
  }
  return rows;
}

/** Pallets in a list of rows, a run counting every pallet in it. */
export function palletCount(rows: readonly PalletVm[]): number {
  return rows.reduce((sum, row) => sum + row.to - row.from + 1, 0);
}

function typeNote(type: string, profile: PalletProfile): string | null {
  const normal = normalizeManualPalletType(type);
  if (!normal || normal === palletTypeLabel(profile)) return null;
  return carrierTypes(profile).find((choice) => choice.value === normal)?.short ?? normal;
}

/** A product's omdoos as the packer reads it: the catalogue's sizes, its weight or the line's; null without sizes. */
export function handCarton(productId: number, products: ReadonlyMap<number, Product> | undefined,
  line: PlannerLine | undefined): HandCarton | null {
  const carton = products?.get(productId)?.carton;
  if (!carton?.lengthCm || !carton.widthCm || !carton.heightCm) return null;
  const weightKg = carton.weightKg && carton.weightKg > 0 ? carton.weightKg : line?.cartonWeightKg ?? 0;
  return { lengthCm: carton.lengthCm, widthCm: carton.widthCm, heightCm: carton.heightCm, weightKg };
}

/**
 * The hand-built pallets with their measured or estimated height and their weight. On a PACKED document (2026-11-25), a
 * pallet of the order's own type that carries what one of the server's pallets carries stands as high as the server
 * counted it (what Zelf indelen copied); one that holds no more of any product than the pallet Zelf indelen copied it
 * from (its source, the copy-time run loaded again) stands as that part of it; any other is judged as the server would
 * load it (handLoader: with the pallets after it, alone, or with omdozen a lowered quantity took off). Otherwise, on any
 * other document or pallet type, or without the catalogue, every product stands in whole layers of its own, added up:
 * the way MIXED and STRICT count. Every load here stands on the document's load floor (packDeck(spec): the floor plus
 * the spill the server counted with), as the server's count does; a pallet copied while the document counted with a
 * smaller spill is loaded on the floor of that copy, which lies inside today's (copiedLoader), and while it still
 * carries exactly what was copied it stands as it was copied, before any try on today's deck (copiedOnSmallerFloor).
 */
export function handPallets(view: SalesOrderView, lines: readonly PlannerLine[], spec: PlannerSpec,
  products?: ReadonlyMap<number, Product>): PalletVm[] {
  const byId = new Map(lines.map((line) => [line.productId, line]));
  const priced = new Set(view.priced.lines.map((line) => line.productId));
  const pallets = view.order.pallets;
  const word = carrierWords(spec.profile).label;
  const packedDoc = view.priced.totals.palletRule === 'PACKED';
  const server = packedDoc ? view.priced.totals.autoPallets ?? [] : [];
  const own = (index: number) => typeNote(pallets[index].type, spec.profile) === null;
  const cartonOf = (productId: number) => handCarton(productId, products, byId.get(productId));
  const order = lines.map((line) => line.productId);
  const loadOf = packedDoc && products?.size
    ? handLoader(pallets.map((pallet) => pallet.items), order, cartonOf, packDeck(spec), ALL_SIDES, own)
    : null;
  const copiedOf = packedDoc && products?.size ? copiedLoader(spec, cartonOf, packDeck(spec), ALL_SIDES) : null;
  const serverLoadOf = packedDoc && products?.size && server.length
    ? handLoader(server.map((pallet) => pallet.items), order, cartonOf, packDeck(spec), ALL_SIDES)
    : null;
  const layersOf = (item: { productId: number; cartons: number }) => {
    const line = byId.get(item.productId);
    return line && line.perLayer > 0 ? Math.ceil(item.cartons / line.perLayer) : 0;
  };
  return pallets.map((pallet, index) => {
    const parts = pallet.items.map((item) => {
      const line = byId.get(item.productId);
      return { productId: item.productId, name: line?.name ?? 'Verwijderd product', colour: line?.colour ?? 'var(--muted-2)',
        photoUrl: line?.photoUrl ?? null, cartons: item.cartons };
    });
    const layered = estimatePalletHeightCm(pallet, view.priced.lines, spec.baseHeightCm);
    let packedCm: number | null = null;
    if (packedDoc && !layered.measured && own(index) && pallet.items.length) {
      const same = server[index] && sameItems(server[index].items, pallet.items) ? server[index]
        : server.find((candidate) => sameItems(candidate.items, pallet.items));
      /* Copied on a smaller floor than the document counts on now and still carrying exactly that: as it was copied. */
      const kept = !same && copiedOf && copiedOnSmallerFloor(pallet.source, pallet.items, specSpillCm(spec)) ? copiedOf(pallet.source) : null;
      const load = same || kept || !loadOf ? null : loadOf(index);
      /* Copied by Zelf indelen and holding no more of any product than then: that part of the copied pallet, at most as
         high (after the tries above, which load it fully carried where they can). */
      const copied = same || kept || load || !copiedOf ? null : copiedOf(pallet.source);
      const part = copied ? partOf(copied, pallet.items, cartonOf) : null;
      packedCm = same ? same.heightCm : kept ? spec.baseHeightCm + kept.top / 100 : load ? spec.baseHeightCm + load.top / 100
        : part ? spec.baseHeightCm + part.top / 100 : null;
      /* No more of any product than a server pallet carries: it fits as that part of the server's pallet, at most as high. */
      if (packedCm === null) {
        const holder = server.findIndex((candidate) => within(pallet.items, candidate.items));
        if (holder >= 0) {
          const whole = serverLoadOf ? serverLoadOf(holder) : null;
          const part = whole ? partOf(whole, pallet.items, cartonOf) : null;
          packedCm = part ? Math.min(server[holder].heightCm, spec.baseHeightCm + part.top / 100) : server[holder].heightCm;
        }
      }
    }
    const stack = packedCm === null ? layered : { heightCm: Math.round(packedCm * 10) / 10, measured: false };
    const weightKg = pallet.items.reduce((sum, item) => sum + Math.max(0, item.cartons) * (byId.get(item.productId)?.cartonWeightKg ?? 0), 0);
    const fill = Math.min(1, Math.max(stack.heightCm === null ? 0 : (stack.heightCm - spec.baseHeightCm) / spec.usableCm,
      weightShare(weightKg, spec)));
    const only = pallet.items.length === 1 ? byId.get(pallet.items[0].productId) : undefined;
    const over = stack.heightCm !== null && stack.heightCm > spec.maxHeightCm + 1e-6;
    /* At the server's 0.1 kg: a carton here is the line's rounded weight over its omdozen, so a pallet it filled to 700 kg may read 700.04. */
    const heavy = Math.round(weightKg * 10) / 10 > spec.maxWeightKg;
    /* Past the height or the weight is not full but too much. */
    const full = !over && !heavy && ((!!only && only.perPallet > 0 && pallet.items[0].cartons >= only.perPallet) || fill >= 0.995);
    const broken = pallet.items.some((item) => item.cartons <= 0 || !priced.has(item.productId))
      || (stack.measured && stack.heightCm !== null && (stack.heightCm < spec.baseHeightCm || over));
    const status: PalletStatus = broken ? 'nakijken' : over ? 'te hoog' : heavy ? 'te zwaar'
      : !pallet.items.length ? 'leeg' : full ? 'vol' : 'pct';
    return {
      index, from: index + 1, to: index + 1, label: pallet.label.trim() || `${word} ${index + 1}`, contents: contents(parts),
      parts, cartons: pallet.items.reduce((sum, item) => sum + item.cartons, 0),
      heightCm: stack.heightCm, measured: stack.measured, weightKg, fill, full, over, heavy, status,
      blocks: packedDoc ? glyphBlocks(pallet.items, byId, stack.heightCm, spec, layersOf) : pallet.items.map((item) => block(byId.get(item.productId), layersOf(item), spec)),
      type: normalizeManualPalletType(pallet.type), typeNote: typeNote(pallet.type, spec.profile),
    };
  });
}

/** Where a product's omdozen stand on the hand-built pallets. */
export interface Placement { placed: number; remaining: number; over: number }

export function placements(order: SalesOrder, lines: readonly PlannerLine[]): Map<number, Placement> {
  const placed = new Map<number, number>();
  for (const item of order.pallets.flatMap((pallet) => pallet.items)) {
    placed.set(item.productId, (placed.get(item.productId) ?? 0) + item.cartons);
  }
  return new Map(lines.map((line) => {
    const count = placed.get(line.productId) ?? 0;
    return [line.productId, { placed: count, remaining: Math.max(0, line.cartons - count), over: Math.max(0, count - line.cartons) }];
  }));
}

/** "vol", "72 % vol" for one pallet; "alle vol" or "2 vol" for more. */
export function fillWords(rows: readonly PalletVm[]): string {
  const total = palletCount(rows);
  if (!total) return '';
  if (total === 1) return rows[0].full ? 'vol' : rows[0].parts.length ? `${Math.round(rows[0].fill * 100)} % vol` : '';
  const full = rows.filter((row) => row.full).reduce((sum, row) => sum + row.to - row.from + 1, 0);
  return full === total ? 'alle vol' : full ? `${full} vol` : '';
}

export interface MixedLayout {
  count: number;
  saving: number;
  pallets: OrderPallet[];
  /** The glyph of the pallet that mixes the most. */
  blocks: GlyphBlock[];
}

/** The products that fit a pallet, as Palletberekening plans them; null when a layer's height is unknown (an older server). */
function planLines(lines: readonly PlannerLine[], spec: PlannerSpec): PlanLine[] | null {
  const fitting = lines.filter((line) => !line.problem && line.perPallet > 0 && line.cartons > 0);
  if (fitting.some((line) => line.cartonHeightCm === null)) return null;
  return fitting.map((line) => ({
    key: line.productId, cartons: line.cartons, cartonHeightCm: line.cartonHeightCm!, cartonWeightKg: line.cartonWeightKg,
    fit: { perLayer: line.perLayer, layers: line.fullLayers, cartonsPerPallet: line.perPallet,
      heightCm: spec.baseHeightCm + line.cartonHeightCm! * line.fullLayers, limitedBy: null, problem: null,
      upCm: line.cartonHeightCm!, up: 'h' },
  }));
}

/**
 * Palletberekening's mix for these products (planPallets: whole layers of
 * one product, tallest first, under the height and 700 kg), offered only
 * when it needs fewer pallets than the automatic count. A server that does
 * not say how high a layer is gets no offer.
 */
export function mixedLayout(lines: readonly PlannerLine[], spec: PlannerSpec, autoCount: number): MixedLayout | null {
  const plan = planLines(lines, spec);
  if (!plan || plan.length < 2 || separatePallets(plan) > MAX_PLANNED_PALLETS) return null;
  const planned = planPallets(plan, spec);
  if (!planned.length || planned.length >= autoCount) return null;
  const byId = new Map(lines.map((line) => [line.productId, line]));
  const widest = planned.reduce((best, pallet) => (pallet.parts.length > best.parts.length ? pallet : best), planned[0]);
  const type = palletTypeLabel(spec.profile);
  const word = carrierWords(spec.profile).label;
  return {
    count: planned.length,
    saving: autoCount - planned.length,
    pallets: planned.map((pallet, index) => ({
      id: null, label: `${word} ${index + 1}`, type, heightCm: null,
      items: pallet.parts.map((part) => ({ productId: part.key, cartons: part.cartons })),
    })),
    blocks: widest.parts.map((part) => block(byId.get(part.key), part.layers, spec)),
  };
}

/** Every room hint is a re-plan per product: beyond this many pallets there are none (Palletberekening's bound). */
const ROOM_PLAN_LIMIT = 30;

/**
 * Under the mixed rule, how many more omdozen of each product still go on
 * the same pallets: Palletberekening's roomWithoutExtraPallet on this
 * screen's plan, and only while that plan gives the server's count, so a
 * hint never promises room the pallets on screen do not have.
 */
export function mixedRoom(lines: readonly PlannerLine[], spec: PlannerSpec, count: number): Map<number, number> {
  const plan = planLines(lines, spec);
  if (!plan?.length || count <= 0 || count > ROOM_PLAN_LIMIT || planPallets(plan, spec).length !== count) return new Map();
  return new Map(plan.map((line) => [line.key, roomWithoutExtraPallet(plan, line.key, spec, count)]));
}

/** What still keeps a hand layout from being complete. */
export interface LayoutCheck {
  empty: boolean;
  /** An item without omdozen, or a product that is no longer in the order. */
  broken: boolean;
  /** A measured height outside the wood and the maximum. */
  measuredOut: boolean;
  tooHigh: boolean;
  tooHeavy: boolean;
  over: boolean;
  /** Omdozen on no pallet. */
  loose: number;
  /** Of those, the ones of products that fit a pallet: what laying out again can place. */
  looseFitting: number;
}

/** With the catalogue a hand pallet's height is judged as its omdozen go on it as full as they go (handPallets). */
export function checkLayout(view: SalesOrderView, products?: ReadonlyMap<number, Product>): LayoutCheck {
  const spec = plannerSpec(view);
  const lines = plannerLines(view, spec);
  const rows = handPallets(view, lines, spec, products);
  const placement = placements(view.order, lines);
  const placed = [...placement.values()];
  const priced = new Set(view.priced.lines.map((line) => line.productId));
  return {
    empty: rows.some((row) => !row.parts.length),
    broken: view.order.pallets.some((pallet) => pallet.items.some((item) => item.cartons <= 0 || !priced.has(item.productId))),
    measuredOut: rows.some((row) => row.measured && row.heightCm !== null
      && (row.heightCm < spec.baseHeightCm || row.heightCm > spec.maxHeightCm)),
    tooHigh: rows.some((row) => !row.measured && row.over),
    tooHeavy: rows.some((row) => row.heavy),
    over: placed.some((entry) => entry.over > 0)
      || view.order.pallets.some((pallet) => pallet.items.some((item) => !lines.some((line) => line.productId === item.productId)
        && priced.has(item.productId) && item.cartons > 0)),
    loose: placed.reduce((sum, entry) => sum + entry.remaining, 0),
    looseFitting: lines.filter((line) => line.perPallet > 0).reduce((sum, line) => sum + (placement.get(line.productId)?.remaining ?? 0), 0),
  };
}

export function layoutComplete(check: LayoutCheck): boolean {
  return !check.empty && !check.broken && !check.measuredOut && !check.tooHigh && !check.tooHeavy && !check.over && !check.loose;
}

/** The one pill a hand layout gets: what to look at first ("lege kar" on the kar). */
export function layoutPill(check: LayoutCheck, words: CarrierWords = CARRIER_WORDS.pallet): { text: string; tone: 'ok' | 'warn' | 'danger' } {
  if (check.empty) return { text: `lege ${words.one}`, tone: 'warn' };
  if (check.broken) return { text: 'nakijken', tone: 'danger' };
  if (check.measuredOut || check.tooHigh) return { text: 'te hoog', tone: 'danger' };
  if (check.tooHeavy) return { text: 'te zwaar', tone: 'danger' };
  if (check.over) return { text: 'te veel', tone: 'danger' };
  if (check.loose) return { text: `${check.loose.toLocaleString('nl-BE')} los`, tone: 'warn' };
  return { text: 'compleet', tone: 'ok' };
}

/** The freight basis an order uses, the stored one or the legacy default; a kar's is a fixed amount by hand. */
export function freightStrategy(order: SalesOrder): FreightPricingStrategy {
  if (order.freightPricingStrategy) return order.freightPricingStrategy;
  if (order.manualFreightEur != null || isKarOrder(order)) return 'FIXED';
  return order.loadMode === 'LOOSE_CARTONS' ? 'PER_CBM' : 'COUNTRY_PALLET';
}

export function strategyLabel(strategy: FreightPricingStrategy, carriers: readonly Carrier[], carrierId: number | null | undefined): string {
  switch (strategy) {
    case 'COUNTRY_PALLET': return 'Landentarief';
    case 'CARRIER': return carriers.find((carrier) => carrier.id === carrierId)?.name ?? 'Verzendorganisatie';
    case 'PER_CBM': return 'Per m³';
    case 'FIXED': return 'Vast bedrag';
    case 'PICKUP': return 'Afhalen';
    default: return strategy;
  }
}

/** What a freight basis still lacks before it can price; null when it can. */
export function freightGap(order: SalesOrder): string | null {
  if (order.freight === 'TE_BEPALEN') return null;
  const strategy = freightStrategy(order);
  if (strategy === 'PER_CBM' && !((order.freightRatePerCbmEur ?? 0) > 0)) return 'Vul het tarief per m³ in';
  if (strategy === 'FIXED' && order.manualFreightEur == null) return 'Vul het vaste bedrag in';
  if (strategy === 'COUNTRY_PALLET' && order.loadMode === 'LOOSE_CARTONS') return 'Kies Per m³ of Vast bedrag';
  /* Landentarief and the staffels count pallets (Euro, Blok, Half): never a kar's freight. */
  if ((strategy === 'COUNTRY_PALLET' || strategy === 'CARRIER') && isKarOrder(order) && order.loadMode !== 'LOOSE_CARTONS') {
    return 'Kies Vast bedrag voor karren';
  }
  return null;
}
