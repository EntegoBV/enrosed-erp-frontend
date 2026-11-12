import type { SettlementSnapshotLine } from '../../core/api/models';
import type { PartnerDocumentBreakdown, PartnerDocumentBreakdownLine, PartnerDocumentMelding } from '../../core/api/partner-sales-api';

/*
 * The "Marge / eenheid" popup of a document made from the partner's meldingen
 * (Veilingverkopen › Factureren): per product line the way from the auction's
 * bruto to what this document invoices, per unit and for the whole line.
 * Every amount is the server's (the breakdown, else the document's own
 * settlement snapshot and line): nothing is recomputed differently, only
 * divided by the line's quantity for the per-unit column. Pure: types only.
 */

export type CostSign = '' | '−' | '+' | '=' | '→';

export interface ReportCostRow {
  key: string;
  sign: CostSign;
  label: string;
  hint: string | null;
  /** The whole line, in euros. */
  lineEur: number;
  /** Per unit of the invoice line (line / quantity); null when the line has no quantity. */
  unitEur: number | null;
  /** sum = an intermediate result (Netto opbrengst, Winst), total = what the document invoices, part = an indented split. */
  tone: 'plain' | 'sum' | 'total' | 'part';
}

export interface ReportCostView {
  /** "100 verkocht · 1 teruggekocht" (quantities in the line's unit). */
  quantities: string;
  rows: ReportCostRow[];
  /** The row equal to the clicked "Marge" cell: our profit on this line. */
  highlight: string;
  /** "= € 0,04 per roos" under the highlighted per-unit figure of a display. */
  perPiece: number | null;
  meldingen: PartnerDocumentMelding[];
  /** Said under the rows: a fallback without detail, an absorbed product. */
  notes: string[];
}

export interface ReportCostUnit {
  /** "display" / "roos": what one invoice unit is. */
  singular: string;
  plural: string;
  /** Pieces in one unit when it is a display (12), else null. */
  piecesPerDisplay: number | null;
  /** The piece's own name ("roos"), for "= € x per roos". */
  pieceOne: string;
}

export interface ReportCostInput {
  productId: number;
  /** The invoice line's quantity, in its sales unit. */
  quantity: number;
  unit: ReportCostUnit;
  /** The line as the document prices it: its net (our value) and its cost per unit. */
  line: { net: number; landedUnitCost: number; marginEur: number };
  /** undefined while loading, null when the server has none (an older backend, or no breakdown kept). */
  breakdown: PartnerDocumentBreakdown | null | undefined;
  settlementLine: SettlementSnapshotLine | null;
  /** The document's profit share (a settlement's own), when the breakdown does not say it. */
  sharePct: number | null;
  /** "Verhoeven": the partner in a label. */
  partner: string;
}

const FALLBACK_NOTE = 'Opbouw uit de factuurregels; geen detail bewaard.';

