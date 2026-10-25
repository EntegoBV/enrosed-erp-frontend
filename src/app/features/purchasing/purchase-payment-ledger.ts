import type {
  Currency, Instalment, Payee, PurchaseCreditOffset, PurchaseDocument, PurchaseInstalmentReconciliation, PurchaseInvoice, PurchaseInvoiceFile,
  PurchaseOrderView, PurchasePayment, PurchaseSupplierCredit, SupplierCreditReason, SupplierCreditStatus, SupplierCreditUpdate,
} from '../../core/api/models';
import type { PurchaseInstalmentState } from './purchase-instalment-state';

/**
 * The money going out of one container, per payee: one view model for the
 * desk workbench, the phone overview and their sheets.
 *
 * Every amount comes from the server's reconciliation; this module only
 * arranges it and adds what the server does not know: whether an open amount
 * is due now or later, and which payments still lack a betaalbewijs (a
 * payment on the bank is proven: the bank transaction is its proof; a
 * payment paid in parts is one row with its transfers underneath). The
 * server nets a payee's terms (a surplus on one covers a shortfall on
 * another), so nothing here adds up gross per-term gaps. Templates format the
 * figures with the pipes; only a status that names an amount ('Betaald ·
 * € 0,50 te veel') is written here. It counts in cents, so every row closes
 * exactly: Afspraak − Betaald − Minder betaald + Meer betaald = Open.
 */

export type Due = Instalment['due'];
type OrderStatus = PurchaseOrderView['order']['status'];

