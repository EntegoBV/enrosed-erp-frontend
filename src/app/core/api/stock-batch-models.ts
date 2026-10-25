/**
 * Stock batches (2026-10-25): the shapes of /api/stock-batches, field for field as the server writes them.
 * Types only.
 */

export type StockBatchKind = 'RECEIPT' | 'OPENING' | 'COUNT';
export type StockBatchOwner = 'OWN' | 'PARTNER';
export type StockBatchCostState = 'APPLIED' | 'CALCULATED' | 'CARD' | 'NONE';
export type StockBatchMoveKind = 'PURCHASE_RECEIPT' | 'RECEIPT_CORRECTION' | 'OPENING' | 'COUNT_IN' | 'BACKFILL'
  | 'REPAIR' | 'SALE' | 'SALE_RETURN' | 'DAMAGED' | 'SHORTAGE' | 'DEMO' | 'STOCKTAKE' | 'MANUAL_CORRECTION';
export interface StockBatchParts { goodsEur: number | null; originEur: number | null; freightEur: number | null;
  dutyEur: number | null; destinationEur: number | null; enrosedEur: number | null; separateEur: number | null }
export interface StockBatch {
  id: number; productId: number; kind: StockBatchKind; owner: StockBatchOwner;
  purchaseOrderId: number | null; orderNumber: string | null; containerName: string | null; containerGone: boolean;
  supplierId: number | null; supplierName: string | null; productSupplierId: number | null;
  receivedOn: string | null; bookedAt: string | null;
  unitPieces: number; piecesIn: number; piecesLeft: number;
  soldPieces: number; lostPieces: number; earlierPieces: number; otherPieces: number;
  costState: StockBatchCostState; unitCostEur: number | null; unitCostExclEnrosedEur: number | null;
  parts: StockBatchParts | null; costAppliedAt: string | null; costAppliedBy: string | null;
  valueLeftEur: number | null; next: boolean; calcUnitEur: number | null; stale: boolean; note: string | null;
}
export interface ProductStockBatches { productId: number; started: boolean; unitPieces: number; batches: StockBatch[];
  summary: { stockPieces: number; batchPieces: number; unassignedPieces: number; differencePieces: number;
    valueEur: number; partnerValueEur: number; valueComplete: boolean; nextUnitCostEur: number | null;
    nextBatchId: number | null } }
export interface StockBatchMove { id: number; batchId: number | null; kind: StockBatchMoveKind; pieces: number;
  unitPieces: number; unitCostEur: number | null; reference: string | null; salesOrderId: number | null;
  ticaSaleId: number | null; purchaseOrderId: number | null; pinned: boolean; settles: boolean; restores: boolean;
  movementGone: boolean; at: string; actor: string | null }
export interface StockBatchMoves { total: number; moves: StockBatchMove[] }
export interface PurchaseStockBatchRow extends StockBatch { sku: string; productName: string }
export interface PurchaseStockBatches { started: boolean; booked: boolean; rows: PurchaseStockBatchRow[];
  totals: { piecesIn: number; piecesLeft: number; valueLeftEur: number; valueComplete: boolean };
  costs: { applied: number; calculated: number; card: number; none: number; stale: number; staleLargestEur: number } }
export interface SalesStockCostBatch { batchId: number | null; kind: StockBatchKind | null; containerName: string | null;
  orderNumber: string | null; pieces: number; unitPieces: number; unitCostEur: number | null;
  unitCostExclEnrosedEur: number | null }
export interface SalesStockCostLine { productId: number; unitPieces: number; pieces: number; exclEnrosed: boolean;
  withoutBatchPieces: number; withoutCostPieces: number; batches: SalesStockCostBatch[] }
export interface SalesStockCost { salesOrderId: number; shipped: boolean; lines: SalesStockCostLine[] }
export interface StockBatchStatus { started: boolean; paused: boolean; startedAt: string | null; startedBy: string | null;
  pausedAt: string | null; pausedBy: string | null; differences: number }
export interface StockBatchCheckRow { productId: number; sku: string; name: string; unitPieces: number; stockPieces: number;
  batchPieces: number; unassignedPieces: number; differencePieces: number }
export type BackfillFlag = 'OPENING' | 'NEGATIVE' | 'NO_COST' | 'PARTNER';
export interface StockBatchBackfillRow { productId: number; sku: string; name: string; unitPieces: number; stockPieces: number;
  openingPieces: number; unassignedPieces: number; valueEur: number; flags: BackfillFlag[]; notes: string[];
  batches: { purchaseOrderId: number | null; orderNumber: string | null; kind: StockBatchKind; owner: StockBatchOwner;
    piecesIn: number; piecesLeft: number; unitCostEur: number | null; costState: StockBatchCostState }[] }
export interface StockBatchBackfillReport { dryRun: boolean; startedAt: string | null; products: number; batches: number;
  openingPieces: number; unassignedPieces: number; valueEur: number; rows: StockBatchBackfillRow[];
  notBooked: { purchaseOrderId: number; orderNumber: string }[] }
