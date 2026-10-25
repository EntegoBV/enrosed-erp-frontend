/**
 * One product, several suppliers (2026-10-25): the pure rules the product
 * editor and the product page share. Only `import type` from src, so node
 * tests load it directly; money text comes in as an argument.
 */
import type { Currency, Product } from '../../core/api/models';
import type {
  ProductPurchaseFieldsPut, ProductPurchaseMirror, ProductSupplierNoteWrite, ProductSupplierRow, ProductSupplierWrite,
  ReceiptIssueSupplierPart,
} from '../../core/api/product-supplier-models';

export type SupplierRowsState = 'loading' | 'ready' | 'error';
/** 'new' and 'legacy' show today's EXW/Munt/Extra fields and the supplier select and send their values;
    'loading' shows a skeleton and sends values too; 'rows' shows the list and leaves the values to the rows. */
export type PurchaseMode = 'new' | 'loading' | 'legacy' | 'rows';

const COUNT = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });

/** A finite number, else null (an emptied number input reads as null or NaN). */
function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Trimmed text, '' as null. */
function textOrNull(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text ? text : null;
}

export function purchaseMode(productId: number | null, state: SupplierRowsState, rowCount: number,
                             supplierId: number | null): PurchaseMode {
  if (productId === null) return 'new';
  if (state === 'loading') return 'loading';
  if (state === 'error') return 'legacy';
  if (rowCount === 0 && supplierId != null) return 'legacy';
  return 'rows';
}

/** 'rows' -> four nulls (the server keeps the values the rows wrote); every other mode -> the product's own four values. */
export function purchaseFieldsForPut(mode: PurchaseMode,
  product: Pick<Product, 'supplierId' | 'exwPrice' | 'exwCurrency' | 'extraUnitCost'>): ProductPurchaseFieldsPut {
  if (mode === 'rows') return { supplierId: null, exwPrice: null, exwCurrency: null, extraUnitCost: null };
  return {
    supplierId: product.supplierId,
    exwPrice: product.exwPrice,
    exwCurrency: product.exwCurrency,
    extraUnitCost: product.extraUnitCost,
  };
}

/** The editor's "Nog invullen" entry for the supplier, or null when nothing is missing. */
export function supplierMissing(mode: PurchaseMode, rowCount: number, supplierId: number | null):
  { tab: string; field: string; label: string } | null {
  if (mode === 'rows' && rowCount === 0) return { tab: 'purchasing', field: 'ps-add', label: 'minstens één leverancier' };
  if (!supplierId) return { tab: 'identity', field: 'p-supplier', label: 'leverancier' };
  return null;
}

/** Preferred first, then active, then by supplier name (nl). A new array. */
export function sortSupplierRows<T extends ProductSupplierRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    Number(b.preferred) - Number(a.preferred)
    || Number(b.active) - Number(a.active)
    || a.supplierName.localeCompare(b.supplierName, 'nl', { sensitivity: 'base' })
    || a.id - b.id);
}

/** "Versie B · ref PB-1530 · MOQ 600 · 45 dagen": only the parts present; '' when none. */
export function supplierRowMeta(row: ProductSupplierRow): string {
  const parts: string[] = [];
  const label = textOrNull(row.versionLabel);
  const reference = textOrNull(row.supplierReference);
  const moq = numberOrNull(row.moq);
  const days = numberOrNull(row.leadTimeDays);
  if (label) parts.push(`Versie ${label}`);
  if (reference) parts.push(`ref ${reference}`);
  if (moq !== null) parts.push(`MOQ ${COUNT.format(moq)}`);
  if (days !== null) parts.push(`${COUNT.format(days)} ${days === 1 ? 'dag' : 'dagen'}`);
  return parts.join(' · ');
}

/** "laatst PO-2026-005 · kostprijs € 8,32", "laatst PO-2026-005", "kostprijs € 8,32" or "nog niet besteld". */
export function supplierRowHistory(row: ProductSupplierRow, eur: (n: number) => string): string {
  const parts: string[] = [];
  if (row.lastOrder) parts.push(`laatst ${row.lastOrder.number}`);
  if (row.lastCost) parts.push(`kostprijs ${eur(row.lastCost.unitEur)}`);
  return parts.length ? parts.join(' · ') : 'nog niet besteld';
}

/** Active rows other than the Voorkeur: the "+{n}" next to the supplier's name. */
export function otherActiveCount(rows: readonly ProductSupplierRow[]): number {
  return rows.filter((row) => row.active && !row.preferred).length;
}

/** Only a row no purchase line names (trashed containers included), and never the Voorkeur. */
export function canDeleteRow(row: ProductSupplierRow): boolean {
  return !row.preferred && row.purchaseLineCount === 0;
}

export function canDeactivate(row: ProductSupplierRow): boolean {
  return row.active && !row.preferred;
}

