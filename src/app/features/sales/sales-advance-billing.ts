import type {
  QuoteStatus, SalesAdvanceDeduction, SalesAdvanceInvoice, SalesAdvanceInvoiceRequest, SalesAdvanceReceipt, SalesOrderView,
} from '../../core/api/models';

/*
 * Voorschotfacturen and the slotfactuur of a regular sale (a whole container
 * for a French customer, paid in down payments). An advance is an ordinary
 * F-series invoice with one amount line on a quote; the slotfactuur is the
 * quote's own invoice, with a server-owned negative line per issued advance.
 * The server judges every rule; this module only previews, labels and guards
 * the buttons. Pure and node-tested: type-only imports.
 */

const DEAD = new Set<QuoteStatus>(['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);
const finite = (value: number | null | undefined): number => (Number.isFinite(value) ? (value as number) : 0);
/** Half-up to cents, also for x.xx5 that binary floats store a hair low. */
const round2 = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + 1e-9) * 100) / 100;

/** € 1.234,56 for sentences. */
export function euroText(value: number): string {
  const text = Math.abs(finite(value)).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${finite(value) < 0 ? '− ' : ''}€ ${text}`;
}

/** 'dd/mm/jjjj' from '2026-04-05' or an ISO instant (its calendar date as written). */
export function dayText(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function isLiveAdvance(advance: Pick<SalesAdvanceInvoice, 'status'>): boolean {
  return !DEAD.has(advance.status);
}

/** A quote's advances that still count: concepts included, cancelled ones not. */
export function liveAdvances(view: Pick<SalesOrderView, 'advanceInvoices'> | null | undefined): SalesAdvanceInvoice[] {
  return (view?.advanceInvoices ?? []).filter(isLiveAdvance);
}

type BillingView = Pick<SalesOrderView, 'order' | 'advanceBilling'>;

export function isAdvanceBillingInvoice(view: BillingView | null | undefined): boolean {
  return view?.advanceBilling?.stage === 'ADVANCE' && view.order.docType === 'FACTUUR';
}

export function isFinalBillingInvoice(view: BillingView | null | undefined): boolean {
  return view?.advanceBilling?.stage === 'FINAL' && view.order.docType === 'FACTUUR';
}

/** 'Voorschotfactuur' or 'Slotfactuur' for a regular sale paid in advance; null for anything else. */
export function billingKind(view: BillingView | null | undefined): 'Voorschotfactuur' | 'Slotfactuur' | null {
  return isAdvanceBillingInvoice(view) ? 'Voorschotfactuur' : isFinalBillingInvoice(view) ? 'Slotfactuur' : null;
}

/** 'Voorschotfactuur · offerte OF-2026-041' or 'Slotfactuur · offerte …', for the header tag. */
export function billingTag(view: BillingView | null | undefined): string | null {
  const kind = billingKind(view);
  if (!kind) return null;
  const quote = view!.advanceBilling!.quoteNumber;
  return `${kind}${quote ? ` · offerte ${quote}` : ''}`;
}

export function pctText(value: number): string {
  return finite(value).toLocaleString('nl-BE', { maximumFractionDigits: 4 });
}

/** A regular quote of our own, where advances belong: never a partner deal or a quote with a partner payment plan. */
export function isRegularQuote(view: Pick<SalesOrderView, 'order' | 'advanceAgreement'> | null | undefined): boolean {
  if (!view) return false;
  const order = view.order;
  return (order.docType ?? 'OFFERTE') === 'OFFERTE' && (order.purpose ?? 'STANDARD') === 'STANDARD'
    && !order.partnerPurchaseOrderId && !view.advanceAgreement;
}

/** The quote's value advances are taken from: its priced total excl. VAT, freight and extra lines included. */
export function advanceBaseExcl(view: Pick<SalesOrderView, 'priced'> | null | undefined): number {
  return round2(Math.max(0, finite(view?.priced?.totals?.total)));
}

export function advancedExcl(view: Pick<SalesOrderView, 'advanceInvoices'> | null | undefined): number {
  return round2(liveAdvances(view).reduce((sum, advance) => sum + finite(advance.amountExclEur), 0));
}

/** What is still to be invoiced as an advance or on the slotfactuur. */
export function remainingToInvoiceExcl(view: Pick<SalesOrderView, 'priced' | 'advanceInvoices'> | null | undefined): number {
  return round2(Math.max(0, advanceBaseExcl(view) - advancedExcl(view)));
}

/** The quote's VAT for a preview: 0 under a legal mention (reverse charge, intra-EU), else its rate. */
export function advanceVatPct(view: Pick<SalesOrderView, 'priced'> | null | undefined): number {
  const totals = view?.priced?.totals;
  return !totals || totals.vatLegalMention ? 0 : Math.max(0, finite(totals.vatRatePct));
}

/**
 * Why the quote cannot get an advance now, or null when it can. The server
 * repeats every rule; these are the ones the button can know.
 */
export function advanceInvoiceBlock(view: SalesOrderView | null | undefined): string | null {
  if (!view || !isRegularQuote(view)) return 'Alleen een reguliere offerte krijgt voorschotfacturen.';
  /* An older backend sends no advanceInvoices and has no advance endpoint yet. */
  if (!Array.isArray(view.advanceInvoices)) return 'Voorschotfacturen zijn beschikbaar zodra de server bijgewerkt is.';
  const order = view.order;
  /* The slotfactuur archives its quote: name it, not the archive. */
  if (view.invoicedAsId || view.invoicedAs) return `Deze offerte is al gefactureerd${view.invoicedAs ? ` (${view.invoicedAs})` : ''}.`;
  if (order.archivedAt) return 'Deze offerte is gearchiveerd.';
  if (view.fulfillment?.groupId) return 'Een gesplitste order krijgt geen voorschotfacturen.';
  if (DEAD.has(order.status)) return 'Deze offerte is afgesloten.';
  if (order.freight === 'TE_BEPALEN') return 'Vul eerst de vracht in.';
  if (!(advanceBaseExcl(view) > 0)) return 'De offerte heeft nog geen bedrag.';
  if (!(remainingToInvoiceExcl(view) > 0)) return 'De offerte is volledig gefactureerd als voorschot.';
  return null;
}

export type AdvanceChoice = { kind: 'PERCENT'; pct: number | null } | { kind: 'AMOUNT'; amountEur: number | null };

export interface AdvancePreview {
  exclEur: number;
  vatEur: number;
  inclEur: number;
  vatPct: number;
  /** Still to invoice after this advance, excl. VAT. */
  remainingAfterEur: number;
  error: string | null;
  request: SalesAdvanceInvoiceRequest | null;
}

/** The sheet's preview: pct × quote total excl. VAT (half-up to cents) or the amount, its VAT and what stays to invoice. */
export function advancePreview(view: SalesOrderView | null | undefined, choice: AdvanceChoice, dueDate?: string | null): AdvancePreview {
  const base = advanceBaseExcl(view), remaining = remainingToInvoiceExcl(view), vatPct = advanceVatPct(view);
  const fail = (error: string, exclEur = 0): AdvancePreview => ({ exclEur, vatEur: 0, inclEur: exclEur, vatPct, remainingAfterEur: remaining, error, request: null });
  const due = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null;
  let excl: number;
  let request: SalesAdvanceInvoiceRequest;
  if (choice.kind === 'PERCENT') {
    const pct = choice.pct;
    if (pct == null || !Number.isFinite(pct) || pct <= 0) return fail('Vul een percentage groter dan 0 in.');
    if (pct > 100) return fail('Een voorschot is hoogstens 100 % van de offerte.');
    if (Math.abs(pct * 10000 - Math.round(pct * 10000)) > 1e-6) return fail('Een percentage heeft hoogstens vier decimalen.');
    excl = round2(base * pct / 100);
    request = { percentage: pct, dueDate: due };
  } else {
    const amount = choice.amountEur;
    if (amount == null || !Number.isFinite(amount) || amount <= 0) return fail('Vul een bedrag groter dan € 0,00 in.');
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return fail('Een bedrag heeft hoogstens twee decimalen.');
    excl = round2(amount);
    request = { amountEur: excl, dueDate: due };
  }
  if (!(excl > 0)) return fail('Dit voorschot wordt € 0,00; kies een hoger percentage of bedrag.');
  if (excl > remaining + 0.005) {
    return fail(`Met dit voorschot zou meer gefactureerd worden dan de offerte (${euroText(base)} excl. btw); nog ${euroText(remaining)} te factureren.`, excl);
  }
  const vatEur = round2(excl * vatPct / 100);
  return { exclEur: excl, vatEur, inclEur: round2(excl + vatEur), vatPct, remainingAfterEur: round2(remaining - excl), error: null, request };
}

/** The last receipt's date, 'YYYY-MM-DD'. */
export function lastReceiptDate(receipts: readonly SalesAdvanceReceipt[] | null | undefined): string | null {
  const dates = (receipts ?? []).filter((receipt) => finite(receipt.amountEur) > 0 && !!receipt.receivedOn).map((receipt) => receipt.receivedOn).sort();
  return dates.at(-1) ?? null;
}

export interface AdvancePaymentState {
  label: string;
  cls: 'ok' | 'warn' | 'rose' | 'neutral';
  /** 'YYYY-MM-DD' once fully paid. */
  paidOn: string | null;
}

/** The pill of one advance on the quote: 'Betaald op dd/mm/jjjj', 'Deels betaald', 'Open' or the concept state. */
export function advancePaymentState(advance: Pick<SalesAdvanceInvoice, 'status' | 'receivedEur' | 'remainingEur' | 'paidAt' | 'receipts'>): AdvancePaymentState {
  if (advance.status === 'CONCEPT') return { label: 'Concept · nog niet uitgereikt', cls: 'neutral', paidOn: null };
  if (DEAD.has(advance.status)) return { label: 'Geannuleerd', cls: 'neutral', paidOn: null };
  const received = finite(advance.receivedEur), remaining = finite(advance.remainingEur);
  if ((received > 0 || advance.status === 'BETAALD') && remaining <= 0.005) {
    const paidOn = lastReceiptDate(advance.receipts) ?? (advance.paidAt ? advance.paidAt.slice(0, 10) : null);
    return { label: paidOn ? `Betaald op ${dayText(paidOn)}` : 'Betaald', cls: 'ok', paidOn };
  }
  if (received > 0) return { label: `Deels betaald · ${euroText(received)} ontvangen`, cls: 'warn', paidOn: null };
  return { label: 'Open', cls: 'rose', paidOn: null };
}

/** 'betaald op 05/04/2026', the receipts when paid in parts, or 'nog open': the slotfactuur's words. */
export function deductionPaidText(deduction: Pick<SalesAdvanceDeduction, 'paidOn' | 'receipts'>): string {
  if (deduction.paidOn) return `betaald op ${dayText(deduction.paidOn)}`;
  const parts = (deduction.receipts ?? []).filter((receipt) => finite(receipt.amountEur) > 0 && receipt.receivedOn);
  if (parts.length) return `deels betaald: ${parts.map((receipt) => `${euroText(receipt.amountEur)} op ${dayText(receipt.receivedOn)}`).join(', ')}`;
  return 'nog open';
}

export interface FinalInvoiceDeduction {
  advance: SalesAdvanceInvoice;
  /** Its issued credit notes excl. VAT (0 when none, or when an older backend does not say). */
  creditedExclEur: number;
  /** What the slotfactuur takes off: the advance excl. VAT minus those credit notes. */
  netExclEur: number;
}

export interface FinalInvoicePlan {
  advances: SalesAdvanceInvoice[];
  /** The issued advances the slotfactuur deducts; a fully credited one is left out, as the server does. */
  deductions: FinalInvoiceDeduction[];
  /** The guard that stops the slotfactuur, or null. */
  blocking: string | null;
  /** Σ deducted excl. VAT: each issued advance minus its issued credit notes. */
  deductedExclEur: number;
  /** The quote total excl. VAT minus the deductions: what the slotfactuur still asks. */
  balanceExclEur: number;
  /** The deductions exceed what is now on the quote. */
  negative: boolean;
  /** False against an older backend that does not send creditedExclEur: the amounts are then before credit notes. */
  creditsKnown: boolean;
}

/** What the slotfactuur will deduct, or null for a quote without advances (then it is an ordinary invoice). */
export function finalInvoicePlan(view: SalesOrderView | null | undefined): FinalInvoicePlan | null {
  const advances = liveAdvances(view);
  if (!view || !advances.length) return null;
  const concept = advances.find((advance) => advance.status === 'CONCEPT');
  const issued = advances.filter((advance) => advance.status !== 'CONCEPT');
  /* undefined = an older backend; null or a number = the server says (null meaning none). */
  const creditsKnown = issued.every((advance) => advance.creditedExclEur !== undefined);
  const deductions = issued.map((advance): FinalInvoiceDeduction => {
    const creditedExclEur = round2(Math.abs(finite(advance.creditedExclEur)));
    return { advance, creditedExclEur, netExclEur: round2(finite(advance.amountExclEur) - creditedExclEur) };
  }).filter((row) => row.netExclEur > 0);
  const deductedExclEur = round2(deductions.reduce((sum, row) => sum + row.netExclEur, 0));
  const balanceExclEur = round2(advanceBaseExcl(view) - deductedExclEur);
  return {
    advances, deductions,
    blocking: concept ? `Reik eerst voorschotfactuur ${concept.number} uit of verwijder ze.` : null,
    deductedExclEur, balanceExclEur, negative: balanceExclEur < 0, creditsKnown,
  };
}

/** The confirm before 'Slotfactuur maken', as plain text parts; the host escapes and joins them. */
export function finalInvoiceConfirmLines(view: SalesOrderView): string[] {
  const plan = finalInvoicePlan(view);
  if (!plan) return [];
  const rows = plan.advances.map((advance) => {
    const state = advancePaymentState(advance).label.toLowerCase();
    if (advance.status === 'CONCEPT') return `${advance.number} · ${euroText(advance.amountExclEur)} excl. btw · ${state}`;
    const row = plan.deductions.find((item) => item.advance.id === advance.id);
    if (!row) return `${advance.number} · volledig gecrediteerd · wordt niet afgetrokken`;
    return `${advance.number} · ${euroText(row.netExclEur)} excl. btw${row.creditedExclEur > 0 ? ' na creditnota' : ''} · ${state}`;
  });
  return [
    'De slotfactuur neemt de volledige offerte over en trekt deze voorschotfacturen af:',
    ...rows,
    `Saldo ${euroText(plan.balanceExclEur)} excl. btw${plan.creditsKnown ? '' : ' vóór creditnota\'s op de voorschotten'}; de btw wordt berekend op het saldo. Er wordt geen e-mail verstuurd.`,
  ];
}

export interface QuoteSettlement {
  /** The slotfactuur's id, to open it; null when only its number is known. */
  id: number | null;
  number: string;
  /** 'nog in concept', 'uitgereikt' or 'betaald'; '' when the server gave no status. */
  state: string;
}

/** On a quote whose slotfactuur (its own invoice) exists: which one and how far it is; null before. */
export function quoteSettlement(view: Pick<SalesOrderView, 'invoicedAs' | 'invoicedAsId' | 'invoiceStatus'> | null | undefined): QuoteSettlement | null {
  if (!view || !(view.invoicedAsId || view.invoicedAs)) return null;
  const status = view.invoiceStatus;
  const state = !status ? '' : status === 'CONCEPT' ? 'nog in concept' : status === 'BETAALD' ? 'betaald' : 'uitgereikt';
  return { id: view.invoicedAsId ?? null, number: view.invoicedAs || 'de slotfactuur', state };
}

/** A slotfactuur line the server owns: 'Voorschotfactuur F-… van dd/mm/jjjj'. It is never edited or removed here. */
export function isDeductionLine(description: string | null | undefined, deductions: readonly Pick<SalesAdvanceDeduction, 'number'>[] | null | undefined): boolean {
  const text = (description ?? '').trim();
  return !!text && (deductions ?? []).some((deduction) => !!deduction.number && text.startsWith(`Voorschotfactuur ${deduction.number}`));
}

/** 'Slotfactuur maken' once a quote has advances; the ordinary words otherwise. */
export function invoiceActionLabel(view: Pick<SalesOrderView, 'advanceInvoices'> | null | undefined, fallback: string): string {
  return liveAdvances(view).length ? 'Slotfactuur maken' : fallback;
}

export interface InvoiceConfirm { title: string; message: string; confirmLabel: string }

/**
 * The confirm before converting a quote: the ordinary invoice, or the
 * slotfactuur with the advances it deducts. `escape` is the host's HTML
 * escaper (the confirm renders markup); a concept advance refuses instead.
 */
export function invoiceConfirmOptions(view: SalesOrderView, escape: (value: string) => string): InvoiceConfirm | { refused: string } {
  const plan = finalInvoicePlan(view);
  const number = escape(view.order.number);
  if (!plan) {
    return {
      title: 'Factuur maken zonder versturen',
      message: `De inhoud van <b>${number}</b> komt in een nieuwe conceptfactuur. `
        + 'De offerte wordt gearchiveerd en blijft gekoppeld aan de factuur. Er wordt geen e-mail verstuurd.',
      confirmLabel: 'Conceptfactuur maken',
    };
  }
  if (plan.blocking) return { refused: plan.blocking };
  const [intro, ...rest] = finalInvoiceConfirmLines(view);
  const outro = rest.pop() ?? '';
  return {
    title: 'Slotfactuur maken',
    message: `<b>${number}</b> · ${escape(intro)}<br>${rest.map((row) => `· ${escape(row)}`).join('<br>')}<br>${escape(outro)}`
      + (!plan.negative ? ''
        : plan.creditsKnown ? '<br><b>Let op:</b> de voorschotten zijn hoger dan de offerte; uitreiken lukt pas na een creditnota op een voorschotfactuur.'
        : '<br><b>Let op:</b> vóór creditnota\'s zijn de voorschotten hoger dan de offerte; zonder creditnota op een voorschotfactuur lukt uitreiken niet.'),
    confirmLabel: 'Conceptslotfactuur maken',
  };
}