export const PAYEE_ORDER: readonly Payee[] = ['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'OTHER'];

/** The one vocabulary for payees. Kosten & bank copies these four labels into its cost ledger on purpose. */
export const PAYEE_LABEL: Readonly<Record<Payee, string>> = {
  SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten',
};
export const PAYEE_SHORT: Readonly<Record<Payee, string>> = {
  SUPPLIER: 'Leverancier', LOGISTICS: 'Transport', SEPARATE: 'Inspectie', OTHER: 'Bijkomend',
};
/** The goods box for the supplier: the 'suppliers' glyph is a lorry, too close to transport's. */
export const PAYEE_ICON: Readonly<Record<Payee, string>> = {
  SUPPLIER: 'purchase', LOGISTICS: 'truck', SEPARATE: 'search', OTHER: 'receipt',
};
/** Workspace kit tones, shared with Kosten & bank. */
export const PAYEE_TONE: Readonly<Record<Payee, string>> = {
  SUPPLIER: 'tone-accent', LOGISTICS: 'tone-blue', SEPARATE: 'tone-amber', OTHER: 'tone-grey',
};
/** What the supplier is paid for; the basis line and the composition share the word. */
export const SUPPLIER_GOODS = 'Goederen';
/** Under CIF the supplier also invoices the sea freight (and the origin costs). */
export const SUPPLIER_GOODS_CIF = 'Goederen + zeevracht (CIF)';

/**
 * CIF: the supplier arranges and invoices the sea freight, so origin costs
 * and freight sit in its Afspraak (payable.supplierFreightEur) and duty and
 * destination costs stay with Douane & transport. Never when the container is
 * DDP, which already includes all transport.
 */
export function purchaseCif(view: Pick<PurchaseOrderView, 'order' | 'payable'>): boolean {
  if (!view.order.freightViaSupplier) return false;
  const lines = view.order.lines ?? [];
  const ddp = view.payable?.ddp ?? (lines.length > 0 && lines.every(line => (line.priceBasis ?? 'EXW') === 'DDP'));
  return !ddp;
}
/** FREIGHT is the CIF supplier's 'Zeevracht (CIF)' term: due at departure, placed before any arrival term. */
export const DUE_ORDER: readonly Due[] = ['ORDERED', 'SHIPPED', 'FREIGHT', 'ARRIVED'];
export const DUE_MOMENT: Readonly<Record<Due, string>> = {
  ORDERED: 'bij bestelling', SHIPPED: 'bij vertrek', FREIGHT: 'bij vertrek', ARRIVED: 'bij aankomst',
};
/** The CIF term in words; the server names it the same in its instalment labels and PDFs ('zeevracht' in note lines). */
export const FREIGHT_TERM_LABEL = 'Zeevracht (CIF)';

/** A term's name when the server sent none: 'Termijn bij vertrek', or 'Zeevracht (CIF)'. */
export function dueFallbackLabel(due: Due): string {
  return due === 'FREIGHT' ? FREIGHT_TERM_LABEL : 'Termijn ' + DUE_MOMENT[due];
}

/**
 * From which order status an open amount counts as due now. The server only
 * knows the supplier's moments (its plan); the supplier list applies when no
 * plan exists. Transport is paid once the container sails, inspection before
 * loading. A frontend convention, tuned here and nowhere else; the first
 * status of each list is also the moment a later amount waits for.
 */
export const PAYEE_DUE_STATUSES: Readonly<Record<Exclude<Payee, 'OTHER'>, readonly OrderStatus[]>> = {
  SUPPLIER: ['BESTELD', 'ONDERWEG', 'ONTVANGEN'],
  LOGISTICS: ['ONDERWEG', 'ONTVANGEN'],
  SEPARATE: ['BESTELD', 'ONDERWEG', 'ONTVANGEN'],
};
const STATUS_DUE: Readonly<Record<OrderStatus, Due>> = {
  CONCEPT: 'ORDERED', BESTELD: 'ORDERED', ONDERWEG: 'SHIPPED', ONTVANGEN: 'ARRIVED',
};

/** 'Tegoed leverancier': why the supplier owes money back, and where that credit stands. */
export const SUPPLIER_CREDIT_REASON_LABEL: Readonly<Record<SupplierCreditReason, string>> = {
  SHORTAGE: 'Tekort', DAMAGE: 'Schade', PRICE: 'Prijsverschil', OTHER: 'Andere',
};
export const SUPPLIER_CREDIT_STATUS_LABEL: Readonly<Record<SupplierCreditStatus, string>> = {
  OPEN: 'Tegoed open', OFFSET: 'Verrekend', REFUNDED: 'Terugbetaald',
};

export type LedgerTone = 'warn' | 'ok' | 'neutral';
export type PayeeStatusKind = 'NONE' | 'ADDITIONAL' | 'INCOMPLETE' | 'UNBUDGETED' | 'OVERPAID' | 'FX' | 'SETTLED_HIGHER'
  | 'SETTLED_LOWER' | 'PAID' | 'PLANNED' | 'DUE' | 'LATER' | 'SMALL_DIFFERENCE' | 'PARTIAL';

export interface PayeeStatus { kind: PayeeStatusKind; label: string; tone: LedgerTone }

/** What a template asks for: record a payment, maybe for one payee, amount and term. */
export interface PurchasePaymentAction {
  payee: Payee;
  amount?: number;
  label?: string;
  due?: Due | null;
}

/** Settle a whole payee or one supplier term, optionally on a chosen payment. */
export interface PurchaseSettleRequest {
  payee: Payee;
  scope: 'GROUP' | 'TERM';
  due: Due | null;
  paymentId?: number | null;
}

/**
 * What a template asks of a supplier credit: note a new one (maybe for a
 * reason, e.g. from the receipt block), or act on an existing one.
 */
export type SupplierCreditAction =
  | { kind: 'add'; reason?: SupplierCreditReason }
  | { kind: 'edit' | 'refund' | 'offset' | 'remove' | 'undo-refund' | 'open-offset'; credit: PurchaseSupplierCredit };

/** One bank transfer of a payment: a never-split payment has one part, a payment paid in parts one per transfer. */
export interface LedgerPart {
  id: number;
  payment: PurchasePayment;
  paidOn: string;
  amount: number;
  currency: Currency;
  amountEur: number;
  bankStatementLineId: number | null;
  /** The hard link, or the 'containerbetaling #id' marker of an older line. */
  onBank: boolean;
  /** Proof files of this part (invoice files excluded); null while the documents load. */
  proofs: PurchaseDocument[] | null;
}

export interface LedgerRow {
  /**
   * The group id (= the root's id). `payment` is the member whose id equals
   * the group id, else (old data) the first part by paidOn, id. Group actions
   * (edit, settle, move, menus) address `row.payment.id`, never `row.id` blindly.
   */
  id: number;
  payment: PurchasePayment;
  /** ≥ 1, by paidOn then id. */
  parts: LedgerPart[];
  payee: Payee;
  payeeLabel: string;
  payeeShort: string;
  /** The newest part's day: one rule for the ledger, the sheet and Kosten & bank. */
  paidOn: string;
  /** The first part's day ('eerste 10/09' under a payment in parts); paidOn for a payment never split. */
  firstPaidOn: string;
  /** The description, or the payee when there is none. */
  title: string;
  label: string | null;
  due: Due | null;
  termLabel: string | null;
  settles: boolean;
  settlesLabel: string | null;
  /** The sum of the parts (in their currency when they share one). */
  amount: number;
  currency: Currency;
  foreign: boolean;
  /** As booked, the sum of the parts; never converted again. Not finite when an old payment lacks its euro value. */
  amountEur: number;
  /** Proof files of all parts, invoice files excluded; null while the documents are still loading. */
  proofs: PurchaseDocument[] | null;
  proofCount: number;
  /** Proof files present: decides whether the file button shows, never whether a betaalbewijs is missing (see proven). */
  hasProof: boolean | null;
  /** Every part noted on the bank: the line's hard link, or the 'containerbetaling #id' marker of an older line. */
  onBank: boolean;
  /** Parts on the bank, all parts, and the other payees of this order on the same bank line(s). */
  bank: { linked: number; total: number; sharedWith: Payee[] };
  /**
   * Has its betaalbewijs: a credit offset, or every part on the bank or with
   * a proof file. Null while the documents load and a part is neither on the
   * bank nor an offset. Every 'zonder betaalbewijs' reads proven === false.
   */
  proven: boolean | null;
  /** The invoice the server resolved this payment to; viaSupplier when it is another payee's (the supplier's for the inspection). */
  invoice: { id: number; number: string; documentId: number | null; viaSupplier: boolean } | null;
  /** Older invoice files hung on a part ('Factuurbestand openen'); never proof. */
  invoiceFiles: PurchaseDocument[];
  actor: string | null;
  recordedAt: string;
  /** This payment offsets a credit of another container: its amount belongs to that credit. */
  creditOffset: PurchaseCreditOffset | null;
}

/** One credit the supplier owes on this container, as the Tegoed leverancier block lists it. */
export interface LedgerCredit {
  id: number;
  credit: PurchaseSupplierCredit;
  notedOn: string;
  amount: number;
  currency: Currency;
  foreign: boolean;
  amountEur: number;
  reason: SupplierCreditReason;
  reasonLabel: string;
  note: string | null;
  status: SupplierCreditStatus;
  /** 'Tegoed open', 'Terugbetaald 12/09' or 'Verrekend met INK-2026-015'. */
  statusLabel: string;
  tone: LedgerTone;
  open: boolean;
}

export interface LedgerTerm {
  due: Due;
  label: string;
  moment: string;
  fullEur: number;
  /** Booked on this term, gross. */
  paidEur: number;
  /** Netted: what the payee's other terms did not cover. */
  openEur: number;
  lowerEur: number;
  higherEur: number;
  /**
   * The term's own difference: booked minus Afspraak plus what is still open
   * on it, because open money is not a difference. + meer, − minder; an
   * unpaid term without an offset shows 0. A payee's terms add up to its
   * Verschil (Meer betaald − Minder betaald).
   */
  differenceEur: number;
  /** + another term's surplus covered this shortfall, − this surplus covered another term; 0 for an older response. */
  offsetEur: number;
  /**
   * The term's unsettled overpayment when it is a koersverschil (ledgerFxRate): the foreign amount paid is the
   * foreign amount agreed, only the bank's euro differs. Then it equals higherEur; 0 otherwise.
   */
  fxEur: number;
  /** The labels of the terms this one was netted with. */
  offsetWith: string[];
  settled: boolean;
  finalized: boolean;
  state: PurchaseInstalmentState['state'];
  hasScopedPayment: boolean;
  /** The supplier payments tied to this term as ledger rows (group ids), newest first: 'Betaling aanpassen…' opens the first. */
  paymentIds: number[];
  canSettle: boolean;
  /**
   * Paid to the cent, tied to a payment and not flagged yet: settling only
   * confirms it ('Betaald · afgerekend'). Kept apart from canSettle, which
   * also picks the default term of the settle sheet.
   */
  canConfirm: boolean;
  canUndo: boolean;
  status: { label: string; tone: LedgerTone };
  /** What the pill leaves out, e.g. '€ 60,78 verrekend met 70% bij vertrek'; null when it says it all. */
  statusNote: string | null;
  /**
   * The same words for the desk's narrow Status column: the pill keeps 'Betaald · verrekend' and 'met 30% bij
   * bestelling' goes on the line under it. Null when the label is short enough to stand as one pill.
   */
  statusSplit: { pill: string; rest: string } | null;
}

export interface CompositionLine { label: string; amountEur: number; hint: string | null; rounding: boolean }

export interface LedgerNext {
  payee: Payee;
  due: Due | null;
  label: string;
  amountEur: number;
  /** True when it is due now; otherwise it waits for `when`. */
  now: boolean;
  /** 'nu' or the moment, e.g. 'bij vertrek'. */
  when: string;
}

export interface PayeeLedger {
  payee: Payee;
  label: string;
  short: string;
  icon: string;
  tone: string;
  /** What the agreement rests on, in words. */
  basis: string;
  known: boolean;
  /** Null for the bijkomende kosten: they have no agreement. */
  agreedEur: number | null;
  paidEur: number;
  openEur: number;
  lowerEur: number;
  higherEur: number;
  /**
   * The part of higherEur nobody settled yet: what 'Betaald · € 0,50 te veel'
   * and the review to-do name. A term settled on its own keeps its confirmed
   * overrun out of it, and a koersverschil (fxEur) is no overpayment to review.
   */
  reviewEur: number;
  /** The part of higherEur nobody settled yet that is a koersverschil: 'Koersverschil € 44,80 (bank)', neutral, never a to-do. */
  fxEur: number;
  differenceEur: number;
  dueNowEur: number;
  laterEur: number;
  laterDue: Due | null;
  finalized: boolean;
  explicitlySettled: boolean;
  missingAmount: boolean;
  balanced: boolean;
  paymentCount: number;
  rows: LedgerRow[];
  /** Rows with a betaalbewijs of the rows that need one (credit offsets need none); null while the documents are still loading. */
  proof: { withProof: number; total: number } | null;
  status: PayeeStatus;
  terms: LedgerTerm[];
  composition: CompositionLine[];
  compositionConsistent: boolean;
  canSettle: boolean;
  canUndoSettle: boolean;
  smallDifference: boolean;
  settleDefault: PurchaseSettleRequest;
  next: LedgerNext | null;
  /** The one text action of the payee's row on every screen: payeeRowAction. */
  action: 'add' | 'settle' | null;
  visible: boolean;
  /** Supplier only: the credits it owes back, newest first; they lower the eindkost, never Betaald or Open. */
  credits: LedgerCredit[];
  creditEur: number;
  /** The part of creditEur neither refunded nor offset yet. */
  creditOpenEur: number;
  /** Inspectie & andere kosten with the container's 'Inspectie via leverancier' on. */
  viaSupplier: boolean;
  /** SEPARATE with the flag: some payment already counts as paid via the supplier (same transfer, or not on the bank yet). */
  viaSupplierPaid: boolean;
  /** The payee's invoices, the primary first, and its invoice files without data. */
  invoices: PurchaseInvoice[];
  invoiceFiles: PurchaseInvoiceFile[];
  /** The inspection's own Afspraak (order.inspectionCostEur): what 'gelijk aan de afspraak + inspectie' compares with (payeeInvoiceComparison). */
  inspectionAgreedEur: number;
  /** SEPARATE via the supplier without an invoice of its own: the supplier's primary invoice. */
  supplierInvoice: PurchaseInvoice | null;
}

export type LedgerHeadlineKind = 'due' | 'later' | 'review' | 'done' | 'concept' | 'empty';

export interface LedgerSummary {
  agreedEur: number;
  paidOnAgreementEur: number;
  lowerEur: number;
  higherEur: number;
  differenceEur: number;
  openEur: number;
  dueNowEur: number;
  laterEur: number;
  /** Paid to the bijkomende kosten, outside every agreement. */
  additionalEur: number;
  /** The payees' overpayments still to review, and the koersverschil beside them (PayeeLedger.reviewEur, fxEur). */
  reviewEur: number;
  fxEur: number;
  paidTotalEur: number;
  /** Credits of the supplier (any status) and the part still to receive. */
  creditEur: number;
  creditOpenEur: number;
  /** Paid + open − the supplier's credits: the server's forecast. */
  forecastEur: number;
  progress: number;
  /** Widths in percent for the stacked bar: paid, due now, later, and where the agreement ends when paid beyond it. */
  meter: { paidPct: number; duePct: number; laterPct: number; agreedPct: number | null };
  balanced: boolean;
  known: boolean;
  paymentCount: number;
  missingProofCount: number | null;
  headline: { kind: LedgerHeadlineKind; payee: PayeeLedger | null };
  next: LedgerNext | null;
}

export type LedgerTodo =
  | { kind: 'pay'; key: string; payee: Payee; due: Due | null; label: string; amountEur: number }
  | { kind: 'settle' | 'review' | 'budget'; key: string; payee: Payee; amountEur: number; request: PurchaseSettleRequest }
  | { kind: 'incomplete'; key: string; payee: Payee }
  | { kind: 'credit'; key: string; payee: 'SUPPLIER'; amountEur: number; count: number }
  | { kind: 'proof'; key: string; count: number };

export interface BridgeRow {
  key: string;
  label: string;
  amountEur: number;
  note: string | null;
  /** The landed total as a running subtotal: shown, never added again. */
  subtotal?: boolean;
}

export interface LandedBridge {
  rows: BridgeRow[];
  totalLabel: string;
  totalEur: number;
  /** False when the parts miss the total by more than a euro; the total is then shown without an equals sign. */
  consistent: boolean;
}

export interface SettleCarrier {
  /** The group's root: one option per payment paid in parts. */
  id: number;
  payment: PurchasePayment;
  /** The bank transfers of the group (1 for a payment never split). */
  transfers: number;
  payee: Payee;
  paidOn: string;
  amount: number;
  currency: Currency;
  amountEur: number;
  instalmentDue: Due | null;
  label: string | null;
  settles: boolean;
  /** A supplier payment tied to a term that a whole-supplier settlement would spread again. */
  reallocates: boolean;
}

export interface PaymentLedgerInput {
  view: PurchaseOrderView;
  payments: readonly PurchasePayment[] | null;
  documents: readonly PurchaseDocument[] | null;
  /** purchaseInstalmentState of the plan, as the host shows it. */
  terms: readonly PurchaseInstalmentState[];
  /** purchaseGroupSettled; only used when an old response has no reconciliation. */
  settled: (payee: Payee) => boolean;
  toleranceEur: number;
  totalLabel: string;
  planLabel: string;
  /** Payments an older bank line marks by text; the host reads the markers, this module only shows them. */
  bankedPaymentIds?: ReadonlySet<number>;
}

export interface PaymentLedger {
  payees: PayeeLedger[];
  visible: PayeeLedger[];
  summary: LedgerSummary;
  rows: LedgerRow[];
  todos: LedgerTodo[];
  bridge: LandedBridge;
  known: boolean;
  /** The server sent per-term figures, so a payment may be tied to a term. */
  canonical: boolean;
}

const cents = (value: number | null | undefined): number => Math.round((value ?? 0) * 100);
const euro = (value: number): number => value / 100;
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
/** Cents as the eur pipe writes them, for the few status words that carry an amount. */
const eur = (value: number): string => EURO.format(euro(value));
/** '30% bij bestelling', '30% bij bestelling en 40% bij aankomst', 'a, b en c'. */
const listNl = (items: readonly string[]): string =>
  items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' en ' + items[items.length - 1];
const byNewest = (left: PurchasePayment, right: PurchasePayment): number =>
  right.paidOn.localeCompare(left.paidOn) || right.id - left.id;
const payeeOf = (payment: PurchasePayment): Payee => payment.payee ?? 'SUPPLIER';

const STATUS: Readonly<Record<Exclude<PayeeStatusKind, 'LATER'>, PayeeStatus>> = {
  NONE: { kind: 'NONE', label: 'Geen afspraak', tone: 'neutral' },
  ADDITIONAL: { kind: 'ADDITIONAL', label: 'Bijkomend', tone: 'neutral' },
  INCOMPLETE: { kind: 'INCOMPLETE', label: 'Onvolledig', tone: 'warn' },
  UNBUDGETED: { kind: 'UNBUDGETED', label: 'Betaald zonder afspraak', tone: 'warn' },
  /** Paid beyond the agreement, not settled yet: payeeStatus names the amount, 'Betaald · € 0,50 te veel'. */
  OVERPAID: { kind: 'OVERPAID', label: 'Betaald · te veel', tone: 'warn' },
  /** Paid, beyond the agreement only by the bank's exchange rate (the foreign amount is the agreed one): 'Koersverschil € 44,80 (bank)'. */
  FX: { kind: 'FX', label: 'Koersverschil (bank)', tone: 'neutral' },
  SETTLED_HIGHER: { kind: 'SETTLED_HIGHER', label: 'Afgerekend · meer betaald', tone: 'neutral' },
  SETTLED_LOWER: { kind: 'SETTLED_LOWER', label: 'Afgerekend · minder betaald', tone: 'ok' },
  PAID: { kind: 'PAID', label: 'Betaald', tone: 'ok' },
  PLANNED: { kind: 'PLANNED', label: 'Gepland', tone: 'neutral' },
  DUE: { kind: 'DUE', label: 'Nu te betalen', tone: 'warn' },
  SMALL_DIFFERENCE: { kind: 'SMALL_DIFFERENCE', label: 'Klein verschil', tone: 'warn' },
  PARTIAL: { kind: 'PARTIAL', label: 'Deels betaald', tone: 'neutral' },
};

/** The whole money-out picture of a container. */
export function purchasePaymentLedger(input: PaymentLedgerInput): PaymentLedger {
  const { view } = input;
  const payments = input.payments ?? [];
  const instalments = view.reconciliation?.supplierInstalments;
  const canonical = Array.isArray(instalments);
  const concept = view.order.status === 'CONCEPT';
  const rows = ledgerRows(payments, input.documents, instalments, view.creditOffsets ?? [], input.bankedPaymentIds, view.invoices ?? []);
  const rateOf = (currency: Currency) => ledgerFxRate(view, currency);
  const terms = ledgerTerms(input.terms, instalments, payments, rows, canonical, concept, rateOf);
  const payees = PAYEE_ORDER.map(payee => payeeLedger(payee, input, rows, payee === 'SUPPLIER' ? terms : [], canonical, concept, rateOf));
  const summary = ledgerSummary(input, payees, rows, concept);
  return {
    payees,
    visible: payees.filter(payee => payee.visible),
    summary,
    rows,
    todos: ledgerTodos(payees, summary),
    bridge: purchaseLandedBridge(view, input.totalLabel),
    known: summary.known,
    canonical,
  };
}

function payeeLedger(
  payee: Payee, input: PaymentLedgerInput, allRows: readonly LedgerRow[], terms: LedgerTerm[], canonical: boolean, concept: boolean,
  rateOf: (currency: Currency) => number | null,
): PayeeLedger {
  const { view } = input;
  const other = payee === 'OTHER';
  const stream = view.reconciliation?.streams.find(item => item.payee === payee);
  const rows = allRows.filter(row => row.payee === payee);
  const missingAmount = rows.some(row => !Number.isFinite(row.amountEur));
  const known = !!stream;
  let agreed: number | null;
  let paid: number;
  let open: number;
  let lower = 0;
  let higher = 0;
  let finalized = false;
  let explicitlySettled = false;
  if (stream) {
    agreed = other ? null : cents(stream.plannedEur);
    paid = cents(stream.paidEur);
    open = other ? 0 : cents(stream.remainingEur);
    lower = other ? 0 : cents(stream.settledSavingEur);
    higher = other ? 0 : cents(stream.overpaidEur);
    finalized = stream.finalized;
    explicitlySettled = stream.explicitlySettled;
  } else {
    // An old cached response without reconciliation: provisional figures, never a settled difference.
    agreed = other ? null : cents(legacyAgreed(payee, view));
    paid = rows.reduce((sum, row) => sum + (Number.isFinite(row.amountEur) ? cents(row.amountEur) : 0), 0);
    open = other || input.settled(payee) ? 0 : Math.max(0, (agreed ?? 0) - paid);
    if (paid > 0 && open <= cents(input.toleranceEur)) open = 0;
  }
  const balanced = other || !known || (agreed ?? 0) - paid - lower + higher === open;
  // Paid beyond the agreement and settled by nobody yet: the server's terms tell a confirmed overrun (a term settled on its own) from one to review.
  const unsettled = other || finalized ? 0 : canonical && terms.length
    ? terms.filter(term => !term.finalized).reduce((sum, term) => sum + cents(term.higherEur), 0) : higher;
  // Of that, what the bank's exchange rate made of a foreign amount paid as agreed: a koersverschil, not an overpayment to review.
  const fx = unsettled <= 0 ? 0 : canonical && terms.length
    ? terms.filter(term => !term.finalized).reduce((sum, term) => sum + cents(term.fxEur), 0)
    : payee === 'SUPPLIER' && stream && !purchaseCif(view)
      && paidAsAgreed(input.payments?.filter(payment => payeeOf(payment) === 'SUPPLIER') ?? [], cents(stream.paidEur), cents(stream.plannedEur), rateOf)
      ? unsettled : 0;
  const review = Math.max(0, unsettled - fx);

  let dueNow = 0;
  let later = 0;
  let laterDue: Due | null = null;
  if (!other && open > 0) {
    const firstLater = terms.find(term => term.state === 'later')?.due ?? null;
    const fallbackDue = STATUS_DUE[PAYEE_DUE_STATUSES[payee as Exclude<Payee, 'OTHER'>][0]];
    if (concept) {
      later = open;
      laterDue = firstLater ?? fallbackDue;
    } else if (payee === 'SUPPLIER' && terms.length) {
      dueNow = Math.min(open, terms.filter(term => term.state === 'due').reduce((sum, term) => sum + cents(term.openEur), 0));
      later = open - dueNow;
      laterDue = later > 0 ? firstLater : null;
    } else if (PAYEE_DUE_STATUSES[payee as Exclude<Payee, 'OTHER'>].includes(view.order.status)) {
      dueNow = open;
    } else {
      later = open;
      laterDue = fallbackDue;
    }
  }

  const settledRows = rows.some(row => row.settles);
  const status = payeeStatus({
    payee, known, agreed, paid, open, lower, higher, review, fx, finalized, explicitlySettled, settledRows, missingAmount, balanced,
    count: rows.length, dueNow, laterDue, concept, tolerance: cents(input.toleranceEur),
  });
  const composition = payeeComposition(payee, view, agreed === null ? null : euro(agreed));
  const credits = payee === 'SUPPLIER' ? ledgerCredits(view.supplierCredits ?? []) : [];
  const creditSum = credits.reduce((total, credit) => total + cents(credit.amountEur), 0);
  const credit = payee === 'SUPPLIER' ? (stream?.creditEur != null ? cents(stream.creditEur) : creditSum) : 0;
  const creditOpen = credits.filter(item => item.open).reduce((total, item) => total + cents(item.amountEur), 0);
  const openTerms = terms.filter(term => term.openEur > 0);
  // Netted terms are settled together: settling one on its own takes it out of the netting and reopens the other.
  const netted = terms.some(term => term.offsetEur !== 0);
  const settleDefault: PurchaseSettleRequest = payee === 'SUPPLIER' && canonical && !netted && openTerms.length === 1 && openTerms[0].hasScopedPayment
    ? { payee, scope: 'TERM', due: openTerms[0].due } : { payee, scope: 'GROUP', due: null };
  const term = payee === 'SUPPLIER'
    ? [...terms].sort((left, right) => DUE_ORDER.indexOf(left.due) - DUE_ORDER.indexOf(right.due))
      .find(item => item.openEur > 0 && !item.settled)
    : undefined;
  const next: LedgerNext | null = other || open <= 0 ? null : term
    ? { payee, due: term.due, label: term.label, amountEur: term.openEur, now: term.state === 'due',
      when: term.state === 'due' ? 'nu' : term.moment }
    : { payee, due: null, label: PAYEE_LABEL[payee], amountEur: euro(open), now: dueNow > 0,
      when: dueNow > 0 ? 'nu' : laterDue ? DUE_MOMENT[laterDue] : 'later' };

  const canSettle = !other && known && rows.length >= 1
    && (open > 0 || (higher > 0 && !finalized) || status.kind === 'UNBUDGETED');
  const invoices = [...(view.invoices ?? [])].filter(invoice => invoice.payee === payee).sort((left, right) => left.id - right.id);
  const invoiceFiles = (view.invoiceFiles ?? []).filter(file => file.payee === payee);
  const flag = !!view.order.inspectionViaSupplier;
  const via = payee === 'SEPARATE' && flag;
  const orderPayments = input.payments ?? [];
  const viaPaid = via && orderPayments.some(payment => paidViaSupplier(payment, orderPayments, flag));
  const supplierPrimary = [...(view.invoices ?? [])].filter(invoice => invoice.payee === 'SUPPLIER').sort((left, right) => left.id - right.id)[0] ?? null;
  return {
    payee,
    label: PAYEE_LABEL[payee],
    short: PAYEE_SHORT[payee],
    icon: PAYEE_ICON[payee],
    tone: PAYEE_TONE[payee],
    basis: payeeBasis(payee, view, terms.length > 0, input.planLabel),
    known,
    agreedEur: agreed === null ? null : euro(agreed),
    paidEur: euro(paid),
    openEur: euro(open),
    lowerEur: euro(lower),
    higherEur: euro(higher),
    reviewEur: euro(review),
    fxEur: euro(fx),
    differenceEur: euro(higher - lower),
    dueNowEur: euro(dueNow),
    laterEur: euro(later),
    laterDue,
    finalized,
    explicitlySettled,
    missingAmount,
    balanced,
    paymentCount: rows.length,
    rows,
    proof: input.documents === null ? null : {
      withProof: rows.filter(row => !row.creditOffset && row.proven === true).length, total: rows.filter(row => !row.creditOffset).length },
    status,
    terms,
    composition: composition.lines,
    compositionConsistent: composition.consistent,
    canSettle,
    canUndoSettle: settledRows,
    smallDifference: status.kind === 'SMALL_DIFFERENCE',
    settleDefault,
    next,
    action: payeeRowAction({ dueNowEur: euro(dueNow), canSettle, laterEur: euro(later), openEur: euro(open), smallDifference: status.kind === 'SMALL_DIFFERENCE' }),
    visible: payee === 'SUPPLIER' || rows.length > 0 || (!other && (agreed ?? 0) > 0) || invoices.length > 0 || invoiceFiles.length > 0 || via,
    credits,
    creditEur: euro(credit),
    creditOpenEur: euro(creditOpen),
    viaSupplier: via,
    viaSupplierPaid: viaPaid,
    invoices,
    invoiceFiles,
    inspectionAgreedEur: view.order.inspectionCostEur ?? 0,
    supplierInvoice: via && !invoices.length ? supplierPrimary : null,
  };
}


/** The supplier's credits, newest first, each with its reason and where it stands in words. */
export function ledgerCredits(credits: readonly PurchaseSupplierCredit[]): LedgerCredit[] {
  return [...credits].sort((left, right) => right.notedOn.localeCompare(left.notedOn) || right.id - left.id).map(credit => {
    const status = credit.status;
    const statusLabel = status === 'REFUNDED'
      ? SUPPLIER_CREDIT_STATUS_LABEL.REFUNDED + (credit.settledOn ? ' ' + dayMonth(credit.settledOn) : '')
      : status === 'OFFSET'
        ? SUPPLIER_CREDIT_STATUS_LABEL.OFFSET + (credit.offsetOrderNumber ? ' met ' + credit.offsetOrderNumber : '')
        : SUPPLIER_CREDIT_STATUS_LABEL.OPEN;
    return {
      id: credit.id,
      credit,
      notedOn: credit.notedOn,
      amount: credit.amount,
      currency: credit.currency,
      foreign: credit.currency !== 'EUR',
      amountEur: credit.amountEur,
      reason: credit.reason,
      reasonLabel: SUPPLIER_CREDIT_REASON_LABEL[credit.reason] ?? SUPPLIER_CREDIT_REASON_LABEL.OTHER,
      note: credit.note?.trim() || null,
      status,
      statusLabel,
      tone: status === 'OPEN' ? 'warn' : 'ok',
      open: status === 'OPEN',
    };
  });
}

/**
 * The containers a credit can be offset on: another order of the same
 * supplier that was ordered (not a concept), newest first; the server checks
 * the same rule.
 */
export function creditOffsetTargets(
  views: readonly PurchaseOrderView[], source: Pick<PurchaseOrderView['order'], 'id' | 'supplierId'>,
): PurchaseOrderView[] {
  return views.filter(view => view.order.id !== source.id && view.order.supplierId === source.supplierId && view.order.status !== 'CONCEPT')
    .sort((left, right) => right.order.orderDate.localeCompare(left.order.orderDate) || right.order.id - left.order.id);
}

/** '12/09' of an ISO day. */
function dayMonth(iso: string): string {
  return iso.slice(8, 10) + '/' + iso.slice(5, 7);
}

/**
 * What the Tegoed noteren sheet proposes for a reason, in euro: the value of
 * the missing pieces for a shortage, of the damaged ones for damage, from the
 * receipt (server receiptVariance), minus what earlier credits for the same
 * reason already claim. Null when there is nothing to propose.
 */
export function supplierCreditPrefill(view: Pick<PurchaseOrderView, 'receiptVariance' | 'supplierCredits'>, reason: SupplierCreditReason): number | null {
  const variance = view.receiptVariance;
  if (!variance || (reason !== 'SHORTAGE' && reason !== 'DAMAGE')) return null;
  const value = cents(reason === 'SHORTAGE' ? variance.missingValueEur : variance.damagedValueEur);
  const claimed = (view.supplierCredits ?? []).filter(credit => credit.reason === reason)
    .reduce((total, credit) => total + cents(credit.amountEur), 0);
  const rest = value - claimed;
  return rest > 0 ? euro(rest) : null;
}

/**
 * The euro an empty 'Afgeschreven in euro' field keeps when an open credit
 * is corrected: the stored one while amount and currency stay (the server
 * keeps it), null once either changes (the server takes the order rate).
 */
export function supplierCreditKeptEur(credit: Pick<PurchaseSupplierCredit, 'amount' | 'currency' | 'amountEur'>,
  amount: number | null, currency: Currency): number | null {
  return amount !== null && cents(amount) === cents(credit.amount) && currency === credit.currency ? credit.amountEur : null;
}

/**
 * The PUT body of 'Aanpassen…' on an open credit. The euro goes along only
 * when the buyer typed it for a USD/CNY credit, so a new amount or currency
 * gets a new euro value instead of the old one. The note is always sent: an
 * emptied one ('') clears it, where null would keep the stored note.
 */
export function supplierCreditEditBody(fields: {
  amount: number; currency: Currency; amountEur: number | null; reason: SupplierCreditReason; note: string;
}): SupplierCreditUpdate {
  return { amount: fields.amount, currency: fields.currency, reason: fields.reason, note: fields.note.trim(),
    ...(fields.currency !== 'EUR' && fields.amountEur !== null ? { amountEur: fields.amountEur } : {}) };
}

/**
 * The PUT body of 'Terugbetaald noteren…' on an open credit. A USD/CNY
 * credit keeps its amount and takes what reached the bank as its euro. A
 * euro credit's euro is its amount, so a refund of another sum (500 € noted,
 * 480 € back) changes the amount itself; to the cent it sends neither.
 */
export function supplierCreditRefundBody(credit: Pick<PurchaseSupplierCredit, 'amount' | 'currency'>,
  settledOn: string, refundEur: number): SupplierCreditUpdate {
  const body: SupplierCreditUpdate = { status: 'REFUNDED', settledOn };
  if (credit.currency !== 'EUR') return { ...body, amountEur: refundEur };
  return cents(refundEur) === cents(credit.amount) ? body : { ...body, amount: refundEur, amountEur: refundEur };
}

/**
 * The one text action of a payee row, shared by Betalingen and the
 * Nacalculatie: a small difference is settled rather than paid, what is due
 * is recorded, a remainder that is not scheduled for later (an overpayment, a
 * payment without budget) is settled, else money is recorded ahead of time;
 * a closed payee has only the ⋯ menu. Nothing is ever settled while a
 * remainder is scheduled later, a small one included.
 */
export function payeeRowAction(item: Pick<PayeeLedger, 'dueNowEur' | 'canSettle' | 'laterEur' | 'openEur' | 'smallDifference'>): 'add' | 'settle' | null {
  if (item.smallDifference && item.canSettle && item.laterEur === 0) return 'settle';
  if (item.dueNowEur > 0) return 'add';
  if (item.canSettle && item.laterEur === 0) return 'settle';
  return item.openEur > 0 ? 'add' : null;
}

/**
 * Whether a payee's Verschil is final: 'nakijken' while part of it is an
 * overpayment nobody settled yet, else 'afgerekend'. A saving only exists
 * once settled, so a term settled lower stays afgerekend while the next term
 * is still open.
 */
/** One line of an equation's difference: the sign, the words and the amount. */
export interface DifferenceLine { op: '−' | '+'; label: string; eur: number }

/**
 * The difference lines of an equation (summary or payee), netted like the desk's Verschil: a term paid more
 * and another paid less read as one figure, never as a gross minus and plus that only cancel out.
 * An overpayment still to review keeps its own line, because that is a to-do, not a settled difference.
 * Afspraak − Betaald (∓ these lines) = Open still holds to the cent.
 */
export function differenceLines(item: Pick<PayeeLedger, 'lowerEur' | 'higherEur' | 'reviewEur' | 'fxEur'>): DifferenceLine[] {
  const lower = cents(item.lowerEur);
  const higher = cents(item.higherEur);
  const higherLabel = `Meer betaald${item.reviewEur > 0 ? ' · nakijken' : item.fxEur > 0 ? ' · koersverschil (bank)' : ''}`;
  if (cents(item.reviewEur) > 0) {
    const lines: DifferenceLine[] = lower > 0 ? [{ op: '−', label: 'Minder betaald · afgerekend', eur: euro(lower) }] : [];
    return [...lines, { op: '+', label: higherLabel, eur: euro(higher) }];
  }
  const net = higher - lower;
  if (net === 0) return [];
  return [net < 0 ? { op: '−', label: 'Minder betaald · afgerekend', eur: euro(-net) } : { op: '+', label: higherLabel, eur: euro(net) }];
}

export function payeeDifferenceState(item: Pick<PayeeLedger, 'reviewEur'>): 'afgerekend' | 'nakijken' {
  return cents(item.reviewEur) > 0 ? 'nakijken' : 'afgerekend';
}

/**
 * A payee's Verschil in words where it has no column of its own: 'Koersverschil
 * € 44,80 (bank)' when the bank's exchange rate is all of it, else '€ 2.500,00
 * meer · nakijken', '€ 120,00 minder · afgerekend', with any koersverschil named
 * beside it.
 */
export function payeeDifferenceText(item: Pick<PayeeLedger, 'differenceEur' | 'reviewEur' | 'fxEur'>): string {
  const difference = cents(item.differenceEur);
  const fx = cents(item.fxEur);
  if (fx > 0 && fx === difference) return `Koersverschil ${eur(fx)} (bank)`;
  const words = `${eur(Math.abs(difference))} ${difference < 0 ? 'minder' : 'meer'}`;
  const koers = fx > 0 ? ` · koersverschil ${eur(fx)} (bank)` : '';
  return cents(item.reviewEur) > 0 ? `${words} · nakijken${koers}` : koers ? words + koers : `${words} · afgerekend`;
}

/** The word under a Verschil amount (payee, term, total): 'koersverschil (bank)' when the bank's rate is all of it, else meer or minder. */
export function differenceWord(item: { differenceEur: number; fxEur: number }): string {
  const fx = cents(item.fxEur);
  return fx > 0 && fx === cents(item.differenceEur) ? 'koersverschil (bank)' : item.differenceEur < 0 ? 'minder' : 'meer';
}

/** Under the headline Verschil: what is still to review, the koersverschil, or 'na afrekening'. */
export function ledgerDifferenceNote(summary: Pick<LedgerSummary, 'differenceEur' | 'reviewEur' | 'fxEur'>): string {
  const fx = cents(summary.fxEur);
  if (cents(summary.reviewEur) > 0) return fx > 0 ? `nog na te kijken · waarvan koersverschil ${eur(fx)} (bank)` : 'nog na te kijken';
  if (fx > 0) return fx === cents(summary.differenceEur) ? 'koersverschil (bank)' : `waarvan koersverschil ${eur(fx)} (bank)`;
  return 'na afrekening';
}

/**
 * The order rate of a foreign currency when the supplier's goods are agreed in
 * it: every order line that names its price currency names this one (a line
 * without one follows its product), at least one does, and the order has its
 * rates. Null otherwise: a euro agreement, mixed currencies, a missing rate.
 * Only the supplier's goods are agreed abroad; the CIF freight term converts
 * at the transport rate and stays out (ledgerTerms).
 */
export function ledgerFxRate(view: Pick<PurchaseOrderView, 'order'>, currency: Currency): number | null {
  if (currency === 'EUR') return null;
  const lines = view.order.lines ?? [];
  if (!lines.some(line => line.exwCurrency === currency) || lines.some(line => line.exwCurrency != null && line.exwCurrency !== currency)) return null;
  const usd = view.order.usdToEurGoods;
  if (!(Number.isFinite(usd) && usd > 0)) return null;
  if (currency === 'USD') return usd;
  const cny = view.order.cnyToUsd;
  return Number.isFinite(cny) && cny > 0 ? cny * usd : null;
}

/**
 * Koersverschil (Emre, 2026-10-15): a USD/CNY payment linked to its bank
 * transaction takes the bank's euro, so a term paid exactly its foreign amount
 * can still differ from its euro Afspraak. True when these payments are all of
 * what was booked (paidCents) and, in the agreement's currency at the order
 * rate, land on the Afspraak within 0.01 of that currency, plus the euro cent
 * the Afspraak itself was rounded to.
 */
function paidAsAgreed(payments: readonly PurchasePayment[], paidCents: number, plannedCents: number, rateOf: (currency: Currency) => number | null): boolean {
  if (!payments.length || plannedCents <= 0) return false;
  const currency = payments[0].currency;
  const rate = rateOf(currency);
  if (rate === null || payments.some(payment => payment.currency !== currency || !Number.isFinite(payment.amount) || !Number.isFinite(payment.amountEur))) return false;
  // Untied money that landed on the term (or a part of another payee's line) has no foreign amount here: no claim.
  if (payments.reduce((sum, payment) => sum + cents(payment.amountEur), 0) !== paidCents) return false;
  const foreign = payments.reduce((sum, payment) => sum + cents(payment.amount), 0);
  return Math.abs(foreign * rate - plannedCents) <= rate + 1 + 1e-9;
}

/**
 * The one word per payee. A payee paid in full reads 'Betaald · afgerekend'
 * as soon as any of its payments carries a settlement, a whole-payee one or
 * a term's: that is exactly when the row offers to undo it.
 */
function payeeStatus(values: {
  payee: Payee; known: boolean; agreed: number | null; paid: number; open: number; lower: number; higher: number; review: number; fx: number;
  finalized: boolean; explicitlySettled: boolean; settledRows: boolean; missingAmount: boolean; balanced: boolean; count: number;
  dueNow: number; laterDue: Due | null; concept: boolean; tolerance: number;
}): PayeeStatus {
  const { agreed, paid, open, lower, higher, finalized } = values;
  if (values.payee === 'OTHER') return values.count ? (values.missingAmount ? STATUS.INCOMPLETE : STATUS.ADDITIONAL) : STATUS.NONE;
  if (values.missingAmount || !values.balanced) return STATUS.INCOMPLETE;
  if (agreed === 0 && paid === 0) return STATUS.NONE;
  if (agreed === 0) return finalized ? STATUS.SETTLED_HIGHER : STATUS.UNBUDGETED;
  if (open === 0 && (lower > 0 || higher > 0)) {
    // Only what is still to review: a term settled on its own already confirmed its overrun; the bank's koersverschil is neutral.
    if (!finalized && higher > 0 && values.review <= 0 && values.fx > 0) return { ...STATUS.FX, label: `Koersverschil ${eur(values.fx)} (bank)` };
    if (!finalized && higher > 0) return { ...STATUS.OVERPAID, label: `Betaald · ${eur(values.review > 0 ? values.review : higher)} te veel` };
    const net = higher - lower;
    return net > 0 ? STATUS.SETTLED_HIGHER : net < 0 ? STATUS.SETTLED_LOWER : STATUS.PAID;
  }
  if (open === 0) return values.explicitlySettled || values.settledRows ? { ...STATUS.PAID, label: 'Betaald · afgerekend' } : STATUS.PAID;
  if (paid === 0) {
    if (values.concept) return STATUS.PLANNED;
    if (values.dueNow > 0) return STATUS.DUE;
    return { kind: 'LATER', label: values.laterDue ? 'Later · ' + DUE_MOMENT[values.laterDue] : 'Later', tone: 'neutral' };
  }
  if (values.known && !values.explicitlySettled && open <= values.tolerance) return STATUS.SMALL_DIFFERENCE;
  return values.dueNow > 0 ? { ...STATUS.PARTIAL, tone: 'warn' } : STATUS.PARTIAL;
}

function payeeBasis(payee: Payee, view: PurchaseOrderView, hasPlan: boolean, planLabel: string): string {
  const cif = purchaseCif(view);
  switch (payee) {
    case 'SUPPLIER': return (cif ? SUPPLIER_GOODS_CIF : SUPPLIER_GOODS) + ' · ' + (hasPlan ? planLabel : 'geen betaalplan');
    case 'LOGISTICS': return view.payable?.ddp ? 'Inbegrepen in de prijs (DDP)'
      : cif ? 'Afspraak: invoerrechten en lokale kosten aankomst · zeevracht via de leverancier (CIF)'
      : 'Afspraak: vracht, lokale kosten en invoerrechten';
    case 'SEPARATE': return separateBasis(view);
    default: return 'Bankkosten, koerier, wisselkoers · zonder afspraak';
  }
}

/**
 * What the Afspraak of Inspectie & andere kosten is made of, in the owner's
 * word (never 'raming'): 'Afspraak inspectie € 300,00 · via leverancier',
 * 'Afspraak inspectie € 300,00 + andere € 120,00'. The amounts come from
 * Kosten, as the composition rows list them.
 */
function separateBasis(view: PurchaseOrderView): string {
  const totals = view.costing.totals;
  const inspection = cents(totals.inspectionEur);
  const other = cents(totals.otherCostsEur ?? (totals.otherCosts ?? []).reduce((sum, cost) => sum + (cost.amountEur ?? 0), 0));
  const parts = inspection && other ? `inspectie ${eur(inspection)} + andere ${eur(other)}`
    : inspection ? `inspectie ${eur(inspection)}` : other ? `andere kosten ${eur(other)}` : 'inspectie en andere kosten';
  return `Afspraak ${parts}` + (view.order.inspectionViaSupplier ? ' · via leverancier' : '');
}

function legacyAgreed(payee: Payee, view: PurchaseOrderView): number {
  switch (payee) {
    case 'SUPPLIER': return view.payable?.supplierEur ?? view.costing.totals.goodsEur;
    case 'LOGISTICS': return view.payable?.logisticsEur ?? 0;
    case 'SEPARATE': return view.costing.totals.separateCostsEur ?? 0;
    default: return 0;
  }
}

function ledgerTerms(
  states: readonly PurchaseInstalmentState[], instalments: readonly PurchaseInstalmentReconciliation[] | undefined,
  payments: readonly PurchasePayment[], rows: readonly LedgerRow[], canonical: boolean, concept: boolean,
  rateOf: (currency: Currency) => number | null,
): LedgerTerm[] {
  const supplier = payments.filter(payment => payeeOf(payment) === 'SUPPLIER');
  const offsets = states.map(state => cents(state.offset));
  /** The terms netted the other way: a covered term names the terms whose surplus covered it, and the other way round. */
  const nettedWith = (offset: number): string[] => offset === 0 ? []
    : states.filter((_, index) => Math.sign(offsets[index]) === -Math.sign(offset)).map(state => state.label);
  /*
   * Koersverschil: the supplier's foreign payments are its foreign Afspraak when every term that money was
   * booked on or netted with was paid exactly its foreign amount (paidAsAgreed). A term short or over in the
   * foreign currency itself, or one only netted (no payment of its own), keeps today's words on every term; the
   * CIF freight term converts at its own rate and never counts as paid as agreed.
   */
  const asAgreed = states.map(state => {
    const server = instalments?.find(item => item.due === state.due);
    return !!server && state.due !== 'FREIGHT' && paidAsAgreed(supplier.filter(payment => payment.instalmentDue === state.due),
      cents(server.paidEur), cents(server.plannedEur), rateOf);
  });
  // A term settled on its own stays out (as it does of the netting); a term closed by netting is in.
  const involved = states.map((state, index) => !state.settled && (cents(state.covered) > 0 || offsets[index] !== 0));
  const paidAsAgreedAll = !concept && involved.some(Boolean) && involved.every((on, index) => !on || asAgreed[index]);
  return states.map((state, index) => {
    const server = instalments?.find(item => item.due === state.due);
    const lower = cents(server?.settledSavingEur);
    const higher = cents(server?.overpaidEur);
    const finalized = server?.finalized ?? false;
    const offset = offsets[index];
    const open = cents(state.amount);
    const offsetWith = nettedWith(offset);
    const verrekend = 'verrekend met ' + listNl(offsetWith);
    // Own difference plus what is still open on the term: an unpaid term differs by nothing, a covered one by its shortfall.
    const difference = server ? cents(server.paidEur) - cents(server.plannedEur) + cents(server.remainingEur) : higher - lower;
    const scoped = supplier.filter(payment => payment.instalmentDue === state.due).sort(byNewest);
    const moment = DUE_MOMENT[state.due];
    // What is still overpaid on the term is the bank's koersverschil when the supplier's foreign payments are its foreign Afspraak.
    const fx = paidAsAgreedAll && asAgreed[index] && higher > 0 && !finalized ? higher : 0;
    const koers: LedgerTerm['status'] = { label: `Koersverschil ${eur(fx)} (bank)`, tone: 'neutral' };
    const status: LedgerTerm['status'] = concept ? { label: 'Gepland', tone: 'neutral' }
      : state.settled && lower > 0 ? { label: 'Afgerekend · minder betaald', tone: 'ok' }
      : higher > 0 && finalized ? { label: 'Afgerekend · meer betaald', tone: 'neutral' }
      : offset > 0 && open === 0 ? { label: 'Betaald · ' + verrekend, tone: 'ok' }
      : offset < 0 && higher > 0 ? fx > 0 ? koers : { label: `Betaald · ${eur(higher)} te veel`, tone: 'warn' }
      : offset < 0 ? { label: 'Betaald · ' + verrekend, tone: 'ok' }
      : higher > 0 ? fx > 0 ? koers : { label: 'Te veel betaald · nakijken', tone: 'warn' }
      : state.settled && state.state === 'paid' ? { label: 'Betaald · afgerekend', tone: 'ok' }
      : state.state === 'paid' ? { label: 'Betaald', tone: 'ok' }
      : state.state === 'due' ? { label: state.covered > 0 || offset > 0 ? 'Deels betaald' : 'Nu te betalen', tone: 'warn' }
      : { label: 'Later · ' + moment, tone: 'neutral' };
    // A term settled on its own, or a netted term, is never settled alone again: that would reopen the term it was netted with.
    const alone = canonical && scoped.length > 0 && !state.settled && offset === 0;
    return {
      due: state.due,
      label: state.label,
      moment,
      fullEur: state.full,
      paidEur: state.covered,
      openEur: state.amount,
      lowerEur: euro(lower),
      higherEur: euro(higher),
      differenceEur: euro(difference),
      offsetEur: euro(offset),
      fxEur: euro(fx),
      offsetWith,
      settled: state.settled,
      finalized,
      state: state.state,
      hasScopedPayment: scoped.length > 0,
      // One entry per payment paid in parts: the term menu opens the group, not only its newest transfer.
      paymentIds: rows.filter(row => row.payee === 'SUPPLIER' && row.parts.some(part => part.payment.instalmentDue === state.due)).map(row => row.id),
      canSettle: alone && (state.amount > 0 || (higher > 0 && !finalized)),
      canConfirm: alone && !scoped.some(payment => payment.settles) && state.state === 'paid' && lower === 0 && higher === 0,
      canUndo: scoped.some(payment => payment.settles),
      status,
      statusNote: offset !== 0 && !concept && !status.label.includes(verrekend) ? `${eur(Math.abs(offset))} ${verrekend}` : null,
      statusSplit: status.label === 'Betaald · ' + verrekend ? { pill: 'Betaald · verrekend', rest: 'met ' + listNl(offsetWith) } : null,
    };
  });
}

function ledgerRows(
  payments: readonly PurchasePayment[], documents: readonly PurchaseDocument[] | null,
  instalments: readonly PurchaseInstalmentReconciliation[] | undefined, offsets: readonly PurchaseCreditOffset[],
  banked: ReadonlySet<number> | undefined, invoices: readonly PurchaseInvoice[],
): LedgerRow[] {
  const byDay = (left: PurchasePayment, right: PurchasePayment): number => left.paidOn.localeCompare(right.paidOn) || left.id - right.id;
  const groups = new Map<number, PurchasePayment[]>();
  for (const payment of payments) {
    const key = payment.groupId ?? payment.id;
    groups.set(key, [...(groups.get(key) ?? []), payment]);
  }
  const rows: LedgerRow[] = [];
  for (const [key, members] of groups) {
    const sorted = [...members].sort(byDay);
    const root = sorted.find(payment => payment.id === key) ?? sorted[0];
    // A part whose payee drifted from its root's (an old cached screen edited one part) is shown as its own row.
    const own = sorted.filter(payment => payeeOf(payment) === payeeOf(root));
    rows.push(ledgerRow(key, root, own, payments, documents, instalments, offsets, banked, invoices));
    for (const drifted of sorted.filter(payment => payeeOf(payment) !== payeeOf(root))) {
      rows.push(ledgerRow(drifted.id, drifted, [drifted], payments, documents, instalments, offsets, banked, invoices));
    }
  }
  return rows.sort((left, right) => right.paidOn.localeCompare(left.paidOn) || right.id - left.id);
}

function ledgerRow(
  id: number, root: PurchasePayment, members: readonly PurchasePayment[], all: readonly PurchasePayment[],
  documents: readonly PurchaseDocument[] | null, instalments: readonly PurchaseInstalmentReconciliation[] | undefined,
  offsets: readonly PurchaseCreditOffset[], banked: ReadonlySet<number> | undefined, invoices: readonly PurchaseInvoice[],
): LedgerRow {
  const payee = payeeOf(root);
  const due = root.instalmentDue ?? null;
  const creditOffset = offsets.find(offset => offset.paymentId === root.id) ?? null;
  const parts: LedgerPart[] = members.map(payment => ({
    id: payment.id, payment, paidOn: payment.paidOn, amount: payment.amount, currency: payment.currency, amountEur: payment.amountEur,
    bankStatementLineId: payment.bankStatementLineId ?? null,
    onBank: payment.bankStatementLineId != null || (banked?.has(payment.id) ?? false),
    proofs: documents === null ? null : documents.filter(document => document.paymentId === payment.id && !invoiceFile(document, invoices)),
  }));
  const ids = new Set(parts.map(part => part.id));
  const proofs = documents === null ? null : parts.flatMap(part => part.proofs ?? []);
  const sameCurrency = parts.every(part => part.currency === root.currency);
  const finite = parts.every(part => Number.isFinite(part.amountEur));
  const amountEur = finite ? euro(parts.reduce((sum, part) => sum + cents(part.amountEur), 0)) : Number.NaN;
  const lines = new Set(parts.map(part => part.bankStatementLineId).filter((line): line is number => line !== null));
  const sharedWith = PAYEE_ORDER.filter(other => other !== payee
    && all.some(payment => payeeOf(payment) === other && payment.bankStatementLineId != null && lines.has(payment.bankStatementLineId)));
  const linked = parts.filter(part => part.onBank).length;
  const proven = creditOffset ? true
    : parts.every(part => part.onBank || (part.proofs?.length ?? 0) > 0) ? true
    : parts.some(part => !part.onBank && part.proofs === null) ? null : false;
  const invoice = invoices.find(item => item.paymentIds?.some(paymentId => ids.has(paymentId))) ?? null;
  const newest = parts[parts.length - 1];
  return {
    id,
    payment: root,
    parts,
    payee,
    payeeLabel: PAYEE_LABEL[payee],
    payeeShort: PAYEE_SHORT[payee],
    paidOn: newest.paidOn,
    firstPaidOn: parts[0].paidOn,
    title: root.label?.trim() || (creditOffset ? ('Verrekend tegoed ' + (creditOffset.sourceOrderNumber ?? '')).trim() : PAYEE_LABEL[payee]),
    label: root.label?.trim() || null,
    due,
    termLabel: termLabel(due, instalments),
    settles: !!root.settles,
    settlesLabel: root.settles ? (due ? 'Rekent de termijn af' : 'Rekent alles af') : null,
    amount: sameCurrency ? parts.reduce((sum, part) => sum + cents(part.amount), 0) / 100 : amountEur,
    currency: sameCurrency ? root.currency : 'EUR',
    foreign: sameCurrency && root.currency !== 'EUR',
    amountEur,
    proofs,
    proofCount: proofs?.length ?? 0,
    hasProof: proofs === null ? null : proofs.length > 0,
    onBank: linked === parts.length,
    bank: { linked, total: parts.length, sharedWith },
    proven,
    invoice: invoice ? { id: invoice.id, number: invoice.number, documentId: invoice.documentId ?? null, viaSupplier: invoice.payee !== payee } : null,
    // Legacy invoice files without data: a file an invoice now points to opens through 'Factuur openen'.
    invoiceFiles: documents === null ? [] : documents.filter(document => document.paymentId !== null && ids.has(document.paymentId)
      && invoiceFile(document, invoices) && !invoices.some(item => item.documentId === document.id)),
    actor: root.actor,
    recordedAt: root.recordedAt,
    creditOffset,
  };
}

/*
 * Two rules of purchase-invoices.ts (isInvoiceFile, viaSupplier), repeated
 * here because node-tested modules import types only; the tests of both
 * modules pin the same cases.
 */
const LEGACY_INVOICE_LABELS = ['Factuur', 'Factuur inspectie', 'Factuur transport'];
function invoiceFile(doc: PurchaseDocument, invoices: readonly PurchaseInvoice[]): boolean {
  return doc.kind === 'COMMERCIAL_INVOICE' || doc.kind === 'PROFORMA_INVOICE' || doc.kind === 'INVOICE' || invoices.some(invoice => invoice.documentId === doc.id)
    || (doc.kind === 'OTHER' && LEGACY_INVOICE_LABELS.includes((doc.label ?? '').trim()));
}
function paidViaSupplier(payment: PurchasePayment, all: readonly PurchasePayment[], flag: boolean): boolean {
  if (!flag || payeeOf(payment) !== 'SEPARATE') return false;
  const line = payment.bankStatementLineId ?? null;
  return line === null || all.some(other => payeeOf(other) === 'SUPPLIER' && other.bankStatementLineId === line);
}

function termLabel(due: Due | null, instalments: readonly PurchaseInstalmentReconciliation[] | undefined): string | null {
  if (!due) return null;
  return instalments?.find(item => item.due === due)?.label ?? dueFallbackLabel(due);
}

/** Newest first by date, or largest first by euro amount; ties keep the newest entry on top. */
export function sortLedgerRows(rows: readonly LedgerRow[], key: 'date' | 'amount', dir: 'asc' | 'desc'): LedgerRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const amount = (row: LedgerRow) => Number.isFinite(row.amountEur) ? cents(row.amountEur) : Number.NEGATIVE_INFINITY;
  return [...rows].sort((left, right) => {
    const primary = key === 'date' ? left.paidOn.localeCompare(right.paidOn) : Math.sign(amount(left) - amount(right));
    return primary * sign || (left.id - right.id) * sign;
  });
}

