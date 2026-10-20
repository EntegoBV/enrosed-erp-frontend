import type { BankStatementLine } from '../../core/api/banking-api';
import type { CompanyCost, PurchasePaymentRow, SalesOrderView, SalesPayment } from '../../core/api/models';
import type { BankAllocationTarget } from './bank-allocation-targets';
import type { LinkTarget } from './bank-change-preview';
import type { ContainerPayable } from './payables';

/*
 * What a bank transaction most likely pays (spec-bank-forecast §3.8): every
 * candidate the caller's bankAllocationTargets finds (costs, invoices,
 * container terms) and every free payment in the line's direction, scored on
 * the amount, the PO / invoice / cost reference in the bank text, the name,
 * whether it is still open and how close an existing payment's day is; a
 * small charge next to a supplier transfer as that container's
 * Transactiekosten (2026-10-19; its own transfer first, pairedTransfer,
 * 2026-10-20), and Boeken als' container choice. The
 * status chip of each line (Gekoppeld, Geboekt als, Suggestie, Te koppelen),
 * the "{k} exacte suggesties koppelen" set, the search of Transacties and its
 * In · Uit line. Pure, only type imports (the caller hands in
 * bankAllocationTargets' rows), node-tested (tests/bank-suggestions.test.mts).
 */

export type LineStatus = 'LINKED' | 'BOOKED' | 'SUGGESTED' | 'OPEN';
export interface CostPattern { kind: 'cost-pattern'; category: string; party: string; description: string; count: number;
  /** The latest of those costs: the registration starts from it. */
  costId: number; label: string; }
/**
 * "Transactiekosten · PO-2026-005 (Yunnan Pubei)": a small charge on the
 * account of a supplier transfer, booked with one button as that container's
 * Bijkomende kosten (FinanceState.bookContainerFee). Never exact.
 */
export interface ContainerFee { kind: 'container-fee'; orderId: number; label: string; }
export interface LineSuggestion {
  lineId: number;
  target: LinkTarget | CostPattern | ContainerFee;
  score: number;
  reasons: string[];
  amountMatches: boolean;
  exact: boolean;
  changesAmount: boolean;
  /** Every candidate that scored, best first (the detail's "Andere mogelijkheden"). */
  others: { target: LinkTarget; score: number; reasons: string[]; amountMatches: boolean; changesAmount: boolean }[];
}

/** A cost payment with its cost, as the bank lines carry them. */
export interface LinkedCostLine { lineId: number; costId: number; category: string; party: string | null; description: string; date: string; }

export interface SuggestionInput {
  lines: readonly BankStatementLine[];
  /** The caller's bankAllocationTargets for one line (costs, invoices, container terms). */
  targets: (line: BankStatementLine) => BankAllocationTarget[];
  costs: readonly CompanyCost[];
  sales: readonly SalesOrderView[];
  containers: readonly ContainerPayable[];
  purchasePayments: readonly PurchasePaymentRow[];
  customerName: (id: number | null) => string;
  /** The cost payments on a line, for the cost pattern ("zoals de vorige 3 keer"). */
  costPaymentsLinkedLines: readonly LinkedCostLine[];
  /** Account labels of the lines, for the existing payments' "Rekening". */
  accountLabel?: (key: string | null | undefined) => string;
  categoryLabel?: (code: string) => string;
  /** The line's local day (Brussels); defaults to the first ten characters of bookedAt. */
  lineDay?: (line: BankStatementLine) => string;
  today?: string;
  /** Lines to score; every unlinked line by default. */
  only?: ReadonlySet<number>;
  /** One key per account (its aliases folded), for a fee on the account of a supplier transfer; the key itself by default. */
  accountKey?: (key: string) => string;
  /** A container's supplier, for the Transactiekosten suggestion's words. */
  supplierOf?: (orderId: number) => string;
}

