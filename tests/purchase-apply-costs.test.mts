import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import type { LandedCostLine, Product, PurchaseOrder, PurchaseOrderView, UnitName } from '../src/app/core/api/models.ts';
import * as units from '../src/app/features/products/product-sales-unit.ts';
import * as containers from '../src/app/features/purchasing/container-name.ts';
import * as geo from '../src/app/core/api/geo.ts';

// purchase-apply-costs and product-cost-basis import their siblings without an
// extension, which node cannot resolve; run them through the TypeScript
// transpiler with the real modules, like inventory-unit.test.mts.
async function load(path: string, modules: Record<string, unknown>): Promise<Record<string, any>> {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const loaded = { exports: {} as Record<string, any> };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: loaded, exports: loaded.exports, require: (id: string) => modules[id] });
  return loaded.exports;
}
const basisModule = await load('../src/app/features/products/product-cost-basis.ts', { './product-sales-unit': units });
const deskFormat = await load('../src/app/features/purchasing/purchase-desk-format.ts', { '../../core/api/geo': geo });
const applyModule = await load('../src/app/features/purchasing/purchase-apply-costs.ts', {
  '../products/product-cost-basis': basisModule, './container-name': containers, './purchase-desk-format': deskFormat,
});
const apply: typeof import('../src/app/features/purchasing/purchase-apply-costs.ts') = applyModule as any;
/** The modules run in their own realm; compare their objects as plain data. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

units.rememberUnitNames([
  { key: 'stuk', one: 'stuk', other: 'stuks', per: 'per stuk', short: 'st.' },
  { key: 'roos', one: 'roos', other: 'rozen', per: 'per roos', short: 'rozen' },
  { key: 'diamant', one: 'diamant', other: 'diamanten', per: 'per diamant', short: 'diamanten' },
  { key: 'bowl', one: 'bowl', other: 'bowls', per: 'per bowl', short: 'bowls' },
] satisfies UnitName[]);

const ORDER = { id: 14, number: 'PO-2026-014', alias: 'container/2026/014' };

function product(id: number, name: string, landedCostEur: number | null, landedCostSource: string | null,
  packaging: Partial<Product['packaging']> = {}): Product {
  return { id, name, landedCostEur, landedCostSource, packaging: {
    kind: 'NONE', dimensions: { lengthCm: null, widthCm: null, heightCm: null, weightKg: null }, barcode: null,
    piecesPerUnit: null, salesUnit: 'PIECE', unitKey: 'stuk', ...packaging } } as unknown as Product;
}
function line(productId: number, quantity: number, landedUnitEur: number, productName = `Product ${productId}`): LandedCostLine {
  return { productId, productName, quantity, landedUnitEur } as LandedCostLine;
}

const PRODUCTS = [
  product(301, 'Long stem rose box display', 31.2, 'PO-2026-011', { kind: 'DISPLAY', piecesPerUnit: 12, salesUnit: 'DISPLAY', unitKey: 'roos' }),
  product(302, 'Rozenschaal', 8.87, 'PO-2026-014'),
  product(303, 'Diamantroos met display - Red', 0.56, 'PO-2026-002', { kind: 'DISPLAY', piecesPerUnit: 12, salesUnit: 'PIECE', unitKey: 'diamant' }),
  product(304, 'Nieuwe stolp', null, null),
  product(305, 'Hart in doos', 4.1, 'PO-2026-011'),
  product(306, 'Bowl rood', 3.1, null, { unitKey: 'bowl' }),
];
const LINES = [
  line(301, 500, 31.5), line(302, 2000, 8.87004), line(303, 2400, 0.56), line(304, 120, 6.25), line(305, 0, 0), line(306, 300, 2.95),
];

/* ---- the rows --------------------------------------------------------- */

