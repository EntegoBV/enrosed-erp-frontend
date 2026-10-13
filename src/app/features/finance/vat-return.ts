import type { Clearance, PurchaseOrderView, SalesOrderView } from '../../core/api/models';
import type { ReturnLine } from './finance-metrics';

/*
 * The quarterly VAT return (form 625) built from three sources: the cost
 * lines finance-metrics already placed in their grids, the issued sales
 * documents (Kader II) and the containers (goods in 81, import VAT by
 * clearance). Every grid is listed, empty ones too, so the screen shows a
 * fixed form. The quarter and deadline helpers mirror finance-metrics (this
 * file takes no runtime import); the money per line comes in as data.
 * Rules: vat-reference.md; the medium-confidence ones are said so on screen.
 */

export type GridCode = '00' | '01' | '02' | '03' | '44' | '45' | '46' | '47' | '48' | '49'
  | '81' | '82' | '83' | '84' | '85' | '86' | '87' | '88' | '54' | '55' | '56' | '57' | '59' | '61' | '62' | '63' | '64';

export interface GridRow {
  kind: 'cost' | 'sales' | 'container';
  id: number;
  date: string;
  title: string;
  /** The party, customer or container name under the title. */
  sub: string;
  baseEur: number;
  vatEur: number;
  badges: string[];
  reference?: string | null;
}

export interface Grid {
  code: GridCode;
  kader: 'II' | 'III' | 'IV' | 'V';
  label: string;
  eur: number;
  rows: GridRow[];
}

/** An issued invoice or credit note as Kader II reads it. */
export interface SalesDocLine {
  id: number;
  number: string;
  customer: string;
  date: string;
  docType: 'FACTUUR' | 'CREDITNOTA';
  treatment: string;
  ratePct: number;
  baseEur: number;
  vatEur: number;
}

/** A container as Kader III reads it: the goods for 81, the import base and its 21 % by clearance. */
export interface ContainerLine {
  id: number;
  number: string;
  alias: string | null;
  date: string | null;
  dateSource: 'received' | 'expected' | null;
  clearance: Clearance | null;
  suggested: Clearance;
  goodsEur: number;
  goodsUsd: number;
  rate: number;
  baseEur: number;
  vatEur: number;
  dutyEur: number;
  representative: string | null;
}

export interface VatReturn {
  year: number;
  quarter: number;
  from: string;
  to: string;
  filingDeadline: string;
  grids: Grid[];
  totals: { dueEur: number; deductibleEur: number; payableEur: number; refundEur: number };
  /** 'ready' once the quarter is over and nothing waits for a confirmation. */
  status: 'provisional' | 'ready';
  unconfirmedCount: number;
  /** Costs without a regime: outside the grids until one is picked. */
  unknown: ReturnLine[];
  notReceived: ContainerLine[];
  lateCount: number;
}

const GRIDS: readonly { code: GridCode; kader: Grid['kader']; label: string }[] = [
  { code: '00', kader: 'II', label: 'Handelingen onder bijzondere regeling' },
  { code: '01', kader: 'II', label: 'Verkopen 6 %' },
  { code: '02', kader: 'II', label: 'Verkopen 12 %' },
  { code: '03', kader: 'II', label: 'Verkopen 21 %' },
  { code: '44', kader: 'II', label: 'Diensten aan EU-klanten (btw verlegd)' },
  { code: '45', kader: 'II', label: 'Handelingen met medecontractant' },
  { code: '46', kader: 'II', label: 'Intracommunautaire leveringen' },
  { code: '47', kader: 'II', label: 'Uitvoer en andere vrijgestelde handelingen' },
  { code: '48', kader: 'II', label: 'Creditnota’s op 44 en 46' },
  { code: '49', kader: 'II', label: 'Creditnota’s op andere verkopen' },
  { code: '81', kader: 'III', label: 'Handelsgoederen, grond- en hulpstoffen' },
  { code: '82', kader: 'III', label: 'Diensten en diverse goederen' },
  { code: '83', kader: 'III', label: 'Bedrijfsmiddelen' },
  { code: '84', kader: 'III', label: 'Creditnota’s op 86 en 88' },
  { code: '85', kader: 'III', label: 'Andere ontvangen creditnota’s' },
  { code: '86', kader: 'III', label: 'Intracommunautaire verwervingen' },
  { code: '87', kader: 'III', label: 'Andere handelingen met verlegde btw' },
  { code: '88', kader: 'III', label: 'Intracommunautaire diensten' },
  { code: '54', kader: 'IV', label: 'Btw op 01, 02 en 03' },
  { code: '55', kader: 'IV', label: 'Btw op 86 en 88' },
  { code: '56', kader: 'IV', label: 'Btw op 87' },
  { code: '57', kader: 'IV', label: 'Btw op invoer met verlegging' },
  { code: '63', kader: 'IV', label: 'Btw op ontvangen creditnota’s' },
  { code: '59', kader: 'V', label: 'Aftrekbare btw' },
  { code: '64', kader: 'V', label: 'Btw op uitgereikte creditnota’s' },
];

