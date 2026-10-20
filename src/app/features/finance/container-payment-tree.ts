import { paymentOriginLabel } from '../purchasing/purchase-payment-origin';
import type {
  Instalment, Payee, PurchaseInvoice, PurchaseOrderView, PurchasePaymentRow, PurchaseReconciliationStream,
} from '../../core/api/models';
import { invoiceComparison, invoiceCoverage, invoiceFileText, invoiceLine, primaryInvoice } from '../purchasing/purchase-invoices';

/*
 * One container in Kosten & bank as invoices → terms → payments (round of
 * 2026-10-15): per payee stream its invoices against the Afspraak, the
 * invoice files that have no data yet, the supplier's terms under its
 * primary invoice with the payments of each term, and every payment with
 * where it stands on the bank. A payment paid in parts is one node with its
 * transfers. Pure apart from the invoice words of purchase-invoices.ts
 * (tests/container-payment-tree.test.mts hands those in).
 */

type Due = Instalment['due'];

export interface PaymentNode {
  id: number;
  /** The newest transfer's day (one rule with Betalingen and the payment sheet). */
  paidOn: string;
  /** A payment paid in parts: its first transfer's day ('eerste 10/09'); null for a payment never split. */
  firstPaidOn: string | null;
  label: string;
  amountEur: number;
  /** 'op de bank · KBC · 14 okt', 'niet op de bank', 'verrekend tegoed', 'via leverancier · zelfde transactie'; '' for a group (its parts say it). */
  bank: string;
  /** The bank line the payment is on (a hard link), for 'op de bank … ›' (line=); null without one. */
  lineId: number | null;
  /** 'aangepast aan de bank (was € 12.480,00 op 13/10)' once the payment followed a transaction (2026-10-16). */
  adjusted: string | null;
  /** 'zelfde transactie als PO-2026-044 en PO-2026-045': one transfer that paid several containers. */
  sharedWith: string | null;
  /** The transfers of a payment paid in parts, by day; empty for a payment never split. */
  parts: { id: number; paidOn: string; amountEur: number; bank: string; lineId: number | null; adjusted: string | null; sharedWith: string | null }[];
}

export interface PayeeBranch {
  payee: Payee;
  label: string;
  status: string;
  plannedEur: number;
  paidEur: number;
  remainingEur: number;
  /**
   * `name` is the file's name, for 'Bestand ↗'. `coverage`: round 2's 'Geldt voor alle betalingen van
   * Leverancier (3)' on the supplier's primary invoice (R2-3); null elsewhere.
   */
  invoices: { id: number; text: string; comparison: string | null; documentId: number | null; name: string; primary: boolean; coverage: string | null }[];
  /** view.invoiceFiles of this payee: '{originalFilename} · zonder gegevens', 'Proforma (PI) · {originalFilename}' (invoiceFileText). */
  invoiceFiles: { documentId: number; text: string; name: string }[];
  /** SEPARATE with 'Inspectie via leverancier' and no invoice of its own: 'Factuur via leverancier · CI-2026-140'. */
  viaSupplier: string | null;
  /** SUPPLIER: the terms under the primary invoice, each with its payments. */
  terms: { due: Due; label: string; paidEur: number; plannedEur: number; payments: PaymentNode[] }[];
  /** Payments without a term. */
  payments: PaymentNode[];
}