function ledgerSummary(input: PaymentLedgerInput, payees: readonly PayeeLedger[], rows: readonly LedgerRow[], concept: boolean): LedgerSummary {
  const agreements = payees.filter(payee => payee.payee !== 'OTHER');
  const sum = (field: 'agreedEur' | 'paidEur' | 'lowerEur' | 'higherEur' | 'openEur' | 'dueNowEur' | 'laterEur') =>
    agreements.reduce((total, payee) => total + cents(payee[field]), 0);
  const agreed = sum('agreedEur');
  const paid = sum('paidEur');
  const lower = sum('lowerEur');
  const higher = sum('higherEur');
  const open = sum('openEur');
  const dueNow = sum('dueNowEur');
  const later = sum('laterEur');
  const additional = cents(payees.find(payee => payee.payee === 'OTHER')?.paidEur);
  const review = agreements.reduce((total, payee) => total + cents(payee.reviewEur), 0);
  const fx = agreements.reduce((total, payee) => total + cents(payee.fxEur), 0);
  const supplier = payees.find(payee => payee.payee === 'SUPPLIER');
  const credit = cents(supplier?.creditEur);
  const creditOpen = cents(supplier?.creditOpenEur);
  const serverPaid = input.view.reconciliation?.totals.paidEur;
  const paidTotal = serverPaid != null ? cents(serverPaid)
    : rows.reduce((total, row) => total + (Number.isFinite(row.amountEur) ? cents(row.amountEur) : 0), 0);
  const scale = Math.max(agreed, paid + open);
  const pct = (value: number) => scale > 0 ? Math.min(100, (value / scale) * 100) : 0;
  // A koersverschil (status FX) is no review: the headline reads done or later.
  const reviewed = agreements.find(payee => ['OVERPAID', 'UNBUDGETED', 'INCOMPLETE'].includes(payee.status.kind)) ?? null;
  const kind: LedgerHeadlineKind = concept ? 'concept'
    : agreed === 0 && rows.length === 0 ? 'empty'
    : dueNow > 0 ? 'due'
    : reviewed ? 'review'
    : open > 0 ? 'later' : 'done';
  const nexts = payees.map(payee => payee.next).filter((next): next is LedgerNext => next !== null);
  const next = nexts.find(item => item.now) ?? nexts[0] ?? null;
  return {
    agreedEur: euro(agreed),
    paidOnAgreementEur: euro(paid),
    lowerEur: euro(lower),
    higherEur: euro(higher),
    differenceEur: euro(higher - lower),
    openEur: euro(open),
    dueNowEur: euro(dueNow),
    laterEur: euro(later),
    additionalEur: euro(additional),
    reviewEur: euro(review),
    fxEur: euro(fx),
    paidTotalEur: euro(paidTotal),
    creditEur: euro(credit),
    creditOpenEur: euro(creditOpen),
    forecastEur: euro(paidTotal + open - credit),
    progress: agreed > 0 ? Math.min(1, paid / agreed) : 0,
    meter: { paidPct: pct(paid), duePct: pct(dueNow), laterPct: pct(later), agreedPct: higher > 0 ? pct(agreed) : null },
    balanced: payees.every(payee => payee.balanced),
    known: !!input.view.reconciliation,
    paymentCount: rows.length,
    // Rows (payments, not their transfers), so the chip, the filter and the list agree.
    missingProofCount: rows.some(row => row.proven === null) ? null : rows.filter(row => row.proven === false).length,
    headline: {
      kind,
      payee: kind === 'review' ? reviewed : kind === 'due' || kind === 'later'
        ? payees.find(payee => payee.payee === next?.payee) ?? null : null,
    },
    next,
  };
}