test('each product shows its cost now with the source, the new cost and the difference', () => {
  const plan = apply.applyCostsPlan(ORDER, LINES, PRODUCTS);
  assert.deepEqual(plain(plan.rows.map((row) => row.state)), ['up', 'unchanged', 'same', 'new', 'skipped', 'down']);
  const [roses, bowl, diamant, stolp, heart, red] = plan.rows;
  assert.equal(roses.currentSource, 'PO-2026-011');
  assert.equal(roses.deltaEur, 0.3);
  assert.equal(roses.deltaPct, 1);
  assert.equal(roses.per, 'per display van 12');
  assert.equal(roses.quantity, '500 displays');
  assert.deepEqual(plain(roses.other), { sign: '=', price: 2.625, per: 'per roos' });
  /* Applied from this very container: its Herkenbare naam, and equal at 4 decimals is no change. */
  assert.equal(bowl.currentSource, 'container/2026/014');
  assert.equal(bowl.deltaEur, 0);
  assert.equal(bowl.per, 'per stuk');
  assert.equal(diamant.per, 'per diamant');
  assert.equal(diamant.quantity, '2.400 diamanten');
  assert.deepEqual(plain(diamant.other), { sign: '=', price: 6.72, per: 'per display van 12' });
  assert.equal(stolp.currentEur, null);
  assert.equal(stolp.currentSource, null);
  assert.equal(stolp.deltaPct, null);
  assert.equal(heart.quantity, '0 stuks');
  assert.equal(heart.currentEur, 4.1);
  assert.equal(red.currentSource, 'handmatig');
  assert.equal(red.deltaEur, -0.15);
  assert.equal(red.deltaPct, -4.8);
  assert.equal(red.quantity, '300 bowls');
  for (const row of plan.rows) assert.doesNotMatch(`${row.per} ${row.quantity} ${row.other?.per ?? ''}`, /\bset\b/);
});

test('the counts: written leaves out what received nothing; equal costs count as unchanged', () => {
  const plan = apply.applyCostsPlan(ORDER, LINES, PRODUCTS);
  assert.equal(plan.again, true, 'Rozenschaal carries this container already');
  assert.deepEqual([plan.written, plan.changed, plan.unchanged, plan.skipped], [5, 3, 2, 1]);
  assert.equal(apply.applyCostsButton(plan), 'Opnieuw toepassen (5 producten)');
  assert.equal(apply.applyCostsToast(plan), 'Kostprijs van 3 producten gewijzigd, 2 ongewijzigd · 1 overgeslagen (niets ontvangen)');
  const first = apply.applyCostsPlan(ORDER, [line(301, 500, 31.5)], PRODUCTS);
  assert.equal(first.again, false);
  assert.equal(apply.applyCostsButton(first), 'Toepassen (1 product)');
  assert.equal(apply.applyCostsToast(first), 'Kostprijs van 1 product gewijzigd');
  const nothing = apply.applyCostsPlan(ORDER, [line(302, 2000, 8.87)], PRODUCTS);
  assert.equal(apply.applyCostsToast(nothing), 'Geen kostprijs gewijzigd');
  assert.equal(apply.applyCostsToast({ changed: 0, unchanged: 0, skipped: 2 }), 'Geen kostprijs gewijzigd · 2 overgeslagen (niets ontvangen)');
  assert.equal(apply.productCount(1), '1 product');
  assert.equal(apply.productCount(1200), '1.200 producten');
});

test('equality holds at 4 decimals; a cost of 0 before has no percentage; an unknown product is not called new', () => {
  const tiny = apply.applyCostRow(ORDER, line(302, 10, 8.8701), PRODUCTS[1]);
  assert.equal(tiny.state, 'up');
  assert.equal(tiny.deltaEur, 0.0001);
  const zero = apply.applyCostRow(ORDER, line(302, 10, 1.5), { ...PRODUCTS[1], landedCostEur: 0 });
  assert.equal(zero.state, 'up');
  assert.equal(zero.deltaPct, null);
  const unknown = apply.applyCostRow(ORDER, line(999, 10, 1.5, 'Ander product'), null);
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.name, 'Ander product');
  /* Its unit is not known either: no "per stuk" for what may be a display. */
  assert.deepEqual([unknown.quantity, unknown.per, unknown.other], ['Aantal 10', null, null]);
  assert.equal(apply.applyCostRow(ORDER, line(999, 1200, 1.5), null).quantity, 'Aantal 1.200');
  const plan = apply.applyCostsPlan(ORDER, [line(999, 10, 1.5)], PRODUCTS);
  assert.deepEqual([plan.written, plan.changed], [1, 1]);
  /* Without a Herkenbare naam the PO number names the container. */
  const own = apply.applyCostRow({ ...ORDER, alias: null }, line(302, 10, 9), PRODUCTS[1]);
  assert.equal(own.currentSource, 'PO-2026-014');
});

