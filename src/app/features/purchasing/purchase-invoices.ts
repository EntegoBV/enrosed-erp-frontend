import type {
  DocumentKind, Payee, PurchaseDocument, PurchaseInvoice, PurchaseInvoiceFile, PurchaseOrder, PurchaseOrderView, PurchasePayment,
} from '../../core/api/models';
import type { LedgerTerm } from './purchase-payment-ledger';

/*
 * The invoices of a container (round of 2026-10-15): one commercial invoice
 * per container with number, date and amount that every supplier term points
 * to, a second one possible (extra on top), and the inspection paid via the
 * supplier, whose invoice is the supplier's. The server owns the invoices and
 * which payments resolve to each (invoice.paymentIds); this module only words
 * them and mirrors the server's resolution rule for the one label the payment
 * sheet shows before a payment is saved. Pure: type-only imports, node-tested,
 * counts in cents.
 */

const cents = (value: number | null | undefined): number => Math.round((value ?? 0) * 100);
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const eur = (centsValue: number): string => EURO.format(centsValue / 100);
const money = (amount: number, currency: string): string =>
  new Intl.NumberFormat('nl-BE', { style: 'currency', currency }).format(amount);
const payeeOf = (payment: Pick<PurchasePayment, 'payee'>): Payee => payment.payee ?? 'SUPPLIER';

/** The labels the ERP wrote on OTHER invoice files before invoices had their own kind (purchase-transfer-split, 2026-10-12). */
export const LEGACY_INVOICE_LABELS: readonly string[] = ['Factuur', 'Factuur inspectie', 'Factuur transport'];

/**
 * The server knows this round: its views carry `invoices` (an empty list
 * when the container has none). Against an older server every new action
 * (invoices, inspection via the supplier, splitting a payment over bank
 * transactions) stays hidden.
 */
export function paymentRoundOnServer(view: Pick<PurchaseOrderView, 'invoices'> | null | undefined): boolean {
  return !!view && view.invoices !== undefined;
}

/** '20/08/2026' of an ISO day. */
export function dayText(iso: string): string {
  return iso.slice(0, 10).split('-').reverse().join('/');
}

/** An invoice number as the server compares it (trimmed, any case): 'CI-2026-118' and ' ci-2026-118' are the same invoice. */
export function invoiceNumberKey(number: string | null | undefined): string {
  return (number ?? '').trim().toLowerCase();
}

/** The payee's first registered invoice (lowest id): it never changes when a later one is added or redated. */
export function primaryInvoice(invoices: readonly PurchaseInvoice[], payee: Payee): PurchaseInvoice | null {
  return invoices.filter(invoice => invoice.payee === payee).sort((left, right) => left.id - right.id)[0] ?? null;
}

/** The invoices of one payee in registration order, so the primary comes first. */
export function invoicesOf(invoices: readonly PurchaseInvoice[], payee: Payee): PurchaseInvoice[] {
  return invoices.filter(invoice => invoice.payee === payee)
    .sort((left, right) => left.id - right.id);
}

/**
 * The invoices of a payee against its Afspraak, in words: equal, more or less.
 * When the supplier's primary invoice also covers the inspection paid via the
 * supplier and the surplus is exactly the inspection's Afspraak (the order's
 * inspectionCostEur, not the whole SEPARATE stream, which also holds other
 * named costs), it reads 'gelijk aan de afspraak + inspectie'. Null without
 * invoices or without an Afspraak.
 */
