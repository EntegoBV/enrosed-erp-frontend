import type {
  StockBatchBackfillReport, StockBatchBackfillRow, StockBatchCheckRow, StockBatchStatus,
} from '../../core/api/stock-batch-models';
import type { BatchFormat } from '../../core/api/stock-batch-units';

/**
 * Stock batches (2026-10-25), the stock page's part: the banner for the state
 * of the start, the figures and rows of the "Batches opbouwen" dry run and
 * the rows of "Batches controleren". Pure (type imports only, node-tested in
 * tests/stock-batch-start.test.mts); the number and euro text come in as a
 * BatchFormat from the component. The report and the check count pieces, so
 * every "st" figure here is physical pieces; check rows read in the product's
 * own unit plus loose pieces ("105 + 4 los").
 */

/** start: the dry run with "Batches opbouwen"; check: differences, Herstellen, pause. */
export type StockBatchSheetMode = 'start' | 'check';

/** What these texts need of a BatchFormat: unit words differ per row, so only count and eur. */
export type StartFormat = Pick<BatchFormat, 'count' | 'eur'>;

/** One tile of the dry run's figures; `title` is the tooltip, when it says more. */
export interface BackfillFigure { label: string; value: string; title?: string }

/** The banner under the stock page's header; null when there is nothing to say. */
export interface StockBatchBanner { text: string; link: string; mode: StockBatchSheetMode; warn: boolean }

/** The dry run shows the first 30 flagged rows, then "Meer". */
export const FLAGGED_LIMIT = 30;

/** "1 product", "212 producten". */
export function productsText(count: number, fmt: StartFormat): string {
  return `${fmt.count(count, 1)} ${count === 1 ? 'product' : 'producten'}`;
}

/** [Producten, Batches, Beginvoorraad (stuks), Zonder batch (stuks), Waarde]; the value counts own batches only. */
export function backfillFigures(report: StockBatchBackfillReport, fmt: StartFormat): BackfillFigure[] {
  return [
    { label: 'Producten', value: fmt.count(report.products, 1) },
    { label: 'Batches', value: fmt.count(report.batches, 1) },
    { label: 'Beginvoorraad', value: `${fmt.count(report.openingPieces, 1)} st` },
    { label: 'Zonder batch', value: `${fmt.count(report.unassignedPieces, 1)} st` },
    { label: 'Waarde', value: fmt.eur(report.valueEur, 0), title: `${fmt.eur(report.valueEur, 2)} · eigen batches, partner niet` },
  ];
}

/** The rows the dry run lists: only those with a flag, in the server's order (flagged first, then SKU). */
export function flaggedRows(report: StockBatchBackfillReport): StockBatchBackfillRow[] {
  return report.rows.filter((row) => row.flags.length > 0);
}

function rowTitle(row: { sku: string; name: string }): string {
  const sku = row.sku?.trim();
  return sku ? `${sku} · ${row.name}` : row.name;
}

/**
 * "{sku} · {name}" and one line of what to look at: "Beginvoorraad {n} st ·
 * kost van productkaart", the negative locations (the server's notes),
 * "kost onbekend", "partner {n} st".
 */
export function backfillRowText(row: StockBatchBackfillRow, fmt: StartFormat): { title: string; sub: string } {
  const parts: string[] = [];
  if (row.flags.includes('OPENING')) {
    /* A Beginvoorraad batch takes the card cost; without one it is "kost onbekend" (NO_COST says so). */
    const opening = row.batches.find((batch) => batch.kind === 'OPENING');
    const card = opening?.costState !== 'NONE';
    parts.push(`Beginvoorraad ${fmt.count(row.openingPieces, 1)} st${card ? ' · kost van productkaart' : ''}`);
  }
  const notes = row.notes.map((note) => note.trim()).filter(Boolean);
  if (notes.length) parts.push(...notes);
  else if (row.flags.includes('NEGATIVE')) parts.push(`Negatief: −${fmt.count(row.unassignedPieces, 1)} st`);
  if (row.flags.includes('NO_COST')) parts.push('kost onbekend');
  if (row.flags.includes('PARTNER')) {
    const partner = row.batches.filter((batch) => batch.owner === 'PARTNER').reduce((sum, batch) => sum + batch.piecesLeft, 0);
    parts.push(`partner ${fmt.count(partner, 1)} st`);
  }
  return { title: rowTitle(row), sub: parts.join(' · ') };
}

/** The row's value of own batches in whole euros; "—" when nothing in it has a cost (never "€ 0" beside "kost onbekend"). */
export function backfillRowValue(row: StockBatchBackfillRow, fmt: StartFormat): string {
  return row.flags.includes('NO_COST') && !row.valueEur ? '—' : fmt.eur(row.valueEur, 0);
}

/** "Niet bijgeboekt: PO-2026-019, PO-2026-020", or null when every received container is booked. */
export function notBookedText(report: StockBatchBackfillReport): string | null {
  const numbers = report.notBooked.map((order) => order.orderNumber?.trim()).filter(Boolean);
  return numbers.length ? `Niet bijgeboekt: ${numbers.join(', ')}` : null;
}

/** "+2", "−10", "0" in the row's unit ("−10 los" for a display product). */
export function signedCount(pieces: number, unitPieces: number, fmt: StartFormat): string {
  if (!pieces) return '0';
  return pieces > 0 ? `+${fmt.count(pieces, unitPieces)}` : fmt.count(pieces, unitPieces);
}

/** A product whose batches differ from its stock: title, "voorraad · batches · zonder batch" and the signed difference. */
export function checkRowText(row: StockBatchCheckRow, fmt: StartFormat): { title: string; sub: string; value: string } {
  const unit = row.unitPieces;
  return {
    title: rowTitle(row),
    sub: `voorraad ${fmt.count(row.stockPieces, unit)} · batches ${fmt.count(row.batchPieces, unit)} · zonder batch ${fmt.count(row.unassignedPieces, unit)}`,
    value: signedCount(row.differencePieces, unit, fmt),
  };
}

/** How many products of the list before Herstellen are gone from the list after it. */
export function repairedCount(before: readonly StockBatchCheckRow[], after: readonly StockBatchCheckRow[]): number {
  const left = new Set(after.map((row) => row.productId));
  return before.filter((row) => !left.has(row.productId)).length;
}

/**
 * Not started: "Batches zijn nog niet gestart." + "Batches opbouwen ›";
 * paused: warn "Batches staan op pauze." + "Bekijken ›"; differences: warn
 * "{n} producten wijken af van hun batches" + "Bekijken ›"; else null.
 */
export function statusBanner(status: StockBatchStatus | null | undefined): StockBatchBanner | null {
  if (!status) return null;
  if (!status.started) return { text: 'Batches zijn nog niet gestart.', link: 'Batches opbouwen ›', mode: 'start', warn: false };
  if (status.paused) return { text: 'Batches staan op pauze.', link: 'Bekijken ›', mode: 'check', warn: true };
  const count = status.differences;
  if (count > 0) {
    const text = count === 1 ? '1 product wijkt af van zijn batches' : `${count.toLocaleString('nl-BE')} producten wijken af van hun batches`;
    return { text, link: 'Bekijken ›', mode: 'check', warn: true };
  }
  return null;
}

/** Started, running and without differences: no banner, so the page offers a small "Batches controleren" (pause stays reachable). */
export function checkLinkShown(status: StockBatchStatus | null | undefined): boolean {
  return !!status && status.started && !status.paused && !(status.differences > 0);
}
