import { costQuantity, costWords, otherSideCost, productCostBasis, type OtherSideCost } from '../products/product-cost-basis';
import { containerName } from './container-name';
import { stripColour, variantOf } from './purchase-desk-format';
import { isNewerSource } from './purchase-phone-model';
import type { LandedCostLine, Product, PurchaseOrder } from '../../core/api/models';

/*
 * What "Kostprijzen toepassen" will do, product by product, before it is
 * done: the cost the product carries now and where it came from, the cost
 * this container gives it, and the difference. The server applies every line
 * of the saved calculation except the ones that received nothing; the
 * counts here are the ones the sheet showed, so the toast tells the same.
 * Node-tested through the transpiler (tests/purchase-apply-costs.test.mts).
 */

export type ApplyCostState =
  /** The product had no cost yet. */
  | 'new'
  | 'up'
  | 'down'
  /** Same cost from another source: the value stays, the source becomes this container. */
  | 'same'
  /** Same cost from this very container: nothing changes. */
  | 'unchanged'
  /** The line received nothing; the server leaves the product alone. */
  | 'skipped'
  /** The screen could not load the product, so its cost now and its unit are not known here. */
  | 'unknown';

export interface ApplyCostRow {
  productId: number;
  /** The series name, without its colour. */
  name: string;
  /** "Rood · 30 cm": what tells this variant from the others of its series, which often get the same cost. */
  variant: string | null;
  /** Name and variant in one, for a button's accessible name. */
  label: string;
  /** "500 displays", "2.000 diamanten"; "Aantal 100" for a product the screen could not load. */
  quantity: string;
  /** "per display van 12", "per diamant", "per stuk"; null when the product, so its unit, is not known. */
  per: string | null;
  currentEur: number | null;
  /** This container's name when the cost came from it, else the source the product kept, "handmatig" without one. */
  currentSource: string | null;
  newEur: number;
  /** The new cost on the other side of a display. */
  other: OtherSideCost | null;
  deltaEur: number | null;
  /** Null without a cost before, or with a cost of 0 before. */
  deltaPct: number | null;
  state: ApplyCostState;
  /**
   * The catalogue price when it follows the cost (no fixed sales price) and changes: the price now
   * (null without a cost before) and after applying, by the server's rule (cost + markup).
   */
  catalogue: { fromEur: number | null; toEur: number } | null;
  /**
   * The product carries a newer container's cost. The server keeps that card unless the row is ticked
   * "Ook op de productkaart" (batches round, 2026-10-25); the batch of this container gets the cost anyway.
   */
  newer: boolean;
  /** What this container still has on the shelf for the product, from its batches; null before batches start. */
  leftPieces: { pieces: number; unitPieces: number } | null;
  /** A newer row that is not ticked: applying leaves its product card (and so its catalogue price) as it is. */
  keepsCard: boolean;
  /** The product as the screen knows it, for its history. */
  product: Product | null;
}

export interface ApplyCostsPlan {
  /** An earlier apply of this container landed on its products. */
  again: boolean;
  /** Batches have started: a row that keeps its card still gets the cost on this container's batch. */
  started: boolean;
  rows: ApplyCostRow[];
  /**
   * Products that get this container's cost: every row but the skipped ones. Before batches start, a row
   * that keeps its card gets nothing, so it counts only under `kept`.
   */
  written: number;
  /** Of those, the ones whose cost is known to change (or that get their first one). */
  changed: number;
  /** Of those, the ones that keep the same cost. */
  unchanged: number;
  /** Of those, the ones the screen could not load: their cost now is not known, so neither is whether it changes. */
  unknown: number;
  /** Lines that received nothing. */
  skipped: number;
  /** Rows that carry a newer container's cost now (ApplyCostRow.newer). */
  newer: number;
  /** Of those, the rows whose product card stays (ApplyCostRow.keepsCard). */
  kept: number;
}

const cents4 = (value: number): number => Math.round(value * 10000);
/** Whole cents, half away from zero, after a 4-decimal step so 1,005 does not slip to 1,00. */
const cents = (value: number): number => Math.sign(value) * Math.round(Math.abs(Math.round(value * 10000) / 100));
const round4 = (value: number): number => cents4(value) / 10000;

