import { Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import type { SalesOrderView } from '../../core/api/models';
import { PartnerDocumentBreakdown, PartnerSalesApi } from '../../core/api/partner-sales-api';
import { isReportBacked } from './report-backed';

/**
 * The breakdown of a report-backed document (GET /api/partner-sales/documents/{id}/breakdown), asked once per
 * document id while the screen shows it: undefined while loading or for any other document, null when the
 * server has none (an older backend answers 404; a failed request reads the same, the screens fall back to the
 * document's own figures). Call in an injection context (a field initializer).
 */
export function reportBreakdownOf(view: () => SalesOrderView | null | undefined): Signal<PartnerDocumentBreakdown | null | undefined> {
  const api = inject(PartnerSalesApi);
  const state = signal<PartnerDocumentBreakdown | null | undefined>(undefined);
  let asked: number | null = null;
  effect(() => {
    const data = view();
    const id = data && isReportBacked(data) ? data.order.id : null;
    untracked(() => {
      if (id === asked) return;
      asked = id;
      state.set(undefined);
      if (id == null) return;
      api.documentBreakdown(id).then(
        (breakdown) => { if (asked === id) state.set(breakdown && Array.isArray(breakdown.lines) ? breakdown : null); },
        () => { if (asked === id) state.set(null); });
    });
  });
  return computed(() => state());
}
