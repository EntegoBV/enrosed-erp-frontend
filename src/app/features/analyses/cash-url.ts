import type { CostBasis, PriceMode } from '../../core/api/models';
import type { ForecastRule, ScenarioDefaults } from '../finance/cash-forecast';

/*
 * The address of Analyses › Kasprognose (spec-bank-forecast §1.4): the
 * horizon, the open container sheet and the link-level scenario defaults.
 * A stored choice per container wins over these; the buffer is a company
 * setting and never in the link. Pure and node-tested: only `import type`.
 */

export interface CashLocation {
  horizon: 3 | 6 | 12;            // h, default 6
  po: number | null;              // po: the open PO sheet
  priceMode: PriceMode | null;    // prijs: 'opslag' | 'stuk' | 'lijst' | 'historisch'
  markupPct: number | null;       // opslag: 0..1000, max 1 decimal
  markupEurPerUnit: number | null;// stuk: >= 0, max 4 decimals (only read when prijs=stuk)
  costBasis: CostBasis | null;    // basis: 'ext' | 'enr'
  sellWeeks: number | null;       // weken: 1..104
  seasonal: boolean | null;       // verloop: 'vlak' | 'seizoen'
  paymentDays: number | null;     // termijn: 0..365
  includeStock: boolean;          // voorraad=0 turns stock off; default true
  rulesOff: ForecastRule[];       // uit: comma list of 'facturen','offertes','partner','containers','kosten','btw'
  openQuotesOn: boolean;          // open=1; default false
}

export const RULE_PARAM: Record<Exclude<ForecastRule, 'openQuotes'>, string> = { invoices: 'facturen', quotes: 'offertes', partner: 'partner', containers: 'containers', costs: 'kosten', vat: 'btw' };

const PRICE_PARAM: Record<PriceMode, string> = { MARKUP_PCT: 'opslag', EUR_PER_UNIT: 'stuk', LIST: 'lijst', HISTORIC: 'historisch' };
const BASIS_PARAM: Record<CostBasis, string> = { EXTERNAL: 'ext', PRICING: 'enr' };
/** The switchable rules in the order the link writes them. */
const RULE_ORDER = Object.keys(RULE_PARAM) as Exclude<ForecastRule, 'openQuotes'>[];

export const DEFAULT_CASH_LOCATION: CashLocation = {
  horizon: 6, po: null, priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null, sellWeeks: null,
  seasonal: null, paymentDays: null, includeStock: true, rulesOff: [], openQuotesOn: false,
};

function keyOf<T extends string>(map: Record<T, string>, value: string | null): T | null {
  if (value === null) return null;
  return (Object.keys(map) as T[]).find((key) => map[key] === value) ?? null;
}

/** A decimal with at most `decimals` places ('37.5' and '37,5' both read), within [min, max]; else null. */
function decimal(value: string | null, decimals: number, min: number, max: number): number | null {
  if (value === null) return null;
  const text = value.trim().replace(',', '.');
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function whole(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  const number = Number(value.trim());
  return number >= min && number <= max ? number : null;
}

/** Reads the address; every invalid value falls back to its default ('h=7' → 6, 'opslag=abc' → null). */
export function parseCashLocation(get: (key: string) => string | null): CashLocation {
  const horizon = get('h');
  const po = whole(get('po'), 1, Number.MAX_SAFE_INTEGER);
  const priceMode = keyOf(PRICE_PARAM, get('prijs'));
  const verloop = get('verloop');
  const off = new Set((get('uit') ?? '').split(',').map((part) => keyOf(RULE_PARAM, part.trim())).filter((rule): rule is Exclude<ForecastRule, 'openQuotes'> => rule !== null));
  return {
    horizon: horizon === '3' ? 3 : horizon === '12' ? 12 : 6,
    po,
    priceMode,
    markupPct: decimal(get('opslag'), 1, 0, 1000),
    markupEurPerUnit: priceMode === 'EUR_PER_UNIT' ? decimal(get('stuk'), 4, 0, Number.MAX_SAFE_INTEGER) : null,
    costBasis: keyOf(BASIS_PARAM, get('basis')),
    sellWeeks: whole(get('weken'), 1, 104),
    seasonal: verloop === 'seizoen' ? true : verloop === 'vlak' ? false : null,
    paymentDays: whole(get('termijn'), 0, 365),
    includeStock: get('voorraad') !== '0',
    rulesOff: RULE_ORDER.filter((rule) => off.has(rule)),
    openQuotesOn: get('open') === '1',
  };
}

/** The query of a location, every default left out (so the plain page has a plain address). */
export function cashQueryParams(location: CashLocation): Record<string, string> {
  const params: Record<string, string> = {};
  if (location.horizon !== 6) params['h'] = String(location.horizon);
  if (location.po !== null) params['po'] = String(location.po);
  if (location.priceMode !== null) params['prijs'] = PRICE_PARAM[location.priceMode];
  if (location.markupPct !== null) params['opslag'] = String(Math.round(location.markupPct * 10) / 10);
  if (location.priceMode === 'EUR_PER_UNIT' && location.markupEurPerUnit !== null) params['stuk'] = String(Math.round(location.markupEurPerUnit * 10000) / 10000);
  if (location.costBasis !== null) params['basis'] = BASIS_PARAM[location.costBasis];
  if (location.sellWeeks !== null) params['weken'] = String(location.sellWeeks);
  if (location.seasonal !== null) params['verloop'] = location.seasonal ? 'seizoen' : 'vlak';
  if (location.paymentDays !== null) params['termijn'] = String(location.paymentDays);
  if (!location.includeStock) params['voorraad'] = '0';
  const off = RULE_ORDER.filter((rule) => location.rulesOff.includes(rule));
  if (off.length) params['uit'] = off.map((rule) => RULE_PARAM[rule]).join(',');
  if (location.openQuotesOn) params['open'] = '1';
  return params;
}

/** The link values as the scenario's defaults for every container without a stored choice. */
export function toScenarioDefaults(location: CashLocation): ScenarioDefaults {
  return {
    priceMode: location.priceMode, markupPct: location.markupPct,
    markupEurPerUnit: location.priceMode === 'EUR_PER_UNIT' ? location.markupEurPerUnit : null,
    costBasis: location.costBasis, sellWeeks: location.sellWeeks, seasonal: location.seasonal, paymentDays: location.paymentDays,
  };
}

/** The location with the link-level scenario defaults cleared ("Wissen"); horizon, sheet, stock and rules stay. */
export function withoutScenarioDefaults(location: CashLocation): CashLocation {
  return { ...location, priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null, sellWeeks: null, seasonal: null, paymentDays: null };
}

/** The address "Link kopiëren" copies. */
export function cashLink(origin: string, location: CashLocation): string {
  const query = new URLSearchParams(cashQueryParams(location)).toString();
  return `${origin}/analyses/cash${query ? `?${query}` : ''}`;
}