/**
 * The catalogue price of a cost as Product.calculateSalesPriceEur makes it: cost + markup %,
 * half-up to the cent; a missing markup adds nothing. toFixed keeps 1038,4999… from rounding down.
 */
export function catalogueAt(costEur: number, markupPct: number | null | undefined): number {
  return Math.round(Number((costEur * (100 + (markupPct ?? 0))).toFixed(6))) / 100;
}

/** A positive fixed sales price wins over cost + markup: the catalogue price then ignores the cost. */
function followsCost(product: Product): boolean {
  return !(product.fixedSalesPriceEur != null && product.fixedSalesPriceEur > 0);
}

function catalogueChange(product: Product | null, state: ApplyCostState, currentEur: number | null, newEur: number): ApplyCostRow['catalogue'] {
  if (!product || !followsCost(product) || (state !== 'new' && state !== 'up' && state !== 'down')) return null;
  const toEur = catalogueAt(newEur, product.markupPct);
  /* The price the product page shows now; an older payload without it is worked out the same way. */
  const fromEur = currentEur == null ? null
    : product.computedSalesPriceEur > 0 ? product.computedSalesPriceEur : catalogueAt(currentEur, product.markupPct);
  return fromEur !== null && Math.round(fromEur * 100) === Math.round(toEur * 100) ? null : { fromEur, toEur };
}

type OrderNaming = Pick<PurchaseOrder, 'id' | 'number' | 'alias'>;

/** Did an earlier apply of this order land on its products? Same rule as the editor's costsApplied. */
export function costsAppliedBefore(order: Pick<PurchaseOrder, 'number'>, lines: readonly LandedCostLine[], products: readonly Product[]): boolean {
  const byId = new Map(products.map((product) => [product.id, product]));
  return lines.some((line) => byId.get(line.productId)?.landedCostSource === order.number);
}

/** What a row knows besides the line and the product: the pieces still on the shelf and the ticked newer products. */
export interface ApplyCostRowContext {
  leftPieces?: { pieces: number; unitPieces: number } | null;
  overwrite?: ReadonlySet<number>;
}

export function applyCostRow(order: OrderNaming, line: LandedCostLine, product: Product | null, context: ApplyCostRowContext = {}): ApplyCostRow {
  /* Without the product its unit is not known: no basis words rather than "per stuk" for what may be a display. */
  const basis = product ? productCostBasis(product) : null;
  const currentEur = product?.landedCostEur ?? null;
  const fromHere = product?.landedCostSource != null && product.landedCostSource === order.number;
  const currentSource = !product ? null
    : fromHere ? containerName(order)
      : product.landedCostSource?.trim() || (currentEur != null ? 'handmatig' : null);
  const newEur = line.landedUnitEur;
  let state: ApplyCostState;
  let deltaEur: number | null = null;
  let deltaPct: number | null = null;
  if (line.quantity <= 0) state = 'skipped';
  else if (!product) state = 'unknown';
  else if (currentEur == null) state = 'new';
  else {
    deltaEur = round4(newEur - currentEur);
    if (cents4(newEur) === cents4(currentEur)) {
      deltaEur = 0;
      deltaPct = 0;
      state = fromHere ? 'unchanged' : 'same';
    } else {
      deltaPct = currentEur > 0 ? Math.round((newEur - currentEur) / currentEur * 1000) / 10 : null;
      state = deltaEur > 0 ? 'up' : 'down';
    }
  }
  /* The catalogue name is the series' name; the line's name carries the colour, but not the size. */
  const base = product?.name?.trim();
  const name = base ? stripColour(base, product?.colour) : line.productName;
  const variant = product ? variantOf(product) : null;
  const newer = state !== 'skipped' && !fromHere && isNewerSource(product?.landedCostSource, order.number);
  return {
    productId: line.productId,
    name, variant,
    label: variant ? `${name} · ${variant}` : name,
    quantity: basis ? costQuantity(basis, Math.max(0, line.quantity)) : `Aantal ${Math.max(0, line.quantity).toLocaleString('nl-BE')}`,
    per: basis ? costWords(basis).per : null,
    currentEur, currentSource, newEur,
    other: basis ? otherSideCost(basis, newEur) : null,
    deltaEur, deltaPct, state,
    catalogue: catalogueChange(product, state, currentEur, newEur),
    newer,
    leftPieces: context.leftPieces ?? null,
    keepsCard: newer && !(context.overwrite?.has(line.productId) ?? false),
    product,
  };
}