function ledgerTodos(payees: readonly PayeeLedger[], summary: LedgerSummary): LedgerTodo[] {
  const todos: LedgerTodo[] = [];
  for (const payee of payees) {
    if (payee.payee === 'SUPPLIER' && payee.terms.length) {
      for (const term of payee.terms) {
        if (term.state === 'due' && term.openEur > 0 && !term.settled) {
          todos.push({ kind: 'pay', key: 'pay:SUPPLIER:' + term.due, payee: 'SUPPLIER', due: term.due, label: term.label, amountEur: term.openEur });
        }
      }
    } else if (payee.payee !== 'OTHER' && payee.dueNowEur > 0) {
      todos.push({ kind: 'pay', key: 'pay:' + payee.payee, payee: payee.payee, due: null, label: payee.label, amountEur: payee.dueNowEur });
    }
  }
  for (const payee of payees) {
    if (payee.smallDifference) todos.push({ kind: 'settle', key: 'settle:' + payee.payee, payee: payee.payee, amountEur: payee.openEur, request: payee.settleDefault });
  }
  for (const payee of payees) {
    if (payee.status.kind === 'OVERPAID') {
      todos.push({ kind: 'review', key: 'review:' + payee.payee, payee: payee.payee, amountEur: payee.reviewEur > 0 ? payee.reviewEur : payee.higherEur,
        request: { payee: payee.payee, scope: 'GROUP', due: null } });
    }
  }
  for (const payee of payees) {
    if (payee.status.kind === 'UNBUDGETED') {
      todos.push({ kind: 'budget', key: 'budget:' + payee.payee, payee: payee.payee, amountEur: payee.paidEur,
        request: { payee: payee.payee, scope: 'GROUP', due: null } });
    }
  }
  for (const payee of payees) {
    if (payee.status.kind === 'INCOMPLETE') todos.push({ kind: 'incomplete', key: 'incomplete:' + payee.payee, payee: payee.payee });
  }
  const supplier = payees.find(payee => payee.payee === 'SUPPLIER');
  const openCredits = supplier?.credits.filter(credit => credit.open) ?? [];
  if (supplier && openCredits.length && supplier.creditOpenEur > 0) {
    todos.push({ kind: 'credit', key: 'credit:SUPPLIER', payee: 'SUPPLIER', amountEur: supplier.creditOpenEur, count: openCredits.length });
  }
  if (summary.missingProofCount) todos.push({ kind: 'proof', key: 'proof', count: summary.missingProofCount });
  return todos;
}

