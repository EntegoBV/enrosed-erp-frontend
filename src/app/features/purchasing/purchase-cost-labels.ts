import {
  PurchaseCostLabels,
  PurchaseOrder,
  PurchaseOrderView,
  Supplier,
} from '../../core/api/models';
import { countryName } from '../../core/api/geo';

/**
 * Uses the backend's route wording, with a complete fallback for an older
 * response that was already open when the backend restarted.
 */
export function purchaseCostLabels(
  view: PurchaseOrderView | null,
  supplier: Supplier | null,
): PurchaseCostLabels {
  if (view?.costLabels) return view.costLabels;

  const order = view?.order;
  const originCountry = countryName(supplier?.country) || 'land van oorsprong';
  const loadingPort = clean(order?.departurePort) || clean(supplier?.portOfLoading)
    || clean(supplier?.city) || 'laadhaven';
  const destinationPort = clean(order?.destinationPort) || 'Rotterdam';
  return {
    originCountry,
    loadingPort,
    destinationPort,
    originCostsLabel: `Lokale kosten ${originCountry}`,
    originRoute: `Fabriek → ${loadingPort}`,
    seaFreightLabel: 'Zeevracht',
    seaFreightRoute: `${loadingPort} → ${destinationPort}`,
    destinationCostsLabel: `${destinationPort} → magazijn`,
  };
}

/** One visible USD rate; backend mirrors it into both historical fields. */
export function effectiveUsdToEur(order: PurchaseOrder | null | undefined): number {
  return order?.usdToEurGoods ?? order?.usdToEurTransport ?? 0;
}

/** Full legacy payload stays compatible while carrying one user choice. */
export function withUsdToEur(order: PurchaseOrder, rate: number): PurchaseOrder {
  return { ...order, usdToEurGoods: rate, usdToEurTransport: rate };
}

/** True when an inspection or another named cost is booked apart from the piece price. */
export function hasSeparateCosts(order: PurchaseOrder | null | undefined): boolean {
  if (!order) return false;
  if ((order.inspectionCostEur ?? 0) > 0) return true;
  return (order.otherCosts ?? []).some((cost) => (cost.amountEur ?? 0) > 0);
}

/** The bottom line under the landed total, named after what it adds. */
export function separateCostsTotalLabel(totals: {
  otherCosts?: { amountEur: number | null }[];
}): string {
  const others = (totals.otherCosts ?? []).some((cost) => (cost.amountEur ?? 0) > 0);
  return others ? 'Totaal incl. aparte kosten' : 'Totaal incl. inspectie';
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
}
