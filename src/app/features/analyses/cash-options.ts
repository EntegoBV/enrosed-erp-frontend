import { horizonEndOf } from '../finance/cash-forecast';
import type { ForecastOptions } from '../finance/cash-forecast';
import { toScenarioDefaults } from './cash-url';
import type { CashLocation } from './cash-url';

/** Desk past (6 weeks); the phone chart shows the last two of them. */
export const PAST_DAYS = 42;

/**
 * The one ForecastOptions builder: Analyses › Kasprognose builds its forecast
 * from its address, the home from DEFAULT_CASH_LOCATION (horizon 6, scenario
 * on, stock included), so both show the same lowest point on the same data.
 */
export function cashOptionsOf(location: CashLocation, today: string, dismissed: readonly string[]): ForecastOptions {
  return {
    horizonEnd: horizonEndOf(today, location.horizon), scenario: true, includeStock: location.includeStock, rulesOff: location.rulesOff,
    openQuotesOn: location.openQuotesOn, defaults: toScenarioDefaults(location), dismissed, pastDays: PAST_DAYS,
  };
}
