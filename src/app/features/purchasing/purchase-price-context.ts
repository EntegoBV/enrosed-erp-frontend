import type { FreightRate } from '../../core/api/models';

export interface FxReferenceInput {
  latestUsd: number;
  latestCny: number;
  asOf: string;
}

export interface PurchaseFxReference {
  /** USD paid for one CNY/RMB. */
  cnyToUsd: number;
  /** EUR paid for one USD. */
  usdToEur: number;
  asOf: string;
}

/**
 * Frankfurter supplies both currencies as units bought by one euro. Convert
 * those values to the directions used by a purchase calculation.
 */
export function purchaseFxReference(
  rates: FxReferenceInput | null | undefined,
): PurchaseFxReference | null {
  if (!rates || !positive(rates.latestUsd) || !positive(rates.latestCny) || !rates.asOf) {
    return null;
  }
  return {
    cnyToUsd: rates.latestUsd / rates.latestCny,
    usdToEur: 1 / rates.latestUsd,
    asOf: rates.asOf,
  };
}

/**
 * Finds the newest own forwarder quote that is genuinely comparable with
 * this order. Public indices, LCL/20ft quotes and other destinations must not
 * look like a ready-to-use current container price.
 */
export function latestOwnFreightQuote(
  rates: readonly FreightRate[],
  departurePort: string | null | undefined,
  destinationPort: string | null | undefined,
  containerType: string | null | undefined,
): FreightRate | null {
  if (destinationPort?.trim().toLocaleLowerCase() !== 'rotterdam') return null;
  if (containerType !== 'FORTY_GP' && containerType !== 'FORTY_HQ') return null;

  const route = ownRouteCode(departurePort);
  if (!route) return null;

  let latest: FreightRate | null = null;
  for (const candidate of rates) {
    if (candidate.route !== route || !positive(candidate.usdPerContainer) || !candidate.quotedOn) {
      continue;
    }
    if (!latest || candidate.quotedOn > latest.quotedOn ||
        (candidate.quotedOn === latest.quotedOn && (candidate.id ?? 0) > (latest.id ?? 0))) {
      latest = candidate;
    }
  }
  return latest;
}

function ownRouteCode(port: string | null | undefined): string | null {
  switch (port?.trim().toLocaleLowerCase()) {
    case 'ningbo':
      return 'NINGBO';
    case 'guangzhou':
    case 'nansha':
      return 'GUANGZHOU';
    case 'shenzhen':
    case 'yantian':
      return 'SHENZHEN';
    default:
      return null;
  }
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
