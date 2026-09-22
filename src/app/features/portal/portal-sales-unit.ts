export interface PortalSalesUnit {
  salesUnit?: 'PIECE' | 'DISPLAY' | null;
  piecesPerDisplay?: number | null;
}

export function portalQuantityUnitKey(item: PortalSalesUnit): string {
  return item.salesUnit === 'DISPLAY' ? 'salesDisplayUnits' : 'portalPieces';
}

export function portalPriceUnitKey(item: PortalSalesUnit): string {
  return item.salesUnit === 'DISPLAY' ? 'salesPricePerDisplay' : 'portalPerPiece';
}

export function portalDisplayPieces(item: PortalSalesUnit): number | null {
  const count = item.piecesPerDisplay;
  return count != null && Number.isSafeInteger(count) && count > 1 ? count : null;
}

/** Raw quote price is unchanged; this is only a display equivalent. */
export function portalSecondaryPrice(item: PortalSalesUnit & { unitPrice: number | null }) {
  const pieces = portalDisplayPieces(item);
  if (!pieces || item.unitPrice == null || !Number.isFinite(item.unitPrice) || item.unitPrice <= 0) return null;
  const price = item.salesUnit === 'DISPLAY' ? item.unitPrice / pieces : item.unitPrice * pieces;
  return {
    price,
    labelKey: item.salesUnit === 'DISPLAY' ? 'salesPricePerPiece' : 'salesPricePerDisplay',
    approximate: Math.abs(price - Math.round(price * 1000) / 1000) > 1e-9,
  };
}