test('colour variants of one series read apart: the series name, then colour and size', () => {
  const rood = { ...product(311, 'Diamantroos met display en geur', 0.56, 'PO-2026-002'), colour: 'Rood', variantSize: null };
  const wit = { ...product(312, 'Diamantroos met display en geur', 0.56, 'PO-2026-002'), colour: 'Wit', variantSize: '30 cm' };
  /* A name that still carries its colour says it once. */
  const roze = { ...product(313, 'Diamantroos met display en geur - Roze', 0.56, 'PO-2026-002'), colour: 'Roze', variantSize: null };
  const plan = apply.applyCostsPlan(ORDER, [
    line(311, 100, 0.6, 'Diamantroos met display en geur - Rood'), line(312, 100, 0.6, 'Diamantroos met display en geur - Wit'),
    line(313, 100, 0.6, 'Diamantroos met display en geur - Roze'), line(999, 10, 1.5, 'Ander product - Blauw'),
  ], [rood, wit, roze]);
  assert.deepEqual(plain(plan.rows.map((row) => [row.name, row.variant])), [
    ['Diamantroos met display en geur', 'Rood'],
    ['Diamantroos met display en geur', 'Wit · 30 cm'],
    ['Diamantroos met display en geur', 'Roze'],
    ['Ander product - Blauw', null],
  ]);
  assert.deepEqual(plain(plan.rows.map((row) => row.label)), [
    'Diamantroos met display en geur · Rood', 'Diamantroos met display en geur · Wit · 30 cm',
    'Diamantroos met display en geur · Roze', 'Ander product - Blauw',
  ]);
  assert.equal(new Set(plan.rows.map((row) => row.label)).size, plan.rows.length, 'no two rows read alike');
});

test('a line the supplier list lacks is named for fetching, each product once', () => {
  assert.deepEqual(plain(apply.missingProductIds([line(301, 1, 1), line(309, 100, 31), line(310, 0, 0), line(309, 5, 31)], PRODUCTS)), [309, 310]);
  assert.deepEqual(plain(apply.missingProductIds(LINES, PRODUCTS)), []);
  assert.deepEqual(plain(apply.missingProductIds([], [])), []);
});

/* ---- the editor: the real members, transport and toasts mocked -------- */

/** The class as plain JavaScript, decorator and imports dropped; `names` keeps only those members. */
function isolatedClass(text: string, file: string, className: string, names: ReadonlySet<string>): string {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className);
  assert.ok(original, className);
  const members = original.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
  assert.equal(members.length, names.size, className);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
    original.name, original.typeParameters, undefined, members);
  return ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

const editorSource = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const editorJavascript = isolatedClass(editorSource, 'purchase-editor.ts', 'PurchaseEditor', new Set(['applyFor', 'applyBusy',
  'applyOtherProducts', 'applyPlan', 'apply', 'closeApply', 'confirmApply', 'reloadOrderQuietly', 'preview', 'save', 'savedOrder', 'saving', 'deletingOrder',
  'dirty', 'previewTimer', 'previewVersion', 'paymentPlanBusy', 'payingBusy', 'adjustments', 'products', 'load']));

function view(order: Partial<PurchaseOrder> = {}): PurchaseOrderView {
  return { order: { id: 14, number: 'PO-2026-014', alias: 'container/2026/014', supplierId: 7, status: 'ONTVANGEN', notes: '', ...order },
    costing: { lines: LINES }, adjustments: [] } as unknown as PurchaseOrderView;
}

