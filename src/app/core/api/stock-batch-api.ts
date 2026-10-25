import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type {
  ProductStockBatches, PurchaseStockBatches, SalesStockCost, StockBatchBackfillReport, StockBatchCheckRow,
  StockBatchMoves, StockBatchStatus,
} from './stock-batch-models';

/**
 * Stock batches (2026-10-25): /api/stock-batches. Every batch view hides while
 * `started` is false; the reset endpoint has no call here on purpose.
 */
@Injectable({ providedIn: 'root' })
export class StockBatchApi {
  private readonly http = inject(HttpClient);

  status(): Promise<StockBatchStatus> {
    return firstValueFrom(this.http.get<StockBatchStatus>(api('/api/stock-batches/status')));
  }

  /** Stops every batch hook at once, without a deploy. */
  pause(): Promise<StockBatchStatus> {
    return firstValueFrom(this.http.post<StockBatchStatus>(api('/api/stock-batches/pause'), {}));
  }

  resume(): Promise<StockBatchStatus> {
    return firstValueFrom(this.http.post<StockBatchStatus>(api('/api/stock-batches/resume'), {}));
  }

  /** A product's batches, oldest live one first, with the summary the card shows. */
  forProduct(productId: number): Promise<ProductStockBatches> {
    return firstValueFrom(this.http.get<ProductStockBatches>(api(`/api/stock-batches/products/${productId}`)));
  }

  /** The moves of one batch, newest first; limit 1..500. */
  moves(batchId: number, limit = 50): Promise<StockBatchMoves> {
    return firstValueFrom(this.http.get<StockBatchMoves>(
      api(`/api/stock-batches/${batchId}/moves`), { params: { limit } }));
  }

  /** The batches a container booked, in the order of its lines. */
  forPurchaseOrder(id: number): Promise<PurchaseStockBatches> {
    return firstValueFrom(this.http.get<PurchaseStockBatches>(api(`/api/stock-batches/purchase-orders/${id}`)));
  }

  /** What the pieces of a shipped sales order cost, per product and per batch. */
  salesStockCost(id: number): Promise<SalesStockCost> {
    return firstValueFrom(this.http.get<SalesStockCost>(api(`/api/stock-batches/sales-orders/${id}`)));
  }

  /** Products whose batches differ from their stock; empty before the start. */
  check(): Promise<StockBatchCheckRow[]> {
    return firstValueFrom(this.http.get<StockBatchCheckRow[]>(api('/api/stock-batches/check')));
  }

  /** Books the differences to zero; no ids = every product in check(). Answers the new check list. */
  repair(productIds: number[] = []): Promise<StockBatchCheckRow[]> {
    return firstValueFrom(this.http.post<StockBatchCheckRow[]>(api('/api/stock-batches/check/repair'), { productIds }));
  }

  /** "Batches opbouwen": the dry run reads only; dryRun false starts the batches. */
  backfill(dryRun: boolean): Promise<StockBatchBackfillReport> {
    return firstValueFrom(this.http.post<StockBatchBackfillReport>(
      api('/api/stock-batches/backfill'), {}, { params: { dryRun } }));
  }
}
