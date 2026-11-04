import type {
  Carrier, FreightPricingStrategy, OrderPallet, PalletProfile, SalesOrder, SalesOrderView,
} from '../../core/api/models';
import {
  MAX_PLANNED_PALLETS, PALLET_BASE_HEIGHT_CM, PALLET_CHOICES, PALLET_MAX_HEIGHT_CM, PALLET_MAX_WEIGHT_KG,
  planPallets, separatePallets, type PalletSpec, type PlanLine,
} from './pallet-calculator-model';
import {
  PALLET_PRODUCT_COLOURS, PALLET_TYPES, estimatePalletHeightCm, normalizeManualPalletType, palletTypeLabel,
} from './pallet-stack';
import { salesLineUnavailable } from './sales-line-availability';

/**
 * What the pallet planner shows, worked out from the priced order without
 * Angular: the pallets of the automatic count (every product on pallets of
 * its own, the backend's palletsStrict), the hand-built pallets with their
 * estimated height and weight, the mixed layout Palletberekening would
 * make, and where every omdoos stands. The backend stays the one that
 * counts fits, m³ and freight; this only lays its answer out.
 */

export interface PlannerSpec extends PalletSpec {
  profile: PalletProfile;
  /** "Europallet 120 × 80". */
  name: string;
  /** The loaded height left above the wood. */
  usableCm: number;
}

export function plannerSpec(view: SalesOrderView): PlannerSpec {
  const profile = view.order.palletProfile ?? 'EURO_120X80';
  const choice = PALLET_CHOICES.find((candidate) => candidate.id === profile) ?? PALLET_CHOICES[0];
  const base = view.priced.totals.palletBaseHeightCm ?? PALLET_BASE_HEIGHT_CM;
  const max = view.priced.totals.palletMaxHeightCm ?? view.order.maxPalletHeightCm ?? PALLET_MAX_HEIGHT_CM;
  return {
    profile, name: `${choice.label} ${choice.size}`, lengthCm: choice.lengthCm, widthCm: choice.widthCm,
    baseHeightCm: base, maxHeightCm: max, maxWeightKg: PALLET_MAX_WEIGHT_KG, usableCm: Math.max(1, max - base),
  };
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
  /** Pallets of its own (the automatic count). */
  pallets: number;
  /** Omdozen that still go on its last pallet. */
  room: number;
  /** Why it fits no pallet, in Palletberekening's words; null when it fits. */
  problem: string | null;
}

const EPSILON = 1e-9;