/**
 * What an agreement is made of, for reading only: a payment has no cost-line
 * reference, so paid amounts stay per payee. A difference up to a euro is
 * rounding; beyond that the estimate in Kosten no longer matches.
 */
export function payeeComposition(payee: Payee, view: PurchaseOrderView, agreedEur: number | null): { lines: CompositionLine[]; consistent: boolean } {
  const totals = view.costing.totals;
  const labels = view.costLabels;
  const line = (label: string, amountEur: number | null | undefined, hint: string | null = null): CompositionLine =>
    ({ label, amountEur: euro(cents(amountEur)), hint, rounding: false });
  let lines: CompositionLine[] = [];
  const cif = purchaseCif(view);
  // Under CIF the transport before the EU border moves from Douane & transport to the supplier; duty and arrival costs stay.
  const transport = () => [
    line(labels?.originCostsLabel ?? 'Lokale kosten vertrek', totals.originEur),
    line(labels?.seaFreightLabel ?? 'Zeevracht', totals.freightEur, labels?.seaFreightRoute ?? null),
  ];
  if (payee === 'SUPPLIER') {
    lines = [line(SUPPLIER_GOODS, totals.goodsEur), ...(cif ? transport() : [])];
  } else if (payee === 'LOGISTICS' && !view.payable?.ddp) {
    lines = [
      ...(cif ? [] : transport()),
      line('Invoerrechten', totals.dutyEur),
      line(labels?.destinationCostsLabel ?? 'Lokale kosten aankomst', totals.destinationEur),
    ];
  } else if (payee === 'SEPARATE') {
    lines = [line('Inspectie', totals.inspectionEur),
      ...(totals.otherCosts ?? []).map(cost => line(cost.label || 'Andere kost', cost.amountEur ?? 0))];
  }
  lines = lines.filter(item => cents(item.amountEur) !== 0);
  if (agreedEur === null || !lines.length) return { lines, consistent: true };
  const residue = cents(agreedEur) - lines.reduce((sum, item) => sum + cents(item.amountEur), 0);
  if (Math.abs(residue) > 100) return { lines, consistent: false };
  if (residue !== 0) lines.push({ label: 'Afronding', amountEur: euro(residue), hint: null, rounding: true });
  return { lines, consistent: true };
}