const DEAD_STATUSES = new Set<string>(['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);
const IMPORT_VAT_PCT = 21;
const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value as number) ? value as number : 0) * 100);
const pad = (value: number): string => String(value).padStart(2, '0');

/* The same calendar as finance-metrics quarterOf / quarterRange / filingDeadline. */
function quarterOf(date: string): { year: number; quarter: number } {
  return { year: Number((date ?? '').slice(0, 4)), quarter: Math.floor(((Number((date ?? '').slice(5, 7)) || 1) - 1) / 3) + 1 };
}
function quarterRange(year: number, quarter: number): { from: string; to: string } {
  const first = (quarter - 1) * 3 + 1;
  return { from: `${year}-${pad(first)}-01`, to: `${year}-${pad(first + 2)}-${pad(new Date(Date.UTC(year, first + 2, 0)).getUTCDate())}` };
}
function filingDeadline(year: number, quarter: number): string {
  return quarter === 4 ? `${year + 1}-01-25` : `${year}-${pad(quarter * 3 + 1)}-25`;
}

/** Antwerp clears in Belgium; Rotterdam and Amsterdam through the Dutch fiscal representative, goods to Belgium. */
export function clearanceSuggestion(destinationPort: string | null | undefined): Clearance {
  return /antwerp/i.test(destinationPort ?? '') ? 'BE_CUSTOMS' : 'NL_FISCAL_REP_TO_BE';
}

/** Issued invoices and credit notes (partner advances included); concepts and dead documents stay out. */
export function salesDocLines(views: readonly SalesOrderView[], customerName: (id: number | null) => string): SalesDocLine[] {
  const lines: SalesDocLine[] = [];
  for (const view of views) {
    const order = view.order;
    const docType = order.docType === 'FACTUUR' ? 'FACTUUR' : order.docType === 'CREDITNOTA' ? 'CREDITNOTA' : null;
    if (!docType || order.status === 'CONCEPT' || DEAD_STATUSES.has(order.status)) continue;
    const totals = view.priced?.totals;
    lines.push({
      id: order.id, number: order.number, customer: customerName(order.customerId), date: order.orderDate, docType,
      treatment: totals?.vatTreatment ?? '', ratePct: Number.isFinite(totals?.vatRatePct) ? totals!.vatRatePct : 0,
      baseEur: Math.abs(cents(totals?.total)) / 100, vatEur: Math.abs(cents(totals?.vatAmount)) / 100,
    });
  }
  return lines.sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);
}

/** Every ordered container: the goods at the order's rate, the import base (customs value + duties) and 21 % on it. */
export function containerLines(views: readonly PurchaseOrderView[], settings: { importVatDeferred: boolean; representative: string | null }): ContainerLine[] {
  const lines: ContainerLine[] = [];
  for (const view of views) {
    const order = view.order;
    if (order.status === 'CONCEPT') continue;
    const totals = view.costing?.totals;
    const baseCents = cents(totals?.customsValueEur) + cents(totals?.dutyEur);
    lines.push({
      id: order.id, number: order.number, alias: order.alias ?? null,
      date: order.receivedOn || order.expectedArrival || null, dateSource: order.receivedOn ? 'received' : order.expectedArrival ? 'expected' : null,
      clearance: order.clearance ?? null, suggested: clearanceSuggestion(order.destinationPort),
      goodsEur: cents(totals?.goodsEur) / 100, goodsUsd: cents(totals?.goodsUsd) / 100, rate: Number.isFinite(order.usdToEurGoods) ? order.usdToEurGoods : 0,
      baseEur: baseCents / 100, vatEur: Math.round(baseCents * IMPORT_VAT_PCT / 100) / 100, dutyEur: cents(totals?.dutyEur) / 100,
      representative: settings.representative,
    });
  }
  return lines.sort((left, right) => (left.date ?? '9999-99-99').localeCompare(right.date ?? '9999-99-99') || left.id - right.id);
}

