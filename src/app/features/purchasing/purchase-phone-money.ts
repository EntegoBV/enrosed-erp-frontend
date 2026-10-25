/*
 * The phone's words for money out and the Nacalculatie (Betalingen, the payee
 * sheet and Kosten, 2026-10-25): one status word per payee or term, one
 * Verschil written as '€ x minder' or '€ x meer' (never a − / + pair), and the
 * rows the phone cards list. Phone only: the desk keeps PayeeStatus.label,
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
 * Under the card's Verschil, where it comes from: each agreement payee with
 * a difference, its own net figure and word, in the ledger's order. A payee
 * still to review says so.
 */
export function differenceByPayee(payees: readonly Pick<PayeeLedger, 'payee' | 'label' | 'differenceEur' | 'reviewEur' | 'fxEur'>[]):
  { payee: Payee; label: string; text: string; tone: PhoneAmount['tone'] }[] {
  return [...payees]
    .filter(item => item.payee !== 'OTHER' && cents(item.differenceEur) !== 0)
    .sort((left, right) => ORDER.indexOf(left.payee) - ORDER.indexOf(right.payee))
    .map(item => {
      const amount = verschilText(item);
      const review = cents(item.reviewEur) > 0;
      return { payee: item.payee, label: item.label, text: review ? `${amount.text} · nakijken` : amount.text, tone: review ? 'warn' : amount.tone };
    });
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
export function nacalcChain(rows: readonly NacalcPayeeRow[], terms: (payee: Payee) => readonly LedgerTerm[], concept: boolean): ChainRow[] {
  const chain: ChainRow[] = [];
  for (const row of rows) {
    const word = payeeWord(row.status);
    const review = row.reason === 'review' || row.reason === 'unbudgeted';
    let amount: PhoneAmount;
    if (row.reason === 'incomplete') amount = { text: '—', tone: 'none' };
    else if (cents(row.verschilEur) !== 0) {
      amount = verschilText({ differenceEur: row.verschilEur, fxEur: row.reason === 'fx' ? row.verschilEur : 0, reviewEur: review ? 1 : 0 });
    } else if (cents(row.openEur) > 0) amount = { text: `${eur(row.openEur)} open`, tone: row.dueNowEur > 0 ? 'warn' : 'none' };
    else amount = { text: 'geen verschil', tone: 'none' };
    const notes = (row.ddpNote ? ' · DDP' : '') + (row.cifNote ? ' · CIF' : '');
    const line = row.agreedEur === null || row.status.kind === 'UNBUDGETED'
      ? `${eur(row.paidEur)} · zonder afspraak`
      : `${eur(row.agreedEur)} → ${eur(row.eindkostEur)}${notes}`;
    chain.push({ kind: 'payee', key: row.payee, payee: row.payee, name: row.label, amount, line, word,
      warn: review || row.reason === 'incomplete' });
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
      chain.push({
        kind: 'term', key: `${row.payee}:${term.due}`, payee: row.payee, name: term.label, amount: termAmount,
        line: `${eur(term.agreedEur)} → ${eur((cents(term.paidEur) + cents(term.openEur)) / 100)}`,
        word: own && own.word !== word.word ? own : null, warn: false,
      });
    }
  }
  return chain;
}

/**
 * The foot under Waar het verschil zit: the gross settled figures as the sum
 * of the rows above ('Opgeteld: € 6.220,56 minder, € 2.949,22 meer, € 0,00
 * bijkomend; samen € 3.271,34 minder.'). Only when there is a gross pair;
 * 'samen …' only when the parts meet the Verschil to the cent.
 */
export function nacalcGrossLine(ex: Pick<NacalcExplained, 'savingsEur' | 'overrunsEur' | 'additionalEur'>, verschilEur: number, creditEur: number): string | null {
  const savings = cents(ex.savingsEur);
  const overruns = cents(ex.overrunsEur);
  const additional = cents(ex.additionalEur);
  const credit = cents(creditEur);
  if (savings <= 0 || (overruns <= 0 && additional <= 0)) return null;
  const parts = `${eur(savings / 100)} minder, ${eur(overruns / 100)} meer, ${eur(additional / 100)} bijkomend` + (credit > 0 ? `, − ${eur(credit / 100)} tegoed` : '');
  const total = overruns + additional - savings - credit;
  return total === cents(verschilEur)
    ? `Opgeteld: ${parts}; samen ${verschilText({ differenceEur: verschilEur, fxEur: 0 }).text}.`
    : `Opgeteld: ${parts}.`;
}

/** The Nacalculatie's line under the Eindkost: 'betaald € a · open € b', a tegoed after it. */
export function storySub(head: Pick<NacalcHeadline, 'kind' | 'paidEur' | 'openEur' | 'creditEur'>): string {
  if (head.kind === 'concept') return 'volgens de calculatie · nog niets betaald';
  return `betaald ${eur(head.paidEur)} · open ${eur(head.openEur)}` + (cents(head.creditEur) > 0 ? ` · tegoed − ${eur(head.creditEur)}` : '');
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