/** Ties the payees to the landed total the hero and Kosten show; the Enrosed kost is ours and nobody's invoice. */
export function purchaseLandedBridge(view: PurchaseOrderView, totalLabel: string): LandedBridge {
  const totals = view.costing.totals;
  const payable = view.payable;
  const separate = cents(totals.separateCostsEur);
  const enrosed = cents(payable ? payable.enrosedEur : totals.extraRevenueEur);
  const rows: BridgeRow[] = [
    { key: 'SUPPLIER', label: purchaseCif(view) ? 'Leverancier · goederen + zeevracht' : 'Leverancier · goederen',
      amountEur: euro(cents(payable ? payable.supplierEur : totals.goodsEur)), note: null },
    { key: 'LOGISTICS', label: 'Douane & transport', note: payable?.ddp ? 'inbegrepen in de prijs (DDP)'
      : purchaseCif(view) ? 'zeevracht via de leverancier (CIF)' : null,
      amountEur: euro(cents(payable ? payable.logisticsEur : totals.originEur + totals.freightEur + totals.dutyEur + totals.destinationEur)) },
  ];
  const separateRow: BridgeRow = { key: 'SEPARATE', label: 'Inspectie & andere kosten', amountEur: euro(separate),
    note: totals.separateCostsInPiecePrice ? null : 'apart, buiten de stukprijs' };
  const enrosedRow: BridgeRow = { key: 'ENROSED', label: 'Enrosed kost', amountEur: euro(enrosed), note: 'intern, geen betaling' };
  if (separate > 0 && !totals.separateCostsInPiecePrice) {
    // Costs outside the piece price come after the landed total the hero shows, so the two figures meet here.
    if (enrosed !== 0) rows.push(enrosedRow);
    // The rows above must add up to the subtotal by eye, so their own rounding sits before it.
    const landed = cents(totals.totalEur);
    const landedResidue = landed - rows.reduce((sum, row) => sum + cents(row.amountEur), 0);
    if (landedResidue !== 0 && Math.abs(landedResidue) <= 100) rows.push({ key: 'ROUNDING_LANDED', label: 'Afronding', amountEur: euro(landedResidue), note: null });
    rows.push({ key: 'LANDED', label: 'Totaal geland', amountEur: euro(landed), note: 'zoals in de kop', subtotal: true });
    rows.push(separateRow);
  } else {
    if (separate > 0) rows.push(separateRow);
    if (enrosed !== 0) rows.push(enrosedRow);
  }
  const total = cents(totals.totalWithSeparateCostsEur ?? totals.totalEur);
  const residue = total - rows.filter(row => !row.subtotal).reduce((sum, row) => sum + cents(row.amountEur), 0);
  const consistent = Math.abs(residue) <= 100;
  if (consistent && residue !== 0) rows.push({ key: 'ROUNDING', label: 'Afronding', amountEur: euro(residue), note: null });
  return { rows, totalLabel, totalEur: euro(total), consistent };
}