/** The products of this container that carry an older cost of it (cost-fix Q1). */
export interface CostsStale {
  count: number;
  productIds: number[];
  /** The largest change, signed: above 0 when the container now calculates more than the product carries. */
  largestEur: number;
}

/**
 * Products whose cost came from this very container (their source is its number) but no longer
 * equals its calculation at 4 decimals: the container changed after it was applied. A product
 * sourced from another container is not stale here, and neither is a line that received nothing,
 * which the server never applies.
 */
export function costsStale(orderNumber: string, lines: readonly LandedCostLine[], products: readonly Product[]): CostsStale {
  const byId = new Map(products.map((product) => [product.id, product]));
  const productIds: number[] = [];
  let largestEur = 0;
  for (const line of lines) {
    const product = byId.get(line.productId);
    const current = product?.landedCostEur;
    if (!product || current == null || line.quantity <= 0 || product.landedCostSource !== orderNumber) continue;
    /* The product page's rule: stale when the two figures differ in cents, so both screens agree. */
    if (cents(line.landedUnitEur) === cents(current)) continue;
    productIds.push(line.productId);
    const change = round4(line.landedUnitEur - current);
    if (Math.abs(change) > Math.abs(largestEur)) largestEur = change;
  }
  return { count: productIds.length, productIds, largestEur };
}

/** "▲ € 2,07"; a change under a cent keeps its 4 decimals, so it never reads as € 0,00. */
function signedChange(eur: number): string {
  const digits = Math.abs(eur) < 0.01 ? 4 : 2;
  const amount = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(Math.abs(eur));
  return `${eur > 0 ? '▲' : '▼'} ${amount}`;
}

/**
 * "3 producten dragen een oudere kostprijs van deze container (tot ▲ € 2,07)"; null when none does.
 * `newer` counts the products a newer container sits on, and the line names them ("· 2 met een nieuwere
 * container"). The screens still offer the apply: the server keeps those newer cards unless the sheet's
 * "Ook op de productkaart" is ticked for them (batches round, 2026-10-25).
 */
export function staleNotice(stale: Pick<CostsStale, 'count' | 'largestEur'>, newer = 0): string | null {
  if (stale.count <= 0) return null;
  const text = stale.count === 1
    ? `1 product draagt een oudere kostprijs van deze container (${signedChange(stale.largestEur)})`
    : `${stale.count.toLocaleString('nl-BE')} producten dragen een oudere kostprijs van deze container (tot ${signedChange(stale.largestEur)})`;
  return newer > 0 ? `${text} · ${newer.toLocaleString('nl-BE')} met een nieuwere container` : text;
}

/**
 * The apply sheet's warn line for the rows whose product card stays (they carry a newer container's
 * cost and are not ticked); null without one. With batches started their batch still gets this cost.
 */
export function newerNotice(count: number, started = false): string | null {
  if (count <= 0) return null;
  const head = count === 1 ? '1 product draagt een nieuwere container: zijn productkaart blijft'
    : `${count.toLocaleString('nl-BE')} producten dragen een nieuwere container: hun productkaart blijft`;
  return started ? `${head}, alleen de batch krijgt deze kost.` : `${head}.`;
}

/**
 * The products of these lines that are not among `products`: a placed order
 * keeps a line of another supplier, whose product the supplier's list lacks.
 * Each id once, in line order.
 */
export function missingProductIds(lines: readonly Pick<LandedCostLine, 'productId'>[], products: readonly Pick<Product, 'id'>[]): number[] {
  const known = new Set(products.map((product) => product.id));
  return [...new Set(lines.map((line) => line.productId).filter((id) => !known.has(id)))];
}

type PlanCounts = Pick<ApplyCostsPlan, 'written' | 'changed' | 'unchanged' | 'unknown' | 'skipped' | 'newer' | 'kept'>;

/**
 * The counts the button and the toast use. A row that keeps its card is written only when batches have
 * started (its batch gets the cost); before that the server writes nothing for it, so it counts as kept only.
 */
