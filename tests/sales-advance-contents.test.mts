import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { isAdvanceDocument } from '../src/app/features/sales/sales-payment-state.ts';
import { salesLineUnavailable, salesAllProductsUnavailable } from '../src/app/features/sales/sales-line-availability.ts';

// Run production projection helpers without Angular or any API capability.
const source = await readFile(new URL('../src/app/features/sales/sales-advance-contents-state.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('state.ts', source, ts.ScriptTarget.Latest, true);
const executable = ts.factory.updateSourceFile(parsed, parsed.statements.filter(node => !ts.isImportDeclaration(node)));
const javascript = ts.transpileModule(ts.createPrinter().printFile(executable), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports: Record<string, any> = {};
vm.runInNewContext(javascript, { exports, isAdvanceDocument, Intl });
const { isAdvanceInvoice, advanceContentsFor, advanceContentsSummary, advanceProductPhoto, advancePlanningHint } = exports;

function fixture() {
  return {
    order: { id: 57, docType: 'FACTUUR', purpose: 'PARTNER_ADVANCE', partnerPurchaseOrderId: 50,
      lines: [], extraLines: [{ description: '1/3 bij productie', quantity: 1, unitPriceEur: 24644.58 }] },
    priced: { lines: [], totals: { pieces: 0, cartons: 0, cbm: 0, palletsStrict: 1, total: 24644.58 } },
    advanceContents: {
      purchaseOrderId: 50, purchaseOrderNumber: 'PO-2026-050', sourceQuoteId: null,
      lines: [
        { productId: 2, sku: 'ROSE-RED', productName: 'Rode roos', quantity: 480, cartons: 20, cbm: 1.25, weightKg: 60 },
        { productId: 3, sku: 'ROSE-WHITE', productName: 'Witte roos', quantity: 240, cartons: 10, cbm: .625, weightKg: 30 },
      ],
      totals: { pieces: 720, cartons: 30, cbm: 1.875, weightKg: 90, pallets: null },
      delivery: { destinationCountry: 'NL', departurePort: 'Ningbo', destinationPort: 'Rotterdam',
        loadMode: null, containerType: '40HC', expectedArrival: '2026-11-16', shippedOn: null,
        receivedOn: null, deliveryWeek: '2026-W47' }, capturedAt: '2026-09-10T10:00:00Z',
    },
  };
}

test('advance physical summary uses frozen full-container contents while its monetary claim remains unchanged', () => {
  const view = fixture(), before = JSON.stringify(view);
  assert.equal(isAdvanceInvoice(view), true);
  assert.equal(advanceContentsFor(view), view.advanceContents);
  const summary = advanceContentsSummary(view);
  assert.equal(summary.lines, 2);
  assert.equal(summary.productLines, '2 regels');
  assert.equal(summary.pieces, '720 stuks');
  assert.equal(summary.load, '30 dozen');
  assert.equal(summary.volume, '1,875 m³');
  assert.equal(JSON.stringify(view), before, 'No monetary or physical fields are edited to obtain the display');
  assert.equal(view.priced.totals.total, 24644.58);
  assert.equal(view.priced.totals.palletsStrict, 1, 'The misleading priced fallback is ignored, not rewritten');
});

test('100 percent and final production terms show the same complete contents, never prorated by the claim', () => {
  for (const [description, amount] of [['100% voorschot', 73933.75], ['2/3 na productie', 49289.17]] as const) {
    const view = fixture();
    view.order.extraLines = [{ description, quantity: 1, unitPriceEur: amount }];
    view.priced.totals.total = amount;
    assert.equal(isAdvanceInvoice(view), true);
    assert.equal(advanceContentsSummary(view).pieces, '720 stuks');
    assert.equal(view.priced.totals.total, amount);
  }
});

test('unknown packing/transport and missing or mismatched snapshots never become zero or automatic pallets', () => {
  const view: any = fixture();
  view.advanceContents.totals = { pieces: 720, cartons: null, cbm: null, weightKg: null, pallets: null };
  assert.equal(advanceContentsSummary(view).load, 'Nog te bevestigen');
  assert.equal(advanceContentsSummary(view).volume, 'Volume nog te bevestigen');
  view.advanceContents.purchaseOrderId = 99;
  assert.equal(advanceContentsFor(view), null, 'A response belonging to another container cannot supply quantities');
  assert.equal(advanceContentsSummary(view).lines, null);
  view.advanceContents = null;
  assert.equal(advanceContentsSummary(view).pieces, 'Inhoud nog niet beschikbaar');
});

test('ordinary sales, quotes and actual auction settlements retain their existing priced content workflow', () => {
  for (const change of [{ purpose: 'STANDARD' }, { docType: 'OFFERTE' }, { purpose: 'PARTNER_SETTLEMENT' }]) {
    const view = fixture(); Object.assign(view.order, change);
    assert.equal(isAdvanceInvoice(view), false);
    assert.equal(advanceContentsFor(view), null);
  }
});

test('authentic catalog photos are matched only by product id, without replacing snapshot name, quantity or price', () => {
  const view = fixture();
  const photos = [{ position: 2, url: '/api/products/2/photos/22' }, { position: 0, url: '/api/products/2/photos/20' }];
  const products = [{ id: 2, name: 'Later changed catalog name', quantity: 9999, price: 999, photos }];
  const before = JSON.stringify(products);
  assert.equal(advanceProductPhoto(products, 2), '/api/products/2/photos/20');
  assert.equal(advanceProductPhoto(products, 3), null, 'Never substitute a different product photo');
  assert.equal(advanceContentsFor(view).lines[0].quantity, 480);
  assert.equal(advanceContentsFor(view).lines[0].productName, 'Rode roos');
  assert.equal(JSON.stringify(products), before, 'Selecting the lead photo does not reorder catalog media');
});

async function screenMethods(file: string, className: string, names: string[]) {
  const source = await readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className);
  assert.ok(original);
  const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
  assert.equal(members.length, names.length);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
    original.name, original.typeParameters, undefined, members);
  const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exported: Record<string, any> = {};
  vm.runInNewContext(javascript, { exports: exported, isAdvanceInvoice, advanceContentsFor, advanceContentsSummary, advancePlanningHint, salesLineUnavailable, Intl });
  return new exported[className]();
}

const editor = await screenMethods('sales-editor', 'SalesEditor', ['workflowHint', 'workflowComplete', 'lineUnavailable']);
// The isolated view is a plain test function, so evaluate the production helper each time.
editor.allProductsUnavailable = () => salesAllProductsUnavailable(editor.view());
const reader = await screenMethods('sales-view', 'SalesView', ['deliveryState']);
test('mobile/editor navigation counts snapshot products and needs no product prices to complete their step', () => {
  const view = fixture();
  Object.assign(editor, { view: () => view });
  assert.equal(editor.workflowHint('order-lines'), '2 regels');
  assert.equal(editor.workflowComplete('order-lines'), true);
  view.advanceContents.lines = [view.advanceContents.lines[0]];
  assert.equal(editor.workflowHint('order-lines'), '1 regel');
  view.advanceContents.lines[0].quantity = 0;
  assert.equal(editor.workflowComplete('order-lines'), false);
});

test('delivery navigation uses snapshot ETA/week and never treats unknown planning as financially complete', () => {
  const view: any = fixture();
  view.order.deliveryTerms = 'VOLLEDIG';
  Object.assign(editor, { view: () => view });
  assert.equal(reader.deliveryState(view), '16/11/2026');
  assert.equal(editor.workflowHint('quote-logistics'), '16/11/2026');
  assert.equal(editor.workflowComplete('quote-logistics'), true);
  view.advanceContents.delivery.expectedArrival = null;
  assert.equal(reader.deliveryState(view), 'Week 47 · 2026');
  view.advanceContents.delivery.deliveryWeek = null;
  assert.equal(reader.deliveryState(view), 'Nog te bevestigen');
  assert.equal(editor.workflowHint('quote-logistics'), 'Nog te bevestigen');
  assert.equal(editor.workflowComplete('quote-logistics'), false);
  view.advanceContents = null;
  assert.equal(editor.workflowHint('order-lines'), 'Nog te bevestigen');
  assert.equal(editor.workflowComplete('order-lines'), false);
});

test('regular-sale navigation retains priced-line completion and the normal delivery state', () => {
  const view: any = fixture();
  view.order.purpose = 'STANDARD'; view.order.deliveryTerms = 'AANGEVULD';
  Object.assign(editor, { view: () => view });
  assert.equal(editor.workflowHint('order-lines'), 'Product toevoegen');
  assert.equal(editor.workflowComplete('order-lines'), false);
  view.priced.lines = [{ quantity: 24, unitPrice: 6.95 }];
  assert.equal(editor.workflowHint('order-lines'), '1 regel');
  assert.equal(editor.workflowComplete('order-lines'), true);
  assert.equal(reader.deliveryState(view), 'Aangevuld');
  view.order.lines = [{ productId: 1, quantity: 24 }, { productId: 2, quantity: 0, unavailable: true, requestedQuantity: 48 }];
  view.priced.lines = [{ productId: 1, quantity: 24, unitPrice: 6.95 }, { productId: 2, quantity: 0, unitPrice: 0, unavailable: true }];
  assert.equal(editor.workflowHint('order-lines'), '1 actief · 1 niet beschikbaar');
  assert.equal(editor.workflowComplete('order-lines'), true);
  view.order.lines[0] = { productId: 1, quantity: 0, unavailable: true, requestedQuantity: 24 };
  assert.equal(editor.workflowHint('order-lines'), 'Alles tijdelijk niet beschikbaar');
  assert.equal(editor.workflowComplete('order-lines'), false);
});