export function invoiceComparison(
  invoices: readonly PurchaseInvoice[], payee: Payee, agreedEur: number | null, inspectionAgreedEur: number,
): { text: string; tone: 'ok' | 'warn' | 'neutral'; differenceEur: number } | null {
  const own = invoices.filter(invoice => invoice.payee === payee);
  if (!own.length || agreedEur === null || !Number.isFinite(agreedEur)) return null;
  const total = own.reduce((sum, invoice) => sum + cents(invoice.amountEur), 0);
  const difference = total - cents(agreedEur);
  if (difference === 0) return { text: 'gelijk aan de afspraak', tone: 'ok', differenceEur: 0 };
  const primary = primaryInvoice(invoices, payee);
  if (primary?.coversInspection && cents(inspectionAgreedEur) > 0 && difference === cents(inspectionAgreedEur)) {
    return { text: 'gelijk aan de afspraak + inspectie', tone: 'ok', differenceEur: difference / 100 };
  }
  return difference > 0
    ? { text: `${eur(difference)} meer dan de afspraak`, tone: 'warn', differenceEur: difference / 100 }
    : { text: `${eur(-difference)} minder dan de afspraak`, tone: 'neutral', differenceEur: difference / 100 };
}

/** invoiceComparison of one payee as the ledger holds it (PayeeLedger). */
export function payeeInvoiceComparison(item: { payee: Payee; invoices: readonly PurchaseInvoice[]; agreedEur: number | null; inspectionAgreedEur: number })
  : { text: string; tone: 'ok' | 'warn' | 'neutral'; differenceEur: number } | null {
  return invoiceComparison(item.invoices, item.payee, item.agreedEur, item.inspectionAgreedEur);
}

/**
 * A payment under Inspectie & andere kosten counts as paid via the supplier
 * while the container's flag is on and it sits on the same bank transaction
 * as a supplier payment of this order, or is not on the bank yet. A lab fee
 * paid in its own transfer keeps its own invoice (Emre, 2026-10-15).
 */
export function viaSupplier(
  payment: Pick<PurchasePayment, 'payee' | 'bankStatementLineId'>,
  paymentsOfOrder: readonly Pick<PurchasePayment, 'payee' | 'bankStatementLineId'>[], flag: boolean | null | undefined,
): boolean {
  if (!flag || payeeOf(payment) !== 'SEPARATE') return false;
  const line = payment.bankStatementLineId ?? null;
  return line === null || paymentsOfOrder.some(other => payeeOf(other) === 'SUPPLIER' && other.bankStatementLineId === line);
}

/**
 * 'Rest als inspectie via leverancier' for a transaction larger than a
 * payment, where the server takes it (inspectionRestRefusal, linkForeign): a
 * euro goods payment to the supplier (not the CIF freight term, not a credit
 * offset) of a container with an inspection cost, no inspection noted on the
 * same transfer (`companions`), and the inspection paid via the supplier not
 * yet reaching that cost. A USD/CNY payment takes the bank's euro instead.
 */
export function inspectionRestOffered(
  payment: { payee?: Payee | null; instalmentDue?: string | null; currency?: string | null },
  order: { inspectionCostEur?: number | null; inspectionViaSupplier?: boolean | null },
  paymentsOfOrder: readonly (Pick<PurchasePayment, 'payee' | 'bankStatementLineId'> & { amountEur?: number | null })[],
  companions = 0,
): boolean {
  if (payeeOf(payment) !== 'SUPPLIER' || payment.instalmentDue === 'FREIGHT' || (payment.currency ?? 'EUR') !== 'EUR' || companions > 0) return false;
  const cost = cents(order.inspectionCostEur);
  if (!(cost > 0)) return false;
  const booked = paymentsOfOrder.filter(other => viaSupplier(other, paymentsOfOrder, order.inspectionViaSupplier))
    .reduce((sum, other) => sum + cents(other.amountEur), 0);
  return !(booked > 0 && booked >= cost);
}

/**
 * Which of the payee's payments (a payment in parts once) an invoice covers,
 * from the server's invoice.paymentIds: 'Geldt voor alle betalingen van
 * Leverancier (3)', or 'Geldt voor 2 van 3 betalingen van Leverancier' with
 * 'Toewijzen aan alle betalingen' beside it (Emre, 2026-10-15: one
 * commercial invoice for every part-payment, not one by one).
 */
