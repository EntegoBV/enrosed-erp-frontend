import type { Payee, PurchaseOrderView, PurchaseReconciliation } from '../../core/api/models';
import type { NacalcUnitMix } from '../purchasing/purchase-payment-result-metrics';
import type { ContainerCostRow, ContainerCostTotals } from '../purchasing/purchase-reconciliation-metrics';
import type { DrillLink, DrillRow, DrillView } from './drill-model';

/**
 * The drill-downs of Analyses › Inkoop › Containerkost (design/analyses2/design.md
 * §B.7, §C.6): the Afspraak per ontvanger, what is still to pay per container and
 * term, the containers behind each line of "Verschil met de afspraak", and one
 * container's cost per product. Pure with type-only imports (node-tested,
 * tests/analyses-drill-container-cost.test.mts); the component passes the scope
 * line, the container names and the unit mix.
 *
 * The sum rule (§A.4): every total is the figure the tile or the card shows
 * (containerCostTotals over the same rows), never a second calculation; the
 * rows are built from the same rows with the same rules, so they add up to it.
 */

/** What the component passes in: the scope line (filter, search, count) and how a container is named. */
export interface ContainerCostDrillContext {
  scope: string;
  name: (view: PurchaseOrderView) => string;
}

/** The parts of the difference with the afspraak, as the card lists them. */
export type VariancePart = 'overpaid' | 'saving' | 'additional' | 'credit';

export interface VarianceLine {
  id: VariancePart | 'other';
  label: string;
  /** Signed as it counts in the net: more paid and extra spending +, a saving and a supplier credit −. */
  amountEur: number;
  /** The view this line opens; null for Overig and for a zero line (a zero figure is no trigger, §A.3). */
  drill: VariancePart | null;
}