function setup(start = view()) {
  const calls: string[] = [];
  const toasts: [string, string | undefined][] = [];
  let failApply: Error | null = null;
  let failSave = false;
  let catalogue = PRODUCTS;
  /* Products of other suppliers, only reachable by id. */
  const elsewhere = new Map<number, Product>();
  let releaseApply: (() => void) | null = null;
  let routeId = start.order.id;
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(editorJavascript, { exports, signal, computed, clearTimeout, applyCostsPlan: apply.applyCostsPlan,
    applyCostsToast: apply.applyCostsToast, missingProductIds: apply.missingProductIds,
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback });
  const editor = new exports['PurchaseEditor']();
  Object.assign(editor, {
    view: signal(start),
    /* What load() touches besides the order: the route id and the side panels, all quiet here. */
    id: () => String(routeId),
    documents: signal(null), paymentStateError: signal(null), paymentStateLoading: signal(false), payments: signal(null),
    families: signal([]), categories: signal([]), freightRates: signal([]), stockLocations: signal([]), supplier: signal(null),
    loadPayments: async () => {}, loadDocuments: async () => {}, loadBankLines: async () => {}, loadPartnerDocs: async () => {},
    negativeExtra: () => false,
    ui: { toast: (text: string, kind?: string) => toasts.push([text, kind]) },
    sourcing: {
      updatePurchaseOrder: async (_id: number, order: PurchaseOrder) => {
        calls.push('save');
        if (failSave) throw new Error('Opslaan mislukt');
        return view(order);
      },
      applyLandedCosts: async () => {
        calls.push('apply');
        if (releaseApply === null) await new Promise<void>((resolve) => { releaseApply = resolve; });
        if (failApply) throw failApply;
        catalogue = PRODUCTS.map((p) => ({ ...p, landedCostSource: 'PO-2026-014' }));
        return { lines: [] };
      },
      purchaseOrder: async (id: number) => {
        calls.push('reload');
        return view(id === 14 ? {} : { id, number: `PO-2026-0${id}`, alias: null });
      },
      suppliers: async () => [],
      freightRates: async () => [],
    },
    catalog: {
      products: async () => { calls.push('products'); return catalogue; },
      product: async (id: number) => {
        calls.push(`product ${id}`);
        const found = elsewhere.get(id);
        if (!found) throw new Error('Niet gevonden');
        return found;
      },
      unitNames: async () => { calls.push('unit-names'); return []; },
      productFamilies: async () => [],
      categories: async () => [],
      stockLocations: async () => [],
    },
  });
  editor.savedOrder.set(JSON.stringify(start.order));
  return { editor, calls, toasts, elsewhere,
    failNextApply: (error: Error) => { failApply = error; },
    failNextSave: () => { failSave = true; },
    routeTo: (id: number) => { routeId = id; },
    release: () => { const go = releaseApply; releaseApply = () => {}; go?.(); } };
}

test('the button opens the sheet first; confirming applies once and toasts the counts the sheet showed', async () => {
  const { editor, calls, toasts, release } = setup();
  await editor.apply();
  assert.ok(editor.applyPlan(), 'the sheet is open');
  assert.deepEqual(calls, ['unit-names', 'products'], 'nothing is applied by opening; the products are fetched again');
  assert.equal(editor.applyPlan().written, 5);
  const confirming = editor.confirmApply();
  assert.equal(editor.applyBusy(), true);
  await editor.confirmApply();
  release();
  await confirming;
  assert.equal(calls.filter((call) => call === 'apply').length, 1, 'a second click while busy applies nothing');
  assert.equal(editor.applyPlan(), null, 'the sheet closes');
  assert.deepEqual(toasts, [['Kostprijs van 3 producten gewijzigd, 2 ongewijzigd · 1 overgeslagen (niets ontvangen)', undefined]]);
  assert.deepEqual(calls.slice(-2), ['products', 'reload']);
});