export function invoiceCoverage(
  invoice: Pick<PurchaseInvoice, 'paymentIds'>, rows: readonly { parts: readonly { id: number }[] }[], payeeLabel: string,
): { covered: number; total: number; all: boolean; text: string } {
  const ids = new Set(invoice.paymentIds ?? []);
  const total = rows.length;
  const covered = rows.filter(row => row.parts.some(part => ids.has(part.id))).length;
  const all = covered === total;
  const text = !total ? `Geldt voor alle betalingen van ${payeeLabel}`
    : all ? `Geldt voor alle betalingen van ${payeeLabel} (${total})` : `Geldt voor ${covered} van ${total} betalingen van ${payeeLabel}`;
  return { covered, total, all, text };
}

/** 'dekt 30% bij bestelling + 70% bij vertrek': the terms the supplier's invoice covers; '' without terms. */
export function invoiceTermsLine(terms: readonly Pick<LedgerTerm, 'label'>[]): string {
  return terms.length ? 'dekt ' + terms.map(term => term.label).join(' + ') : '';
}

/** The kind an invoice file is uploaded as: the supplier's commercial invoice, else a plain invoice. */
export function invoiceDocumentKind(payee: Payee): DocumentKind {
  return payee === 'SUPPLIER' ? 'COMMERCIAL_INVOICE' : 'INVOICE';
}

/** What the payment sheet's 'Factuur' select offers: the payee's own invoices, plus the supplier's for an inspection paid via the supplier. */
export function invoiceCandidates(invoices: readonly PurchaseInvoice[], payee: Payee, via: boolean): PurchaseInvoice[] {
  return [...invoicesOf(invoices, payee), ...(payee === 'SEPARATE' && via ? invoicesOf(invoices, 'SUPPLIER') : [])];
}

/**
 * The server's rule (InvoiceAssignment.resolve), for the sheet's
 * 'Automatisch · {number}' label only: an explicit invoice of this order, the
 * payee's only invoice (two or more: none, kies de factuur), the supplier's
 * primary for an inspection paid via the supplier, else none. Saved payments
 * always read the server's invoice.paymentIds.
 */
export function resolveInvoice(
  payment: { payee: Payee; invoiceId: number | null; bankStatementLineId: number | null },
  invoices: readonly PurchaseInvoice[],
  paymentsOfOrder: readonly Pick<PurchasePayment, 'payee' | 'bankStatementLineId'>[], flag: boolean | null | undefined,
): number | null {
  if (payment.invoiceId != null && invoices.some(invoice => invoice.id === payment.invoiceId)) return payment.invoiceId;
  const own = invoices.filter(invoice => invoice.payee === payment.payee);
  if (own.length === 1) return own[0].id;
  if (own.length > 1) return null;
  if (viaSupplier(payment, paymentsOfOrder, flag)) return primaryInvoice(invoices, 'SUPPLIER')?.id ?? null;
  return null;
}

/** An invoice file, never a payment proof: the invoice kinds (the PI too), a file an invoice points to, or an older OTHER file the ERP labelled 'Factuur …'. */
export function isInvoiceFile(doc: Pick<PurchaseDocument, 'id' | 'kind' | 'label'>, invoices: readonly Pick<PurchaseInvoice, 'documentId'>[]): boolean {
  if (doc.kind === 'COMMERCIAL_INVOICE' || doc.kind === 'PROFORMA_INVOICE' || doc.kind === 'INVOICE') return true;
  if (invoices.some(invoice => invoice.documentId === doc.id)) return true;
  return doc.kind === 'OTHER' && LEGACY_INVOICE_LABELS.includes((doc.label ?? '').trim());
}

/** What an invoice file without data is, in one word: 'Proforma (PI)', else 'Factuurbestand zonder gegevens'. */
export function invoiceFileKind(file: { kind?: DocumentKind | null }): string {
  return file.kind === 'PROFORMA_INVOICE' ? 'Proforma (PI)' : 'Factuurbestand zonder gegevens';
}