export function plannerLines(view: SalesOrderView, spec: PlannerSpec): PlannerLine[] {
  const palletised = (view.order.loadMode ?? 'PALLETS') === 'PALLETS';
  const missing = new Set(view.priced.validation.productsWithoutCartonDimensions ?? []);
  return view.priced.lines.flatMap((line, index) => {
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
        : perLayer <= 0 ? 'Omdoos te groot voor deze pallet' : 'Omdoos te hoog of te zwaar';
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

/** One pallet row, or a run of equal full pallets ("Pallet 1–2") of the automatic count. */
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

function weightShare(weightKg: number, spec: PlannerSpec): number {
  return spec.maxWeightKg > 0 ? weightKg / spec.maxWeightKg : 0;
}

/** The automatic count, laid out the way "Zelf indelen" copies it: per product, its full pallets, then the rest. */
export function autoPallets(lines: readonly PlannerLine[], spec: PlannerSpec): PalletVm[] {
  const rows: PalletVm[] = [];
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
        index: from - 1, from, to, label: from === to ? `Pallet ${from}` : `Pallet ${from}–${to}`,
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
  return PALLET_TYPES.find((choice) => choice.value === normal)?.short ?? normal;
}

/** The hand-built pallets with their estimated (or measured) height and their weight. */
export function handPallets(view: SalesOrderView, lines: readonly PlannerLine[], spec: PlannerSpec): PalletVm[] {
  const byId = new Map(lines.map((line) => [line.productId, line]));
  const priced = new Set(view.priced.lines.map((line) => line.productId));
  return view.order.pallets.map((pallet, index) => {
    const parts = pallet.items.map((item) => {
      const line = byId.get(item.productId);
      return { productId: item.productId, name: line?.name ?? 'Verwijderd product', colour: line?.colour ?? 'var(--muted-2)',
        photoUrl: line?.photoUrl ?? null, cartons: item.cartons };
    });
    const stack = estimatePalletHeightCm(pallet, view.priced.lines, spec.baseHeightCm);
    const weightKg = pallet.items.reduce((sum, item) => sum + Math.max(0, item.cartons) * (byId.get(item.productId)?.cartonWeightKg ?? 0), 0);
    const fill = Math.min(1, Math.max(stack.heightCm === null ? 0 : (stack.heightCm - spec.baseHeightCm) / spec.usableCm,
      weightShare(weightKg, spec)));
    const only = pallet.items.length === 1 ? byId.get(pallet.items[0].productId) : undefined;
    const over = stack.heightCm !== null && stack.heightCm > spec.maxHeightCm;
    const heavy = weightKg > spec.maxWeightKg + EPSILON;
    /* Past the height or the weight is not full but too much. */
    const full = !over && !heavy && ((!!only && only.perPallet > 0 && pallet.items[0].cartons >= only.perPallet) || fill >= 0.995);
    const broken = pallet.items.some((item) => item.cartons <= 0 || !priced.has(item.productId))
      || (stack.measured && stack.heightCm !== null && (stack.heightCm < spec.baseHeightCm || over));
    const status: PalletStatus = broken ? 'nakijken' : over ? 'te hoog' : heavy ? 'te zwaar'
      : !pallet.items.length ? 'leeg' : full ? 'vol' : 'pct';
    return {
      index, from: index + 1, to: index + 1, label: pallet.label.trim() || `Pallet ${index + 1}`, contents: contents(parts),
      parts, cartons: pallet.items.reduce((sum, item) => sum + item.cartons, 0),
      heightCm: stack.heightCm, measured: stack.measured, weightKg, fill, full, over, heavy, status,
      blocks: pallet.items.map((item) => {
        const line = byId.get(item.productId);
        return block(line, line && line.perLayer > 0 ? Math.ceil(item.cartons / line.perLayer) : 0, spec);
      }),
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

/**
 * Palletberekening's mix for these products (planPallets: whole layers of
 * one product, tallest first, under the height and 700 kg), offered only
 * when it needs fewer pallets than the automatic count. A server that does
 * not say how high a layer is gets no offer.
 */
export function mixedLayout(lines: readonly PlannerLine[], spec: PlannerSpec, autoCount: number): MixedLayout | null {
  const fitting = lines.filter((line) => !line.problem && line.perPallet > 0 && line.cartons > 0);
  if (fitting.length < 2 || fitting.some((line) => line.cartonHeightCm === null)) return null;
  const plan: PlanLine[] = fitting.map((line) => ({
    key: line.productId, cartons: line.cartons, cartonHeightCm: line.cartonHeightCm!, cartonWeightKg: line.cartonWeightKg,
    fit: { perLayer: line.perLayer, layers: line.fullLayers, cartonsPerPallet: line.perPallet,
      heightCm: spec.baseHeightCm + line.cartonHeightCm! * line.fullLayers, limitedBy: null, problem: null },
  }));
  if (separatePallets(plan) > MAX_PLANNED_PALLETS) return null;
  const planned = planPallets(plan, spec);
  if (!planned.length || planned.length >= autoCount) return null;
  const byId = new Map(fitting.map((line) => [line.productId, line]));
  const widest = planned.reduce((best, pallet) => (pallet.parts.length > best.parts.length ? pallet : best), planned[0]);
  const type = palletTypeLabel(spec.profile);
  return {
    count: planned.length,
    saving: autoCount - planned.length,
    pallets: planned.map((pallet, index) => ({
      id: null, label: `Pallet ${index + 1}`, type, heightCm: null,
      items: pallet.parts.map((part) => ({ productId: part.key, cartons: part.cartons })),
    })),
    blocks: widest.parts.map((part) => block(byId.get(part.key), part.layers, spec)),
  };
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

export function checkLayout(view: SalesOrderView): LayoutCheck {
  const spec = plannerSpec(view);
  const lines = plannerLines(view, spec);
  const rows = handPallets(view, lines, spec);
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

/** The one pill a hand layout gets: what to look at first. */
export function layoutPill(check: LayoutCheck): { text: string; tone: 'ok' | 'warn' | 'danger' } {
  if (check.empty) return { text: 'lege pallet', tone: 'warn' };
  if (check.broken) return { text: 'nakijken', tone: 'danger' };
  if (check.measuredOut || check.tooHigh) return { text: 'te hoog', tone: 'danger' };
  if (check.tooHeavy) return { text: 'te zwaar', tone: 'danger' };
  if (check.over) return { text: 'te veel', tone: 'danger' };
  if (check.loose) return { text: `${check.loose.toLocaleString('nl-BE')} los`, tone: 'warn' };
  return { text: 'compleet', tone: 'ok' };
}

/** The freight basis an order uses, the stored one or the legacy default. */
export function freightStrategy(order: SalesOrder): FreightPricingStrategy {
  if (order.freightPricingStrategy) return order.freightPricingStrategy;
  if (order.manualFreightEur != null) return 'FIXED';
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
  return null;
}