test('a line kept from another supplier gets its product by id: its cost now, its unit and its history', async () => {
  /* Product 309 of the screen check: a display of 12 roses sold per display, supplier 8, on PO-2026-014 of supplier 7. */
  const display = product(309, 'Long stem rose box display', 31.2, 'PO-2026-014',
    { kind: 'DISPLAY', piecesPerUnit: 12, salesUnit: 'DISPLAY', unitKey: 'roos' });
  const lines = [...LINES, line(309, 100, 31)];
  const withLine = () => ({ ...view(), costing: { lines } } as unknown as PurchaseOrderView);
  const { editor, calls, toasts, elsewhere, release } = setup(withLine());
  elsewhere.set(309, display);
  await editor.apply();
  assert.deepEqual(calls, ['unit-names', 'products', 'product 309'], 'only the product the supplier list lacks is fetched');
  const row = editor.applyPlan().rows.at(-1);
  assert.equal(row.state, 'down');
  assert.deepEqual([row.quantity, row.per, row.currentEur, row.currentSource], ['100 displays', 'per display van 12', 31.2, 'container/2026/014']);
  assert.equal(row.product.id, 309, 'its history opens from the sheet');
  const confirming = editor.confirmApply();
  release();
  await confirming;
  assert.deepEqual(toasts, [['Kostprijs van 4 producten gewijzigd, 2 ongewijzigd · 1 overgeslagen (niets ontvangen)', undefined]]);
  /* Opening again fetches it again, never keeps a stale copy. */
  editor.view.set(withLine());
  await editor.apply();
  assert.equal(calls.filter((call) => call === 'product 309').length, 2);
});

test('a product that cannot be fetched stays unknown, without basis words', async () => {
  const lines = [...LINES, line(309, 100, 31, 'Long stem rose box display - Wit')];
  const { editor, calls } = setup({ ...view(), costing: { lines } } as unknown as PurchaseOrderView);
  await editor.apply();
  assert.equal(calls.at(-1), 'product 309');
  const row = editor.applyPlan().rows.at(-1);
  assert.deepEqual([row.state, row.quantity, row.per, row.product], ['unknown', 'Aantal 100', null, null]);
  /* Nothing missing, nothing fetched. */
  const other = setup();
  other.elsewhere.set(309, product(309, 'Long stem rose box display', 31.2, null));
  await other.editor.apply();
  assert.deepEqual(other.calls, ['unit-names', 'products']);
  assert.deepEqual(plain(other.editor.applyOtherProducts()), []);
});

test('unsaved edits are saved before the sheet opens; a failed save opens nothing', async () => {
  const dirty = setup();
  dirty.editor.view.set(view({ notes: 'gewijzigd' }));
  await dirty.editor.apply();
  assert.equal(dirty.calls[0], 'save');
  assert.ok(dirty.editor.applyPlan());
  const refused = setup();
  refused.failNextSave();
  refused.editor.view.set(view({ notes: 'gewijzigd' }));
  await refused.editor.apply();
  assert.equal(refused.editor.applyPlan(), null);
  assert.deepEqual(refused.calls, ['save']);
});

test('a failed apply keeps the sheet open and says so; closing waits while busy', async () => {
  const { editor, toasts, failNextApply, release } = setup();
  await editor.apply();
  failNextApply(new Error('Kostprijzen toepassen mislukt: server weg'));
  const confirming = editor.confirmApply();
  editor.closeApply();
  assert.ok(editor.applyPlan(), 'busy: the sheet stays');
  release();
  await confirming;
  assert.ok(editor.applyPlan(), 'the sheet stays open after a failure');
  assert.deepEqual(toasts, [['Kostprijzen toepassen mislukt: server weg', 'err']]);
  assert.equal(editor.applyBusy(), false);
  editor.closeApply();
  assert.equal(editor.applyPlan(), null);
});

