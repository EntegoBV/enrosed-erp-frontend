import type { SalesOrder } from './models';

export const shippingFields = [
  'loadMode', 'palletProfile', 'maxPalletHeightCm', 'palletSpillCm', 'freightPricingStrategy',
  'freightRatePerCbmEur', 'manualFreightEur', 'freightCarrierId',
  'freightCarrierExtraEur', 'freight', 'pallets',
] as const satisfies readonly (keyof SalesOrder)[];

/**
 * Complete snapshot for the narrow shipping endpoint; null explicitly resets a value. A kar's freight defaults to FIXED,
 * never per pallet. The height and the spill are the exceptions: without one the server keeps the document's own (for
 * the spill a number, 0 included, sets it). The spill belongs here so a change of it is a transport change: a sent
 * document can save it and "Wijzigingen weggooien" puts it back.
 */
export function shippingSnapshot(order: SalesOrder) {
  return {
    loadMode: order.loadMode ?? 'PALLETS',
    palletProfile: order.palletProfile ?? 'EURO_120X80',
    maxPalletHeightCm: order.maxPalletHeightCm ?? null,
    palletSpillCm: order.palletSpillCm ?? null,
    freightPricingStrategy: order.freightPricingStrategy
      ?? (order.manualFreightEur != null || order.palletProfile === 'DEENSE_KAR' ? 'FIXED'
        : order.loadMode === 'LOOSE_CARTONS' ? 'PER_CBM' : 'COUNTRY_PALLET'),
    freightRatePerCbmEur: order.freightRatePerCbmEur ?? null,
    manualFreightEur: order.manualFreightEur ?? null,
    freightCarrierId: order.freightCarrierId ?? null,
    freightCarrierExtraEur: order.freightCarrierExtraEur ?? null,
    freight: order.freight ?? 'BEREKEND',
    pallets: order.pallets,
  };
}

export type ShippingUpdate = ReturnType<typeof shippingSnapshot>;

export function withoutShipping(order: SalesOrder): object {
  return Object.fromEntries(Object.entries(order).filter(([key]) =>
    !shippingFields.includes(key as typeof shippingFields[number])));
}

/** Keep edits made during a request, while adopting server rounding and regenerated row IDs. */
export function mergeOrderAfterSave(saved: SalesOrder, submitted: SalesOrder, current: SalesOrder): SalesOrder {
  const later = Object.fromEntries(Object.entries(current).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(submitted[key as keyof SalesOrder])));
  return { ...saved, ...later };
}
