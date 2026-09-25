import type {
  Currency, Instalment, Payee, PurchaseDocument, PurchaseInstalmentReconciliation, PurchaseOrderView, PurchasePayment,
} from '../../core/api/models';
import type { PurchaseInstalmentState } from './purchase-instalment-state';

/**
 * The money going out of one container, per payee: one view model for the
 * desk workbench, the phone overview and their sheets.
 *
 * Every amount comes from the server's reconciliation; this module only
 * arranges it and adds what the server does not know: whether an open amount
 * is due now or later, and which payments still lack a bank proof. It
 * formats nothing (templates use the pipes) and counts in cents, so every row
 * closes exactly: Afspraak − Betaald − Minder betaald + Meer betaald = Open.
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
export const DUE_ORDER: readonly Due[] = ['ORDERED', 'SHIPPED', 'ARRIVED'];
export const DUE_MOMENT: Readonly<Record<Due, string>> = {
  ORDERED: 'bij bestelling', SHIPPED: 'bij vertrek', ARRIVED: 'bij aankomst',
};

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

export type LedgerTone = 'warn' | 'ok' | 'neutral';
export type PayeeStatusKind = 'NONE' | 'ADDITIONAL' | 'INCOMPLETE' | 'UNBUDGETED' | 'OVERPAID' | 'SETTLED_HIGHER'
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

export interface LedgerRow {
  id: number;
  payment: PurchasePayment;
  payee: Payee;
  payeeLabel: string;
  payeeShort: string;
  paidOn: string;
  /** The description, or the payee when there is none. */
  title: string;
  label: string | null;
  due: Due | null;
  termLabel: string | null;
  settles: boolean;
  settlesLabel: string | null;
  amount: number;
  currency: Currency;
  foreign: boolean;
  /** As booked; never converted again. Not finite when an old payment lacks its euro value. */
  amountEur: number;
  /** Null while the documents are still loading. */
  proofs: PurchaseDocument[] | null;
  proofCount: number;
  hasProof: boolean | null;
  actor: string | null;
  recordedAt: string;
}

export interface LedgerTerm {
  due: Due;
  label: string;
  moment: string;
  fullEur: number;
  paidEur: number;
  openEur: number;
  lowerEur: number;
  higherEur: number;
  settled: boolean;
  finalized: boolean;
  state: PurchaseInstalmentState['state'];
  hasScopedPayment: boolean;
  canSettle: boolean;
  canUndo: boolean;
  status: { label: string; tone: LedgerTone };
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
  /** Null while the documents are still loading. */
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
  visible: boolean;
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
  paidTotalEur: number;
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
  id: number;
  payment: PurchasePayment;
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
const byNewest = (left: PurchasePayment, right: PurchasePayment): number =>
  right.paidOn.localeCompare(left.paidOn) || right.id - left.id;
const payeeOf = (payment: PurchasePayment): Payee => payment.payee ?? 'SUPPLIER';

const STATUS: Readonly<Record<Exclude<PayeeStatusKind, 'LATER'>, PayeeStatus>> = {
  NONE: { kind: 'NONE', label: 'Geen afspraak', tone: 'neutral' },
  ADDITIONAL: { kind: 'ADDITIONAL', label: 'Bijkomend', tone: 'neutral' },
  INCOMPLETE: { kind: 'INCOMPLETE', label: 'Onvolledig', tone: 'warn' },
  UNBUDGETED: { kind: 'UNBUDGETED', label: 'Niet begroot', tone: 'warn' },
  OVERPAID: { kind: 'OVERPAID', label: 'Te veel betaald · nakijken', tone: 'warn' },
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
  const rows = ledgerRows(payments, input.documents, instalments);
  const terms = ledgerTerms(input.terms, instalments, payments, canonical, concept);
  const payees = PAYEE_ORDER.map(payee => payeeLedger(payee, input, rows, payee === 'SUPPLIER' ? terms : [], canonical, concept));
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
    payee, known, agreed, paid, open, lower, higher, finalized, explicitlySettled, settledRows, missingAmount, balanced,
    count: rows.length, dueNow, laterDue, concept, tolerance: cents(input.toleranceEur),
  });
  const composition = payeeComposition(payee, view, agreed === null ? null : euro(agreed));
  const openTerms = terms.filter(term => term.openEur > 0);
  const settleDefault: PurchaseSettleRequest = payee === 'SUPPLIER' && canonical && openTerms.length === 1 && openTerms[0].hasScopedPayment
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
    proof: input.documents === null ? null : { withProof: rows.filter(row => row.hasProof).length, total: rows.length },
    status,
    terms,
    composition: composition.lines,
    compositionConsistent: composition.consistent,
    canSettle: !other && known && rows.length >= 1
      && (open > 0 || (higher > 0 && !finalized) || status.kind === 'UNBUDGETED'),
    canUndoSettle: settledRows,
    smallDifference: status.kind === 'SMALL_DIFFERENCE',
    settleDefault,
    next,
    visible: payee === 'SUPPLIER' || rows.length > 0 || (!other && (agreed ?? 0) > 0),
  };
}