test('the sheet belongs to the order it was opened for: moving to another order never reopens it there', async () => {
  const { editor, routeTo } = setup();
  await editor.apply();
  assert.ok(editor.applyPlan(), 'the sheet is open');
  /* The desk keeps the screen and loads the other order: a container link in the history, or Back. */
  routeTo(15);
  await editor.load(15);
  assert.equal(editor.view().order.id, 15);
  assert.equal(editor.applyPlan(), null, 'no sheet for a container nobody chose to apply');
  routeTo(14);
  await editor.load(14);
  assert.equal(editor.applyPlan(), null, 'nor on the way back');
  /* Another order in view without a load: still no sheet for it. */
  await editor.apply();
  assert.ok(editor.applyPlan());
  editor.view.set(view({ id: 16, number: 'PO-2026-016', alias: null }));
  assert.equal(editor.applyPlan(), null);
  /* Reloading the same order keeps the sheet. */
  editor.view.set(view());
  assert.ok(editor.applyPlan());
  await editor.load(14);
  assert.ok(editor.applyPlan(), 'a reload of the same order keeps it open');
});

/* ---- the templates: one host each, the sheet parses ------------------ */

test('desk and phone open the sheet from their apply buttons and host it once', async () => {
  const desk = await readFile(new URL('../src/app/features/purchasing/purchase-desk.ts', import.meta.url), 'utf8');
  for (const [name, text] of [['phone', editorSource], ['desk', desk]] as const) {
    assert.equal(text.match(/<app-purchase-apply-costs-sheet /g)?.length, 1, name);
    assert.match(text, /@if \(applyPlan\(\); as plan\) \{\s*<app-purchase-apply-costs-sheet \[plan\]="plan" \[orderId\]="data\.order\.id" \[busy\]="applyBusy\(\)"\s+\(confirm\)="confirmApply\(\)" \(cancel\)="closeApply\(\)" \/>/, name);
    assert.equal(text.match(/\(click\)="apply\(\)"/g)?.length, 1, name);
  }
  assert.doesNotMatch(editorSource, /ui\.confirm\(\s*\{\s*title: again/, 'the generic confirm is gone');
  assert.match(desk, /Zet de gelande kost per display of per stuk op de productkaarten\./);
});

test('the sheet parses, keeps the old sentence and the wording rules', async () => {
  const sheet = await readFile(new URL('../src/app/features/purchasing/purchase-apply-costs-sheet.ts', import.meta.url), 'utf8');
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(sheet)?.[1] ?? '';
  assert.equal(parseTemplate(template, 'purchase-apply-costs-sheet.html').errors, null);
  assert.match(template, /p\.again \? 'Opnieuw kostprijzen toepassen' : 'Kostprijzen toepassen'/);
  assert.match(template.replace(/\s+/g, ' '), /De berekende kostprijs \(per display of per stuk, zoals het product verkocht wordt\) wordt op de producten in de catalogus gezet en overschrijft wat daar staat\. Alle marges op verkooporders rekenen vanaf dan met deze cijfers\./);
  assert.match(template, />Annuleren</);
  assert.match(template, /Historiek ›/);
  /* A product the screen could not load: no history button, its width kept, and no basis words. */
  assert.match(template, /\} @else \{\s*<span class="linklike ac-row__history ac-row__history--none" aria-hidden="true">Historiek ›<\/span>/);
  assert.match(template, /\{\{ row\.quantity \}\}@if \(row\.per\) \{ · kostprijs \{\{ row\.per \}\}\}/);
  assert.match(sheet, /\.ac-row__history--none \{ visibility: hidden; \}/);
  /* Every Historiek button says whose history it opens, with the variant. */
  assert.match(template, /\[attr\.aria-label\]="'Kostprijshistoriek van ' \+ row\.label"/);
  assert.match(template, /\{\{ row\.name \}\}@if \(row\.variant\) \{<span class="ac-row__variant"> · \{\{ row\.variant \}\}<\/span>\}/);
  assert.match(template, /geen wijziging/);
  assert.match(template, /niets ontvangen · blijft/);
  assert.match(template, /<app-product-cost-history-sheet \[product\]="product" \[currentOrderId\]="orderId\(\)"/);
  /* The words on screen: tags, bindings and control flow stripped. */
  const words = template.replace(/<[^>]*>/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ').replace(/@\w+[^{]*\{/g, ' ');
  assert.doesNotMatch(words, /\bset\b|begroot|\bst\b/i);
});
