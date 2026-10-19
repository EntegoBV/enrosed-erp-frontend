import type { TicaAnalyticsDay } from '../../core/api/tica-api';
import type { ResultAnalysis, ResultChannelRow, SalesAnalysis, SalesChannelMetric } from './analysis-metrics';

type TicaChannel = { ticaTransactions: number; ticaMissingCostLines: number };
export type SalesWithTica = Omit<SalesAnalysis, 'channels'> & {
  revenueExclEur: number; marginEur: number; marginPct: number | null; missingCostLines: number;
  ticaTransactions: number; ticaRevenueExclEur: number;
  channels: (SalesChannelMetric & TicaChannel)[];
  ticaMonthly: { month: string; revenueExclEur: number }[];
};
export type ResultWithTica = Omit<ResultAnalysis, 'byChannel'> & {
  ticaTransactions: number; ticaRevenueExclEur: number;
  byChannel: (ResultChannelRow & TicaChannel)[];
};
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const selectedDays = (days: readonly TicaAnalyticsDay[], period: { from: string | null; to: string | null }): TicaAnalyticsDay[] =>
  days.filter(day => (!period.from || day.date >= period.from) && (!period.to || day.date <= period.to));

/** Portal revenue is after discount and excl. VAT. It never becomes an ERP invoice or invoice claim. */
export function withTicaSales(base: SalesAnalysis, days: readonly TicaAnalyticsDay[]): SalesWithTica {
  const selected = selectedDays(days, base.period);
  const revenue = money(selected.reduce((sum, day) => sum + day.revenueExcl, 0));
  const goodsCost = money(selected.reduce((sum, day) => sum + day.goodsCostEur, 0));
  const transactions = selected.reduce((sum, day) => sum + day.transactionCount, 0);
  const missing = selected.reduce((sum, day) => sum + day.missingCostLines, 0);
  const channels = base.channels.map(channel => ({ ...channel, ticaTransactions: 0, ticaMissingCostLines: 0 }));
  if (selected.length) {
    let channel = channels.find(row => row.channel === 'TICA');
    if (!channel) {
      channel = { channel: 'TICA', invoiceCount: 0, revenueExclEur: 0, claimInclEur: 0, goodsValueEur: 0, marginEur: 0, sharePct: 0, ticaTransactions: 0, ticaMissingCostLines: 0 };
      channels.push(channel);
    }
    channel.revenueExclEur = money(channel.revenueExclEur + revenue);
    channel.goodsValueEur = money(channel.goodsValueEur + revenue);
    channel.marginEur = money(channel.marginEur + revenue - goodsCost);
    channel.ticaTransactions = transactions;
    channel.ticaMissingCostLines = missing;
  }
  const revenueExclEur = money(base.invoices.revenueExclEur + revenue);
  const marginEur = money(base.invoices.marginEur + revenue - goodsCost);
  for (const channel of channels) channel.sharePct = revenueExclEur > 0 ? money(channel.revenueExclEur / revenueExclEur * 100) : 0;
  const monthly = new Map<string, number>();
  for (const day of selected) {
    const month = day.date.slice(0, 7);
    monthly.set(month, money((monthly.get(month) ?? 0) + day.revenueExcl));
  }
  return { ...base, revenueExclEur, marginEur, marginPct: revenueExclEur > 0 ? money(marginEur / revenueExclEur * 100) : null,
    missingCostLines: base.invoices.missingCostLines + missing, ticaTransactions: transactions, ticaRevenueExclEur: revenue,
    channels: channels.sort((a, b) => b.revenueExclEur - a.revenueExclEur || a.channel.localeCompare(b.channel)),
    ticaMonthly: [...monthly].map(([month, revenueExclEur]) => ({ month, revenueExclEur })).sort((a, b) => a.month.localeCompare(b.month)) };
}

/** Commission already lives in CompanyCost; add only portal revenue and CURRENT product cost here. */
export function withTicaResult(base: ResultAnalysis, days: readonly TicaAnalyticsDay[]): ResultWithTica {
  const selected = selectedDays(days, base.period);
  const revenue = money(selected.reduce((sum, day) => sum + day.revenueExcl, 0));
  const goodsCost = money(selected.reduce((sum, day) => sum + day.goodsCostEur, 0));
  const transactions = selected.reduce((sum, day) => sum + day.transactionCount, 0);
  const missing = selected.reduce((sum, day) => sum + day.missingCostLines, 0);
  const channels = base.byChannel.map(channel => ({ ...channel, ticaTransactions: 0, ticaMissingCostLines: 0 }));
  if (selected.length) {
    let channel = channels.find(row => row.channel === 'TICA');
    if (!channel) {
      channel = { channel: 'TICA', invoiceCount: 0, revenueEur: 0, goodsCostEur: 0, marginEur: 0, costsEur: 0, resultEur: 0, ticaTransactions: 0, ticaMissingCostLines: 0 };
      channels.push(channel);
    }
    channel.revenueEur = money(channel.revenueEur + revenue);
    channel.goodsCostEur = money(channel.goodsCostEur + goodsCost);
    channel.marginEur = money(channel.marginEur + revenue - goodsCost);
    channel.resultEur = money(channel.marginEur - channel.costsEur);
    channel.ticaTransactions = transactions;
    channel.ticaMissingCostLines = missing;
  }
  const months = new Map(base.monthly.map(month => [month.month, { ...month }]));
  for (const day of selected) {
    const key = day.date.slice(0, 7);
    const month = months.get(key) ?? { month: key, revenueEur: 0, marginEur: 0, costsEur: 0, resultEur: 0 };
    month.revenueEur = money(month.revenueEur + day.revenueExcl);
    month.marginEur = money(month.marginEur + day.revenueExcl - day.goodsCostEur);
    month.resultEur = money(month.marginEur - month.costsEur);
    months.set(key, month);
  }
  const revenueEur = money(base.revenueEur + revenue), marginEur = money(base.marginEur + revenue - goodsCost);
  return { ...base, revenueEur, marginEur, goodsCostEur: money(base.goodsCostEur + goodsCost),
    marginPct: revenueEur > 0 ? money(marginEur / revenueEur * 100) : null, resultEur: money(marginEur - base.costsEur),
    missingCostLines: base.missingCostLines + missing, ticaTransactions: transactions, ticaRevenueExclEur: revenue,
    byChannel: channels.sort((a, b) => b.revenueEur - a.revenueEur || a.channel.localeCompare(b.channel)),
    monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) };
}
