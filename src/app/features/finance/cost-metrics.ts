import type { CompanyCost } from '../../core/api/models';
import type { CostMoney } from './finance-metrics';

/**
 * The company's own costs added up, per category and per month. The money
 * rule comes in as COST_MONEY (finance-metrics.ts): the arithmetic exists
 * once, and this file keeps no runtime import so the node tests run it alone.
 * 'exclEur' is the expense (excl. plus non-deductible VAT), 'vatEur' what the
 * return shows, 'inclEur' what the bank pays.
 */
export interface CostSummary {
  count: number;
  exclEur: number;
  vatEur: number;
  inclEur: number;
  unpaidCount: number;
  unpaidEur: number;
  /** Import VAT paid at customs: not a cost, its own line. */
  importVatEur: number;
  byCategory: { category: string; count: number; exclEur: number; sharePct: number }[];
  byMonth: { month: string; count: number; exclEur: number }[];
  byChannel: { channel: string | null; count: number; exclEur: number }[];
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** The month a date belongs to, as YYYY-MM; malformed dates fall into an empty bucket. */
export function monthKey(date: string | null | undefined): string {
  return /^\d{4}-\d{2}/.test(date ?? '') ? (date as string).slice(0, 7) : '';
}

export function costsInPeriod(costs: readonly CompanyCost[], from?: string | null, to?: string | null): CompanyCost[] {
  return costs.filter((cost) => (!from || cost.date >= from) && (!to || cost.date <= to));
}

export function costSummary(costs: readonly CompanyCost[], money: CostMoney): CostSummary {
  const exclEur = round2(costs.reduce((sum, cost) => sum + money.expenseOf(cost), 0));
  const vatEur = round2(costs.reduce((sum, cost) => sum + money.returnVatOf(cost), 0));
  const inclEur = round2(costs.reduce((sum, cost) => sum + money.cashTotalOf(cost), 0));
  const unpaid = costs.map((cost) => money.openOf(cost)).filter((open) => open > 0);
  const importVatEur = round2(costs.filter((cost) => cost.vatRegime === 'IMPORT_VAT_PAID').reduce((sum, cost) => sum + money.cashTotalOf(cost), 0));
  const groups = <K extends string | null>(key: (cost: CompanyCost) => K) => {
    const map = new Map<K, { count: number; exclEur: number }>();
    for (const cost of costs) {
      const bucket = map.get(key(cost)) ?? { count: 0, exclEur: 0 };
      bucket.count += 1;
      bucket.exclEur = round2(bucket.exclEur + money.expenseOf(cost));
      map.set(key(cost), bucket);
    }
    return map;
  };
  const byCategory = [...groups((cost) => (cost.category ?? '').toUpperCase()).entries()]
    .map(([category, bucket]) => ({ category, ...bucket, sharePct: exclEur > 0 ? round2(bucket.exclEur / exclEur * 100) : 0 }))
    .sort((left, right) => right.exclEur - left.exclEur || left.category.localeCompare(right.category));
  const byMonth = [...groups((cost) => monthKey(cost.date)).entries()]
    .map(([month, bucket]) => ({ month, ...bucket }))
    .sort((left, right) => right.month.localeCompare(left.month));
  const byChannel = [...groups((cost) => (cost.salesChannel ? cost.salesChannel.toUpperCase() : null) as string | null).entries()]
    .map(([channel, bucket]) => ({ channel, ...bucket }))
    .sort((left, right) => right.exclEur - left.exclEur);
  return {
    count: costs.length,
    exclEur,
    vatEur,
    inclEur,
    unpaidCount: unpaid.length,
    unpaidEur: round2(unpaid.reduce((sum, open) => sum + open, 0)),
    importVatEur,
    byCategory,
    byMonth,
    byChannel,
  };
}