/** One invoice file without data on one line: 'Proforma (PI) · PI CULINAN.xlsx', else 'invoice.pdf · zonder gegevens'. */
export function invoiceFileText(file: { kind?: DocumentKind | null; originalFilename: string }): string {
  return file.kind === 'PROFORMA_INVOICE' ? `Proforma (PI) · ${file.originalFilename}` : `${file.originalFilename} · zonder gegevens`;
}

/**
 * What 'Factuur' shows for one payee of a container (the transaction
 * detail, 2026-10-19): its invoices with data (the primary first) and its
 * invoice files without data (a PI too). An inspection paid via the supplier
 * with nothing of its own takes the supplier's (as Te betalen does);
 * `viaSupplier` says so. Without `via` the flag or a supplier invoice that
 * covers the inspection decides; a bank line passes its own answer
 * (viaSupplier above: a lab fee in its own transfer keeps its own invoice).
 * `missing` is 'Nog geen factuur' where an invoice is expected: never for
 * Bijkomende kosten (Transactiekosten, a courier).
 */
export function payeeInvoices(
  view: Pick<PurchaseOrderView, 'invoices' | 'invoiceFiles'> & { order: Pick<PurchaseOrder, 'inspectionViaSupplier'> }, payee: Payee, via?: boolean,
): { invoices: PurchaseInvoice[]; files: PurchaseInvoiceFile[]; viaSupplier: boolean; missing: boolean } {
  const all = view.invoices ?? [];
  const filesOf = (who: Payee) => (view.invoiceFiles ?? []).filter(file => file.payee === who);
  let invoices = invoicesOf(all, payee), files = filesOf(payee), taken = false;
  const fallback = via ?? (!!view.order.inspectionViaSupplier || !!primaryInvoice(all, 'SUPPLIER')?.coversInspection);
  if (payee === 'SEPARATE' && !invoices.length && !files.length && fallback) {
    const supplier = primaryInvoice(all, 'SUPPLIER');
    invoices = supplier ? [supplier] : []; files = supplier ? [] : filesOf('SUPPLIER'); taken = true;
  }
  return { invoices, files, viaSupplier: taken, missing: payee !== 'OTHER' && !invoices.length && !files.length };
}

/** The amount of an invoice: the euro, or the foreign amount with its euro. */
function invoiceMoney(invoice: Pick<PurchaseInvoice, 'amount' | 'currency' | 'amountEur'>): string {
  return invoice.currency === 'EUR' ? eur(cents(invoice.amountEur))
    : `${money(invoice.amount, invoice.currency)} (≈ ${eur(cents(invoice.amountEur))})`;
}

/** 'Factuur CI-2026-118 · 20/08/2026 · € 31.048,04', foreign '… · US$ 36.000,00 (≈ € 31.048,04)'. */
export function invoiceLine(invoice: Pick<PurchaseInvoice, 'number' | 'invoiceDate' | 'amount' | 'currency' | 'amountEur'>): string {
  return `Factuur ${invoice.number} · ${dayText(invoice.invoiceDate)} · ${invoiceMoney(invoice)}`;
}

/** 'CI-2026-118 · 20/08/2026 · € 31.048,04': one option of the payment sheet's select. */
export function invoiceOption(invoice: Pick<PurchaseInvoice, 'number' | 'invoiceDate' | 'amount' | 'currency' | 'amountEur'>): string {
  return `${invoice.number} · ${dayText(invoice.invoiceDate)} · ${invoiceMoney(invoice)}`;
}

/** '20/08/2026 · € 31.048,04 · gelijk aan de afspraak': the sub line of an invoice cell on the phone. */
export function invoiceSub(invoice: Pick<PurchaseInvoice, 'invoiceDate' | 'amount' | 'currency' | 'amountEur'>, comparison: string | null): string {
  return [dayText(invoice.invoiceDate), invoiceMoney(invoice), comparison].filter(Boolean).join(' · ');
}