const PAYEE_TITLE: Readonly<Record<Payee, string>> = {
  SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten',
};
const cents = (value: number | null | undefined): number => Math.round((value ?? 0) * 100);
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
/** '14 okt' of an ISO day; '' without one. */
const dayMon = (iso: string): string => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : '');
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
/** 'PO-2026-044', 'PO-2026-044 en PO-2026-045', 'PO-1, PO-2 en PO-3'. */
const joined = (words: readonly string[]): string => words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} en ${words[words.length - 1]}`;
const payeeOf = (row: Pick<PurchasePaymentRow, 'payee'>): Payee => row.payee ?? 'SUPPLIER';
const byDay = (left: PurchasePaymentRow, right: PurchasePaymentRow): number => left.paidOn.localeCompare(right.paidOn) || left.id - right.id;

/**
 * The tree of one container. `line` resolves a payment's bank line: the hard
 * link, else an older line's 'containerbetaling #id' marker, so the bank
 * status here agrees with the order screens. `status` words a stream as the
 * panel does (reconciliationStatusLabel).
 */
/** A payee with no Afspraak, nothing paid, no invoice and no payment: the tree shows one "… · geen" line for it. */
export function emptyBranch(branch: PayeeBranch): boolean {
  const zero = (value: number) => Math.round(value * 100) === 0;
  return zero(branch.plannedEur) && zero(branch.paidEur) && zero(branch.remainingEur) && !branch.invoices.length && !branch.invoiceFiles.length
    && !branch.terms.length && !branch.payments.length && !branch.viaSupplier;
}

export function containerPaymentTree(
  view: PurchaseOrderView, rows: readonly PurchasePaymentRow[],
  line: (row: PurchasePaymentRow) => { accountLabel: string; day: string; lineId?: number | null } | null,
  status: (stream: PurchaseReconciliationStream) => string = () => '',
): PayeeBranch[] {
  const own = rows.filter(row => row.orderId === view.order.id);
  const invoices = view.invoices ?? [];
  const flag = !!view.order.inspectionViaSupplier;
  const bankOf = (row: PurchasePaymentRow): string => {
    if (row.creditOffset) return 'verrekend tegoed';
    if (row.origin) return paymentOriginLabel(row.origin)!;
    const found = line(row);
    if (!found) return 'niet op de bank';
    const shared = payeeOf(row) === 'SEPARATE' && row.bankStatementLineId != null
      && own.some(other => payeeOf(other) === 'SUPPLIER' && other.bankStatementLineId === row.bankStatementLineId);
    return shared ? 'via leverancier · zelfde transactie' : ['op de bank', found.accountLabel, dayMon(found.day)].filter(Boolean).join(' · ');
  };
  const lineOf = (row: PurchasePaymentRow): number | null => (row.creditOffset ? null : line(row)?.lineId ?? row.bankStatementLineId ?? null);
  const adjustedOf = (row: PurchasePaymentRow): string | null => row.bankAdjustedFromEur == null ? null
    : `aangepast aan de bank (was ${EURO.format(row.bankAdjustedFromEur)}${row.bankAdjustedFromOn ? ' op ' + row.bankAdjustedFromOn.slice(8, 10) + '/' + row.bankAdjustedFromOn.slice(5, 7) : ''})`;
  /* One transfer for several containers (owner addition 2026-10-15): the other containers on the same line. */
  const sharedOf = (row: PurchasePaymentRow): string | null => {
    if (row.bankStatementLineId == null) return null;
    const others = [...new Set(rows.filter(other => other.bankStatementLineId === row.bankStatementLineId && other.orderId !== view.order.id)
      .map(other => other.orderNumber || other.orderAlias || '#' + other.orderId))].sort();
    return others.length ? `zelfde transactie als ${joined(others)}` : null;
  };
  const nodes = (payee: Payee): (PaymentNode & { due: Due | null })[] => {
    const groups = new Map<number, PurchasePaymentRow[]>();
    for (const row of own.filter(item => payeeOf(item) === payee)) {
      const key = row.groupId ?? row.id;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()].map(([key, members]) => {
      const sorted = [...members].sort(byDay);
      const root = sorted.find(row => row.id === key) ?? sorted[0];
      const label = root.label?.trim() || PAYEE_TITLE[payee];
      const amountEur = sorted.reduce((sum, row) => sum + cents(row.amountEur), 0) / 100;
      const grouped = sorted.length > 1;
      return {
        id: root.id, paidOn: sorted[sorted.length - 1].paidOn, firstPaidOn: grouped ? sorted[0].paidOn : null,
        label: grouped ? `${label} · ${sorted.length} transacties` : label, amountEur,
        bank: grouped ? '' : bankOf(root), lineId: grouped ? null : lineOf(root), adjusted: grouped ? null : adjustedOf(root),
        sharedWith: grouped ? null : sharedOf(root), due: root.instalmentDue ?? null,
        parts: grouped ? sorted.map(row => ({ id: row.id, paidOn: row.paidOn, amountEur: row.amountEur, bank: bankOf(row), lineId: lineOf(row),
          adjusted: adjustedOf(row), sharedWith: sharedOf(row) })) : [],
      };
    }).sort((left, right) => left.paidOn.localeCompare(right.paidOn) || left.id - right.id);
  };
  const strip = ({ due: _due, ...node }: PaymentNode & { due: Due | null }): PaymentNode => node;
  return (view.reconciliation?.streams ?? []).map(stream => {
    const payee = stream.payee;
    const mine = invoices.filter(invoice => invoice.payee === payee).sort((left, right) => left.id - right.id);
    const primary = primaryInvoice(invoices, payee);
    const comparison = invoiceComparison(invoices, payee, payee === 'OTHER' ? null : stream.plannedEur, view.order.inspectionCostEur ?? 0);
    const supplierPrimary = primaryInvoice(invoices, 'SUPPLIER');
    const all = nodes(payee);
    const termed = payee === 'SUPPLIER' ? view.reconciliation?.supplierInstalments ?? [] : [];
    /* The payee's payments as the coverage reads them: a payment in parts once, with its transfers. */
    const coverageRows = all.map(node => ({ parts: node.parts.length ? node.parts : [{ id: node.id }] }));
    return {
      payee,
      // The ERP's own payee words (as Betalingen, Te betalen and the bank targets); the server's stream label says 'Andere betaling'.
      label: PAYEE_TITLE[payee],
      status: status(stream),
      plannedEur: stream.plannedEur,
      paidEur: stream.paidEur,
      remainingEur: stream.remainingEur,
      invoices: mine.map((invoice: PurchaseInvoice) => ({
        id: invoice.id, text: invoiceLine(invoice), documentId: invoice.documentId ?? null, name: invoice.documentName || invoice.number,
        primary: invoice.id === primary?.id,
        comparison: invoice.id === primary?.id ? comparison?.text ?? null : 'extra factuur',
        coverage: invoice.id === primary?.id && payee === 'SUPPLIER' && invoice.paymentIds !== undefined ? invoiceCoverage(invoice, coverageRows, PAYEE_TITLE[payee]).text : null,
      })),
      invoiceFiles: (view.invoiceFiles ?? []).filter(file => file.payee === payee)
        .map(file => ({ documentId: file.documentId, text: invoiceFileText(file), name: file.originalFilename })),
      viaSupplier: payee === 'SEPARATE' && flag && !mine.length
        ? (supplierPrimary ? 'Factuur via leverancier · ' + supplierPrimary.number : 'Factuur van de leverancier nog niet ingevoerd') : null,
      terms: termed.map(term => ({ due: term.due, label: term.label, paidEur: term.paidEur, plannedEur: term.plannedEur,
        payments: all.filter(node => node.due === term.due).map(strip) })),
      payments: all.filter(node => !termed.some(term => term.due === node.due)).map(strip),
    };
  });
}