const PAYEE_ORDER: readonly Payee[] = ['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'OTHER'];
const PART_LABEL: Readonly<Record<VariancePart, string>> = {
  overpaid: 'Meer betaald op afgesproken kosten', saving: 'Minder betaald na vereffening',
  additional: 'Extra uitgaven buiten de afspraak', credit: 'Tegoed leverancier',
};
/** The sign of each part in the net difference (the server's variance is paid + open − credit − afspraak). */
const PART_SIGN: Readonly<Record<VariancePart, 1 | -1>> = { overpaid: 1, saving: -1, additional: 1, credit: -1 };
const PARTS: readonly VariancePart[] = ['overpaid', 'saving', 'additional', 'credit'];

const cents = (value: number): number => Math.round(value * 100) / 100;
const isZero = (value: number): boolean => Math.round(value * 100) === 0;
const order = (view: PurchaseOrderView, section: string): DrillLink => ({ path: ['/purchasing', view.order.id], query: { section } });

/** The figure of each part over the rows in view, from the totals the card shows. */
function partFigure(total: ContainerCostTotals, part: VariancePart): number {
  return { overpaid: total.overpaidEur, saving: total.settledSavingEur, additional: total.additionalEur, credit: total.supplierCreditEur }[part];
}

/** One container's share of a part, by the rule of containerCostTotals (streams, OTHER paid, the supplier credit). */
function containerPart(reconciliation: PurchaseReconciliation, part: VariancePart): number {
  if (part === 'credit') return reconciliation.totals.supplierCreditEur ?? 0;
  return reconciliation.streams.reduce((sum, stream) => sum + (part === 'overpaid' ? stream.overpaidEur
    : part === 'saving' ? stream.settledSavingEur : stream.payee === 'OTHER' ? stream.paidEur : 0), 0);
}

/**
 * The card's lines: the four parts with their sign, and "Overig · afronding" only
 * when they miss the net by € 0,50 or more (a stream paid without an afspraak, an
 * older server without the credit field); the net itself is total.varianceEur.
 */
export function varianceLines(total: ContainerCostTotals): VarianceLine[] {
  const lines = PARTS.map((part): VarianceLine => {
    const figure = partFigure(total, part);
    return { id: part, label: PART_LABEL[part], amountEur: cents(PART_SIGN[part] * figure), drill: isZero(figure) ? null : part };
  });
  const rest = cents(total.varianceEur - lines.reduce((sum, line) => sum + line.amountEur, 0));
  if (Math.abs(rest) >= 0.5) lines.push({ id: 'other', label: 'Overig · afronding', amountEur: rest, drill: null });
  return lines;
}

/** Afspraak tile: the agreed external cost per ontvanger, over every stream of the containers in view. */
export function costPayeesView(rows: readonly ContainerCostRow[], total: ContainerCostTotals, context: ContainerCostDrillContext): DrillView {
  const payees = new Map<Payee, { label: string; containers: Set<number>; planned: number; paid: number; open: number; forecast: number }>();
  for (const { view, reconciliation } of rows) {
    for (const stream of reconciliation.streams) {
      if ([stream.plannedEur, stream.paidEur, stream.remainingEur, stream.forecastEur].every(isZero)) continue;
      const entry = payees.get(stream.payee) ?? { label: stream.label, containers: new Set<number>(), planned: 0, paid: 0, open: 0, forecast: 0 };
      entry.containers.add(view.order.id);
      entry.planned += stream.plannedEur;
      entry.paid += stream.paidEur;
      entry.open += stream.remainingEur;
      entry.forecast += stream.forecastEur;
      payees.set(stream.payee, entry);
    }
  }
  const drillRows = [...payees]
    .sort(([leftPayee, left], [rightPayee, right]) => right.planned - left.planned || PAYEE_ORDER.indexOf(leftPayee) - PAYEE_ORDER.indexOf(rightPayee))
    .map(([payee, entry]): DrillRow => ({ key: payee, cells: {
      payee: entry.label, containers: entry.containers.size, paid: cents(entry.paid), open: cents(entry.open),
      forecast: cents(entry.forecast), planned: cents(entry.planned),
    } }));
  return {
    id: 'cost.payees', title: 'Afspraak per ontvanger', scope: context.scope,
    columns: [
      { key: 'payee', label: 'Ontvanger', format: 'text', phone: 'title' },
      { key: 'containers', label: 'Containers', format: 'int', phone: 'sub' },
      { key: 'paid', label: 'Betaald', format: 'eur2', phone: 'none', sum: true },
      { key: 'open', label: 'Open', format: 'eur2', phone: 'none', sum: true },
      { key: 'forecast', label: 'Verwacht', format: 'eur2', phone: 'none', sum: true },
      { key: 'planned', label: 'Afspraak', format: 'eur2', phone: 'value' },
    ],
    rows: drillRows, valueKey: 'planned',
    total: { value: total.plannedEur, format: 'eur2', of: 'sum' },
    sort: { key: 'planned', dir: 'desc' },
    empty: 'Geen afspraak voor deze containers.',
  };
}

/**
 * Nog te betalen tile: per container and ontvanger what is open; the supplier per
 * term (supplierInstalments), whose open amounts the server nets against each
 * other, so an older answer without netting shows the difference as its own row.
 */
export function costOpenView(rows: readonly ContainerCostRow[], total: ContainerCostTotals, context: ContainerCostDrillContext): DrillView {
  const drillRows: DrillRow[] = [];
  for (const { view, reconciliation } of rows) {
    const name = context.name(view);
    const link = order(view, 'ledger');
    for (const stream of reconciliation.streams) {
      const terms = stream.payee === 'SUPPLIER' ? reconciliation.supplierInstalments ?? [] : [];
      if (terms.length) {
        terms.forEach((term, index) => {
          if (Math.round(term.remainingEur * 100) > 0) drillRows.push({ key: `${view.order.id}:${stream.payee}:${index}`,
            cells: { name, payee: stream.label, term: term.label, open: cents(term.remainingEur) }, link });
        });
      } else if (Math.round(stream.remainingEur * 100) > 0) {
        drillRows.push({ key: `${view.order.id}:${stream.payee}`, cells: { name, payee: stream.label, term: null, open: cents(stream.remainingEur) }, link });
      }
    }
  }
  // Per container, then the largest amount first: the dialog sorts on the name and keeps this order within it.
  drillRows.sort((left, right) => String(left.cells['name']).localeCompare(String(right.cells['name']), 'nl')
    || Number(right.cells['open']) - Number(left.cells['open']));
  return {
    id: 'cost.open', title: 'Nog te betalen', scope: context.scope,
    columns: [
      { key: 'name', label: 'Container', format: 'text', phone: 'title' },
      { key: 'payee', label: 'Ontvanger', format: 'text', phone: 'sub' },
      { key: 'term', label: 'Termijn', format: 'text', phone: 'sub' },
      { key: 'open', label: 'Open', format: 'eur2', phone: 'value' },
    ],
    rows: drillRows, valueKey: 'open',
    total: { value: total.remainingEur, format: 'eur2', of: 'sum' },
    gapLabel: 'Verrekend met andere termijnen',
    sort: { key: 'name', dir: 'asc' },
    empty: 'Niets meer te betalen.',
  };
}

/** A line of "Verschil met de afspraak": the containers with a share in it, the largest first. */
export function costVarianceView(part: VariancePart, rows: readonly ContainerCostRow[], total: ContainerCostTotals,
  context: ContainerCostDrillContext): DrillView {
  const drillRows = rows.flatMap(({ view, reconciliation }): DrillRow[] => {
    const amount = containerPart(reconciliation, part);
    return isZero(amount) ? [] : [{ key: String(view.order.id), link: order(view, 'payment-result'), cells: {
      name: context.name(view), state: reconciliation.totals.finalized ? 'Afgerekend' : 'Voorlopig', amount: cents(amount),
    } }];
  }).sort((left, right) => Math.abs(Number(right.cells['amount'])) - Math.abs(Number(left.cells['amount'])));
  return {
    id: `cost.variance.${part}`, title: PART_LABEL[part], scope: context.scope,
    columns: [
      { key: 'name', label: 'Container', format: 'text', phone: 'title' },
      { key: 'state', label: 'Afrekening', format: 'text', phone: 'sub' },
      { key: 'amount', label: 'Bedrag', format: 'eur2', phone: 'value' },
    ],
    rows: drillRows, valueKey: 'amount',
    total: { value: partFigure(total, part), format: 'eur2', of: 'sum' },
    sort: { key: 'amount', dir: 'desc' },
    empty: 'Geen containers met dit verschil.',
  };
}

/**
 * Per eenheid of a container with several products: each product in its own unit
 * (nacalcUnitMix, never an average over them) with its share of the container's
 * expected external cost; what the server could not spread over products is the gap.
 */
export function costUnitView(row: ContainerCostRow, mix: NacalcUnitMix, name: string): DrillView {
  const { view, reconciliation } = row;
  const totals = reconciliation.totals;
  const keyOf = (productId: number | null, productName: string): string => productId != null ? `p${productId}` : `n${productName}`;
  const quantities = new Map<string, number>();
  for (const line of reconciliation.lines) {
    const key = keyOf(line.productId, line.productName);
    quantities.set(key, (quantities.get(key) ?? 0) + (line.unitCostQuantity ?? 0));
  }
  const drillRows = mix.rows.map((product): DrillRow => ({
    key: keyOf(product.productId, product.name),
    link: product.productId != null ? { path: ['/products', product.productId] } : null,
    cells: {
      product: product.name, unit: product.set ? `display · ${product.set.pieces} ${product.set.other}` : 'stuk',
      unitEur: product.unitEur, pieceEur: product.pieceEur, qty: quantities.get(keyOf(product.productId, product.name)) ?? 0,
      value: product.valueEur,
    },
  }));
  const basis = totals.unitCostBasis === 'USABLE_RECEIVED' ? 'bruikbare' : 'bestelde';
  return {
    id: `cost.unit.${view.order.id}`, title: 'Kost per product',
    scope: `${name} · ${totals.finalized ? 'definitieve' : 'verwachte'} kost per ${basis} eenheid`,
    columns: [
      { key: 'product', label: 'Product', format: 'text', phone: 'title' },
      { key: 'unit', label: 'Eenheid', format: 'text', phone: 'sub' },
      { key: 'unitEur', label: 'Per eenheid', format: 'eur4', phone: 'none' },
      { key: 'pieceEur', label: 'Per stuk', format: 'eur4', phone: 'sub' },
      { key: 'qty', label: 'Aantal', format: 'int', phone: 'none' },
      { key: 'value', label: 'Waarde', format: 'eur2', phone: 'value' },
    ],
    rows: drillRows, valueKey: 'value',
    total: { value: totals.forecastExternalEur, format: 'eur2', of: 'sum' },
    gapLabel: 'Niet per product verdeeld',
    sort: { key: 'value', dir: 'desc' },
    empty: 'Geen productregels op deze container.',
  };
}
