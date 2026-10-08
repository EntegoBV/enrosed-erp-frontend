import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type {
  BookingCheck, ClosingOverview, ClosingView, CountLine, CountLineWrite, CountOverview, CountView, DecisionWrite,
  OpeningLayer, OpeningLayerWrite, ValuationRule,
} from './inventory-models';

/**
 * Jaarinventaris: count sessions, opening layers and the year-end closing.
 * A state refusal answers 409 with a `code` next to the Dutch message (and
 * sometimes `details`); read them with refusalCode() and refusalDetails().
 */
@Injectable({ providedIn: 'root' })
export class InventoryApi {
  private readonly http = inject(HttpClient);

  /* ---- count sessions ---- */

  /** Without a year the server takes the current Brussels year. */
  countOverview(year: number | null): Promise<CountOverview> {
    const params = year == null ? new HttpParams() : new HttpParams().set('year', year);
    return firstValueFrom(this.http.get<CountOverview>(api('/api/stock-counts'), { params }));
  }

  /** `correctsCountId` null starts a full count, otherwise a correction of that booked count. */
  startCount(countYear: number, locationId: number, note: string | null, correctsCountId: number | null): Promise<CountView> {
    return firstValueFrom(
      this.http.post<CountView>(api('/api/stock-counts'), { countYear, locationId, note, correctsCountId }));
  }

  count(id: number): Promise<CountView> {
    return firstValueFrom(this.http.get<CountView>(api(`/api/stock-counts/${id}`)));
  }

  saveCountLine(countId: number, lineId: number, write: CountLineWrite): Promise<CountLine> {
    return firstValueFrom(this.http.put<CountLine>(api(`/api/stock-counts/${countId}/lines/${lineId}`), write));
  }

  /** Answers the existing line when the product is already on the list. */
  addCountLine(countId: number, productId: number): Promise<CountLine> {
    return firstValueFrom(this.http.post<CountLine>(api(`/api/stock-counts/${countId}/lines`), { productId }));
  }

  bookingCheck(countId: number): Promise<BookingCheck> {
    return firstValueFrom(this.http.get<BookingCheck>(api(`/api/stock-counts/${countId}/booking-check`)));
  }

  bookCount(countId: number, checkToken: string): Promise<CountView> {
    return firstValueFrom(this.http.post<CountView>(api(`/api/stock-counts/${countId}/book`), { checkToken }));
  }

  cancelCount(countId: number): Promise<CountView> {
    return firstValueFrom(this.http.post<CountView>(api(`/api/stock-counts/${countId}/cancel`), {}));
  }

  /* ---- opening layers ---- */

  openingLayers(): Promise<OpeningLayer[]> {
    return firstValueFrom(this.http.get<OpeningLayer[]>(api('/api/stock-opening-layers')));
  }

  /** Computes nothing: call recompute() on the closing afterwards. */
  saveOpeningLayers(write: OpeningLayerWrite): Promise<OpeningLayer[]> {
    return firstValueFrom(this.http.post<OpeningLayer[]>(api('/api/stock-opening-layers'), write));
  }

  /** The layer is retired, never removed; computes nothing either. */
  retireOpeningLayer(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/stock-opening-layers/${id}`)));
  }

  /* ---- closing ---- */

  /** Null while no closing exists (the server answers 204). */
  async valuationRule(): Promise<ValuationRule | null> {
    return (await firstValueFrom(this.http.get<ValuationRule | null>(api('/api/stock-valuation-rule')))) ?? null;
  }

  closings(): Promise<ClosingOverview> {
    return firstValueFrom(this.http.get<ClosingOverview>(api('/api/stock-closings')));
  }

  /** A null date is 31 December of the year. */
  createClosing(closingYear: number, closingDate: string | null): Promise<ClosingView> {
    return firstValueFrom(this.http.post<ClosingView>(api('/api/stock-closings'), { closingYear, closingDate }));
  }

  /** The stored rows: a concept shows its last compute, `computedAt` says when. */
  closing(id: number): Promise<ClosingView> {
    return firstValueFrom(this.http.get<ClosingView>(api(`/api/stock-closings/${id}`)));
  }

  setClosingDate(id: number, closingDate: string): Promise<ClosingView> {
    return firstValueFrom(this.http.put<ClosingView>(api(`/api/stock-closings/${id}`), { closingDate }));
  }

  recompute(id: number): Promise<ClosingView> {
    return firstValueFrom(this.http.post<ClosingView>(api(`/api/stock-closings/${id}/recompute`), {}));
  }

  saveDecision(closingId: number, write: DecisionWrite): Promise<ClosingView> {
    return firstValueFrom(this.http.put<ClosingView>(api(`/api/stock-closings/${closingId}/decisions`), write));
  }

  deleteDecision(closingId: number, decisionId: number): Promise<ClosingView> {
    return firstValueFrom(
      this.http.delete<ClosingView>(api(`/api/stock-closings/${closingId}/decisions/${decisionId}`)));
  }

  /** A concept only. */
  deleteClosing(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/stock-closings/${id}`)));
  }

  /** `dataSha256` of the view on screen: nobody freezes figures they have not seen. */
  finalize(id: number, dataSha256: string, signerName: string): Promise<ClosingView> {
    return firstValueFrom(
      this.http.post<ClosingView>(api(`/api/stock-closings/${id}/finalize`), { dataSha256, signerName }));
  }

  /** Starts the correction: a new concept version of a final closing. */
  startVersion(id: number, reason: string): Promise<ClosingView> {
    return firstValueFrom(this.http.post<ClosingView>(api(`/api/stock-closings/${id}/versions`), { reason }));
  }

  closingPdf(id: number): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/api/stock-closings/${id}/pdf`), { responseType: 'blob' }));
  }

  closingXlsx(id: number): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/api/stock-closings/${id}/xlsx`), { responseType: 'blob' }));
  }
}

function refusalBody(failure: unknown): { code?: unknown; details?: unknown } | null {
  const body = (failure as { error?: unknown } | null | undefined)?.error;
  return body && typeof body === 'object' ? body : null;
}

/** The `code` of a 409 refusal (TELLING_LOOPT, REGEL_GEWIJZIGD, CIJFERS_GEWIJZIGD, …), or null. */
export function refusalCode(failure: unknown): string | null {
  const code = refusalBody(failure)?.code;
  return typeof code === 'string' && code ? code : null;
}

/** The `details` of a refusal, for example `{ line }` with REGEL_GEWIJZIGD or `{ countId }` with TELLING_LOOPT. */
export function refusalDetails<T>(failure: unknown): T | null {
  return (refusalBody(failure)?.details as T | null | undefined) ?? null;
}
