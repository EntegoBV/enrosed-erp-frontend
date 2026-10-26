/*
 * The phone's words for money out and the Nacalculatie (Betalingen, the payee
 * sheet and Kosten, 2026-10-25): one status word per payee or term, one
 * Verschil written as '€ x minder' or '€ x meer' (never a − / + pair; an
 * overpayment still to review keeps its own Nakijken row), and the rows the
 * phone cards list. Phone only: the desk keeps PayeeStatus.label,
 * differenceLines and the reason labels. Pure and node-tested: type-only
 * imports, its own euro formatting (the same as the eur pipe).
 */
import type { DocumentKind, Payee } from '../../core/api/models';
import type { BridgeRow, LandedBridge, LedgerSummary, LedgerTerm, PayeeLedger, PayeeStatus, PayeeStatusKind } from './purchase-payment-ledger';
import type { NacalcBridgeRow, NacalcExplained, NacalcHeadline, NacalcPayeeRow, NacalcProductRow, NacalcSetBasis } from './purchase-nacalc-metrics';

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const EURO4 = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const ONE_DECIMAL = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const eur = (value: number): string => EURO.format(Number.isFinite(value) ? value : 0);
const eur4 = (value: number): string => EURO4.format(value);
const cents = (value: number | null | undefined): number => Number.isFinite(value as number) ? Math.round((value as number) * 100) : 0;
const count = (value: number): string => value.toLocaleString('nl-BE');
/** '+ € 44,80' or '− € 44,80' (the sign never wraps away from its figure): only where a koersverschil can go either way. */
const signed = (value: number): string => `${cents(value) < 0 ? '−' : '+'}\u00a0${eur(Math.abs(cents(value)) / 100)}`;
/** 'a', 'a en b', 'a, b en c'. */
const listNl = (items: readonly string[]): string => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} en ${items[items.length - 1]}`;
/** The payees in the ledger's order (PAYEE_ORDER); a runtime import would break the node test. */
const ORDER: readonly Payee[] = ['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'OTHER'];

export type PhoneTone = 'ok' | 'warn' | 'neutral';
/** A status in one short word, toned like the ledger's pill. */
export interface PhoneWord { word: string; tone: PhoneTone }
/** A figure with its word: 'in' for minder (green), 'warn' for meer still to review, 'none' otherwise. */
export interface PhoneAmount { text: string; tone: 'in' | 'warn' | 'none' }

const WORD: Readonly<Record<PayeeStatusKind, string>> = {
  NONE: 'Geen afspraak',
  ADDITIONAL: 'Bijkomend',
  INCOMPLETE: 'Onvolledig',
  UNBUDGETED: 'Nakijken',
  OVERPAID: 'Nakijken',
  FX: 'Koersverschil',
  SETTLED_HIGHER: 'Afgerekend',
  SETTLED_LOWER: 'Afgerekend',
  PAID: 'Betaald',
  PLANNED: 'Gepland',
  DUE: 'Nu te betalen',
  LATER: 'Later',
  SMALL_DIFFERENCE: 'Klein verschil',
  PARTIAL: 'Deels betaald',
};

/** The one status word per payee; the amount it named ('€ 0,50 te veel', 'bij aankomst') lives in the Verschil or the split line. */
export function payeeWord(status: Pick<PayeeStatus, 'kind' | 'tone'>): PhoneWord {
  return { word: WORD[status.kind] ?? 'Geen afspraak', tone: status.tone };
}

/**
 * The one word per supplier term, read from its fields in the ledger's order
 * (ledgerTerms' status), never by parsing the label.
 */
export function termWord(term: Pick<LedgerTerm, 'state' | 'settled' | 'finalized' | 'lowerEur' | 'higherEur' | 'fxEur'
  | 'offsetEur' | 'openEur' | 'paidEur'>, concept: boolean): PhoneWord {
  const lower = cents(term.lowerEur);
  const higher = cents(term.higherEur);
  const offset = cents(term.offsetEur);
  const open = cents(term.openEur);
  const fx = cents(term.fxEur);
  if (concept) return { word: 'Gepland', tone: 'neutral' };
  if (term.settled && lower > 0) return { word: 'Afgerekend', tone: 'ok' };
  if (higher > 0 && term.finalized) return { word: 'Afgerekend', tone: 'neutral' };
  if (offset > 0 && open === 0) return { word: 'Verrekend', tone: 'ok' };
  if (higher > 0) return fx > 0 ? { word: 'Koersverschil', tone: 'neutral' } : { word: 'Nakijken', tone: 'warn' };
  if (offset < 0) return { word: 'Verrekend', tone: 'ok' };
  if (term.state === 'paid') return { word: 'Betaald', tone: 'ok' };
  if (term.state === 'due') return { word: cents(term.paidEur) > 0 || offset > 0 ? 'Deels betaald' : 'Nu te betalen', tone: 'warn' };
  return { word: 'Later', tone: 'neutral' };
}

/**
 * What a term's word leaves out: '€ 60,78 verrekend met 70% bij vertrek', or
 * 'verrekend met 1/3 bij vertrek' for a term the ledger calls 'Betaald ·
 * verrekend met …' (its statusNote is null then); null when nothing is left.
 */
export function termNote(term: Pick<LedgerTerm, 'statusNote' | 'statusSplit'>): string | null {
  return term.statusNote ?? (term.statusSplit ? `verrekend ${term.statusSplit.rest}` : null);
}

/**
 * A Verschil in figures and one word: '€ 3.271,34 minder', '€ 2.949,22 meer',
 * '€ 44,80 koersverschil (bank)' when the bank's rate is all of it, or 'geen
 * verschil'. The word follows differenceWord. Minder is green, meer is warn
 * only while part of it is still to review.
 */
export function verschilText(item: { differenceEur: number; fxEur: number; reviewEur?: number }): PhoneAmount {
  const difference = cents(item.differenceEur);
  if (difference === 0) return { text: 'geen verschil', tone: 'none' };
  const fx = cents(item.fxEur);
  const word = fx > 0 && fx === difference ? 'koersverschil (bank)' : difference < 0 ? 'minder' : 'meer';
  return { text: `${eur(Math.abs(difference) / 100)} ${word}`, tone: difference < 0 ? 'in' : cents(item.reviewEur) > 0 ? 'warn' : 'none' };
}

/** '5,0 %' of a Verschil; '' without a percentage or a difference. */
export function pctText(pct: number | null | undefined, differenceEur: number): string {
  return pct === null || pct === undefined || !Number.isFinite(pct) || cents(differenceEur) === 0 ? '' : `${ONE_DECIMAL.format(Math.abs(pct))} %`;
}

/**
 * The second line of a payee on Betalingen: what was paid against the
 * Afspraak, or what is open of it, in figures.
 */
export function payeeFigures(item: Pick<PayeeLedger, 'payee' | 'agreedEur' | 'paidEur' | 'openEur'>): string {
  const agreed = cents(item.agreedEur);
  const paid = cents(item.paidEur);
  const open = cents(item.openEur);
  if (item.payee === 'OTHER' || (agreed === 0 && paid > 0)) return `${eur(item.paidEur)} betaald · zonder afspraak`;
  if (paid === 0) return agreed > 0 ? `${eur(agreed / 100)} open` : 'Nog niets betaald';
  if (open > 0) return `${eur(item.openEur)} open van ${eur(agreed / 100)}`;
  if (paid === agreed) return `${eur(item.paidEur)} betaald`;
  return `${eur(item.paidEur)} van ${eur(agreed / 100)} betaald`;
}

/**
 * A Verschil while an overpayment may wait for a review (2026-10-26): the
 * part that is settled (with any koersverschil) stays the Verschil row, the
 * part still to review gets its own Nakijken row, '€ 300,00 meer', warn. A
 * review is a to-do, so it is never folded into a net minder, and a settled
 * figure never disappears behind it. Without a review this is verschilText.
 */
export interface VerschilSplit {
  /** The Verschil row: what does not wait for a review; null when only a review is left. */
  verschil: PhoneAmount | null;
  verschilEur: number;
  /** 'na afrekening', the koersverschil, or both while a review waits beside it. */
  note: string;
  /** The Nakijken row: '€ 300,00 meer', warn; null without a review. */
  review: PhoneAmount | null;
  reviewEur: number;
}

export function verschilSplit(item: { differenceEur: number; reviewEur?: number | null; fxEur?: number | null }): VerschilSplit {
  const review = Math.max(0, cents(item.reviewEur));
  const rest = cents(item.differenceEur) - review;
  const fx = cents(item.fxEur);
  const note = fx > 0
    ? fx === rest ? 'koersverschil (bank)' : `${review > 0 ? 'na afrekening · ' : ''}waarvan koersverschil ${eur(fx / 100)} (bank)`
    : 'na afrekening';
  return {
    verschil: review > 0 && rest === 0 ? null : verschilText({ differenceEur: rest / 100, fxEur: fx / 100 }),
    verschilEur: rest / 100,
    note,
    review: review > 0 ? { text: `${eur(review / 100)} meer`, tone: 'warn' } : null,
    reviewEur: review / 100,
  };
}

/** One payee's figure under the card's Verschil or Nakijken row. */
export interface PayeeAmount { payee: Payee; label: string; text: string; tone: PhoneAmount['tone'] }

type PayeeDifference = Pick<PayeeLedger, 'payee' | 'label' | 'differenceEur' | 'reviewEur' | 'fxEur'>;
const agreementPayees = (payees: readonly PayeeDifference[]): PayeeDifference[] => [...payees]
  .filter(item => item.payee !== 'OTHER')
  .sort((left, right) => ORDER.indexOf(left.payee) - ORDER.indexOf(right.payee));

/**
 * Under the card's Verschil, where it comes from: each agreement payee's own
 * part outside a review, in the ledger's order. They add up to the Verschil
 * row to the cent; what waits for a review is under Nakijken (reviewByPayee).
 */
export function differenceByPayee(payees: readonly PayeeDifference[]): PayeeAmount[] {
  return agreementPayees(payees)
    .map(item => ({ item, split: verschilSplit(item) }))
    .filter(({ split }) => cents(split.verschilEur) !== 0)
    .map(({ item, split }) => ({ payee: item.payee, label: item.label, text: split.verschil!.text, tone: split.verschil!.tone }));
}

/** Beside Nakijken: the payees with an overpayment still to review, '€ 300,00 meer' each. */
export function reviewByPayee(payees: readonly PayeeDifference[]): PayeeAmount[] {
  return agreementPayees(payees)
    .filter(item => cents(item.reviewEur) > 0)
    .map(item => ({ payee: item.payee, label: item.label, text: `${eur(cents(item.reviewEur) / 100)} meer`, tone: 'warn' as const }));
}

/**
 * The meter where a settled difference counts as done: the widths over paid
 * plus open, so a container paid less after settling fills the bar.
 */
export function settledMeter(s: Pick<LedgerSummary, 'paidOnAgreementEur' | 'openEur' | 'dueNowEur' | 'laterEur'>):
  { paidPct: number; duePct: number; laterPct: number } {
  const paid = Math.max(0, cents(s.paidOnAgreementEur));
  const scale = paid + Math.max(0, cents(s.openEur));
  const pct = (value: number) => scale > 0 ? Math.min(100, Math.max(0, value) / scale * 100) : 0;
  return { paidPct: pct(paid), duePct: pct(cents(s.dueNowEur)), laterPct: pct(cents(s.laterEur)) };
}

const PAYEE_ROWS = new Set(['SUPPLIER', 'LOGISTICS', 'SEPARATE']);

/**
 * Hoe is dit opgebouwd?: the bridge rows with the Afspraak as a subtotal
 * after the payee rows, when they add up to it to the cent and something
 * (the Enrosed kost) still follows. Costs outside the piece price already
 * carry their own Totaal geland subtotal: then the rows stay as they are.
 */
export function landedChain(bridge: Pick<LandedBridge, 'rows'>, agreedEur: number): (BridgeRow & { sum?: true })[] {
  const rows: (BridgeRow & { sum?: true })[] = [...bridge.rows];
  if (rows.some(row => row.subtotal)) return rows;
  let last = -1;
  rows.forEach((row, index) => { if (PAYEE_ROWS.has(row.key)) last = index; });
  if (last < 0 || last === rows.length - 1) return rows;
  const parts = rows.slice(0, last + 1);
  if (parts.some(row => !PAYEE_ROWS.has(row.key))) return rows;
  if (parts.reduce((total, row) => total + cents(row.amountEur), 0) !== cents(agreedEur)) return rows;
  rows.splice(last + 1, 0, { key: 'AFSPRAAK', label: 'Afspraak', amountEur: cents(agreedEur) / 100, note: null, sum: true });
  return rows;
}

/** A row of Waar het verschil zit: a payee, or one of the supplier's terms under it. */
export interface ChainRow {
  kind: 'payee' | 'term';
  key: string;
  payee: Payee;
  name: string;
  /** Line 1, right: the Verschil, else what is open, else 'geen verschil'; '—' while the figures do not close. */
  amount: PhoneAmount;
  /** Line 2, left: afspraak → eindkost. */
  line: string;
  /** Line 2, right: the status word; on a term only when it differs from the supplier's. */
  word: PhoneWord | null;
  /** The payee waits for a review, has no agreement or does not close. */
  warn: boolean;
}

/**
 * Waar het verschil zit: one row per payee, the supplier's terms under it
 * when they tell their own story (termsMixed). A term's word shows only when
 * it differs from the supplier's.
 */
export function nacalcChain(rows: readonly NacalcPayeeRow[], terms: (payee: Payee) => readonly LedgerTerm[], concept: boolean,
  reviewOf: (payee: Payee) => number = () => 0): ChainRow[] {
  const chain: ChainRow[] = [];
  for (const row of rows) {
    const word = payeeWord(row.status);
    const review = row.reason === 'review' || row.reason === 'unbudgeted';
    const toReview = cents(reviewOf(row.payee));
    let amount: PhoneAmount;
    if (row.reason === 'incomplete') amount = { text: '—', tone: 'none' };
    // A settled minder that cancels the meer still to review: the row names what to look at, never 'geen verschil' beside Nakijken.
    else if (cents(row.verschilEur) === 0 && toReview > 0) amount = { text: `${eur(toReview / 100)} meer`, tone: 'warn' };
    else if (cents(row.verschilEur) !== 0) {
      amount = verschilText({ differenceEur: row.verschilEur, fxEur: row.reason === 'fx' ? row.verschilEur : 0, reviewEur: review ? 1 : 0 });
    } else if (cents(row.openEur) > 0) amount = { text: `${eur(row.openEur)} open`, tone: row.dueNowEur > 0 ? 'warn' : 'none' };
    else amount = { text: 'geen verschil', tone: 'none' };
    // The koersverschil inside a payee's figures, unless the bank's rate is all of its Verschil (the amount says so then).
    const notes = (row.ddpNote ? ' · DDP' : '') + (row.cifNote ? ' · CIF' : '')
      + (cents(row.fxEur) !== 0 && row.reason !== 'fx' ? ` · koers ${signed(row.fxEur)}` : '');
    const line = row.agreedEur === null || row.status.kind === 'UNBUDGETED'
      ? `${eur(row.paidEur)} · zonder afspraak`
      : `${eur(row.agreedEur)} → ${eur(row.eindkostEur)}${notes}`;
    // Paid before the logbook: the one word says so instead of the status.
    chain.push({ kind: 'payee', key: row.payee, payee: row.payee, name: row.label, amount, line,
      word: row.reason === 'legacy' ? { word: 'Historisch', tone: 'neutral' } : word, warn: review || row.reason === 'incomplete' });
    if (!row.termsMixed) continue;
    const ledgerTerms = terms(row.payee);
    for (const term of row.terms) {
      const source = ledgerTerms.find(item => item.due === term.due);
      const own = source ? termWord(source, concept) : null;
      const termReview = own?.word === 'Nakijken';
      let termAmount: PhoneAmount;
      if (cents(term.verschilEur) !== 0) termAmount = verschilText({ differenceEur: term.verschilEur, fxEur: source?.fxEur ?? 0, reviewEur: termReview ? 1 : 0 });
      else if (cents(term.openEur) > 0) termAmount = { text: `${eur(term.openEur)} open`, tone: source?.state === 'due' ? 'warn' : 'none' };
      else termAmount = { text: 'geen verschil', tone: 'none' };
      // A netted term names the term it was netted with; 'Verrekend' then stands in the line, not twice.
      const note = source ? termNote(source) : null;
      chain.push({
        kind: 'term', key: `${row.payee}:${term.due}`, payee: row.payee, name: term.label, amount: termAmount,
        line: `${eur(term.agreedEur)} → ${eur((cents(term.paidEur) + cents(term.openEur)) / 100)}` + (note ? ` · ${note}` : ''),
        word: own && own.word !== word.word && !(note && own.word === 'Verrekend') ? own : null, warn: false,
      });
    }
  }
  return chain;
}

/**
 * The foot under Waar het verschil zit, the pair Emre asked about in its
 * right words: 'Bruto € 6.220,56 minder en € 2.949,22 meer; netto € 3.271,34
 * minder.' Zero parts stay out, a tegoed has no sign. Only when minder meets
 * a meer or bijkomend; 'netto …' only when the parts meet the Verschil
 * outside a review to the cent (the story card's Verschil row).
 */
export function nacalcGrossLine(ex: Pick<NacalcExplained, 'savingsEur' | 'overrunsEur' | 'additionalEur'> & { reviewEur?: number }, verschilEur: number,
  creditEur: number): string | null {
  const savings = cents(ex.savingsEur);
  const overruns = cents(ex.overrunsEur);
  const additional = cents(ex.additionalEur);
  const credit = cents(creditEur);
  if (savings <= 0 || (overruns <= 0 && additional <= 0)) return null;
  const parts = [`${eur(savings / 100)} minder`];
  if (overruns > 0) parts.push(`${eur(overruns / 100)} meer`);
  if (additional > 0) parts.push(`${eur(additional / 100)} bijkomend`);
  if (credit > 0) parts.push(`${eur(credit / 100)} tegoed`);
  const rest = cents(verschilEur) - Math.max(0, cents(ex.reviewEur));
  const total = overruns + additional - savings - credit;
  return total === rest && rest !== 0
    ? `Bruto ${listNl(parts)}; netto ${verschilText({ differenceEur: rest / 100, fxEur: 0 }).text}.`
    : `Bruto ${listNl(parts)}.`;
}

/**
 * The Nacalculatie's line under the Eindkost: 'betaald € a · open € b', a
 * tegoed after it, and what the Eindkost includes beside the agreements:
 * '· incl. bijkomend € c, koers + € d'.
 */
export function storySub(head: Pick<NacalcHeadline, 'kind' | 'paidEur' | 'openEur' | 'creditEur'> & Partial<Pick<NacalcHeadline, 'additionalEur' | 'fxEur'>>): string {
  if (head.kind === 'concept') return 'volgens de calculatie · nog niets betaald';
  const incl = [cents(head.additionalEur) > 0 ? `bijkomend ${eur(cents(head.additionalEur) / 100)}` : '',
    cents(head.fxEur) !== 0 ? `koers ${signed(head.fxEur ?? 0)}` : ''].filter(Boolean);
  return `betaald ${eur(head.paidEur)} · open ${eur(head.openEur)}` + (cents(head.creditEur) > 0 ? ` · tegoed − ${eur(head.creditEur)}` : '')
    + (incl.length ? ` · incl. ${incl.join(', ')}` : '');
}

/**
 * The story card's Verschil (Eindkost − Afspraak) split like Betalingen: the
 * part outside a review with its percentage of the Afspraak, and a Nakijken
 * row beside it. Afspraak + Verschil + Nakijken = Eindkost.
 */
export function storyVerschil(head: Pick<NacalcHeadline, 'verschilEur' | 'verschilPct' | 'reviewEur' | 'begrootEur'>): VerschilSplit & { pct: string } {
  const split = verschilSplit({ differenceEur: head.verschilEur, reviewEur: head.reviewEur, fxEur: 0 });
  const begroot = cents(head.begrootEur);
  const pct = cents(head.reviewEur) > 0
    ? (begroot > 0 ? pctText(Math.round(cents(split.verschilEur) / begroot * 1000) / 10, split.verschilEur) : '')
    : pctText(head.verschilPct, head.verschilEur);
  return { ...split, pct };
}

/** One product of Per product: its unit cost and incl. Enrosed kost on line 2, the Verschil at the right. */
export interface ProductLine {
  row: NacalcProductRow;
  unitText: string;
  inclText: string | null;
  verschil: PhoneAmount;
}

function unitOf(row: Pick<NacalcProductRow, 'set'>, basis: NacalcSetBasis): string {
  return row.set ? '/display' : basis === 'PIECE' ? '/st' : '/stuk';
}

/** Per product: the biggest eindkost first, the first five unless all; a display says '/display', a piece '/st' (or '/stuk' beside displays). */
export function productRows(products: readonly NacalcProductRow[], basis: NacalcSetBasis, all: boolean): ProductLine[] {
  const sorted = products.map((row, index) => ({ row, index }))
    .sort((left, right) => cents(right.row.eindkostEur) - cents(left.row.eindkostEur) || left.index - right.index)
    .map(item => item.row);
  return (all ? sorted : sorted.slice(0, 5)).map(row => {
    const usable = row.unitQuantity > 0;
    const unit = unitOf(row, basis);
    return {
      row,
      unitText: usable && row.unitEur !== null ? `${eur4(row.unitEur)} ${unit}` : '—',
      inclText: usable && row.pricingUnitEur !== null ? `${eur4(row.pricingUnitEur)} incl.` : null,
      verschil: !usable ? { text: row.set ? 'geen bruikbare displays' : 'geen bruikbare stuks', tone: 'none' }
        : verschilText({ differenceEur: row.verschilEur, fxEur: 0, reviewEur: row.verschilEur > 0 ? 1 : 0 }),
    };
  });
}

/** A row of the product sheet: its label, the figure, and a sub line under the label. */
export interface SheetRow { label: string; value: string; sub: string | null; strong?: boolean; tone?: PhoneAmount['tone'] }

/** The product sheet: quantity, Afspraak, Eindkost, Verschil, per unit and incl. Enrosed kost. */
export function productSheetRows(row: NacalcProductRow, received: boolean, basis: NacalcSetBasis): SheetRow[] {
  const words = row.set ? { one: 'display', other: 'displays' } : { one: 'stuk', other: 'stuks' };
  const quantity = received ? row.usable : row.ordered;
  const shortfall = [row.missing ? row.missing + ' te weinig' : '', row.damaged ? row.damaged + ' beschadigd' : '', row.over ? row.over + ' te veel' : '']
    .filter(Boolean).join(', ');
  const setSub = row.set ? `× ${row.set.pieces} ${row.set.other}` : '';
  const rows: SheetRow[] = [
    { label: received ? 'Bruikbaar' : 'Besteld', value: `${count(quantity)} ${quantity === 1 ? words.one : words.other}`,
      sub: [setSub, received ? shortfall : ''].filter(Boolean).join(' · ') || null },
    { label: 'Afspraak', value: eur(row.begrootEur), sub: null },
    { label: 'Eindkost', value: eur(row.eindkostEur), sub: null, strong: true },
  ];
  const verschil = row.unitQuantity === 0 ? { text: row.set ? 'geen bruikbare displays' : 'geen bruikbare stuks', tone: 'none' as const }
    : verschilText({ differenceEur: row.verschilEur, fxEur: 0, reviewEur: row.verschilEur > 0 ? 1 : 0 });
  rows.push({ label: 'Verschil', value: verschil.text, sub: null, tone: verschil.tone });
  const usable = row.unitQuantity > 0;
  const label = row.set ? 'Per display' : 'Per stuk';
  rows.push({ label, value: usable && row.unitEur !== null ? eur4(row.unitEur) : '—',
    sub: row.set && usable && row.unitPieceEur !== null ? `${eur4(row.unitPieceEur)} per stuk` : null, strong: true });
  rows.push({ label: 'Incl. Enrosed kost', value: usable && row.pricingUnitEur !== null ? eur4(row.pricingUnitEur) : '—',
    sub: row.set && usable && row.pricingPieceEur !== null ? `${eur4(row.pricingPieceEur)} per stuk` : basis === 'PIECE' ? null : `per ${row.set ? 'display' : 'stuk'}` });
  return rows;
}

/**
 * Van calculatie naar afspraak (Kostbasis): the bridge up to the Afspraak.
 * Paid, open, the eindkost and the Verschil stand in the story card above it,
 * so they are not repeated here.
 */
export function afspraakBridge(rows: readonly NacalcBridgeRow[]): NacalcBridgeRow[] {
  const end = rows.findIndex(row => row.key === 'BUDGET');
  const kept = end < 0 ? [...rows] : rows.slice(0, end + 1);
  return kept.map(row => {
    switch (row.key) {
      case 'LANDED': return { ...row, label: 'Totaal geland', note: 'calculatie' };
      case 'ENROSED': return { ...row, note: 'intern' };
      case 'BUDGET': return { ...row, label: 'Afspraak', note: 'bestelde aantallen, orderkoersen' };
      default: return row;
    }
  });
}

/** The payee sheet's lead: what the agreement rests on, without the status (on the receipt) and the plan (on Termijnen); '' when nothing is left. */
export function sheetLead(payee: Pick<PayeeLedger, 'payee' | 'basis'> & { terms: readonly unknown[] }, supplierName: string): string {
  switch (payee.payee) {
    case 'SUPPLIER': return [supplierName, payee.basis.startsWith('Goederen + zeevracht (CIF)') ? 'goederen + zeevracht (CIF)' : '',
      payee.terms.length ? '' : 'geen betaalplan'].filter(Boolean).join(' · ');
    case 'OTHER': return 'Bankkosten, koerier, wisselkoers · zonder afspraak';
    case 'LOGISTICS': return payee.basis === 'Inbegrepen in de prijs (DDP)' ? 'inbegrepen in de prijs (DDP)'
      : payee.basis.endsWith('(CIF)') ? 'zeevracht via de leverancier (CIF)' : '';
    default: return payee.basis;
  }
}

/** The Termijnen head's trail: '1/3 · 1/3 · 1/3'; the moments are in the term labels. */
export function planTrail(planLabel: string, termLabels: readonly string[]): string {
  const stripped = planLabel.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (stripped !== planLabel.trim()) return stripped;
  const shares = termLabels.map(label => label.split(' ')[0]);
  return termLabels.length && shares.every(share => /^\d/.test(share)) ? shares.join(' · ') : planLabel;
}

/** An invoice file without data in two parts: 'Factuurbestand' with 'zonder gegevens', or 'Proforma (PI)'. */
export function fileWords(file: { kind?: DocumentKind | null }): { title: string; note: string | null } {
  return file.kind === 'PROFORMA_INVOICE' ? { title: 'Proforma (PI)', note: null } : { title: 'Factuurbestand', note: 'zonder gegevens' };
}

/**
 * The proof mark of a payment row: the bank icon for money on the bank (its
 * words go to the screen reader), a clip for a file, and visible words only
 * where the mark alone does not say it ('1 van 2', a file name, an offset).
 */
export function proofMark(text: string | null, row: { linked: number; creditOffset: boolean }): { icon: 'bank' | 'clip' | null; label: string; text: string } | null {
  if (!text) return null;
  if (row.creditOffset) return { icon: null, label: text, text };
  if (row.linked > 0) {
    const [bank, ...rest] = text.split(' · ');
    if (!/op de bank$/.test(bank)) return { icon: 'bank', label: text, text };
    const partial = /^(\d+ van \d+) op de bank$/.exec(bank);
    return { icon: 'bank', label: text, text: [partial ? partial[1] : '', ...rest].filter(Boolean).join(' · ') };
  }
  return { icon: 'clip', label: text, text };
}

/** A payment row's second line: the term, else the payee (Douane & transport in full), with the transfer count. */
export function paymentLine(row: { termLabel: string | null; payee: Payee; payeeLabel: string; payeeShort: string; parts: readonly unknown[] }): string {
  const who = row.termLabel || (row.payee === 'LOGISTICS' ? row.payeeLabel : row.payeeShort);
  return who + (row.parts.length > 1 ? ` · ${row.parts.length} transacties` : '');
}

/** The same line inside the payee's own sheet: the term and the transfer count, never the payee again; '' when nothing is left. */
export function sheetPaymentLine(row: { termLabel: string | null; parts: readonly unknown[] }): string {
  return [row.termLabel ?? '', row.parts.length > 1 ? `${row.parts.length} transacties` : ''].filter(Boolean).join(' · ');
}