/**
 * The one word per payee. A payee paid in full reads 'Betaald · afgerekend'
 * as soon as any of its payments carries a settlement, a whole-payee one or
 * a term's: that is exactly when the row offers to undo it.
 */
function payeeStatus(values: {
  payee: Payee; known: boolean; agreed: number | null; paid: number; open: number; lower: number; higher: number;
  finalized: boolean; explicitlySettled: boolean; settledRows: boolean; missingAmount: boolean; balanced: boolean; count: number;
  dueNow: number; laterDue: Due | null; concept: boolean; tolerance: number;
}): PayeeStatus {
  const { agreed, paid, open, lower, higher, finalized } = values;
  if (values.payee === 'OTHER') return values.count ? (values.missingAmount ? STATUS.INCOMPLETE : STATUS.ADDITIONAL) : STATUS.NONE;
  if (values.missingAmount || !values.balanced) return STATUS.INCOMPLETE;
  if (agreed === 0 && paid === 0) return STATUS.NONE;
  if (agreed === 0) return finalized ? STATUS.SETTLED_HIGHER : STATUS.UNBUDGETED;
  if (open === 0 && (lower > 0 || higher > 0)) {
    if (!finalized && higher > 0) return STATUS.OVERPAID;
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
  switch (payee) {
    case 'SUPPLIER': return SUPPLIER_GOODS + ' · ' + (hasPlan ? planLabel : 'geen betaalplan');
    case 'LOGISTICS': return view.payable?.ddp ? 'Inbegrepen in de prijs (DDP)' : 'Raming uit Kosten: vracht, lokale kosten en invoerrechten';
    case 'SEPARATE': return 'Raming uit Kosten: inspectie en andere kosten';
    default: return 'Bankkosten, koerier, wisselkoers · zonder afspraak';
  }
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
  payments: readonly PurchasePayment[], canonical: boolean, concept: boolean,
): LedgerTerm[] {
  const supplier = payments.filter(payment => payeeOf(payment) === 'SUPPLIER');
  return states.map(state => {
    const server = instalments?.find(item => item.due === state.due);
    const lower = cents(server?.settledSavingEur);
    const higher = cents(server?.overpaidEur);
    const finalized = server?.finalized ?? false;
    const scoped = supplier.filter(payment => payment.instalmentDue === state.due);
    const moment = DUE_MOMENT[state.due];
    const status: LedgerTerm['status'] = concept ? { label: 'Gepland', tone: 'neutral' }
      : state.settled && lower > 0 ? { label: 'Afgerekend · minder betaald', tone: 'ok' }
      : higher > 0 ? (finalized ? { label: 'Afgerekend · meer betaald', tone: 'neutral' } : { label: 'Te veel betaald · nakijken', tone: 'warn' })
      : state.settled && state.state === 'paid' ? { label: 'Betaald · afgerekend', tone: 'ok' }
      : state.state === 'paid' ? { label: 'Betaald', tone: 'ok' }
      : state.state === 'due' ? { label: state.covered > 0 ? 'Deels betaald' : 'Nu te betalen', tone: 'warn' }
      : { label: 'Later · ' + moment, tone: 'neutral' };
    return {
      due: state.due,
      label: state.label,
      moment,
      fullEur: state.full,
      paidEur: state.covered,
      openEur: state.amount,
      lowerEur: euro(lower),
      higherEur: euro(higher),
      settled: state.settled,
      finalized,
      state: state.state,
      hasScopedPayment: scoped.length > 0,
      canSettle: canonical && scoped.length > 0 && !state.settled && (state.amount > 0 || (higher > 0 && !finalized)),
      canUndo: scoped.some(payment => payment.settles),
      status,
    };
  });
}

function ledgerRows(
  payments: readonly PurchasePayment[], documents: readonly PurchaseDocument[] | null,
  instalments: readonly PurchaseInstalmentReconciliation[] | undefined,
): LedgerRow[] {
  return [...payments].sort(byNewest).map(payment => {
    const payee = payeeOf(payment);
    const due = payment.instalmentDue ?? null;
    const proofs = documents === null ? null : documents.filter(document => document.paymentId === payment.id);
    return {
      id: payment.id,
      payment,
      payee,
      payeeLabel: PAYEE_LABEL[payee],
      payeeShort: PAYEE_SHORT[payee],
      paidOn: payment.paidOn,
      title: payment.label?.trim() || PAYEE_LABEL[payee],
      label: payment.label?.trim() || null,
      due,
      termLabel: termLabel(due, instalments),
      settles: !!payment.settles,
      settlesLabel: payment.settles ? (due ? 'Rekent de termijn af' : 'Rekent alles af') : null,
      amount: payment.amount,
      currency: payment.currency,
      foreign: payment.currency !== 'EUR',
      amountEur: payment.amountEur,
      proofs,
      proofCount: proofs?.length ?? 0,
      hasProof: proofs === null ? null : proofs.length > 0,
      actor: payment.actor,
      recordedAt: payment.recordedAt,
    };
  });
}

function termLabel(due: Due | null, instalments: readonly PurchaseInstalmentReconciliation[] | undefined): string | null {
  if (!due) return null;
  return instalments?.find(item => item.due === due)?.label ?? 'Termijn ' + DUE_MOMENT[due];
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
  const serverPaid = input.view.reconciliation?.totals.paidEur;
  const paidTotal = serverPaid != null ? cents(serverPaid)
    : rows.reduce((total, row) => total + (Number.isFinite(row.amountEur) ? cents(row.amountEur) : 0), 0);
  const scale = Math.max(agreed, paid + open);
  const pct = (value: number) => scale > 0 ? Math.min(100, (value / scale) * 100) : 0;
  const review = agreements.find(payee => ['OVERPAID', 'UNBUDGETED', 'INCOMPLETE'].includes(payee.status.kind)) ?? null;
  const kind: LedgerHeadlineKind = concept ? 'concept'
    : agreed === 0 && rows.length === 0 ? 'empty'
    : dueNow > 0 ? 'due'
    : review ? 'review'
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
    paidTotalEur: euro(paidTotal),
    forecastEur: euro(paidTotal + open),
    progress: agreed > 0 ? Math.min(1, paid / agreed) : 0,
    meter: { paidPct: pct(paid), duePct: pct(dueNow), laterPct: pct(later), agreedPct: higher > 0 ? pct(agreed) : null },
    balanced: payees.every(payee => payee.balanced),
    known: !!input.view.reconciliation,
    paymentCount: rows.length,
    missingProofCount: input.documents === null ? null : rows.filter(row => row.hasProof === false).length,
    headline: {
      kind,
      payee: kind === 'review' ? review : kind === 'due' || kind === 'later'
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
      todos.push({ kind: 'review', key: 'review:' + payee.payee, payee: payee.payee, amountEur: payee.higherEur,
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
  if (payee === 'SUPPLIER') {
    lines = [line(SUPPLIER_GOODS, totals.goodsEur)];
  } else if (payee === 'LOGISTICS' && !view.payable?.ddp) {
    lines = [
      line(labels?.originCostsLabel ?? 'Lokale kosten vertrek', totals.originEur),
      line(labels?.seaFreightLabel ?? 'Zeevracht', totals.freightEur, labels?.seaFreightRoute ?? null),
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
    { key: 'SUPPLIER', label: 'Leverancier · goederen', amountEur: euro(cents(payable ? payable.supplierEur : totals.goodsEur)), note: null },
    { key: 'LOGISTICS', label: 'Douane & transport', note: payable?.ddp ? 'inbegrepen in de prijs (DDP)' : null,
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
 * The payments that can carry a settlement flag, newest first. A whole-payee
 * settlement prefers the payment that already carries it, then one without a
 * term (flagging a term payment would spread it again); a term settlement
 * only takes the payments tied to that term.
 */
export function settleCarriers(
  payments: readonly PurchasePayment[], payee: Payee, scope: 'GROUP' | 'TERM', due: Due | null,
): { options: SettleCarrier[]; defaultId: number | null } {
  const own = payments.filter(payment => payeeOf(payment) === payee).sort(byNewest);
  const pool = scope === 'GROUP' ? own : payee === 'SUPPLIER' && due ? own.filter(payment => payment.instalmentDue === due) : [];
  const options = pool.map((payment): SettleCarrier => ({
    id: payment.id, payment, payee, paidOn: payment.paidOn, amount: payment.amount, currency: payment.currency,
    amountEur: payment.amountEur, instalmentDue: payment.instalmentDue ?? null, label: payment.label ?? null,
    settles: !!payment.settles, reallocates: scope === 'GROUP' && payee === 'SUPPLIER' && payment.instalmentDue != null,
  }));
  const chosen = scope === 'TERM'
    ? options.find(option => option.settles) ?? options[0]
    : options.find(option => option.settles && option.instalmentDue === null)
      ?? options.find(option => option.instalmentDue === null) ?? options[0];
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