function dayMonthYear(day: string): string {
  return `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;
}

/** Places every line, document and container of the quarter in its grids and adds the form up. */
export function vatReturn(year: number, quarter: number, lines: readonly ReturnLine[], sales: readonly SalesDocLine[], containers: readonly ContainerLine[],
                          settings: { importVatDeferred: boolean; today: string }): VatReturn {
  const { from, to } = quarterRange(year, quarter);
  const grids = new Map<GridCode, Grid>(GRIDS.map((grid) => [grid.code, { ...grid, eur: 0, rows: [] }]));
  const put = (code: GridCode, row: GridRow): void => { grids.get(code)!.rows.push(row); };
  const inQuarter = (date: string | null): boolean => !!date && quarterOf(date).year === year && quarterOf(date).quarter === quarter;

  const unknown: ReturnLine[] = [];
  let unconfirmedCount = 0;
  let lateCount = 0;
  for (const line of lines) {
    if (line.year !== year || line.quarter !== quarter) continue;
    if (line.regime === null) { unknown.push(line); continue; }
    if (!line.confirmed) unconfirmedCount += 1;
    if (line.lateBooked) lateCount += 1;
    const badges = [
      ...(line.confirmed ? [] : ['te bevestigen']),
      ...(line.lateBooked ? ['na indiening'] : []),
      ...(line.needsDocument ? [line.regime === 'IMPORT_VAT_PAID' ? 'zonder douanedocument' : 'zonder factuur'] : []),
    ];
    const row = (baseEur: number, vatEur: number): GridRow => ({
      kind: 'cost', id: line.costId ?? 0, date: line.date, title: line.description, sub: line.party ?? '', baseEur, vatEur, badges, reference: line.reference,
    });
    if (line.baseGrid) put(line.baseGrid, row(line.baseEur, line.deductibleEur));
    if (line.detailGrid) put(line.detailGrid, row(line.detailEur, line.dueEur));
    if (line.dueGrid) put(line.dueGrid, row(line.detailEur, line.dueEur));
    if (line.deductibleEur > 0) put('59', row(line.baseGrid ? line.baseEur : 0, line.deductibleEur));
  }

  for (const doc of sales) {
    if (!inQuarter(doc.date)) continue;
    const row = (badges: string[] = []): GridRow => ({ kind: 'sales', id: doc.id, date: doc.date, title: doc.number, sub: doc.customer, baseEur: doc.baseEur, vatEur: doc.vatEur, badges });
    const intraEu = doc.treatment === 'INTRACOMMUNAUTAIR';
    const exempt = doc.treatment === 'UITVOER' || doc.treatment === 'VERLEGD_FISCAAL_VERTEGENWOORDIGER';
    if (doc.docType === 'CREDITNOTA') {
      put(intraEu ? '48' : '49', row());
      put('64', row());
      continue;
    }
    if (intraEu) { put('46', row()); continue; }
    if (exempt) { put('47', row()); continue; }
    const standard = doc.ratePct === 6 || doc.ratePct === 12 || doc.ratePct === 21;
    const badges = standard ? [] : [`tarief ${doc.ratePct} % · te bevestigen`];
    put(doc.ratePct === 6 ? '01' : doc.ratePct === 12 ? '02' : '03', row(badges));
    put('54', row(badges));
  }

  const notReceived: ContainerLine[] = [];
  let openClearance = false;
  for (const container of containers) {
    if (!container.date) { notReceived.push(container); continue; }
    if (!inQuarter(container.date)) continue;
    const clearance = container.clearance ?? container.suggested;
    const name = container.alias ? `${container.number} · ${container.alias}` : container.number;
    const badges = [
      ...(container.clearance === null ? ['inklaring te bevestigen'] : []),
      ...(container.dateSource === 'expected' ? ['verwachte aankomst'] : []),
    ];
    if (container.clearance === null) openClearance = true;
    const row = (baseEur: number, vatEur: number, extra: string[] = []): GridRow => ({
      kind: 'container', id: container.id, date: container.date!, title: name, sub: 'container', baseEur, vatEur, badges: [...badges, ...extra],
    });
    put('81', row(container.goodsEur, 0, [`koers van de order ${container.rate}`, 'invoerrechten · bij de goederen, geen vak']));
    if (clearance === 'BE_CUSTOMS' && settings.importVatDeferred) {
      const selfAssessed = ['ET 14000 · zelf aangegeven'];
      put('87', row(container.baseEur, container.vatEur, selfAssessed));
      put('57', row(container.baseEur, container.vatEur, selfAssessed));
      put('59', row(container.baseEur, container.vatEur, selfAssessed));
    } else if (clearance === 'NL_FISCAL_REP_TO_BE') {
      const via = [`via ${container.representative ?? 'fiscaal vertegenwoordiger'}`];
      put('86', row(container.baseEur, container.vatEur, via));
      put('55', row(container.baseEur, container.vatEur, via));
      put('59', row(container.baseEur, container.vatEur, via));
    }
  }

  const amountOf = (grid: Grid, row: GridRow): number => (grid.kader === 'IV' || grid.kader === 'V' ? row.vatEur : row.baseEur);
  for (const grid of grids.values()) {
    grid.rows.sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);
    grid.eur = grid.rows.reduce((sum, row) => sum + cents(amountOf(grid, row)), 0) / 100;
  }
  const eur = (code: GridCode): number => cents(grids.get(code)!.eur);
  const dueCents = eur('54') + eur('55') + eur('56') + eur('57') + eur('63');
  const deductibleCents = eur('59') + eur('64');
  const ready = settings.today > to && unconfirmedCount === 0 && unknown.length === 0 && !openClearance;
  return {
    year, quarter, from, to, filingDeadline: filingDeadline(year, quarter),
    grids: [...grids.values()],
    totals: { dueEur: dueCents / 100, deductibleEur: deductibleCents / 100, payableEur: Math.max(0, dueCents - deductibleCents) / 100, refundEur: Math.max(0, deductibleCents - dueCents) / 100 },
    status: ready ? 'ready' : 'provisional',
    unconfirmedCount, unknown, notReceived, lateCount,
  };
}

/** The return as the accountant's Excel opens it: a status line, then one line per grid and one per document under it. The caller adds the BOM. */
export function vatReturnCsv(result: VatReturn): string {
  const cell = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : value;
    return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const status = result.status === 'ready' ? 'KLAAR' : `VOORLOPIG · ${result.unconfirmedCount + result.unknown.length} te bevestigen`;
  const lines = [
    `${status} · btw-aangifte ${result.year} Q${result.quarter} · ${dayMonthYear(result.from)} tot ${dayMonthYear(result.to)} · indienen vóór ${dayMonthYear(result.filingDeadline)}`,
    ['Kader', 'Rooster', 'Omschrijving', 'Bedrag', 'Document', 'Datum', 'Partij', 'Referentie', 'Basis', 'Btw', 'Opmerking'].join(';'),
  ];
  for (const grid of result.grids) {
    lines.push([grid.kader, grid.code, grid.label, grid.eur, null, null, null, null, null, null, null].map(cell).join(';'));
    for (const row of grid.rows) {
      lines.push([grid.kader, grid.code, null, null, row.title, row.date, row.sub, row.reference ?? null, row.baseEur, row.vatEur, row.badges.join(' · ') || null].map(cell).join(';'));
    }
  }
  lines.push(['', '71', 'Btw te betalen', result.totals.payableEur].map(cell).join(';'));
  lines.push(['', '72', 'Btw terug te krijgen', result.totals.refundEur].map(cell).join(';'));
  for (const line of result.unknown) {
    lines.push(['', 'Nog te bepalen', null, null, line.description, line.date, line.party ?? null, line.reference ?? null, line.exclEur, null, 'btw-regeling kiezen'].map(cell).join(';'));
  }
  return lines.join('\r\n');
}
