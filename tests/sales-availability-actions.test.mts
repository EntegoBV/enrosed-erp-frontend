import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';

async function methods(file: string, name: string, names: string[]) {
  const text = await readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(cls);
  const members = cls.members.filter(member => member.name && names.includes(member.name.getText(parsed)));
  assert.equal(members.length, names.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(modifier => !ts.isDecorator(modifier)), cls.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, computed, signal, salesLineUnavailable: (line: any) => line.unavailable === true });
  return exports[name];
}
const Card = await methods('sales-fulfillment-card', 'SalesFulfillmentCard', ['hasDeliverableProducts', 'weeks', 'markReady']);
const View = await methods('sales-view', 'SalesView', ['sendFromView', 'markSent', 'openShipSheet']);
const Desk = await methods('sales-desk', 'SalesDesk', ['markSent', 'openShipSheet']);

test('a waiting delivery with only unavailable products cannot be planned and has no promised weeks', async () => {
  const data = signal({ order: { id: 72, lines: [{ productId: 1, quantity: 0, unavailable: true, deliveryWeek: '2026-W42' }] } });
  const card = new Card(), calls: number[] = [];
  Object.assign(card, { view: data, busy: signal(false), blocked: () => false, canPlan: () => true,
    error: signal(''), sales: { markFulfillmentReady: async (id: number) => { calls.push(id); return data(); } }, changed: { emit() {} } });
  assert.equal(card.hasDeliverableProducts(), false);
  assert.equal(card.weeks().length, 0);
  await card.markReady(); assert.deepEqual(calls, []);
  data.set({ order: { id: 72, lines: [...data().order.lines, { productId: 2, quantity: 24, unavailable: false, deliveryWeek: '2026-W44' }] } });
  assert.equal(card.hasDeliverableProducts(), true);
  assert.deepEqual(Array.from(card.weeks()), ['2026-W44']);
  await card.markReady(); assert.deepEqual(calls, [72]);
});

test('read view and desktop cannot bypass availability via send or mark-as-sent actions', async () => {
  const document = { order: { id: 72 } };
  for (const Constructor of [View, Desk]) {
    const component = new Constructor();
    Object.assign(component, { view: () => document, sendingQuote: () => false, invoiceBusy: () => false, allProductsUnavailable: () => true,
      dirty: () => false, saving: () => false });
    await component.markSent(document);
    if (Constructor === View) await component.sendFromView();
    // No API collaborator is supplied: reaching a send call would fail this test.
  }
});

test('shipping preview only shows products with an active positive quantity on desktop and mobile', async () => {
  const document = { order: { id: 72, number: 'QA-72' }, priced: { totals: { pieces: 24 }, lines: [
    { productId: 1, description: 'Beschikbaar', quantity: 24 },
    { productId: 2, description: 'Niet beschikbaar', quantity: 0, unavailable: true, requestedQuantity: 48 },
    { productId: 3, description: 'Onvolledige aanvraag', quantity: 0 },
  ] } };
  for (const Constructor of [View, Desk]) {
    const component = new Constructor();
    Object.assign(component, { invoiceBusy: () => false, shipSheet: signal(null),
      catalog: { products: async () => [{ id: 1, stockQuantity: 30 }, { id: 2, stockQuantity: 50 }] },
      lineUnavailable: (id: number) => id === 2 });
    await component.openShipSheet(document);
    assert.equal(component.shipSheet().rows.length, 1);
    assert.equal(component.shipSheet().rows[0].name, 'Beschikbaar');
    assert.equal(component.shipSheet().rows[0].after, 6);
    assert.equal(component.shipSheet().pieces, 24);
  }
});