function planCounts(rows: readonly ApplyCostRow[], started: boolean): PlanCounts {
  const writes = rows.filter((row) => started || !row.keepsCard);
  const count = (...states: ApplyCostState[]): number => writes.filter((row) => states.includes(row.state)).length;
  const skipped = count('skipped');
  return { written: writes.length - skipped, changed: count('new', 'up', 'down'), unchanged: count('same', 'unchanged'),
    unknown: count('unknown'), skipped, newer: rows.filter((row) => row.newer).length, kept: rows.filter((row) => row.keepsCard).length };
}

/**
 * The rows of the saved calculation against the products as they stand. `batches` is what each product
 * still has on the shelf from this container (batchPiecesByProduct); `overwrite` the newer products ticked
 * "Ook op de productkaart"; `started` whether batches have started.
 */
export function applyCostsPlan(order: OrderNaming, lines: readonly LandedCostLine[], products: readonly Product[],
  batches?: ReadonlyMap<number, { pieces: number; unitPieces: number }> | null, overwrite: ReadonlySet<number> = new Set(),
  started = false): ApplyCostsPlan {
  const byId = new Map(products.map((product) => [product.id, product]));
  const rows = lines.map((line) => applyCostRow(order, line, byId.get(line.productId) ?? null,
    { leftPieces: batches?.get(line.productId) ?? null, overwrite }));
  return { again: costsAppliedBefore(order, lines, products), started, rows, ...planCounts(rows, started) };
}

/** The same plan with these newer products ticked "Ook op de productkaart" (the sheet's checkboxes). */
export function withOverwrite(plan: ApplyCostsPlan, overwrite: ReadonlySet<number>): ApplyCostsPlan {
  const rows = plan.rows.map((row) => ({ ...row, keepsCard: row.newer && !overwrite.has(row.productId) }));
  return { ...plan, rows, ...planCounts(rows, plan.started) };
}

/** The request's overwriteNewerProductIds: the newer rows whose card is written after all (ticked), each once. */
export function applyCostsRequest(plan: Pick<ApplyCostsPlan, 'rows'>): number[] {
  return [...new Set(plan.rows.filter((row) => row.newer && !row.keepsCard).map((row) => row.productId))];
}

/** "1 product", "12 producten". */
export function productCount(count: number): string {
  return `${count.toLocaleString('nl-BE')} ${count === 1 ? 'product' : 'producten'}`;
}

/** The sheet's confirm button: "Toepassen (12 producten)", "Opnieuw toepassen (1 product)". */
export function applyCostsButton(plan: Pick<ApplyCostsPlan, 'again' | 'written'>): string {
  return `${plan.again ? 'Opnieuw toepassen' : 'Toepassen'} (${productCount(plan.written)})`;
}

/**
 * The toast after applying, with the counts the sheet showed. Only a row known to change counts as
 * gewijzigd: a product the sheet could not load got the cost too, but whether it changed is not known
 * ("niet vergeleken", as its row said "huidige kostprijs onbekend"). Cards kept beside a newer
 * container are named last; before batches start they are not counted as gewijzigd (planCounts).
 */
export function applyCostsToast(plan: Pick<ApplyCostsPlan, 'changed' | 'unchanged' | 'unknown' | 'skipped'> & { kept?: number }): string {
  const number = (count: number): string => count.toLocaleString('nl-BE');
  const unknown = plan.unknown;
  const rest = [plan.unchanged > 0 ? `${number(plan.unchanged)} ongewijzigd` : null, unknown > 0 ? `${number(unknown)} niet vergeleken` : null]
    .filter((part): part is string => part !== null).join(', ');
  const text = plan.changed > 0 ? `Kostprijs van ${productCount(plan.changed)} gewijzigd${rest ? `, ${rest}` : ''}`
    : unknown > 0 ? `Kostprijs toegepast op ${productCount(plan.unchanged + unknown)}: ${rest}`
      : 'Geen kostprijs gewijzigd';
  const withSkipped = plan.skipped > 0 ? `${text} · ${number(plan.skipped)} overgeslagen (niets ontvangen)` : text;
  const kept = plan.kept ?? 0;
  return kept > 0 ? `${withSkipped} · ${number(kept)} ${kept === 1 ? 'productkaart' : 'productkaarten'} behouden` : withSkipped;
}
