/*
 * The Gelande kost sheet of a sales line (phone editor and desk), apart from
 * the screen. The line carries the cost frozen on it when it was written; the
 * sheet never puts today's container calculation under that figure. Parts
 * show only when a cost-history row of the product kept parts for exactly that
 * cost (4 decimals); otherwise one muted line and the product's history.
 * Pure and node-tested (tests/sales-cost-build.test.mts): type-only imports.
 */
import type { DocumentType, ProductCostHistoryEntry } from '../../core/api/models';

export interface SalesCostRow {
  label: string;
  hint?: string;
  eur: number;
  sum?: boolean;
}

export interface SalesCostBuild {
  /** The kept parts, when they explain the cost, then the frozen cost as the closing sum. */
  rows: SalesCostRow[];
  /** Where the parts come from: "Opbouw uit PO-2026-005 · toegepast 23/08/2026"; null without parts. */
  source: string | null;
  /** No parts for this cost: the muted line beside 'Historiek ›'; null when the parts show. */
  missing: string | null;
}

export interface SalesCostInput {
  /** The line's frozen cost per unit (PricedLine.landedUnitCost). */
  costEur: number;
  unit: { singular: string; plural: string };
  docType: DocumentType | null | undefined;
  /**
   * A regular sale made from a container: its container lines froze the cost without the Enrosed
   * kost (SalesOrderService, container quote), a line added later took the product's cost with it.
   */
  containerSale: boolean;
  /** The product's cost history, newest first. */
  history: readonly ProductCostHistoryEntry[];
}

const cents4 = (value: number): number => Math.round(value * 10000);

const DOC_WORD: Readonly<Record<DocumentType, string>> = { OFFERTE: 'offerte', FACTUUR: 'factuur', CREDITNOTA: 'creditnota' };

function hasParts(row: ProductCostHistoryEntry): boolean {
  return [row.goodsEur, row.originEur, row.freightEur, row.dutyEur, row.destinationEur, row.enrosedEur, row.separateEur]
    .some((value) => value != null);
}

/** "23/08/2026" from an ISO date or timestamp; '' when it does not read as one. */
function day(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/**
 * The row that explains the cost: the newest with parts whose cost equals it, or (a container sale)
 * whose cost without the Enrosed kost equals it. The server rounds that snapshot from the line total,
 * the history its parts one by one, so the two may differ in the fourth decimal; Afronding closes it.
 */
function explaining(costEur: number, containerSale: boolean, history: readonly ProductCostHistoryEntry[]):
  { row: ProductCostHistoryEntry; withoutEnrosed: boolean } | null {
  const kept = history.filter(hasParts);
  const full = kept.find((row) => cents4(row.landedUnitEur) === cents4(costEur));
  if (full) return { row: full, withoutEnrosed: false };
  if (!containerSale) return null;
  const without = kept.find((row) => (row.enrosedEur ?? 0) > 0
    && Math.abs(cents4(row.landedUnitEur) - cents4(row.enrosedEur!) - cents4(costEur)) <= 1);
  return without ? { row: without, withoutEnrosed: true } : null;
}

export function salesCostBuild(input: SalesCostInput): SalesCostBuild {
  const { costEur, unit, containerSale } = input;
  const found = explaining(costEur, containerSale, input.history);
  /* A container sale's own lines leave the Enrosed kost out; a line matched with it in says nothing of the kind. */
  const excluded = found ? found.withoutEnrosed : containerSale;
  const frozen = `vastgelegd op deze ${DOC_WORD[input.docType ?? 'OFFERTE']}${excluded ? ' · excl. Enrosed kost' : ''}`;
  const total: SalesCostRow = { label: `Gelande kost per ${unit.singular}`, hint: frozen, eur: costEur, sum: true };
  if (!found) return { rows: [total], source: null, missing: 'Opbouw van deze kost niet bewaard.' };

  const { row, withoutEnrosed } = found;
  const name = row.containerName?.trim() || row.source?.trim() || 'handmatig';
  const known: [number | null | undefined, string][] = [
    [row.goodsEur, 'Inkoopprijs (EXW)'],
    [row.originEur, '+ Lokale kosten bij vertrek'],
    [row.freightEur, '+ Zeevracht'],
    [row.dutyEur, '+ Invoerrechten'],
    [row.destinationEur, '+ Kosten na aankomst'],
    [withoutEnrosed ? null : row.enrosedEur, '+ Enrosed kost'],
    [row.separateEur, '+ Inspectie en andere kosten'],
  ];
  const rows: SalesCostRow[] = [];
  let sum = 0;
  known.forEach(([value, label], index) => {
    if (value == null || (index > 0 && value === 0)) return;
    rows.push(index === 0 && row.quantity
      ? { label, hint: `${row.quantity.toLocaleString('nl-BE')} ${unit.plural} in ${name}`, eur: value }
      : { label, eur: value });
    sum += cents4(value);
  });
  /* Each part is kept at 4 decimals: the rest, if any, closes on the frozen cost. */
  const rest = cents4(costEur) - sum;
  if (rest !== 0) rows.push({ label: '± Afronding', eur: rest / 10000 });
  rows.push(total);
  const applied = day(row.appliedAt);
  return { rows, source: `Opbouw uit ${name}${applied ? ` · toegepast ${applied}` : ''}`, missing: null };
}