export function canMakePreferred(row: ProductSupplierRow): boolean {
  return row.active && !row.preferred;
}

export interface SupplierRowForm { supplierId: number | null; versionLabel: string; supplierReference: string;
  exwPrice: number | null; exwCurrency: Currency | null; extraUnitCost: number | null; moq: number | null; leadTimeDays: number | null; }

/** An empty sheet; a chosen supplier brings its currency. */
export function blankRowForm(supplier: { id: number | null; currency: Currency } | null): SupplierRowForm {
  return {
    supplierId: supplier?.id ?? null,
    versionLabel: '',
    supplierReference: '',
    exwPrice: null,
    exwCurrency: supplier?.currency ?? null,
    extraUnitCost: null,
    moq: null,
    leadTimeDays: null,
  };
}

export function rowFormOf(row: ProductSupplierRow): SupplierRowForm {
  return {
    supplierId: row.supplierId,
    versionLabel: row.versionLabel ?? '',
    supplierReference: row.supplierReference ?? '',
    exwPrice: row.exwPrice,
    exwCurrency: row.exwCurrency,
    extraUnitCost: row.extraUnitCost,
    moq: row.moq,
    leadTimeDays: row.leadTimeDays,
  };
}

/** The server's refusals (suppliers §2.3), checked first so the sheet answers without a round trip; null when fine. */
export function rowFormError(form: SupplierRowForm, adding: boolean): string | null {
  const price = numberOrNull(form.exwPrice);
  const extra = numberOrNull(form.extraUnitCost);
  const moq = numberOrNull(form.moq);
  const days = numberOrNull(form.leadTimeDays);
  if (adding && form.supplierId == null) return 'Kies een leverancier';
  if (price === null) return 'Vul de EXW-prijs in';
  if (price < 0) return 'EXW-prijs kan niet negatief zijn';
  if (!form.exwCurrency) return 'Kies de munt';
  if (extra !== null && extra < 0) return 'Extra kost kan niet negatief zijn';
  if (moq !== null && moq < 1) return 'MOQ moet minstens 1 stuk zijn';
  if (days !== null && days < 0) return 'Levertijd kan niet negatief zijn';
  if ((form.versionLabel ?? '').trim().length > 60) return 'Versie mag maximaal 60 tekens hebben';
  if ((form.supplierReference ?? '').trim().length > 120) return 'Referentie mag maximaal 120 tekens hebben';
  return null;
}

/** The POST (row null: with supplierId) or PUT body (with the row's updatedAt as loaded); texts trimmed, '' → null. */
export function rowWrite(form: SupplierRowForm, row: ProductSupplierRow | null): ProductSupplierWrite {
  const body: ProductSupplierWrite = {
    versionLabel: textOrNull(form.versionLabel),
    supplierReference: textOrNull(form.supplierReference),
    exwPrice: numberOrNull(form.exwPrice),
    exwCurrency: form.exwCurrency ?? null,
    extraUnitCost: numberOrNull(form.extraUnitCost),
    moq: numberOrNull(form.moq),
    leadTimeDays: numberOrNull(form.leadTimeDays),
  };
  if (row) return { ...body, updatedAt: row.updatedAt };
  return form.supplierId == null ? body : { supplierId: form.supplierId, ...body };
}

/** The note PUT of one row: null or blank clears (''), the row's updatedAt as loaded. */
export function noteWrite(draft: string | null, row: ProductSupplierRow): ProductSupplierNoteWrite {
  const text = draft ?? '';
  return { supplierNote: text.trim() ? text : '', updatedAt: row.updatedAt };
}

/** The product's five mirrored fields after a row change; a null currency reads USD (Product.exwCurrency is non-null). */
export function mirrorPatch(mirror: ProductPurchaseMirror): Partial<Product> {
  return {
    supplierId: mirror.supplierId,
    supplierNote: mirror.supplierNote,
    exwPrice: mirror.exwPrice,
    exwCurrency: mirror.exwCurrency ?? 'USD',
    extraUnitCost: mirror.extraUnitCost,
  };
}

export interface SupplierChoice { id: number; label: string; }

/** The Afspraken supplier choice, keyed by supplier id: preferred first; "{naam}", inactive "{naam} · inactief". */
export function agreementSupplierChoices(rows: readonly ProductSupplierRow[]): SupplierChoice[] {
  return sortSupplierRows(rows).map((row) => ({
    id: row.supplierId,
    label: row.active ? row.supplierName : `${row.supplierName} · inactief`,
  }));
}

/** The supplier of an earlier receipt issue, named only when the product has two or more suppliers. */
export function issueSupplierName(issue: ReceiptIssueSupplierPart, rows: readonly ProductSupplierRow[]): string | null {
  if (rows.length < 2 || issue.supplierId == null) return null;
  return rows.find((row) => row.supplierId === issue.supplierId)?.supplierName ?? null;
}
