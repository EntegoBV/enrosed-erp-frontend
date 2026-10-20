import type { ContainerNameSource } from '../purchasing/container-name';
import type { DrillRow, DrillTone, DrillView } from './drill-model';
import type { FreightContainerRow, UsdContainerRow } from './market-math';

/*
 * The drill-downs of Analyses › Markt & container (design/analyses2/design.md
 * §B.9): the containers behind the buying power and behind our freight. Rows
 * come from market-math.ts; type-only imports, so what needs a runtime
 * import comes in through MarketDrillContext.
 */

/** The runtime helpers this module may not import. */
export interface MarketDrillContext {
  /** containerName (purchasing/container-name.ts): the Herkenbare naam, else the PO number. */
  containerName: (po: ContainerNameSource) => string;
  /** The area's date words: '16 okt'. */
  day: (day: string) => string;
}

const STATUS: Record<string, string> = { CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen' };
const rate = (value: number): string => value.toLocaleString('nl-BE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const whole = (value: number): string => `€ ${Math.round(Math.abs(value)).toLocaleString('nl-BE')}`;
/** Up is the warning: the goods cost more euro today, the freight was above the market. */
const toneOf = (value: number | null): DrillTone | null => (value === null || Math.abs(value) < 0.005 ? null : value > 0 ? 'warn' : 'ok');

/** Koopkracht › "Open containers ›": their goods at the order's rate and at today's ECB rate (`market.usdContainers`). */
export function usdContainersView(rows: readonly UsdContainerRow[], ecb: { usdPerEur: number; asOf: string }, ctx: MarketDrillContext): DrillView {
  const ordered = [...rows].sort((left, right) => Math.abs(right.diffEur) - Math.abs(left.diffEur) || right.id - left.id);
  const totalCents = ordered.reduce((sum, row) => sum + Math.round(row.diffEur * 100), 0);
  return {
    id: 'market.usdContainers', title: 'Open containers in dollar',
    scope: `ECB ${ctx.day(ecb.asOf)}: $ ${rate(ecb.usdPerEur)} voor € 1 · goederen volgens de order`,
    summary: totalCents === 0 ? null : `Aan de koers van vandaag ${whole(totalCents / 100)} ${totalCents > 0 ? 'duurder' : 'goedkoper'} dan in de orders`,
    note: 'Al betaalde termijnen gingen aan hun eigen koers.',
    columns: [
      { key: 'name', label: 'Container', format: 'text', phone: 'title' },
      { key: 'status', label: 'Status', format: 'text', phone: 'sub', width: '96px' },
      { key: 'usd', label: 'Goederen $', format: 'usd', phone: 'sub' },
      { key: 'rate', label: 'Koers order', format: 'rate', phone: 'none', width: '96px' },
      { key: 'eurOrder', label: '€ volgens order', format: 'eur', phone: 'none', sum: true },
      { key: 'eurToday', label: '€ aan ECB vandaag', format: 'eur', phone: 'none', sum: true },
      { key: 'diff', label: 'Verschil', format: 'eurSigned', phone: 'value' },
    ],
    rows: ordered.map((row): DrillRow => ({
      key: `po:${row.id}`, tone: toneOf(row.diffEur), link: { path: ['/purchasing', row.id] },
      /* absDiff is no column: the list opens with the largest difference either way. */
      cells: { name: ctx.containerName(row), status: STATUS[row.status] ?? row.status, usd: row.goodsUsd, rate: row.orderRate, eurOrder: row.eurOrder,
        eurToday: row.eurToday, diff: row.diffEur, absDiff: Math.abs(row.diffEur) },
    })),
    valueKey: 'diff', total: { value: totalCents / 100, format: 'eurSigned', of: 'sum', label: 'Verschil vandaag' },
    sort: { key: 'absDiff', dir: 'desc' }, empty: 'Geen open containers met goederen in dollar.',
  };
}

/** Zeevracht › "Per container ›": our freight per container against Drewry of that week (`market.freightContainers`). */
export function freightContainersView(rows: readonly FreightContainerRow[], ctx: MarketDrillContext): DrillView {
  const compared = rows.filter((row) => row.diffPct !== null).map((row) => row.diffPct as number);
  const mean = compared.length ? Math.round(compared.reduce((sum, value) => sum + value, 0) / compared.length * 10) / 10 : null;
  return {
    id: 'market.freightContainers', title: 'Vracht per container',
    scope: 'Onze zeevracht in USD per container · Drewry WCI Shanghai → Rotterdam van die week',
    summary: mean === null ? 'Geen Drewry-notering in die weken'
      : `gemiddeld ${mean > 0 ? '+ ' : mean < 0 ? '− ' : ''}${String(Math.abs(mean)).replace('.', ',')} % t.o.v. Drewry`,
    note: 'Vertrek: de vertrekdag, anders de besteldatum.',
    columns: [
      { key: 'name', label: 'Container', format: 'text', phone: 'title' },
      { key: 'route', label: 'Route', format: 'text', phone: 'sub' },
      { key: 'day', label: 'Vertrek', format: 'day', phone: 'sub' },
      { key: 'freight', label: 'Vracht $', format: 'usd', phone: 'none' },
      { key: 'market', label: 'Drewry die week', format: 'usd', phone: 'none' },
      { key: 'diff', label: 'Verschil', format: 'pct', phone: 'value' },
    ],
    rows: rows.map((row): DrillRow => ({
      key: `po:${row.id}`, pill: row.status === 'CONCEPT' ? 'Concept' : null, tone: toneOf(row.diffPct), link: { path: ['/purchasing', row.id] },
      cells: { name: ctx.containerName(row), route: row.route || null, day: row.day, freight: row.freightUsd, market: row.marketUsd, diff: row.diffPct },
    })),
    valueKey: null, total: null, sort: { key: 'day', dir: 'desc' }, empty: 'Geen containers met eigen zeevracht in dollar.',
  };
}