export const SUGGESTED_SCORE = 70;
export const AMBIGUOUS_SCORE = 50;
/** An existing payment within this share of the transaction follows it (exchange rate, bank fees): "Bekijken". */
export const NEAR_SHARE = 0.02;
const TOLERANCE_CENTS = 2;
const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value as number) ? value as number : 0) * 100);
const normal = (text: string | null | undefined): string => (text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const compact = (text: string | null | undefined): string => normal(text).replace(/[^a-z0-9]/g, '');
const days = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const addDays = (day: string, count: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

export function allocatedLine(line: Pick<BankStatementLine, 'allocated' | 'salesPaymentId' | 'classification'>): boolean {
  return line.allocated === true || line.salesPaymentId != null || !!line.classification;
}

/** The status chip of a line: Gekoppeld, the booked label, Suggestie or Te koppelen. */
export function lineStatus(line: Pick<BankStatementLine, 'allocated' | 'salesPaymentId' | 'classification'>, suggestion: LineSuggestion | undefined): LineStatus {
  if (line.classification) return 'BOOKED';
  if (line.allocated === true || line.salesPaymentId != null) return 'LINKED';
  return suggestion ? 'SUGGESTED' : 'OPEN';
}

interface Candidate { target: LinkTarget; amountEur: number; existing: boolean; open: boolean; po: string | null; invoices: string[]; reference: string | null; party: string | null; day: string | null; }

/**
 * A container's one name, the rule of purchasing/container-name.ts's containerName (alias, else the PO number, else
 * 'Inkoop #id'), copied so this file keeps type-only imports. Titles name the container as the linked rows do; the PO
 * number stays in `po`, so the reasons ("PO in mededeling") still match on it.
 */
function nameOfContainer(alias: string | null | undefined, number: string | null | undefined, id: number): string {
  return alias?.trim() || number?.trim() || `Inkoop #${id}`;
}

/** Every candidate of one line, new payments on documents and terms first, then the free payments in its direction. */
function candidatesOf(line: BankStatementLine, input: SuggestionInput, linkedReceipts: ReadonlySet<number>): Candidate[] {
  const out: Candidate[] = [];
  const label = input.accountLabel ?? ((key) => key ?? '');
  const outgoing = line.amountEur < 0;
  for (const target of input.targets(line)) {
    const open = Math.abs(target.openBankEur);
    if (target.kind === 'cost') {
      const cost = input.costs.find((row) => row.id === target.id);
      if (!open) continue;
      out.push({ target: { kind: 'cost-new', costId: target.id, title: `Kost · ${target.title}`, openEur: open }, amountEur: open, existing: false, open: true,
        po: null, invoices: [], reference: cost?.reference ?? target.reference ?? null, party: target.party || null, day: target.date || null });
    } else if (target.kind === 'sales') {
      if (!open) continue;
      out.push({ target: { kind: 'sales-new', salesOrderId: target.id, title: `Factuur ${target.title}`, openEur: open }, amountEur: open, existing: false, open: true,
        po: null, invoices: [target.title], reference: null, party: target.party || null, day: target.date || null });
    } else if (target.container) {
      const term = target.container;
      const words = term.termLabel ?? target.reference;
      out.push({ target: { kind: 'term-new', orderId: term.orderId, payable: term, title: `Inkoop · ${nameOfContainer(term.alias, term.orderNumber, term.orderId)} · ${words}` }, amountEur: open, existing: false, open: open > 0,
        po: term.orderNumber, invoices: term.invoiceNumber ? [term.invoiceNumber] : [], reference: null, party: target.party && target.party !== term.orderNumber ? target.party : null, day: null });
    }
  }
  for (const cost of input.costs) for (const payment of cost.payments ?? []) {
    if (!payment.id || payment.bankStatementLineId != null || !payment.amountEur || Math.sign(payment.amountEur) !== (outgoing ? 1 : -1)) continue;
    out.push({ target: { kind: 'cost-existing', costId: cost.id!, costPaymentId: payment.id, title: `Kost · ${cost.description}`, amountEur: Math.abs(payment.amountEur),
      paidOn: payment.paidOn, account: payment.account ? label(payment.account) : null, proofCount: 0 },
    amountEur: Math.abs(payment.amountEur), existing: true, open: false, po: null, invoices: [], reference: cost.reference ?? null, party: cost.party ?? null, day: payment.paidOn });
  }
  if (outgoing) {
    const groups = new Map<number, number>();
    for (const payment of input.purchasePayments) if (payment.groupId != null) groups.set(payment.groupId, (groups.get(payment.groupId) ?? 0) + 1);
    for (const payment of input.purchasePayments) {
      if (payment.bankStatementLineId != null || payment.creditOffset || !(payment.amountEur > 0)) continue;
      const order = nameOfContainer(payment.orderAlias, payment.orderNumber, payment.orderId);
      out.push({ target: { kind: 'purchase-existing', orderId: payment.orderId, paymentId: payment.id, title: `Inkoop · ${order}${payment.label ? ' · ' + payment.label : ''}`,
        amountEur: payment.amountEur, paidOn: payment.paidOn, currency: payment.currency ?? 'EUR', amount: payment.amount ?? payment.amountEur, account: null, proofCount: 0,
        hasInspectionAfspraak: false, groupSize: payment.groupId != null ? groups.get(payment.groupId) ?? 1 : 1 },
      amountEur: payment.amountEur, existing: true, open: false, po: payment.orderNumber, invoices: payment.invoiceNumber ? [payment.invoiceNumber] : [],
      reference: null, party: null, day: payment.paidOn });
    }
  }
  for (const view of input.sales) {
    for (const payment of (view.paymentSummary?.payments ?? []) as SalesPayment[]) {
      if (payment.offsetPaymentId != null || linkedReceipts.has(payment.id) || Math.sign(payment.amountEur) !== Math.sign(line.amountEur)) continue;
      const day = payment.receivedAt.slice(0, 10);
      out.push({ target: { kind: 'sales-existing', salesOrderId: view.order.id, paymentId: payment.id, title: `Factuur ${view.order.number}`, amountEur: Math.abs(payment.amountEur),
        receivedOn: day, account: payment.bankAccount ? label(payment.bankAccount) : null },
      amountEur: Math.abs(payment.amountEur), existing: true, open: false, po: null, invoices: [view.order.number], reference: payment.reference, party: input.customerName(view.order.customerId) || null, day });
    }
  }
  return out;
}

function scored(line: BankStatementLine, candidate: Candidate, day: string): { score: number; reasons: string[]; amountMatches: boolean; changesAmount: boolean } {
  const reasons: string[] = [];
  let score = 0;
  const lineCents = Math.abs(cents(line.amountEur));
  const gap = Math.abs(lineCents - cents(candidate.amountEur));
  const exact = gap <= TOLERANCE_CENTS;
  const near = !exact && candidate.existing && gap <= Math.round(cents(candidate.amountEur) * NEAR_SHARE);
  if (exact) { score += 40; reasons.push('bedrag exact'); }
  else if (near) { score += 30; reasons.push('bedrag bijna gelijk'); }
  const text = compact(`${line.reference ?? ''} ${line.counterparty ?? ''}`);
  const words = normal(`${line.counterparty ?? ''} ${line.reference ?? ''}`);
  if (candidate.po && compact(candidate.po).length > 3 && text.includes(compact(candidate.po))) { score += 30; reasons.push('PO in mededeling'); }
  if (candidate.invoices.some((number) => compact(number).length > 2 && text.includes(compact(number)))) { score += 30; reasons.push('factuurnummer in mededeling'); }
  if (candidate.reference && compact(candidate.reference).length > 3 && text.includes(compact(candidate.reference))) { score += 30; reasons.push('referentie in mededeling'); }
  if (candidate.party && normal(candidate.party).trim().length > 3 && words.includes(normal(candidate.party).trim())) { score += 20; reasons.push('naam bekend'); }
  if (candidate.open) { score += 10; reasons.push('nog open'); }
  if (candidate.existing && candidate.day && Math.abs(days(candidate.day, day)) <= 10) { score += 10; reasons.push('datum dichtbij'); }
  return { score, reasons, amountMatches: exact || near, changesAmount: candidate.existing && !exact };
}

const TEXT_REASONS = new Set(['PO in mededeling', 'factuurnummer in mededeling', 'referentie in mededeling', 'naam bekend']);

/** "Kost · Telefoon & internet · zoals de vorige 3 keer": a counterparty that went to costs of one category at least twice in the last year. */
function costPattern(line: BankStatementLine, input: SuggestionInput, day: string, byId: ReadonlyMap<number, BankStatementLine>): CostPattern | null {
  if (line.amountEur >= 0) return null;
  const party = normal(line.counterparty).trim();
  if (party.length < 2) return null;
  const since = addDays(input.today ?? day, -365);
  const groups = new Map<string, LinkedCostLine[]>();
  const seen = new Set<number>();
  for (const linked of input.costPaymentsLinkedLines) {
    const other = byId.get(linked.lineId);
    if (!other || other.id === line.id || seen.has(other.id) || normal(other.counterparty).trim() !== party || linked.date < since) continue;
    seen.add(other.id);
    groups.set(linked.category, [...(groups.get(linked.category) ?? []), linked]);
  }
  const best = [...groups.entries()].filter(([, rows]) => rows.length >= 2).sort((a, b) => b[1].length - a[1].length)[0];
  if (!best) return null;
  const [category, rows] = best;
  const latest = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.costId - a.costId)[0];
  const name = input.categoryLabel ? input.categoryLabel(category) : category;
  return { kind: 'cost-pattern', category, party: latest.party || line.counterparty, description: latest.description, count: rows.length, costId: latest.costId,
    label: `Kost · ${name} · zoals de vorige ${rows.length} keer` };
}

/** A fee is small: a bank's charge on one transfer, never a part of the goods. */
export const FEE_MAX_EUR = 100;
/** Bank words for a transfer's charge, in the languages the bank texts come in: kosten alone or as transactie-, transfer-, overschrijvings- or betalingskosten, never every '…kosten' (Beheerskosten is the account's). */
const FEE_WORDS = /\b(transactie|transfer|overschrijvings?|betalings?)?kosten\b|\b(fees?|charges?|commission|swift|our|sha|frais|gebuhr(en)?)\b/;

/** The bank text says it is a charge. */
export function feeText(line: Pick<BankStatementLine, 'counterparty' | 'reference'>): boolean {
  return FEE_WORDS.test(normal(`${line.counterparty ?? ''} ${line.reference ?? ''}`));
}

/** KBC's own words on the charge of a foreign transfer: 'Aanrekening kosten Buitenlandse overschrijving Referentie … Zie bijlage' (never 'Aanrekening beheerskosten'). */
const FOREIGN_FEE_WORDS = /\baanrekening\s+kosten\b|\b(buitenlandse|internationale)\s+overschrijving\b/;

/**
 * A small outgoing line that reads as a bank's charge (the charge words, or
 * KBC's 'Aanrekening kosten' / 'Buitenlandse overschrijving'): a transfer's
 * Transactiekosten. The transfer itself ('Internationale overschrijving',
 * thousands of euro) never is one.
 */
export function feeLike(line: Pick<BankStatementLine, 'amountEur' | 'counterparty' | 'reference'>): boolean {
  if (!(line.amountEur < 0) || Math.abs(cents(line.amountEur)) > FEE_MAX_EUR * 100) return false;
  return feeText(line) || FOREIGN_FEE_WORDS.test(normal(`${line.counterparty ?? ''} ${line.reference ?? ''}`));
}

/**
 * The transfer a charge belongs to (live KBC data via Odoo: each foreign
 * transfer is followed the same day by its own fee line with the next id,
 * 65 '… Internationale overschrijving …' − € 11.565,11 and 64 'Aanrekening
 * kosten …' − € 38,01, no shared reference): an outgoing line of the same
 * account, not a charge itself, larger, booked within three days. The same
 * day first, then the nearest id (on a tie the higher one: the transfer
 * comes before its fee), then the nearest day. Null for a line that is no
 * charge, or with none.
 */
export function pairedTransfer(fee: BankStatementLine, lines: readonly BankStatementLine[],
  dayOf: (line: BankStatementLine) => string = (line) => line.bookedAt.slice(0, 10), account: (key: string) => string = (key) => key): BankStatementLine | null {
  if (!feeLike(fee)) return null;
  const day = dayOf(fee), own = account(fee.account), size = Math.abs(cents(fee.amountEur));
  const rows = lines.filter((other) => other.id !== fee.id && other.amountEur < 0 && Math.abs(cents(other.amountEur)) > size && account(other.account) === own
    && other.classification !== 'INTERNAL_TRANSFER' && !feeLike(other))
    .map((other) => ({ other, gap: Math.abs(days(day, dayOf(other))), apart: Math.abs(other.id - fee.id) }))
    .filter((row) => row.gap <= 3)
    .sort((a, b) => Number(a.gap > 0) - Number(b.gap > 0) || a.apart - b.apart || Number(b.other.id > fee.id) - Number(a.other.id > fee.id) || a.gap - b.gap);
  return rows[0]?.other ?? null;
}

/** The containers a bank line pays, the largest part first (several on a split transfer). */
export function linkedContainers(lineId: number, payments: readonly PurchasePaymentRow[]): number[] {
  const sums = new Map<number, number>();
  for (const payment of payments) if (payment.bankStatementLineId === lineId && !payment.creditOffset) sums.set(payment.orderId, (sums.get(payment.orderId) ?? 0) + cents(payment.amountEur));
  return [...sums.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([orderId]) => orderId);
}

/** The containers an unlinked line's best match and its other candidates point at, best first. */
export function suggestedContainers(suggestion: Pick<LineSuggestion, 'target' | 'others'> | undefined): number[] {
  if (!suggestion) return [];
  const ids = [suggestion.target, ...suggestion.others.map((other) => other.target)]
    .map((target) => target.kind === 'purchase-existing' || target.kind === 'term-new' || target.kind === 'container-fee' ? target.orderId : null);
  return [...new Set(ids.filter((id): id is number => id !== null))];
}

/**
 * The supplier transfers near a line: the containers whose supplier payment
 * sits on another bank line of the same account within `withinDays`,
 * nearest first (then the larger transfer), one row per container.
 */
function nearSupplierTransfers(line: BankStatementLine, lines: readonly BankStatementLine[], payments: readonly PurchasePaymentRow[], dayOf: (line: BankStatementLine) => string,
  account: (key: string) => string, withinDays: number): { orderId: number; days: number }[] {
  const byId = new Map(lines.map((other) => [other.id, other]));
  const day = dayOf(line), own = account(line.account);
  const best = new Map<number, { orderId: number; days: number; eur: number }>();
  for (const payment of payments) {
    const other = payment.bankStatementLineId != null ? byId.get(payment.bankStatementLineId) : undefined;
    if (!other || other.id === line.id || (payment.payee ?? 'SUPPLIER') !== 'SUPPLIER' || account(other.account) !== own) continue;
    const gap = Math.abs(days(day, dayOf(other)));
    if (gap > withinDays) continue;
    const seen = best.get(payment.orderId);
    if (!seen || gap < seen.days || (gap === seen.days && payment.amountEur > seen.eur)) best.set(payment.orderId, { orderId: payment.orderId, days: gap, eur: payment.amountEur });
  }
  return [...best.values()].sort((a, b) => a.days - b.days || b.eur - a.eur).map(({ orderId, days: gap }) => ({ orderId, days: gap }));
}

/**
 * A charge (feeLike) on a container: the container of its own transfer
 * (pairedTransfer, once that one is linked; the largest part of a split),
 * else the nearest supplier transfer on the same account within three days.
 * Null otherwise.
 */
function containerFee(line: BankStatementLine, input: SuggestionInput, day: (line: BankStatementLine) => string): { fee: ContainerFee; reasons: string[] } | null {
  if (!feeLike(line)) return null;
  const account = input.accountKey ?? ((key: string) => key);
  const transfer = pairedTransfer(line, input.lines, day, account);
  const paired = transfer ? linkedContainers(transfer.id, input.purchasePayments)[0] : undefined;
  const orderId = paired ?? nearSupplierTransfers(line, input.lines, input.purchasePayments, day, account, 3)[0]?.orderId;
  if (orderId === undefined) return null;
  const payment = input.purchasePayments.find((row) => row.orderId === orderId);
  const supplier = input.supplierOf?.(orderId) ?? '';
  return { fee: { kind: 'container-fee', orderId, label: `Transactiekosten · ${nameOfContainer(payment?.orderAlias, payment?.orderNumber, orderId)}${supplier ? ` (${supplier})` : ''}` },
    reasons: ['kosten in mededeling', paired !== undefined ? 'bij de overschrijving' : 'naast betaling leverancier'] };
}

/**
 * The best match per unlinked line: SUGGESTED from 70 points with a matching
 * amount, exact when one text signal backs it and no other candidate reaches
 * 50; else, for an outgoing line, the cost pattern or a container's
 * Transactiekosten (never exact).
 */
export function lineSuggestions(input: SuggestionInput): Map<number, LineSuggestion> {
  const result = new Map<number, LineSuggestion>();
  const linkedReceipts = new Set(input.lines.map((line) => line.salesPaymentId).filter((id): id is number => id != null));
  const byId = new Map(input.lines.map((line) => [line.id, line]));
  for (const line of input.lines) {
    if (allocatedLine(line) || !line.amountEur || (input.only && !input.only.has(line.id))) continue;
    const day = input.lineDay ? input.lineDay(line) : line.bookedAt.slice(0, 10);
    const ranked = candidatesOf(line, input, linkedReceipts).map((candidate) => ({ target: candidate.target, ...scored(line, candidate, day) }))
      .filter((row) => row.score > 0).sort((a, b) => b.score - a.score || Number(b.amountMatches) - Number(a.amountMatches));
    const best = ranked[0];
    if (best && best.score >= SUGGESTED_SCORE && best.amountMatches) {
      const rival = ranked.slice(1).some((row) => row.score >= AMBIGUOUS_SCORE);
      result.set(line.id, { lineId: line.id, target: best.target, score: best.score, reasons: best.reasons, amountMatches: true,
        exact: !rival && !best.changesAmount && best.reasons.some((reason) => TEXT_REASONS.has(reason)), changesAmount: best.changesAmount, others: ranked.slice(1, 4) });
      continue;
    }
    // A charge that went to company costs before stays one, also beside a supplier transfer.
    const pattern = costPattern(line, input, day, byId);
    if (pattern) { result.set(line.id, { lineId: line.id, target: pattern, score: SUGGESTED_SCORE, reasons: ['zoals vorige keren'], amountMatches: false, exact: false, changesAmount: false, others: ranked.slice(0, 3) }); continue; }
    const fee = containerFee(line, input, (row) => input.lineDay ? input.lineDay(row) : row.bookedAt.slice(0, 10));
    if (fee) result.set(line.id, { lineId: line.id, target: fee.fee, score: SUGGESTED_SCORE, reasons: fee.reasons, amountMatches: false, exact: false, changesAmount: false, others: ranked.slice(0, 3) });
  }
  return result;
}

/* ---------------------------------------------------------------- search */

/**
 * A search term as an amount, or null: with a comma the dots are thousands
 * ('1.452,00'), more than one dot are thousands too ('1.452.000'), else the
 * dot is the decimal point ('1452.00'); '-12512' searches the amount.
 */
export function searchAmount(term: string): number | null {
  if (!/^-?[\d.,]+$/.test(term) || !/\d/.test(term)) return null;
  let text = term.replace(/^-/, '');
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  else if ((text.match(/\./g) ?? []).length > 1) text = text.replace(/\./g, '');
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Every whitespace-separated term must match the counterparty, the reference, the account label, a linked target or the amount (within € 0,005). */
export function bankSearchMatches(line: Pick<BankStatementLine, 'counterparty' | 'reference' | 'amountEur'>, query: string, extra: readonly (string | null | undefined)[] = []): boolean {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = normal([line.counterparty, line.reference, ...extra].filter(Boolean).join(' '));
  return terms.every((term) => {
    const amount = searchAmount(term);
    if (amount !== null && Math.abs(Math.abs(line.amountEur) - amount) < 0.005) return true;
    return text.includes(normal(term));
  });
}

/** "In € x · Uit € y" of a selection: internal transfers left out (they say so). */
export function selectionTotals(lines: readonly Pick<BankStatementLine, 'amountEur' | 'classification'>[]): { inEur: number; outEur: number; netEur: number; internal: number } {
  let incoming = 0, outgoing = 0, internal = 0;
  for (const line of lines) {
    if (line.classification === 'INTERNAL_TRANSFER') { internal++; continue; }
    const value = cents(line.amountEur);
    if (value > 0) incoming += value; else outgoing -= value;
  }
  return { inEur: incoming / 100, outEur: outgoing / 100, netEur: (incoming - outgoing) / 100, internal };
}

/* ---------------------------------------------------------------- Boeken als */

/** 'zelfde dag', '2 dagen later', '1 dag eerder': the other leg of a transfer seen from this line. */
export function legDistance(day: string, otherDay: string): string {
  const gap = days(day, otherDay);
  if (gap === 0) return 'zelfde dag';
  const n = Math.abs(gap);
  return `${n} ${n === 1 ? 'dag' : 'dagen'} ${gap > 0 ? 'later' : 'eerder'}`;
}

/**
 * "Andere kant" of an internal transfer: free lines on another active account
 * with the exact opposite amount within five days, nearest first.
 */
export function transferCandidates<T extends Pick<BankStatementLine, 'id' | 'account' | 'amountEur' | 'allocated' | 'salesPaymentId' | 'classification'>>(
  line: T, lines: readonly T[], dayOf: (line: T) => string, account: (key: string) => string, active: (key: string) => boolean,
): T[] {
  const own = account(line.account);
  const day = dayOf(line);
  return lines.filter((other) => other.id !== line.id && account(other.account) !== own && active(account(other.account)) && !allocatedLine(other)
    && cents(other.amountEur) === -cents(line.amountEur) && Math.abs(days(day, dayOf(other))) <= 5)
    .sort((a, b) => Math.abs(days(day, dayOf(a))) - Math.abs(days(day, dayOf(b))) || a.id - b.id);
}

/** A container Boeken als › Bankkosten › "Bij een container…" offers: non-concept, not archived. */
export interface FeeContainer { orderId: number; number: string; alias: string | null; supplier: string; }
/** With why it comes first: its supplier transfer near this line ('betaling 2 dagen eerder'), or the line's party. */
export interface RankedFeeContainer extends FeeContainer { near: string | null; party: boolean; }

/**
 * "Bij een container…" under Bankkosten: `first` (the containers of this
 * charge's own transfer, from the detail's Transactiekosten card) leads,
 * then the containers whose supplier payment sits on a bank line of the
 * same account within five days of this line (nearest first), then those of
 * the same counterparty (a line with it paid the container, or the bank
 * text names the supplier), then the rest by PO number, newest first.
 */
export function feeContainers(line: BankStatementLine, containers: readonly FeeContainer[], lines: readonly BankStatementLine[], payments: readonly PurchasePaymentRow[],
  dayOf: (line: BankStatementLine) => string, account: (key: string) => string = (key) => key, first: readonly number[] = []): RankedFeeContainer[] {
  const lead = (orderId: number): number => { const index = first.indexOf(orderId); return index < 0 ? Infinity : index; };
  const near = new Map(nearSupplierTransfers(line, lines, payments, dayOf, account, 5).map((row, index) => [row.orderId, { ...row, index }]));
  const party = compact(line.counterparty);
  const text = compact(`${line.counterparty ?? ''} ${line.reference ?? ''}`);
  const byId = new Map(lines.map((other) => [other.id, other]));
  const sameParty = new Set(party.length > 3 ? payments.filter((payment) => {
    const other = payment.bankStatementLineId != null ? byId.get(payment.bankStatementLineId) : undefined;
    return !!other && other.id !== line.id && compact(other.counterparty) === party;
  }).map((payment) => payment.orderId) : []);
  const gapText = (gap: number): string => gap === 0 ? 'betaling zelfde dag' : `betaling ${gap} ${gap === 1 ? 'dag' : 'dagen'} ernaast`;
  return containers.map((container) => {
    const close = near.get(container.orderId);
    const supplier = compact(container.supplier);
    return { ...container, near: first.includes(container.orderId) ? 'bij de overschrijving' : close ? gapText(close.days) : null,
      party: sameParty.has(container.orderId) || (supplier.length > 3 && text.includes(supplier)) };
  }).sort((a, b) => lead(a.orderId) - lead(b.orderId) || (near.get(a.orderId)?.index ?? Infinity) - (near.get(b.orderId)?.index ?? Infinity) || Number(b.party) - Number(a.party)
    || b.number.localeCompare(a.number, 'nl', { numeric: true }));
}

/** The picker's search: every word in the PO number, the alias or the supplier. */
export function filterFeeContainers<T extends FeeContainer>(rows: readonly T[], query: string): T[] {
  const words = normal(query).split(/\s+/).filter(Boolean);
  return rows.filter((row) => words.every((word) => normal(`${row.number} ${row.alias ?? ''} ${row.supplier}`).includes(word)));
}

const quarterIndex = (day: string): number => Number(day.slice(0, 4)) * 4 + Math.floor((Number(day.slice(5, 7)) - 1) / 3);
const quarterKey = (index: number): string => `${Math.floor(index / 4)}-Q${index % 4 + 1}`;

/**
 * The VAT quarters to choose from: today's and the four before it ('2026-Q4'
 * … '2025-Q4'), newest first; the default is the quarter before the line's
 * own (a return is paid in the quarter after it).
 */
export function vatPeriods(today: string, lineDay: string): { options: string[]; preferred: string } {
  const current = quarterIndex(today);
  const options = [0, 1, 2, 3, 4].map((back) => quarterKey(current - back));
  const preferred = quarterKey(quarterIndex(lineDay) - 1);
  return { options: options.includes(preferred) ? options : [...options, preferred], preferred };
}

/** 'Btw-kwartaal Q3 2026' of '2026-Q3'. */
export function vatPeriodLabel(period: string | null | undefined): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(period ?? '');
  return match ? `Btw-kwartaal Q${match[2]} ${match[1]}` : '';
}