/**
 * The term whose payment can carry a whole-supplier settlement of netted
 * terms: the earliest one another term's surplus covered. The flag unties
 * the payment, and an untied payment fills the earliest open gap; no earlier
 * term has one, so the money lands on this term again and every term keeps
 * its own + / −. Null when nothing was netted.
 */
export function nettedCarrierDue(terms: readonly { due: Due; offsetEur?: number | null }[]): Due | null {
  return [...terms].sort((left, right) => DUE_ORDER.indexOf(left.due) - DUE_ORDER.indexOf(right.due))
    .find(term => cents(term.offsetEur) > 0)?.due ?? null;
}

/**
 * The payments that can carry a settlement flag, newest first. A whole-payee
 * settlement prefers the payment that already carries it, then one without a
 * term (flagging a term payment would spread it again), then, for netted
 * supplier terms, one of the term nettedCarrierDue names, so the settlement
 * moves no money between the terms; a term settlement only takes the
 * payments tied to that term.
 */
export function settleCarriers(
  payments: readonly PurchasePayment[], payee: Payee, scope: 'GROUP' | 'TERM', due: Due | null,
  terms: readonly { due: Due; offsetEur?: number | null }[] = [],
): { options: SettleCarrier[]; defaultId: number | null } {
  // One option per payment paid in parts: the root carries the flag for the whole group (applyToGroup).
  const groups = new Map<number, PurchasePayment[]>();
  for (const payment of payments.filter(item => payeeOf(item) === payee)) {
    const key = payment.groupId ?? payment.id;
    groups.set(key, [...(groups.get(key) ?? []), payment]);
  }
  const roots = [...groups.entries()].map(([key, members]) => {
    const sorted = [...members].sort((left, right) => left.paidOn.localeCompare(right.paidOn) || left.id - right.id);
    return { root: sorted.find(payment => payment.id === key) ?? sorted[0], members: sorted };
  }).sort((left, right) => byNewest(left.members[left.members.length - 1], right.members[right.members.length - 1]));
  const pool = scope === 'GROUP' ? roots : payee === 'SUPPLIER' && due ? roots.filter(group => group.root.instalmentDue === due) : [];
  const options = pool.map(({ root, members }): SettleCarrier => ({
    id: root.id, payment: root, transfers: members.length, payee, paidOn: members[members.length - 1].paidOn,
    amount: members.every(member => member.currency === root.currency) ? members.reduce((sum, member) => sum + cents(member.amount), 0) / 100 : root.amount,
    currency: root.currency,
    amountEur: members.every(member => Number.isFinite(member.amountEur)) ? euro(members.reduce((sum, member) => sum + cents(member.amountEur), 0)) : Number.NaN,
    instalmentDue: root.instalmentDue ?? null, label: root.label ?? null,
    settles: members.some(member => !!member.settles), reallocates: scope === 'GROUP' && payee === 'SUPPLIER' && root.instalmentDue != null,
  }));
  const carrierDue = scope === 'GROUP' && payee === 'SUPPLIER' ? nettedCarrierDue(terms) : null;
  const chosen = scope === 'TERM'
    ? options.find(option => option.settles) ?? options[0]
    : options.find(option => option.settles && option.instalmentDue === null)
      ?? options.find(option => option.instalmentDue === null)
      ?? (carrierDue ? options.find(option => option.instalmentDue === carrierDue) : undefined) ?? options[0];
  return { options, defaultId: chosen?.id ?? null };
}

/** The parts that tell two payments apart in a picker: date, payee, term, amount and description. */
export function paymentOptionParts(
  payment: PurchasePayment, supplierInstalments: readonly PurchaseInstalmentReconciliation[] | undefined,
): { paidOn: string; payeeLabel: string; termLabel: string | null; amountEur: number; label: string | null } {
  return {
    paidOn: payment.paidOn,
    payeeLabel: PAYEE_LABEL[payeeOf(payment)],
    termLabel: termLabel(payment.instalmentDue ?? null, supplierInstalments),
    amountEur: payment.amountEur,
    label: payment.label?.trim() || null,
  };
}
