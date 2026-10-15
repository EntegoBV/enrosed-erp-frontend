import { containerNumberHint } from '../purchasing/container-name';
import { costQuantity, costWords, entryCostBasis, otherSideCost, sameCostBasis, type CostBasis, type OtherSideCost } from './product-cost-basis';
import type { ProductCostHistoryEntry } from '../../core/api/models';

/*
 * The figures of the Kostprijshistoriek, apart from the screen: every row in
 * the words of the basis it was applied on, its kind, its change against the
 * row before it, the parts it was made of, and the sums over the rows that
 * share the newest row's basis. Node-tested through the transpiler.
 */

export type CostKind = 'APPLY' | 'REAPPLY' | 'SEED' | 'COPY';

export const COST_KIND_LABEL: Record<CostKind, string> = {
  APPLY: 'Toegepast',
  REAPPLY: 'Opnieuw',
  SEED: 'Start',
  COPY: 'Kopie',
};

/** The row's kind; an older server sends none, and then its first-start seed wrote 'system'. */
export function costKind(entry: Pick<ProductCostHistoryEntry, 'kind' | 'appliedBy'>): CostKind {
  const kind = entry.kind;
  if (kind === 'APPLY' || kind === 'REAPPLY' || kind === 'SEED' || kind === 'COPY') return kind;
  return entry.appliedBy === 'system' ? 'SEED' : 'APPLY';
}

/**
 * How a row compares with the one before it: dearer, cheaper, equal, the
 * first one, or not comparable because the two were applied on another basis.
 */
export interface CostDelta {
  tone: 'up' | 'down' | 'same' | 'first' | 'basis';
  eur: number | null;
  pct: number | null;
}

export interface CostPart {
  /** '·' for the first part, '+' for the next ones, '±' for rounding and '=' for the cost. */
  mark: '·' | '+' | '±' | '=';
  label: string;
  hint: string | null;
  eur: number;
}

export interface CostHistoryRow {
  entry: ProductCostHistoryEntry;
  kind: CostKind;
  kindLabel: string;
  basis: CostBasis;
  /** "per display van 12", "per diamant". */
  per: string;
  other: OtherSideCost | null;
  /** "500 displays", "2.000 diamanten"; null without a quantity. */
  quantity: string | null;
  /** The container's name today, else the source the row kept, else "Handmatig". */
  name: string;
  /** The PO number beside a Herkenbare naam. */
  numberHint: string | null;
  /** The container to link to: not gone and not the one the sheet was opened from. */
  linkId: number | null;
  gone: boolean;
  /** Who applied it; empty for the system's own rows. */
  by: string | null;
  delta: CostDelta;
  /** What the change is against: the container before, or this same container before a re-apply. */
  against: string;
  /** What one unit was made of; null when the row kept no parts. */
  parts: CostPart[] | null;
}

