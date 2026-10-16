import { costQuantity, costWords, otherSideCost, productCostBasis, type OtherSideCost } from '../products/product-cost-basis';
import { containerName } from './container-name';
import { stripColour, variantOf } from './purchase-desk-format';
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
  /** The product as the screen knows it, for its history. */
  product: Product | null;
}

export interface ApplyCostsPlan {
  /** An earlier apply of this container landed on its products. */
  again: boolean;
  rows: ApplyCostRow[];
  /** Products that get this container's cost: every row but the skipped ones. */
  written: number;
  /** Of those, the ones whose cost is known to change (or that get their first one). */
  changed: number;
  /** Of those, the ones that keep the same cost. */
  unchanged: number;
  /** Of those, the ones the screen could not load: their cost now is not known, so neither is whether it changes. */
  unknown: number;
  /** Lines that received nothing. */
  skipped: number;
}

const cents4 = (value: number): number => Math.round(value * 10000);
const round4 = (value: number): number => cents4(value) / 10000;

type OrderNaming = Pick<PurchaseOrder, 'id' | 'number' | 'alias'>;

/** Did an earlier apply of this order land on its products? Same rule as the editor's costsApplied. */
export function costsAppliedBefore(order: Pick<PurchaseOrder, 'number'>, lines: readonly LandedCostLine[], products: readonly Product[]): boolean {
  const byId = new Map(products.map((product) => [product.id, product]));
  return lines.some((line) => byId.get(line.productId)?.landedCostSource === order.number);
}

export function applyCostRow(order: OrderNaming, line: LandedCostLine, product: Product | null): ApplyCostRow {
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
  return {
    productId: line.productId,
    name, variant,
    label: variant ? `${name} · ${variant}` : name,
    quantity: basis ? costQuantity(basis, Math.max(0, line.quantity)) : `Aantal ${Math.max(0, line.quantity).toLocaleString('nl-BE')}`,
    per: basis ? costWords(basis).per : null,
    currentEur, currentSource, newEur,
    other: basis ? otherSideCost(basis, newEur) : null,
    deltaEur, deltaPct, state, product,
  };
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

/** The rows of the saved calculation against the products as they stand. */
export function applyCostsPlan(order: OrderNaming, lines: readonly LandedCostLine[], products: readonly Product[]): ApplyCostsPlan {
  const byId = new Map(products.map((product) => [product.id, product]));
  const rows = lines.map((line) => applyCostRow(order, line, byId.get(line.productId) ?? null));
  const count = (...states: ApplyCostState[]): number => rows.filter((row) => states.includes(row.state)).length;
  const skipped = count('skipped');
  return { again: costsAppliedBefore(order, lines, products), rows, written: rows.length - skipped,
    changed: count('new', 'up', 'down'), unchanged: count('same', 'unchanged'), unknown: count('unknown'), skipped };
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
 * ("niet vergeleken", as its row said "huidige kostprijs onbekend").
 */
export function applyCostsToast(plan: Pick<ApplyCostsPlan, 'changed' | 'unchanged' | 'unknown' | 'skipped'>): string {
  const number = (count: number): string => count.toLocaleString('nl-BE');
  const unknown = plan.unknown;
  const rest = [plan.unchanged > 0 ? `${number(plan.unchanged)} ongewijzigd` : null, unknown > 0 ? `${number(unknown)} niet vergeleken` : null]
    .filter((part): part is string => part !== null).join(', ');
  const text = plan.changed > 0 ? `Kostprijs van ${productCount(plan.changed)} gewijzigd${rest ? `, ${rest}` : ''}`
    : unknown > 0 ? `Kostprijs toegepast op ${productCount(plan.unchanged + unknown)}: ${rest}`
      : 'Geen kostprijs gewijzigd';
  return plan.skipped > 0 ? `${text} · ${number(plan.skipped)} overgeslagen (niets ontvangen)` : text;
}
