import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import * as availability from '../src/app/features/sales/sales-line-availability.ts';
import { isPartnerDocument } from '../src/app/features/sales/sales-payment-state.ts';
import { websiteCartonRequests } from '../src/app/features/sales/quote-status.ts';

async function isolate(file: string, className: string, names: string[], globals: Record<string, unknown> = {}) {
  const source = await readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className); assert.ok(cls);
  const members = cls.members.filter(member => member.name && names.includes(member.name.getText(parsed))); assert.equal(members.length, names.length);
  const selected = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(modifier => !ts.isDecorator(modifier)), cls.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [selected])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {}; vm.runInNewContext(js, { exports, signal, computed, ...availability, isPartnerDocument, websiteCartonRequests, ...globals });
  return exports[className];
}

const Editor = await isolate('sales-editor', 'SalesEditor', ['sendIssues', 'lineUnavailable', 'allProductsUnavailable', 'workflowComplete'], { isAdvanceInvoice: () => false });
const Planner = await isolate('shipping-planner', 'ShippingPlanner', ['order', 'activeLines', 'invalidPalletLines', 'unassignedLines', 'assignable']);
const Restore = await isolate('sales-line-restore-sheet', 'SalesLineRestoreSheet', ['quantity', 'error', 'confirm']);
const row = (id: number, quantity: number, unavailable = false) => ({ id, productId: id, quantity, unavailable, requestedQuantity: unavailable ? 48 : null,
  unitPriceEur: 10, unitPrice: 10, description: `Product ${id}`, cartons: quantity / 24, cartonsPerPallet: 8 });
const view = (lines: any[], docType = 'OFFERTE') => ({
  order: { id: 72, docType, purpose: 'STANDARD', status: 'CONCEPT', customerId: 1, countryCode: 'NL', freight: 'BEREKEND',
    freightPricingStrategy: 'FIXED', manualFreightEur: 10, pallets: [], lines },
  priced: { lines: lines.map(line => ({ ...line })), validation: { hasLines: lines.some(line => !line.unavailable && line.quantity > 0), meetsMinimum: true }, totals: { unassignedCartons: 0 } },
});

function editorFor(data: any) {
  const editor = new Editor(); Object.assign(editor, { view: signal(data), customers: () => [{ id: 1, company: 'Klant', email: 'qa@example.test' }],
    advanceAgreement: () => null, overassigned: () => false }); return editor;
}

test('unavailable is explicit and ordinary unresolved zero quantities remain incomplete', () => {
  assert.equal(availability.salesLineUnavailable(row(1, 0)), false);
  assert.equal(availability.salesAllProductsUnavailable(view([row(1, 0)]) as any), false);
  const editor = editorFor(view([row(1, 24), row(2, 0)]));
  assert.match(editor.sendIssues().join(' '), /positief aantal/);
  assert.equal(editor.workflowComplete('order-lines'), false);
});

test('group availability counts only explicitly parked rows, including mixed groups and unresolved zeros', () => {
  assert.equal(availability.salesUnavailableLineCount([]), 0);
  assert.equal(availability.salesUnavailableLineCount([row(1, 0), row(2, 24)]), 0);
  assert.equal(availability.salesUnavailableLineCount([row(1, 0, true), row(2, 24), row(3, 0)]), 1);
  assert.equal(availability.salesUnavailableLineCount([row(1, 0, true), row(2, 0, true)]), 2);
});

test('excluded rows skip quantity and price requirements but keep active product validation', () => {
  const doc = view([row(1, 24), { ...row(2, 0, true), unitPrice: 0 }]);
  const editor = editorFor(doc);
  assert.deepEqual(Array.from(editor.sendIssues()), []);
  assert.equal(editor.workflowComplete('order-lines'), true);
  editor.view.set({ ...doc, priced: { ...doc.priced, lines: [{ ...doc.priced.lines[0], unitPrice: 0 }, doc.priced.lines[1]] } });
  assert.match(editor.sendIssues().join(' '), /geldige stukprijs/);
  assert.equal(editor.workflowComplete('order-lines'), false);
});

test('all parked products block quote and invoice sending, even if transport or custom lines carry an amount', () => {
  for (const type of ['OFFERTE', 'FACTUUR']) {
    const doc = view([row(1, 0, true), row(2, 0, true)], type);
    doc.order.extraLines = [{ description: 'Voorbereiding', quantity: 1, unitPriceEur: 50 }] as any;
    const editor = editorFor(doc);
    assert.match(editor.sendIssues().join(' '), /Alle producten staan tijdelijk op 0/);
    assert.equal(editor.workflowComplete('order-lines'), false);
  }
});

test('packing choices omit unavailable and zero rows, including during an outstanding price preview', () => {
  const data = view([row(1, 24), row(2, 0, true), row(3, 0)]);
  data.priced.lines[1] = { ...row(2, 48), cartonsPerPallet: 0 };
  const planner = new Planner(); Object.assign(planner, { view: signal(data), remainingFor: (id: number) => id === 1 ? 1 : 2 });
  assert.deepEqual(Array.from(planner.activeLines(), (line: any) => line.productId), [1]);
  assert.equal(planner.invalidPalletLines().length, 0);
  assert.deepEqual(Array.from(planner.unassignedLines(), (line: any) => line.productId), [1]);
  assert.deepEqual(Array.from(planner.assignable(0), (line: any) => line.productId), [1]);
});

test('the manual restore sheet requires an explicit positive full-carton quantity', () => {
  const sheet = new Restore(), restored: number[] = [];
  Object.assign(sheet, { piecesPerCarton: () => 24, restored: { emit: (value: number) => restored.push(value) } });
  for (const value of [null, 0, -24, 12, 24.5, NaN, Infinity]) {
    sheet.quantity.set(value); sheet.confirm(); assert.equal(restored.length, 0); assert.ok(sheet.error());
  }
  sheet.quantity.set(48); sheet.confirm(); assert.deepEqual(restored, [48]);
});

test('availability changes retain line identity and pricing and never rewrite unrelated pallet placements', () => {
  const original = { ...row(1, 48), unitPriceEur: 7.95, manualDiscountPct: 3, deliveryWeek: '2026-W46' };
  const parked = availability.salesLineWithAvailability(original as any, true)!;
  assert.equal(parked.unitPriceEur, 7.95); assert.equal(parked.manualDiscountPct, 3); assert.equal(parked.id, 1);
  assert.equal(availability.salesFrozenLineChangeAllowed(original as any, parked), true);
  const restored = availability.salesLineWithAvailability(parked, false)!;
  assert.equal(restored.quantity, 48); assert.equal(restored.requestedQuantity, 48);
  assert.equal(availability.salesFrozenLineChangeAllowed(parked, restored), true);
  assert.equal(availability.salesFrozenLineChangeAllowed(parked, { ...restored, quantity: 72 }), false);
  assert.equal(availability.salesFrozenLineChangeAllowed(parked, { ...restored, unitPriceEur: 1 }), false);
});

test('updated mobile, restore, shipping and receipt templates remain valid Angular templates', async () => {
  for (const file of ['sales-editor', 'sales-line-restore-sheet', 'shipping-planner', 'sales-receipts']) {
    const source = await readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');
    const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1]; assert.ok(template, file);
    assert.equal(parseTemplate(template, `${file}.html`).errors, null, file);
  }
});