export interface CostHistoryView {
  /** Newest first. */
  rows: CostHistoryRow[];
  /** Over the rows on the newest row's basis, one per container: its newest. */
  stats: { min: number; max: number; avg: number };
  /** Distinct containers: purchase orders, else the source text. */
  containers: number;
  /** Rows left out of the sums and the chart because they hold on another basis. */
  excluded: number;
  /** Earlier rows of a container that was applied again: in the list, not in the sums or the chart. */
  replaced: number;
  /** Oldest first, one point per day (the day's last cost), on the newest row's basis, one row per container. */
  chart: { dates: string[]; values: number[] };
  /** Set when the product's basis today differs from the newest row's. */
  basisNote: string | null;
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const SYSTEM_ACTORS = new Set(['system', 'systeem']);

function delta(entry: ProductCostHistoryEntry, basis: CostBasis, older: CostHistoryRow | null): CostDelta {
  if (entry.deltaEur == null || entry.previousLandedUnitEur == null) return { tone: 'first', eur: null, pct: null };
  if (older && !sameCostBasis(basis, older.basis)) return { tone: 'basis', eur: null, pct: null };
  const eur = round4(entry.deltaEur);
  if (eur === 0) return { tone: 'same', eur: 0, pct: 0 };
  return { tone: eur > 0 ? 'up' : 'down', eur, pct: entry.deltaPct ?? null };
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('nl-BE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('nl-BE', { maximumFractionDigits: 4 })}`;
  }
}

/** The stored parts of one unit, in the words of the price build-up; null when none was kept. */
export function costParts(entry: ProductCostHistoryEntry, basis: CostBasis): CostPart[] | null {
  const words = costWords(basis);
  const known: [number | null | undefined, string, string | null][] = [
    [entry.goodsEur, 'Inkoopprijs (EXW)', entry.extraUnitCost && entry.exwCurrency
      ? `fabrieksprijs incl. ${money(entry.extraUnitCost, entry.exwCurrency)} extra kost` : 'fabrieksprijs'],
    [entry.originEur, 'Lokale kosten bij vertrek', 'vervoer naar de haven, export, laden'],
    [entry.freightEur, 'Zeevracht', 'containerprijs verdeeld per m³'],
    [entry.dutyEur, 'Invoerrechten', 'douane, op basis van de HS-code'],
    [entry.destinationEur, 'Kosten na aankomst', 'havenkosten, inklaring en levering aan het magazijn'],
    [entry.enrosedEur, 'Enrosed kost', `vast bedrag per container, verdeeld over de ${words.plural}`],
    [entry.separateEur, 'Inspectie en andere kosten', `verdeeld in de prijs ${words.per}`],
  ];
  if (known.every(([value]) => value == null)) return null;
  const parts: CostPart[] = [];
  let sum = 0;
  known.forEach(([value, label, hint], index) => {
    if (value == null || (index > 0 && value === 0)) return;
    parts.push({ mark: parts.length ? '+' : '·', label, hint, eur: value });
    sum += value;
  });
  const rest = round4(entry.landedUnitEur - sum);
  if (Math.abs(rest) >= 0.0001) parts.push({ mark: '±', label: 'Afronding', hint: 'elk deel staat op 4 decimalen', eur: rest });
  parts.push({ mark: '=', label: `Kostprijs ${words.per}`, hint: null, eur: entry.landedUnitEur });
  return parts;
}

/**
 * The history as the screen reads it. `current` is the product's basis today
 * (also for rows that kept none); `currentOrderId` is the container the sheet
 * was opened from, which gets no link to itself.
 */
export function costHistoryView(entries: readonly ProductCostHistoryEntry[], current: CostBasis, currentOrderId: number | null = null): CostHistoryView {
  const rows: CostHistoryRow[] = [];
  /* Oldest first, so every row can compare with the one before it. */
  for (const entry of [...entries].reverse()) {
    const basis = entryCostBasis(entry, current);
    const kind = costKind(entry);
    const name = entry.containerName?.trim() || entry.source?.trim()
      || (entry.purchaseOrderId != null ? `Inkoop #${entry.purchaseOrderId}` : 'Handmatig');
    const gone = entry.purchaseOrderId != null && entry.containerGone === true;
    rows.unshift({
      entry, kind, kindLabel: COST_KIND_LABEL[kind], basis,
      per: costWords(basis).per,
      other: otherSideCost(basis, entry.landedUnitEur),
      quantity: entry.quantity ? costQuantity(basis, entry.quantity) : null,
      name,
      numberHint: entry.containerName ? containerNumberHint(entry.containerName, entry.source) : null,
      linkId: entry.purchaseOrderId != null && !gone && entry.purchaseOrderId !== currentOrderId ? entry.purchaseOrderId : null,
      gone,
      by: entry.appliedBy && !SYSTEM_ACTORS.has(entry.appliedBy.trim().toLowerCase()) ? entry.appliedBy : null,
      delta: delta(entry, basis, rows[0] ?? null),
      /* A re-apply compares with this very container's earlier cost, never with another container. */
      against: kind === 'REAPPLY' ? 'eerder bij deze container' : 'de vorige container',
      parts: costParts(entry, basis),
    });
  }

  const latest = rows[0] ?? null;
  /* A container applied again replaced its earlier cost: only its newest row counts in the sums and the chart.
     Rows without a container stay as they are. Every row stays in the list. */
  const seen = new Set<number>();
  const counted = rows.filter((row) => {
    const id = row.entry.purchaseOrderId;
    if (id == null) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const comparable = latest ? counted.filter((row) => sameCostBasis(row.basis, latest.basis)) : [];
  const values = comparable.map((row) => row.entry.landedUnitEur);
  const stats = values.length
    ? { min: Math.min(...values), max: Math.max(...values), avg: round4(values.reduce((sum, value) => sum + value, 0) / values.length) }
    : { min: 0, max: 0, avg: 0 };
  const containers = new Set(rows
    .map((row) => row.entry.purchaseOrderId != null ? `po:${row.entry.purchaseOrderId}` : row.entry.source?.trim() ? `src:${row.entry.source.trim()}` : null)
    .filter((key): key is string => key !== null)).size;

  /* Two rows on one day would draw a vertical stroke: the day's last cost stands for it. */
  const byDay = new Map<string, number>();
  for (const row of [...comparable].reverse()) byDay.set(row.entry.appliedAt.slice(0, 10), row.entry.landedUnitEur);
  const chart = { dates: [...byDay.keys()], values: [...byDay.values()] };

  let basisNote: string | null = null;
  const now = costWords(current).per;
  if (latest && !sameCostBasis(latest.basis, current) && now !== latest.per) {
    basisNote = `De prijs geldt nu ${now}; deze kostprijs werd toegepast ${latest.per} en is niet omgerekend.`;
  }
  return { rows, stats, containers, excluded: counted.length - comparable.length, replaced: rows.length - counted.length, chart, basisNote };
}

/** "1 rij op een andere basis telt niet mee", "3 rijen … tellen niet mee". */
export function excludedNote(excluded: number): string | null {
  if (excluded <= 0) return null;
  return excluded === 1
    ? '1 rij op een andere basis telt niet mee in laagste, hoogste, gemiddeld en de grafiek.'
    : `${excluded.toLocaleString('nl-BE')} rijen op een andere basis tellen niet mee in laagste, hoogste, gemiddeld en de grafiek.`;
}

/** The earlier cost of a container that was applied again: listed, but only its newest cost counts. */
export function replacedNote(replaced: number): string | null {
  if (replaced <= 0) return null;
  return replaced === 1
    ? '1 eerdere kostprijs van een opnieuw toegepaste container telt niet mee in laagste, hoogste, gemiddeld en de grafiek.'
    : `${replaced.toLocaleString('nl-BE')} eerdere kostprijzen van opnieuw toegepaste containers tellen niet mee in laagste, hoogste, gemiddeld en de grafiek.`;
}
