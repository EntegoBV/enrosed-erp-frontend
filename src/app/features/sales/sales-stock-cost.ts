/*
 * Stock batches (2026-10-25): the "Kost bij levering" sheet of a shipped sales
 * line. The server stamped what the pieces cost that left stock (by batch,
 * oldest first); this lists those batches, the pieces no batch or no batch
 * cost could explain, the stamped cost the margin uses and, apart, the cost
 * the document expected. Pure and node-tested (tests/sales-stock-cost.test.mts):
 * type-only imports, the formatting comes in as a BatchFormat.
 */
import type { SalesStockCostBatch, SalesStockCostLine } from '../../core/api/stock-batch-models';
import type { BatchFormat } from '../../core/api/stock-batch-units';
import type { SalesCostRow } from './sales-cost-build';

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** The batch as the screens name it: its container, else its order number, else what kind of batch it is. */
function batchLabel(batch: SalesStockCostBatch): string {
  const name = batch.containerName?.trim() || batch.orderNumber?.trim();
  if (name) return name;
  if (batch.kind === 'OPENING') return 'Beginvoorraad';
  if (batch.kind === 'COUNT') return 'Telling';
  return 'Batch';
}

/** The batch's cost per unit on this line's basis; null when the batch has none (its pieces go under "Zonder batch"). */
function batchCost(batch: SalesStockCostBatch, exclEnrosed: boolean): number | null {
  const cost = exclEnrosed ? (batch.unitCostExclEnrosedEur ?? batch.unitCostEur) : batch.unitCostEur;
  return cost == null || !Number.isFinite(cost) ? null : round4(cost);
}

const unitOf = (unitPieces: number): number => (Number.isFinite(unitPieces) && unitPieces >= 1 ? unitPieces : 1);

/**
 * Without the document's expected cost (an older answer), what the server counted per unit for the
 * pieces without batch or cost: the stamped total minus the batches, over those pieces.
 */
function withoutCost(line: SalesStockCostLine, stockUnitCost: number, batchValue: number, without: number): number {
  const f = unitOf(line.unitPieces);
  const rest = (stockUnitCost * line.pieces / f - batchValue) / (without / f);
  return Number.isFinite(rest) && rest >= 0 ? round4(rest) : stockUnitCost;
}

/**
 * Rows of the sheet, in the order the pieces left: one per batch with a cost (its units as hint), then
 * "Zonder batch" for the pieces taken without a batch or from a batch without cost (they count at the
 * expected cost, as the server does), then the sum "Kost bij levering" (the stamped stockUnitCost the
 * margin uses), then "Verwacht op de {docWord}" when the document's own cost is known.
 */
export function salesStockCostRows(line: SalesStockCostLine, fmt: BatchFormat, stockUnitCost: number,
  expectedEur: number | null, docWord: string): SalesCostRow[] {
  const rows: SalesCostRow[] = [];
  let batchValue = 0;
  for (const batch of line.batches) {
    if (batch.batchId == null || batch.pieces === 0) continue;
    const eur = batchCost(batch, line.exclEnrosed);
    if (eur == null) continue;
    rows.push({ label: batchLabel(batch), hint: fmt.units(batch.pieces, batch.unitPieces), eur });
    batchValue += eur * batch.pieces / unitOf(batch.unitPieces);
  }
  const without = (line.withoutBatchPieces ?? 0) + (line.withoutCostPieces ?? 0);
  if (without > 0) {
    rows.push({ label: 'Zonder batch', hint: `${fmt.units(without, line.unitPieces)} · tegen verwachte kost`,
      eur: expectedEur ?? withoutCost(line, stockUnitCost, batchValue, without) });
  }
  const basis = `per ${fmt.unit.singular}${line.exclEnrosed ? ' · excl. Enrosed kost' : ''}`;
  rows.push({ label: 'Kost bij levering', hint: basis, eur: stockUnitCost, sum: true });
  if (expectedEur != null) rows.push({ label: `Verwacht op de ${docWord}`, eur: expectedEur });
  return rows;
}
