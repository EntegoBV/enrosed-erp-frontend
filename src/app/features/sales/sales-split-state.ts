import type { SalesOrderView, SalesSplitEligibility, SalesSplitPreview, SalesSplitRequest } from '../../core/api/models';

/** A useful local explanation; the server also checks history and current stock. */
export function salesSplitBlockReason(view: SalesOrderView | null | undefined): string | null {
  if (!view) return 'Laad eerst de verkooporder.';
  const order = view.order;
  if (order.purpose && order.purpose !== 'STANDARD' || order.partnerPurchaseOrderId || order.partnerSettlement
    || view.advanceAgreement || view.advanceContents || view.settlement) return 'Partnerfacturen worden via hun container en termijnplan beheerd.';
  if (order.archivedAt) return 'Een gearchiveerd document kan niet worden gesplitst.';
  if (view.fulfillment) return 'Deze order is al verdeeld in twee leveringen.';
  if ((order.docType ?? 'OFFERTE') === 'OFFERTE' && order.status === 'GEACCEPTEERD') return 'Maak eerst een conceptfactuur van de geaccepteerde offerte.';
  if (view.invoicedAsId || view.invoicedAs) return 'Open de bijbehorende conceptfactuur om de levering te splitsen.';
  if (order.status !== 'CONCEPT' || order.sentAt || order.decidedAt) return 'Alleen een ongebruikt concept kan worden gesplitst.';
  if (order.goodsShippedAt) return 'De goederen zijn al uitgeboekt; deze order kan niet worden gesplitst.';
  const payments = view.paymentSummary;
  if (order.paidAt || payments?.legacyPaidMarker || payments?.payments?.length || (payments?.grossReceivedEur ?? 0) > 0
    || (payments?.receivedEur ?? 0) > 0 || (payments?.refundedEur ?? 0) > 0) return 'Er is al een betaling geregistreerd; deze order kan niet worden gesplitst.';
  if (!order.lines.length || order.lines.some(line => !line.id || !Number.isInteger(line.quantity) || line.quantity <= 0)) return 'Sla eerst de productregels en aantallen op.';
  return null;
}

export type SalesSplitQuantities = Record<number, number | null>;
export type SalesSplitOverrides = Pick<SalesSplitRequest, 'currentFreightEur' | 'laterFreightEur' | 'currentExtraDiscountPct' | 'laterExtraDiscountPct'>;

export function salesSplitRequest(eligibility: SalesSplitEligibility, quantities: SalesSplitQuantities, week: string, overrides: SalesSplitOverrides = {}, freightRequired = false): SalesSplitRequest {
  if (!eligibility.allowed) throw new Error(eligibility.reason || 'Deze order kan niet worden gesplitst.');
  const lines = eligibility.lines.map(line => {
    const laterQuantity = quantities[line.lineId] ?? 0;
    if (!Number.isSafeInteger(laterQuantity) || laterQuantity < 0 || laterQuantity > line.quantity) {
      throw new Error(`Vul voor ${line.description} een geheel aantal van 0 tot ${line.quantity} in.`);
    }
    if (line.piecesPerCarton && line.piecesPerCarton > 1
      && (laterQuantity % line.piecesPerCarton !== 0 || (line.quantity - laterQuantity) % line.piecesPerCarton !== 0)) {
      throw new Error(`Verdeel ${line.description} in volle dozen van ${line.piecesPerCarton} stuks.`);
    }
    return { lineId: line.lineId, laterQuantity };
  });
  const total = eligibility.lines.reduce((sum, line) => sum + line.quantity, 0);
  const later = lines.reduce((sum, line) => sum + line.laterQuantity, 0);
  if (!later) throw new Error('Kies minstens één productaantal voor de latere levering.');
  if (later >= total) throw new Error('Laat ook producten op het eerste deel staan.');
  const deliveryWeek = week.trim() || null;
  if (deliveryWeek && !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(deliveryWeek)) throw new Error('Kies een geldige leverweek voor het latere deel.');
  if (freightRequired && (overrides.currentFreightEur == null || overrides.laterFreightEur == null)) {
    throw new Error('De vracht was nog niet bepaald. Vul voor beide delen een vrachtbedrag in, ook wanneer dit € 0,00 is.');
  }
  for (const [field, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || field.endsWith('Pct') && value > 100) {
      throw new Error(field.endsWith('Pct') ? 'Vul een extra korting van 0 tot 100% in.' : 'Vul een geldig vrachtbedrag van minstens € 0,00 in.');
    }
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) throw new Error('Gebruik maximaal twee decimalen voor vracht en extra korting.');
  }
  return { lines, deliveryWeek, currentFreightEur: overrides.currentFreightEur ?? null, laterFreightEur: overrides.laterFreightEur ?? null,
    currentExtraDiscountPct: overrides.currentExtraDiscountPct ?? null, laterExtraDiscountPct: overrides.laterExtraDiscountPct ?? null };
}

/** The confirm button requires matching quantities and an explicit server-priced total difference. */
export function salesSplitPreviewMatches(preview: SalesSplitPreview, eligibility: SalesSplitEligibility, request: SalesSplitRequest): boolean {
  if (preview.sourceId !== eligibility.sourceId || !preview.previewToken || !preview.original || !preview.current || !preview.later) return false;
  const later = request.lines.reduce((sum, line) => sum + line.laterQuantity, 0);
  const total = eligibility.lines.reduce((sum, line) => sum + line.quantity, 0);
  if (preview.original.quantity !== total || preview.later.quantity !== later || preview.current.quantity !== total - later) return false;
  const amounts = ['totalExclVatEur', 'vatEur', 'totalInclVatEur', 'freightEur', 'handlingEur', 'extraLinesEur', 'goodsEur'] as const;
  for (const field of amounts) {
    const values = [preview.original[field], preview.current[field], preview.later[field]];
    if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) return false;
  }
  for (const [field, delta] of [['totalExclVatEur', 'deltaExclVatEur'], ['totalInclVatEur', 'deltaInclVatEur']] as const) {
    if (!Number.isFinite(preview[delta]) || Math.round(preview[delta] * 100) !== Math.round(preview.current[field] * 100)
      + Math.round(preview.later[field] * 100) - Math.round(preview.original[field] * 100)) return false;
  }
  if (request.currentFreightEur !== null && request.currentFreightEur !== undefined && Math.round(preview.current.freightEur * 100) !== Math.round(request.currentFreightEur * 100)) return false;
  if (request.laterFreightEur !== null && request.laterFreightEur !== undefined && Math.round(preview.later.freightEur * 100) !== Math.round(request.laterFreightEur * 100)) return false;
  return [preview.original, preview.current, preview.later].every(part =>
    Math.round(part.totalInclVatEur * 100) === Math.round(part.totalExclVatEur * 100) + Math.round(part.vatEur * 100));
}
