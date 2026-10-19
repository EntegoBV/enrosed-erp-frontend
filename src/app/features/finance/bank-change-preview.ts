import type { ContainerPayable } from './payables';

/*
 * "Wat verandert" before a bank transaction is linked (spec-bank-forecast
 * §3.6, the Bank-B graft): the payment now against the payment after the
 * link, the switch "Betaling volgt de bank" (on by default), what happens to
 * a smaller or larger transaction, the button's words and the toast after
 * the link. The notice copies round 2's merged sentence (purchase-payment-
 * links.ts linkNotice): "Bedrag en datum gevolgd van de transactie: … (was
 * …)." Pure, only type imports, node-tested (tests/bank-change-preview.test.mts);
 * counts in cents with the two-cent bank rule.
 */

/** What the transaction is linked to: a new payment on a document or term, or an existing payment that follows it. */
export type LinkTarget =
  | { kind: 'sales-new'; salesOrderId: number; title: string; openEur: number }
  | { kind: 'sales-existing'; salesOrderId: number; paymentId: number; title: string; amountEur: number; receivedOn: string; account: string | null }
  | { kind: 'cost-new'; costId: number; title: string; openEur: number }
  | { kind: 'cost-existing'; costId: number; costPaymentId: number; title: string; amountEur: number; paidOn: string; account: string | null; proofCount: number }
  | { kind: 'term-new'; orderId: number; payable: ContainerPayable; title: string }
  | { kind: 'purchase-existing'; orderId: number; paymentId: number; title: string; amountEur: number; paidOn: string;
      currency: 'EUR' | 'USD' | 'CNY'; amount: number; account: string | null; proofCount: number; hasInspectionAfspraak: boolean; groupSize: number };

export interface ChangeRow {
  label: 'Bedrag' | 'Betaald op' | 'Ontvangen op' | 'Rekening' | 'In USD' | 'In CNY' | 'Koers' | 'Transactiekosten' | 'Bewijs';
  now: string;
  after: string;
  changed: boolean;
}

export interface ChangePreview {
  mode: 'equal' | 'lower' | 'higher';
  /** The transaction minus the payment (or the open amount of a new one), in euro: positive when the bank paid more. */
  differenceEur: number;
  rows: ChangeRow[];
  /** Under the switch "Betaling volgt de bank". */
  followText: string;
  /** "Betaling houden, verschil € x als …" may be offered (a larger transaction on a purchase payment, follow off). */
  keepAllowed: boolean;
  /** A smaller transaction on a purchase payment: the rest stays open as a second transfer. */
  restText: string | null;
  /** Follow off where it cannot be: the reason, and the button stays disabled. */
  blockedText: string | null;
  primaryLabel: string;
  /** The toast after the link. */
  notice: string;
}

/**
 * "Betaling houden, verschil als …": Koersverschil and Bankkosten are a
 * company cost on the line (/links' keepDifferenceAs); for a purchase payment
 * the detail offers Transactiekosten instead of Bankkosten (2026-10-19): a
 * Bijkomende kosten payment of the container on the line (bank-part), so a
 * fee never lands twice.
 */
export type KeepAs = 'BANKKOSTEN' | 'KOERSVERSCHIL' | 'TRANSACTIEKOSTEN';
export const KEEP_LABEL: Readonly<Record<KeepAs, string>> = { BANKKOSTEN: 'Bankkosten', KOERSVERSCHIL: 'Koersverschil', TRANSACTIEKOSTEN: 'Transactiekosten van de container' };
export const KEEP_ONLY_EQUAL = 'Betaling houden kan alleen als de bedragen gelijk zijn (± € 0,02).';

