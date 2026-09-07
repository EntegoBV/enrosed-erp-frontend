import type { CompanyCost } from '../../core/api/models';

/** The company's own costs added up, per category and per month, all excluding VAT unless said otherwise. */
export interface CostSummary {
  count: number;
  exclEur: number;
  vatEur: number;
  inclEur: number;
  unpaidCount: number;
  unpaidEur: number;
  byCategory: { category: string; count: number; exclEur: number; sharePct: number }[];
  byMonth: { month: string; count: number; exclEur: number }[];
  byChannel: { channel: string | null; count: number; exclEur: number }[];
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const money = (value: number | null | undefined): number => (Number.isFinite(value as number) && (value as number) > 0 ? (value as number) : 0);

export function vatOf(cost: Pick<CompanyCost, 'amountExclEur' | 'vatPct'>): number {
  const pct = money(cost.vatPct);
  return round2(money(cost.amountExclEur) * pct / 100);
}

export function inclOf(cost: Pick<CompanyCost, 'amountExclEur' | 'vatPct'>): number {
  return round2(money(cost.amountExclEur) + vatOf(cost));
}

/** The month a date belongs to, as YYYY-MM; malformed dates fall into an empty bucket. */
export function monthKey(date: string | null | undefined): string {
  return /^\d{4}-\d{2}/.test(date ?? '') ? (date as string).slice(0, 7) : '';
}

export function costsInPeriod(costs: readonly CompanyCost[], from?: string | null, to?: string | null): CompanyCost[] {
  return costs.filter((cost) => (!from || cost.date >= from) && (!to || cost.date <= to));
}

export function costSummary(costs: readonly CompanyCost[]): CostSummary {
  const exclEur = round2(costs.reduce((sum, cost) => sum + money(cost.amountExclEur), 0));
  const vatEur = round2(costs.reduce((sum, cost) => sum + vatOf(cost), 0));
  const unpaid = costs.filter((cost) => !cost.paidOn);
  const groups = <K extends string | null>(key: (cost: CompanyCost) => K) => {
    const map = new Map<K, { count: number; exclEur: number }>();
    for (const cost of costs) {
      const bucket = map.get(key(cost)) ?? { count: 0, exclEur: 0 };
      bucket.count += 1;
      bucket.exclEur = round2(bucket.exclEur + money(cost.amountExclEur));
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
    inclEur: round2(exclEur + vatEur),
    unpaidCount: unpaid.length,
    unpaidEur: round2(unpaid.reduce((sum, cost) => sum + inclOf(cost), 0)),
    byCategory,
    byMonth,
    byChannel,
  };
}
