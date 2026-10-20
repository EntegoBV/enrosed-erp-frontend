import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type {
  PurchaseInstalmentReconciliation, PurchaseOrderView, PurchaseReconciliationLine, PurchaseReconciliationStream,
} from '../src/app/core/api/models.ts';
import type { DrillView } from '../src/app/features/analyses/drill-model.ts';
import { containerName } from '../src/app/features/purchasing/container-name.ts';
import { nacalcUnitMix } from '../src/app/features/purchasing/purchase-payment-result-metrics.ts';
import { containerCostRows, containerCostTotals } from '../src/app/features/purchasing/purchase-reconciliation-metrics.ts';
import {
  costOpenView, costPayeesView, costUnitView, costVarianceView, varianceLines,
} from '../src/app/features/analyses/drill-container-cost.ts';

/*
 * Analyses › Inkoop › Containerkost drill-downs (design/analyses2 §B.7, §C.6, D-C1…D-C4): every view adds up to the
 * figure on the tile or the card (the sum rule §A.4), as containerCostTotals computes it over the same rows.
 */

const LABEL = { SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten' } as const;
function stream(values: Partial<PurchaseReconciliationStream> & Pick<PurchaseReconciliationStream, 'payee'>): PurchaseReconciliationStream {
  return { label: LABEL[values.payee], status: 'PARTIAL', plannedEur: 0, paidEur: 0, remainingEur: 0, forecastEur: 0, varianceEur: 0,
    overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 0, ...values };
}
function term(values: Partial<PurchaseInstalmentReconciliation>): PurchaseInstalmentReconciliation {
  return { due: 'ORDERED', label: '30% bij bestelling', plannedEur: 0, paidEur: 0, remainingEur: 0, settledSavingEur: 0, overpaidEur: 0,
    explicitlySettled: false, finalized: false, ...values };
}
function line(values: Partial<PurchaseReconciliationLine>): PurchaseReconciliationLine {
  return { productId: null, productName: 'Product', orderedQuantity: 0, receivedQuantity: 0, damagedQuantity: 0, usableQuantity: 0,
    unitCostQuantity: 0, unitCostBasis: 'USABLE_RECEIVED', plannedExternalEur: 0, paidEur: 0, remainingEur: 0, forecastExternalEur: 0,
    varianceEur: 0, internalMarkupEur: 0, forecastPricingEur: 0, forecastExternalUnitEur: null, forecastPricingUnitEur: null,
    allocationBasis: '', ...values };
}
/** A container whose totals are the server's: forecast = paid + open − credit, variance = forecast − afspraak. */
function container(id: number, streams: PurchaseReconciliationStream[], options: {
  alias?: string | null; status?: PurchaseOrderView['order']['status']; finalized?: boolean; creditEur?: number;
  instalments?: PurchaseInstalmentReconciliation[]; lines?: PurchaseReconciliationLine[];
} = {}): PurchaseOrderView {
  const sum = (pick: (item: PurchaseReconciliationStream) => number) => streams.reduce((total, item) => total + pick(item), 0);
  const credit = options.creditEur ?? 0;
  const planned = sum((item) => item.plannedEur);
  const forecast = sum((item) => item.paidEur) + sum((item) => item.remainingEur) - credit;
  return {
    order: { id, number: `PO-2026-${id}`, alias: options.alias ?? null, status: options.status ?? 'ONTVANGEN', orderDate: `2026-0${id}-01` },
    costing: { totals: { totalEur: planned } },
    reconciliation: { streams, lines: options.lines ?? [], notes: [], supplierInstalments: options.instalments, totals: {
      plannedExternalEur: planned, paidEur: sum((item) => item.paidEur), remainingEur: sum((item) => item.remainingEur),
      forecastExternalEur: forecast, varianceEur: forecast - planned, internalMarkupEur: 0, plannedPricingEur: planned,
      forecastPricingEur: forecast, finalized: options.finalized ?? false, orderedQuantity: 0, receivedQuantity: 0, damagedQuantity: 0,
      usableQuantity: 0, unitCostQuantity: 0, unitCostBasis: 'USABLE_RECEIVED', forecastExternalUnitEur: null, forecastPricingUnitEur: null,
      receiptRecorded: true, legacyPaidTotalEur: null, supplierCreditEur: credit, productCount: 2, containerAverage: false,
    } },
  } as PurchaseOrderView;
}

/* "Rozen zomer": the deposit's surplus netted into the balance, a supplier credit, a settled saving, an extra payment and an open inspection. */
const roses = container(1, [
  stream({ payee: 'SUPPLIER', plannedEur: 10_000, paidEur: 6_000, remainingEur: 4_000, forecastEur: 9_500, varianceEur: -500, creditEur: 500, paymentCount: 3 }),
  stream({ payee: 'LOGISTICS', status: 'SETTLED_LOWER', plannedEur: 2_000, paidEur: 1_800, forecastEur: 1_800, varianceEur: -200,
    settledSavingEur: 200, explicitlySettled: true, finalized: true, paymentCount: 2 }),
  stream({ payee: 'SEPARATE', status: 'UNPAID', plannedEur: 500, remainingEur: 500, forecastEur: 500 }),
  stream({ payee: 'OTHER', status: 'ADDITIONAL', paidEur: 75, forecastEur: 75, varianceEur: 75, finalized: true, paymentCount: 1 }),
], { alias: 'Rozen zomer', creditEur: 500, instalments: [
  term({ label: '30% bij bestelling', plannedEur: 3_000, paidEur: 3_500, offsetEur: -500, finalized: true }),
  term({ due: 'BEFORE_DEPARTURE' as PurchaseInstalmentReconciliation['due'], label: '70% voor vertrek', plannedEur: 7_000, paidEur: 2_500, remainingEur: 4_000, offsetEur: 500 }),
], lines: [
  line({ productId: 11, productName: 'Rozen rood', unitCostQuantity: 400, forecastExternalEur: 7_875, forecastExternalUnitEur: 19.6875,
    forecastExternalPieceEur: 1.6406, salesUnit: 'DISPLAY', piecesPerUnit: 12, unitOther: 'rozen', pieceQuantity: 4_800 }),
  line({ productId: 12, productName: 'Vaas', unitCostQuantity: 600, forecastExternalEur: 2_400, forecastExternalUnitEur: 4 }),
  line({ productId: 12, productName: 'Vaas', unitCostQuantity: 400, forecastExternalEur: 1_600, forecastExternalUnitEur: 4 }),
] });
/* PO-2026-2 on the water: the supplier overpaid, transport open, an inspection paid without an afspraak (not one of the four parts). */
const lilies = container(2, [
  stream({ payee: 'SUPPLIER', status: 'OVERPAID', plannedEur: 5_000, paidEur: 5_100, forecastEur: 5_100, varianceEur: 100, overpaidEur: 100, paymentCount: 2 }),
  stream({ payee: 'LOGISTICS', status: 'UNPAID', plannedEur: 1_500, remainingEur: 1_500, forecastEur: 1_500 }),
  stream({ payee: 'SEPARATE', status: 'ADDITIONAL', paidEur: 40, forecastEur: 40, varianceEur: 40, paymentCount: 1 }),
], { status: 'ONDERWEG' });
/* Fully settled: out of the default filter, never in openCount. */
const settled = container(3, [
  stream({ payee: 'SUPPLIER', status: 'PAID', plannedEur: 4_000, paidEur: 4_000, forecastEur: 4_000, finalized: true, paymentCount: 2 }),
], { finalized: true });

const context = { scope: 'Nog niet volledig afgerekend · 2 containers', name: (view: PurchaseOrderView) => containerName(view.order) };
const rows = containerCostRows([roses, lilies, settled], 'open');
const total = containerCostTotals(rows);

/** Σ of the value column, null as 0, and what the dialog shows as the gap row (rule A.4). */
function check(view: DrillView, figure: number): { sum: number; gap: number } {
  assert.ok(view.valueKey, `${view.id} adds a column up`);
  assert.equal(view.total?.value, figure, `${view.id} totals the clicked figure`);
  assert.equal(view.columns.at(-1)?.key, view.valueKey, `${view.id}: the value is the last column`);
  assert.equal(view.columns.filter((column) => column.phone === 'title').length, 1, `${view.id}: one phone title`);
  const sum = Math.round(view.rows.reduce((acc, row) => acc + Number(row.cells[view.valueKey!] ?? 0), 0) * 100) / 100;
  return { sum, gap: Math.round((figure - sum) * 100) / 100 };
}

test('the totals carry the supplier credit, the payments and the containers with something open (D-C1, D-C2)', () => {
  assert.deepEqual(rows.map((row) => row.view.order.id), [2, 1], 'the default filter leaves the settled container out');
  assert.equal(total.supplierCreditEur, 500);
  assert.equal(total.paymentCount, 3 + 2 + 1 + 2 + 1);
  assert.equal(total.openCount, 2);
  const all = containerCostTotals(containerCostRows([roses, lilies, settled], 'active'));
  assert.equal(all.openCount, 2, 'a settled container has nothing open');
  assert.equal(all.provisionalCount, 2);
  assert.equal(all.paymentCount, 11);
  assert.equal(containerCostTotals([]).openCount, 0);
});

test('Afspraak per ontvanger adds up to the Afspraak tile; paid, open and forecast add up to theirs', () => {
  const view = costPayeesView(rows, total, context);
  assert.equal(view.id, 'cost.payees');
  assert.deepEqual(check(view, total.plannedEur), { sum: 19_000, gap: 0 });
  assert.deepEqual(view.rows.map((row) => row.cells['payee']),
    ['Leverancier', 'Douane & transport', 'Inspectie & andere kosten', 'Bijkomende kosten'], 'Afspraak descending, then the payee order');
  assert.deepEqual(view.rows.map((row) => row.cells['containers']), [2, 2, 2, 1]);
  const column = (key: string) => Math.round(view.rows.reduce((acc, row) => acc + Number(row.cells[key]), 0) * 100) / 100;
  assert.equal(column('paid'), total.paidEur);
  assert.equal(column('open'), total.remainingEur);
  assert.equal(column('forecast'), total.forecastEur, 'the supplier stream forecast already has the credit off');
  assert.deepEqual(view.columns.filter((col) => col.sum).map((col) => col.key), ['paid', 'open', 'forecast']);
  assert.deepEqual(view.sort, { key: 'planned', dir: 'desc' });
  assert.equal(costPayeesView([], containerCostTotals([]), context).rows.length, 0);
  assert.equal(costPayeesView([], containerCostTotals([]), context).empty, 'Geen afspraak voor deze containers.');
});

test('Nog te betalen lists each container and ontvanger, the supplier per term, and adds up to the tile', () => {
  const view = costOpenView(rows, total, context);
  assert.equal(view.id, 'cost.open');
  assert.deepEqual(check(view, total.remainingEur), { sum: 6_000, gap: 0 });
  assert.deepEqual(view.rows.map((row) => [row.cells['name'], row.cells['payee'], row.cells['term'], row.cells['open']]), [
    ['PO-2026-2', 'Douane & transport', null, 1_500],
    ['Rozen zomer', 'Leverancier', '70% voor vertrek', 4_000],
    ['Rozen zomer', 'Inspectie & andere kosten', null, 500],
  ], 'per container, the largest first; the netted deposit term is not open');
  assert.deepEqual(view.rows[1].link, { path: ['/purchasing', 1], query: { section: 'ledger' } });
  assert.deepEqual(view.sort, { key: 'name', dir: 'asc' });
  assert.equal(view.gapLabel, 'Verrekend met andere termijnen');
  /* An answer whose terms are not netted: the balance shows its own open amount, the netting is the gap row. */
  const raw = container(4, [stream({ payee: 'SUPPLIER', plannedEur: 10_000, paidEur: 6_000, remainingEur: 4_000, forecastEur: 10_000 })], {
    instalments: [term({ plannedEur: 3_000, paidEur: 3_500 }), term({ label: '70% voor vertrek', plannedEur: 7_000, paidEur: 2_500, remainingEur: 4_500 })] });
  const rawRows = containerCostRows([raw], 'open');
  const rawView = costOpenView(rawRows, containerCostTotals(rawRows), context);
  assert.deepEqual(check(rawView, 4_000), { sum: 4_500, gap: -500 });
  assert.equal(costOpenView(containerCostRows([settled], 'active'), containerCostTotals(containerCostRows([settled], 'active')), context).rows.length, 0);
});

test('the card lines add up to the net difference with Tegoed leverancier and Overig (D-C1, D-C4)', () => {
  const lines = varianceLines(total);
  assert.deepEqual(lines.map((item) => [item.id, item.amountEur, item.drill]), [
    ['overpaid', 100, 'overpaid'], ['saving', -200, 'saving'], ['additional', 75, 'additional'], ['credit', -500, 'credit'],
    ['other', 40, null],
  ]);
  assert.equal(lines.reduce((acc, item) => acc + item.amountEur, 0), total.varianceEur);
  assert.equal(total.varianceEur, -485);
  assert.deepEqual(lines.map((item) => item.label), ['Meer betaald op afgesproken kosten', 'Minder betaald na vereffening',
    'Extra uitgaven buiten de afspraak', 'Tegoed leverancier', 'Overig · afronding']);
  /* One container whose parts explain the net: no Overig; a zero part is no trigger. */
  const alone = varianceLines(containerCostTotals(containerCostRows([roses], 'open')));
  assert.deepEqual(alone.map((item) => item.id), ['overpaid', 'saving', 'additional', 'credit']);
  assert.equal(alone[0].drill, null, 'nothing overpaid: a plain line');
  assert.equal(alone.reduce((acc, item) => acc + item.amountEur, 0), -625);
  /* Less than € 0,50 off is rounding, not a line. */
  assert.equal(varianceLines({ ...total, varianceEur: -524.6, overpaidEur: 100, settledSavingEur: 200, additionalEur: 75, supplierCreditEur: 500 })
    .some((item) => item.id === 'other'), false);
});

test('each difference line opens its containers, which add up to the line', () => {
  const expect = { overpaid: [['PO-2026-2', 100]], saving: [['Rozen zomer', 200]], additional: [['Rozen zomer', 75]], credit: [['Rozen zomer', 500]] } as const;
  const figure = { overpaid: total.overpaidEur, saving: total.settledSavingEur, additional: total.additionalEur, credit: total.supplierCreditEur };
  for (const part of ['overpaid', 'saving', 'additional', 'credit'] as const) {
    const view = costVarianceView(part, rows, total, context);
    assert.equal(view.id, `cost.variance.${part}`);
    assert.deepEqual(check(view, figure[part]), { sum: figure[part], gap: 0 });
    assert.deepEqual(view.rows.map((row) => [row.cells['name'], row.cells['amount']]), expect[part]);
    assert.deepEqual(view.rows[0].link, { path: ['/purchasing', view.rows[0].key === '1' ? 1 : 2], query: { section: 'payment-result' } });
    assert.equal(view.rows[0].cells['state'], 'Voorlopig');
  }
  assert.equal(costVarianceView('credit', rows, total, context).title, 'Tegoed leverancier');
  const two = containerCostRows([roses, container(5, [stream({ payee: 'OTHER', paidEur: 300, forecastEur: 300, varianceEur: 300 })])], 'open');
  const view = costVarianceView('additional', two, containerCostTotals(two), context);
  assert.deepEqual(view.rows.map((row) => row.cells['amount']), [300, 75], 'the largest first');
  assert.equal(costVarianceView('overpaid', containerCostRows([roses], 'open'), total, context).empty, 'Geen containers met dit verschil.');
});

test('Per eenheid opens the products in their own unit, adding up to the container cost', () => {
  const row = rows.find((item) => item.view.order.id === 1)!;
  const mix = nacalcUnitMix(row.reconciliation);
  assert.equal(mix.uniform, false);
  const view = costUnitView(row, mix, 'Rozen zomer');
  assert.equal(view.id, 'cost.unit.1');
  assert.deepEqual(check(view, row.reconciliation.totals.forecastExternalEur), { sum: 11_875, gap: 0 });
  assert.deepEqual(view.rows.map((item) => [item.cells['product'], item.cells['unit'], item.cells['unitEur'], item.cells['pieceEur'], item.cells['qty']]), [
    ['Rozen rood', 'display · 12 rozen', 19.6875, 1.6406, 400],
    ['Vaas', 'stuk', 4, 4, 1_000],
  ], 'two lines of one product count once, with their quantities');
  assert.deepEqual(view.rows[0].link, { path: ['/products', 11] });
  assert.equal(view.scope, 'Rozen zomer · verwachte kost per bruikbare eenheid');
  assert.equal(view.gapLabel, 'Niet per product verdeeld');
  assert.deepEqual(view.sort, { key: 'value', dir: 'desc' });
  /* What the server could not spread over products shows as the gap, never a silent mismatch. */
  const short = { ...row, reconciliation: { ...row.reconciliation, lines: row.reconciliation.lines.slice(1) } };
  assert.deepEqual(check(costUnitView(short, nacalcUnitMix(short.reconciliation), 'Rozen zomer'), 11_875), { sum: 4_000, gap: 7_875 });
});

test('Containerkost: default filter, tiles and the merged card as the design names them (D-C2, D-C3, D-C4)', async () => {
  const source = await readFile(new URL('../src/app/features/analyses/container-cost-analysis.ts', import.meta.url), 'utf8');
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1] ?? '';
  assert.ok(template.length > 1000, 'the template is found');
  assert.match(source, /readonly filter = signal<ContainerCostFilter>\('open'\)/);
  assert.match(source, /\{ id: 'open', label: 'Nog niet volledig afgerekend' \}, \{ id: 'active', label: 'Alle containers' \}/);
  assert.match(source, /\{ id: 'all', label: 'Alle containers · ook concepten' \}/);
  assert.match(template, /<span class="an-kpi__label">Afspraak<\/span>/);
  assert.match(template, /externe kost · \{\{ plural\(rows\(\)\.length, 'container', 'containers'\) \}\}/);
  assert.match(template, /\{\{ plural\(total\.paymentCount, 'betaling', 'betalingen'\) \}\}/);
  assert.match(template, /op \{\{ plural\(total\.openCount, 'container', 'containers'\) \}\}/);
  assert.equal(template.match(/class="an-kpi an-kpi--drill" aria-haspopup="dialog"/g)?.length, 2, 'Afspraak and Nog te betalen');
  assert.match(template, /@if \(isZero\(total\.plannedEur\)\)/, 'a zero figure is no trigger');
  assert.equal(template.match(/id="cc-diff-title">Verschil met de afspraak</g)?.length, 1, 'one card');
  assert.doesNotMatch(template, /Extra opbrengst uit betalingen|ENROSED|<details|Interne Enrosed opslag/);
  assert.match(template, /Enrosed-kost \{\{ payment\.internalMarkupEur/);
  assert.match(template, /class="wk-link cc-range" aria-haspopup="dialog" \(click\)="openUnit\(row\)"/);
  assert.match(template, /@if \(!isZero\(row\.reconciliation\.totals\.varianceEur\)\)/, 'the phone meta only when not 0');
  assert.match(source, /private readonly drill = inject\(AnDrillHost\)/);
});

test('the drill module only imports types (node-tested, no runtime imports)', async () => {
  const source = await readFile(new URL('../src/app/features/analyses/drill-container-cost.ts', import.meta.url), 'utf8');
  const imports = source.match(/^import .*$/gm) ?? [];
  assert.ok(imports.length > 0);
  for (const line of imports) assert.match(line, /^import type /);
});