const TOLERANCE_CENTS = 2;
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const cents = (value: number): number => Math.round((Number.isFinite(value) ? value : 0) * 100);
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
/** '€ 12.480,00', the formatter round 2 words its notice with. */
const eur = (value: number): string => EURO.format(value);
const GROUPED = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** '$ 14.560,00', '¥ 14.560,00': the row label already names the currency. */
const foreign = (amount: number, currency: 'USD' | 'CNY'): string => `${currency === 'USD' ? '$' : '¥'} ${GROUPED.format(amount)}`;
/** '13 okt'. */
const dayMon = (iso: string): string => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : '—');
/** '05/01/2026', as round 2's notice writes a day. */
const day = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/');
/** '1,1667': the foreign amount per euro, four decimals. */
const rate = (amount: number, amountEur: number): string => (amount > 0 && amountEur > 0
  ? (amount / amountEur).toLocaleString('nl-BE', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '—');
const files = (count: number): string => (count <= 0 ? 'geen' : count === 1 ? '1 bestand' : `${count} bestanden`);

/**
 * Round 2's notice after a link (purchase-payment-links.ts linkNotice, copied: a node-tested module only
 * imports types): what followed the transaction, with what it was; null when nothing but the link changed.
 */
export function followNotice(before: { amountEur: number; paidOn: string }, after: { amountEur: number; paidOn: string }): string | null {
  const amount = cents(before.amountEur) !== cents(after.amountEur);
  const date = before.paidOn !== after.paidOn;
  if (amount && date) return `Bedrag en datum gevolgd van de transactie: ${eur(after.amountEur)} op ${day(after.paidOn)} (was ${eur(before.amountEur)} op ${day(before.paidOn)}).`;
  if (amount) return `Bedrag gevolgd van de transactie: ${eur(after.amountEur)} (was ${eur(before.amountEur)}).`;
  if (date) return `Datum gevolgd van de transactie: ${day(after.paidOn)} (was ${day(before.paidOn)}).`;
  return null;
}

/** The amount the target stands at now (the payment) or would take (the open amount of a document or term), positive. */
function baseEur(target: LinkTarget): number {
  switch (target.kind) {
    case 'sales-new': case 'cost-new': return Math.abs(target.openEur);
    case 'term-new': return Math.abs(target.payable.remainingEur);
    default: return Math.abs(target.amountEur);
  }
}

/**
 * The comparison for one target and one transaction. `follow` is the switch
 * (a smaller transaction on a purchase payment always follows: the line's
 * part is carved out); `keepAs` is the select beside "Betaling houden";
 * `surplus` the choice for a larger transaction on a purchase payment that
 * follows ('ADJUST' takes the transaction's amount, 'INSPECTION' and 'FEE'
 * keep the payment and add the rest as the inspection via the supplier or
 * as Transactiekosten). `feeEur`: 'Waarvan transactiekosten' of a USD/CNY
 * purchase payment that follows; its euro becomes the rest.
 */
export function changePreview(
  target: LinkTarget, line: { amountEur: number; day: string; accountLabel: string }, follow: boolean, keepAs: KeepAs,
  surplus: 'ADJUST' | 'INSPECTION' | 'FEE' = 'ADJUST', feeEur: number | null = null,
): ChangePreview {
  const lineCents = Math.abs(cents(line.amountEur));
  const base = cents(baseEur(target));
  const difference = lineCents - base;
  const mode: ChangePreview['mode'] = Math.abs(difference) <= TOLERANCE_CENTS ? 'equal' : difference < 0 ? 'lower' : 'higher';
  const lineEur = lineCents / 100;
  const row = (label: ChangeRow['label'], now: string, after: string): ChangeRow => ({ label, now, after, changed: now !== after });
  const isNew = target.kind === 'sales-new' || target.kind === 'cost-new' || target.kind === 'term-new';
  const sales = target.kind === 'sales-new' || target.kind === 'sales-existing';
  const dateLabel = sales ? 'Ontvangen op' : 'Betaald op';
  const purchase = target.kind === 'purchase-existing';
  const effectiveFollow = follow || (purchase && mode === 'lower');
  const keep = !effectiveFollow && purchase && mode === 'higher';
  const blockedText = !effectiveFollow && mode !== 'equal' && !keep ? KEEP_ONLY_EQUAL : null;

  if (isNew) {
    // A new payment takes the bank's day and account; its amount is the open amount when the line matches it, else the line.
    const afterEur = (target.kind === 'cost-new' || target.kind === 'sales-new') && mode === 'equal' ? base / 100 : lineEur;
    const rows = [row('Bedrag', '—', eur(afterEur)), row(dateLabel, '—', dayMon(line.day)), row('Rekening', '—', line.accountLabel || '—')];
    if (!sales) rows.push(row('Bewijs', '—', 'deze transactie'));
    return {
      mode, differenceEur: difference / 100, rows, followText: followText(target, afterEur), keepAllowed: false, restText: null, blockedText: null,
      primaryLabel: 'Koppelen', notice: `Gekoppeld aan ${target.title}.`,
    };
  }

  const nowEur = base / 100;
  const nowDay = target.kind === 'sales-existing' ? target.receivedOn : target.paidOn;
  // Kept with the difference as Transactiekosten: bank-part links it, so its day follows (its amount stays).
  const keepFee = keep && keepAs === 'TRANSACTIEKOSTEN';
  // A USD/CNY payment that follows with 'Waarvan transactiekosten': its euro is the transaction less the fee.
  const foreignFee = purchase && target.currency !== 'EUR' && effectiveFollow && feeEur !== null && cents(feeEur) > 0 && cents(feeEur) < lineCents ? cents(feeEur) : 0;
  // Follow: the payment takes the transaction (a smaller one carves the line's part out of it; the rest stays open);
  // a larger purchase payment whose rest is the inspection or Transactiekosten keeps its own amount.
  const restFee = purchase && mode === 'higher' && effectiveFollow && surplus === 'FEE';
  const keepsAmount = !effectiveFollow || (purchase && mode === 'higher' && (surplus === 'INSPECTION' || surplus === 'FEE'));
  const afterEur = keepsAmount ? nowEur : (lineCents - foreignFee) / 100;
  const afterDay = effectiveFollow || keepFee ? line.day : nowDay;
  const feeText = keepFee || restFee ? eur(difference / 100) : foreignFee ? eur(foreignFee / 100) : null;
  const rows: ChangeRow[] = [
    row('Bedrag', eur(nowEur), eur(afterEur)),
    row(dateLabel, dayMon(nowDay), dayMon(afterDay)),
    row('Rekening', target.account || 'geen', line.accountLabel || target.account || 'geen'),
  ];
  if (purchase && target.currency !== 'EUR') {
    rows.push(row(target.currency === 'USD' ? 'In USD' : 'In CNY', foreign(target.amount, target.currency), foreign(target.amount, target.currency)));
    rows.push(row('Koers', rate(target.amount, nowEur), rate(target.amount, afterEur)));
  }
  if (feeText) rows.push(row('Transactiekosten', '—', `${feeText} op dezelfde transactie`));
  if (target.kind !== 'sales-existing') rows.push(row('Bewijs', files(target.proofCount), 'deze transactie'));

  const changed = cents(afterEur) !== cents(nowEur) || afterDay !== nowDay;
  const title = `Gekoppeld aan ${target.title}.`;
  let notice = title;
  if (keepFee) notice = `${title} Verschil ${eur(difference / 100)} als transactiekosten bij de container.`;
  else if (keep) notice = `${title} Verschil ${eur(difference / 100)} geboekt als ${KEEP_LABEL[keepAs]}.`;
  else if (effectiveFollow) {
    const followed = followNotice({ amountEur: nowEur, paidOn: nowDay }, { amountEur: afterEur, paidOn: afterDay });
    if (followed) notice = `${title} ${followed}`;
  }
  return {
    mode, differenceEur: difference / 100, rows,
    followText: followText(target, effectiveFollow ? afterEur : nowEur),
    keepAllowed: purchase && mode === 'higher',
    // A USD/CNY payment is compared in its own currency (round 2): the transaction is the whole payment, nothing stays open.
    restText: purchase && mode === 'lower' && target.currency === 'EUR' ? `Rest ${eur((base - lineCents) / 100)} blijft open als tweede transactie.` : null,
    blockedText,
    primaryLabel: keep ? 'Koppelen en verschil boeken' : effectiveFollow && changed ? 'Koppelen en aanpassen' : 'Koppelen',
    notice,
  };
}

/** "Bedrag, dag en rekening komen van de transactie. De nacalculatie rekent met € 12.512,40." */
function followText(target: LinkTarget, amountEur: number): string {
  const subject = target.kind === 'term-new' || target.kind === 'purchase-existing' ? 'De nacalculatie'
    : target.kind === 'cost-new' || target.kind === 'cost-existing' ? 'De kost' : 'De factuur';
  return `Bedrag, dag en rekening komen van de transactie. ${subject} rekent met ${eur(amountEur)}.`;
}