function cents(value: number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function pct(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `${new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 2 }).format(n)} %`;
}

function count(n: number, one: string, other: string): string {
  return `${new Intl.NumberFormat('nl-BE').format(n)} ${n === 1 ? one : other}`;
}

/** The breakdown's line of this product, when there is one. */
export function breakdownLineOf(breakdown: PartnerDocumentBreakdown | null | undefined, productId: number): PartnerDocumentBreakdownLine | null {
  return breakdown?.lines?.find((line) => line.productId === productId) ?? null;
}

/** Our profit on a report-backed line: the breakdown's (value − cost) once it is known, else the document line's margin. */
export function reportLineMargin(breakdown: PartnerDocumentBreakdown | null | undefined, productId: number, marginEur: number): number {
  const line = breakdownLineOf(breakdown, productId);
  return line ? cents(line.enrosedProfitEur ?? (line.valueEur - line.costEur)) : marginEur;
}

/** The cost per unit a report-backed line shows under its margin ("inkoop € x"). */
export function reportLineCost(breakdown: PartnerDocumentBreakdown | null | undefined, productId: number, quantity: number, landedUnitCost: number): number {
  const line = breakdownLineOf(breakdown, productId);
  return line && quantity > 0 ? line.costEur / quantity : landedUnitCost;
}

/** Netto opbrengst of the whole document: the breakdown's lines, else the settlement's; null when neither is known. */
export function reportProceeds(breakdown: PartnerDocumentBreakdown | null | undefined, settlement: readonly SettlementSnapshotLine[] | null | undefined): number | null {
  if (breakdown?.lines?.length) return cents(breakdown.lines.reduce((sum, line) => sum + (line.proceedsEur ?? 0), 0));
  if (settlement?.length) return cents(settlement.reduce((sum, line) => sum + (line.proceedsEur ?? 0), 0));
  return null;
}

/** "Veiling", "Direct", "Veiling en direct" for the meldingen of a document. */
export function reportChannelLabel(breakdown: PartnerDocumentBreakdown | null | undefined): string {
  const channels = new Set((breakdown?.meldingen ?? []).map((melding) => melding.channel));
  const channel = breakdown?.channel ?? (channels.size > 1 ? 'MIXED' : [...channels][0] ?? null);
  return channel === 'DIRECT' ? 'direct verkocht' : channel === 'MIXED' ? 'veiling en direct' : channel === 'AUCTION' ? 'op de veiling' : '';
}

/**
 * The rows of the popup. With the breakdown: Bruto − commissie − transport − extra − terugkoopkost (± what another
 * product brought in) = Netto opbrengst; − Inkoopkost (who financed it) = Winst, split → Enrosed / → the partner;
 * Onze waarde − voorschot = Te factureren; the partner keeps the rest of the netto opbrengst. Without it, the same
 * chain from Netto opbrengst on (a settlement's snapshot), or only our value and cost (own stock).
 */
export function reportCostView(input: ReportCostInput): ReportCostView {
  const q = input.quantity;
  const per = (eur: number): number | null => (q > 0 ? eur / q : null);
  const rows: ReportCostRow[] = [];
  const notes: string[] = [];
  const add = (key: string, sign: CostSign, label: string, eur: number, tone: ReportCostRow['tone'] = 'plain', hint: string | null = null): void => {
    rows.push({ key, sign, label, hint, lineEur: cents(eur), unitEur: per(cents(eur)), tone });
  };
  const unit = input.unit;
  const line = breakdownLineOf(input.breakdown, input.productId);
  let quantities = count(q, unit.singular, unit.plural);

  if (line) {
    const fallback = input.breakdown?.fallback === true;
    const sold = line.soldQuantity ?? q, back = line.boughtBackQuantity ?? 0;
    quantities = back > 0 ? `${count(sold, unit.singular, unit.plural)} verkocht · ${new Intl.NumberFormat('nl-BE').format(back)} teruggekocht`
      : `${count(sold, unit.singular, unit.plural)} verkocht`;
    const hasTop = !fallback || cents(line.grossEur) !== 0;
    if (hasTop) {
      add('gross', '', 'Bruto', line.grossEur, 'plain', `verkocht ${reportChannelLabel(input.breakdown) || ''}`.trim());
      if (cents(line.commissionEur)) add('commission', '−', 'Veilingcommissie', line.commissionEur);
      if (cents(line.transportEur)) add('transport', '−', 'Transport', line.transportEur);
      if (cents(line.extraEur)) add('extra', '−', 'Extra kost', line.extraEur);
      if (cents(line.buybackCostEur)) add('buyback', '−', 'Terugkoopkost', line.buybackCostEur, 'plain', 'incl. commissie en transport');
      const absorbed = cents(line.absorbedEur);
      if (absorbed) {
        const from = (line.absorbedFrom ?? []).filter(Boolean);
        add('absorbed', absorbed > 0 ? '+' : '−', absorbed > 0 ? 'Overgenomen' : 'Overgedragen', Math.abs(absorbed), 'plain',
          from.length ? `${from.join(', ')}: verkocht en teruggekocht` : 'van een product dat verkocht en teruggekocht werd');
      }
    }
    add('proceeds', hasTop ? '=' : '', 'Netto opbrengst', line.proceedsEur, 'sum');
    const costShare = line.costSharePct;
    const costHint = costShare == null ? null
      : costShare >= 100 ? `${input.partner} ${pct(100)}` : costShare <= 0 ? `Enrosed ${pct(100)}`
      : `${input.partner} ${pct(costShare)} · Enrosed ${pct(100 - costShare)}`;
    add('cost', '−', 'Inkoopkost', line.costEur, 'plain', costHint);
    const profit = cents(line.profitEur ?? (line.proceedsEur - line.costEur));
    add('profit', '=', 'Winst', profit, 'sum');
    const share = line.profitSharePct ?? input.sharePct;
    const ours = cents(line.enrosedProfitEur ?? (line.valueEur - line.costEur));
    add('ours', '→', `Enrosed${share != null ? ' ' + pct(share) : ''}`, ours, 'part');
    const theirs = cents(line.partnerProfitEur ?? (line.proceedsEur - line.valueEur));
    add('theirs', '→', input.partner, theirs, 'part');
    add('value', '', 'Onze waarde', line.valueEur, 'sum', 'inkoopkost + winst Enrosed');
    const correction = cents(line.correctionEur);
    if (correction) add('correction', '', 'waarvan correctie eerdere deelfacturen', correction, 'part');
    if (cents(line.advanceEur)) add('advance', '−', 'Voorschot verrekend', line.advanceEur);
    const invoiced = cents(line.valueEur - (line.advanceEur ?? 0));
    add('invoice', '=', 'Te factureren', invoiced, 'total');
    /* Without an advance this equals his profit share above: said once. */
    if (cents(line.advanceEur)) add('keeps', '', `${input.partner} houdt`, cents(line.proceedsEur - invoiced), 'plain', 'netto opbrengst − te factureren');
    if (fallback) notes.push(input.breakdown?.fallbackNote || FALLBACK_NOTE);
    return { quantities, rows, highlight: 'ours', perPiece: perPiece(ours, q, unit), meldingen: input.breakdown?.meldingen ?? [], notes };
  }

  /* No breakdown (an older backend): what the document itself kept. */
  const snapshot = input.settlementLine;
  const ours = cents(input.line.marginEur);
  if (snapshot) {
    add('proceeds', '', 'Netto opbrengst', snapshot.proceedsEur, 'sum');
    add('cost', '−', 'Inkoopkost', snapshot.costEur);
    add('profit', '=', 'Winst', snapshot.proceedsEur - snapshot.costEur, 'sum');
    add('ours', '→', `Enrosed${input.sharePct != null ? ' ' + pct(input.sharePct) : ''}`, ours, 'part');
    add('theirs', '→', input.partner, snapshot.proceedsEur - snapshot.revenueEur, 'part');
    add('value', '', 'Onze waarde', snapshot.revenueEur, 'sum', 'inkoopkost + winst Enrosed');
    if (cents(snapshot.advanceEur)) add('advance', '−', 'Voorschot verrekend', snapshot.advanceEur);
    const invoiced = cents(snapshot.revenueEur - snapshot.advanceEur);
    add('invoice', '=', 'Te factureren', invoiced, 'total');
    if (cents(snapshot.advanceEur)) add('keeps', '', `${input.partner} houdt`, snapshot.proceedsEur - invoiced, 'plain', 'netto opbrengst − te factureren');
  } else {
    const cost = q * input.line.landedUnitCost;
    add('value', '', 'Onze waarde', input.line.net, 'sum', 'deze factuurregel');
    add('cost', '−', 'Inkoopkost', cost);
    add('ours', '=', 'Winst Enrosed', ours, 'part');
  }
  notes.push(input.breakdown === null ? FALLBACK_NOTE + ' Bruto en kosten per melding staan bij Veilingverkopen.' : '');
  return { quantities, rows, highlight: 'ours', perPiece: perPiece(ours, q, unit), meldingen: [], notes: notes.filter(Boolean) };
}

function perPiece(eur: number, quantity: number, unit: ReportCostUnit): number | null {
  const pieces = unit.piecesPerDisplay;
  return pieces && pieces > 1 && quantity > 0 ? eur / quantity / pieces : null;
}

/**
 * The melding numbers of a document, consecutive ones collapsed: "VV-12, VV-14, VV-17–19". Numbers that do not end
 * in digits stay as they are. Never "t/m" over a gap: a number in between may sit on another document.
 */
export function meldingNumbersLine(meldingen: readonly Pick<PartnerDocumentMelding, 'number'>[]): string {
  const parsed = meldingen.map((melding) => {
    const match = /^(.*?)(\d+)$/.exec(melding.number ?? '');
    return match ? { prefix: match[1], n: Number(match[2]), text: melding.number } : { prefix: null, n: NaN, text: melding.number };
  });
  const numbered = parsed.filter((item) => item.prefix !== null).sort((a, b) => (a.prefix! < b.prefix! ? -1 : a.prefix! > b.prefix! ? 1 : a.n - b.n));
  const parts: string[] = [];
  for (let i = 0; i < numbered.length; i++) {
    let j = i;
    while (j + 1 < numbered.length && numbered[j + 1].prefix === numbered[i].prefix && numbered[j + 1].n === numbered[j].n + 1) j++;
    parts.push(j > i ? `${numbered[i].prefix}${numbered[i].n}–${numbered[j].n}` : numbered[i].text);
    i = j;
  }
  return [...parts, ...parsed.filter((item) => item.prefix === null).map((item) => item.text)].join(', ');
}
