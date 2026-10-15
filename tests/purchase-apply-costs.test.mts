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
const applyModule = await load('../src/app/features/purchasing/purchase-apply-costs.ts', {
  '../products/product-cost-basis': basisModule, './container-name': containers,
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
  const plan = apply.applyCostsPlan(ORDER, [line(999, 10, 1.5)], PRODUCTS);
  assert.deepEqual([plan.written, plan.changed], [1, 1]);
  /* Without a Herkenbare naam the PO number names the container. */
  const own = apply.applyCostRow({ ...ORDER, alias: null }, line(302, 10, 9), PRODUCTS[1]);
  assert.equal(own.currentSource, 'PO-2026-014');
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
const editorJavascript = isolatedClass(editorSource, 'purchase-editor.ts', 'PurchaseEditor', new Set(['applyOpen', 'applyBusy',
  'applyPlan', 'apply', 'closeApply', 'confirmApply', 'reloadOrderQuietly', 'preview', 'save', 'savedOrder', 'saving', 'deletingOrder',
  'dirty', 'previewTimer', 'previewVersion', 'paymentPlanBusy', 'payingBusy', 'adjustments', 'products']));

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
  let releaseApply: (() => void) | null = null;
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(editorJavascript, { exports, signal, computed, clearTimeout, applyCostsPlan: apply.applyCostsPlan,
    applyCostsToast: apply.applyCostsToast,
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback });
  const editor = new exports['PurchaseEditor']();
  Object.assign(editor, {
    view: signal(start),
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
      purchaseOrder: async () => { calls.push('reload'); return view(); },
    },
    catalog: {
      products: async () => { calls.push('products'); return catalogue; },
      unitNames: async () => { calls.push('unit-names'); return []; },
    },
  });
  editor.savedOrder.set(JSON.stringify(start.order));
  return { editor, calls, toasts,
    failNextApply: (error: Error) => { failApply = error; },
    failNextSave: () => { failSave = true; },
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
  assert.match(template, /geen wijziging/);
  assert.match(template, /niets ontvangen · blijft/);
  assert.match(template, /<app-product-cost-history-sheet \[product\]="product" \[currentOrderId\]="orderId\(\)"/);
  /* The words on screen: tags, bindings and control flow stripped. */
  const words = template.replace(/<[^>]*>/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ').replace(/@\w+[^{]*\{/g, ' ');
  assert.doesNotMatch(words, /\bset\b|begroot|\bst\b/i);
});
