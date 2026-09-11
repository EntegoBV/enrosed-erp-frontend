import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import { customerMessageIsReadOnly, originalCustomerMessage } from '../src/app/features/sales/quote-status.ts';
import { salesSplitBlockReason } from '../src/app/features/sales/sales-split-state.ts';

const source = await readFile(new URL('../src/app/features/sales/sales-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('sales-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'SalesEditor'); assert.ok(original);
const names = ['mobileSplitOpen', 'mobileSplitBusy', 'mobileSplitBlockReason', 'mobileFinanciallyLocked', 'mobileCommercialEditable', 'mobileCustomerAuthoredMessage', 'mobileCustomerNote', 'openMobileSplit', 'closeMobileSplit', 'mobileSplitSaved', 'mobileFulfillmentChanged', 'mobileAcceptsDraft', 'enqueue', 'patch', 'setLine', 'setLineQuantity', 'documentMutationBusy', 'canEdit', 'canEditTerms', 'canDeactivate', 'warnBeforeUnload', 'adopt', 'openPicker'];
const members = original.members.filter(member => member.name && names.includes(member.name.getText(parsed))); assert.equal(members.length, names.length);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, undefined, undefined, members);
const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports: any = {}; vm.runInNewContext(js, { exports, signal, computed, clearTimeout, HostListener: () => () => undefined, customerMessageIsReadOnly, originalCustomerMessage, salesSplitBlockReason });
const Editor = exports.SalesEditor;
const document = () => ({ order: { id: 72, number: 'INV-72', purpose: 'STANDARD', docType: 'FACTUUR', status: 'CONCEPT', notes: 'Documenttekst', internalNotes: null, customerId: 1, countryCode: 'NL', salesChannel: 'DIRECT', freightPricingStrategy: 'FIXED', manualFreightEur: 12, extraDiscountPct: 5, extraLines: [], pallets: [], lines: [{ id: 101, productId: 7, quantity: 48, unitPriceEur: 10, manualDiscountPct: null, deliveryWeek: null }] }, priced: { lines: [] } });
const split = () => ({ ...document(), fulfillment: { groupId: 'group', part: 1, status: 'PLANNED', financialsLocked: true } });
function harness(initial: any = document()) {
  const editor = new Editor(), calls: string[] = [], toasts: string[] = [];
  Object.assign(editor, { view: signal(initial), savedOrder: signal(JSON.stringify(initial.order)), saving: signal(false), sending: signal(false), invoiceConversionBusy: signal(false), advanceAgreement: () => null, saveError: signal(null), previewError: signal(null), picking: signal(false), previewTimer: null, previewVersion: 0, linePending: signal({}),
    ui: { toast: (message: string) => toasts.push(message), confirm: () => calls.push('CONFIRM') },
    schedulePreview: () => calls.push('PREVIEW'), refreshWorkQueue: () => calls.push('REFRESH'), reloadLatestOrder: () => calls.push('RELOAD'), piecesPerCarton: () => 24,
    sales: { updateDeliveryTerms: async () => { calls.push('DELIVERY WRITE'); return initial; } },
  });
  editor.dirty = computed(() => JSON.stringify(editor.view().order) !== editor.savedOrder());
  return { editor, calls, toasts };
}

test('mobile editor exposes split only for a clean, eligible draft and holds navigation while confirming', () => {
  const { editor, calls } = harness(); editor.openMobileSplit(); assert.equal(editor.mobileSplitOpen(), true);
  editor.mobileSplitBusy.set(true); editor.closeMobileSplit(); assert.equal(editor.mobileSplitOpen(), true); assert.equal(editor.canDeactivate(), false);
  const event = { preventDefault() { calls.push('PREVENT UNLOAD'); }, returnValue: null }; editor.warnBeforeUnload(event); assert.equal(event.returnValue, '');
  assert.equal(editor.canEdit(), false); assert.equal(editor.canEditTerms(), false);
  editor.mobileSplitBusy.set(false); editor.closeMobileSplit(); assert.equal(editor.mobileSplitOpen(), false); assert.ok(calls.includes('RELOAD'));
  editor.patch({ notes: 'Unsaved' }); editor.openMobileSplit(); assert.equal(editor.mobileSplitOpen(), false);
});

test('split product quantities, prices, customer, strategy, extra lines and pallets cannot change through inherited editor methods', () => {
  const { editor, calls } = harness(split()); const before = JSON.stringify(editor.view().order);
  assert.equal(editor.canEdit(), true); assert.equal(editor.mobileCommercialEditable(), false);
  editor.setLineQuantity(7, 72); editor.setLine(7, { quantity: 72 }); editor.setLine(7, { unitPriceEur: 1 }); editor.setLine(7, { manualDiscountPct: 40 });
  for (const patch of [{ customerId: 2 }, { countryCode: 'BE' }, { salesChannel: 'OTHER' }, { freightPricingStrategy: 'PICKUP' }, { extraLines: [{ description: 'new' }] }, { pallets: [{ id: 1 }] }]) editor.patch(patch);
  editor.openPicker(); assert.equal(editor.picking(), false); assert.equal(JSON.stringify(editor.view().order), before);
  assert.deepEqual(calls, []); assert.deepEqual(Object.keys(editor.linePending()), []);
});

test('split concepts keep fixed freight, extra discount, delivery week and terms editable without changing their product claims', () => {
  const { editor, calls } = harness(split());
  editor.patch({ manualFreightEur: 30, extraDiscountPct: 10, extraDiscountLabel: 'Afspraak', paymentTerms: '14 dagen', incoterm: 'DAP' });
  editor.setLine(7, { deliveryWeek: '2026-W45' });
  const order = editor.view().order; assert.equal(order.manualFreightEur, 30); assert.equal(order.extraDiscountPct, 10); assert.equal(order.lines[0].deliveryWeek, '2026-W45');
  assert.equal(order.lines[0].quantity, 48); assert.equal(order.lines[0].unitPriceEur, 10); assert.deepEqual(calls, ['PREVIEW', 'PREVIEW']);
});

test('original website request stays read only while team notes and ordinary document notes remain editable', () => {
  const website = { ...document(), customerRequestMessageReadonly: true, customerRequestMessage: 'Graag rood\nEn levering later.' };
  const { editor } = harness(website); assert.equal(editor.mobileCustomerNote(editor.view()), website.customerRequestMessage);
  editor.patch({ notes: 'Overwritten' }); assert.equal(editor.view().order.notes, 'Documenttekst'); assert.equal(editor.dirty(), false);
  editor.patch({ internalNotes: 'Teamafspraak' }); assert.equal(editor.view().order.internalNotes, 'Teamafspraak');
  const normal = harness(); normal.editor.patch({ notes: 'Gewijzigde documenttekst' }); assert.equal(normal.editor.view().order.notes, 'Gewijzigde documenttekst');
  const empty = harness({ ...document(), customerRequestMessageReadonly: true, customerRequestMessage: '' }); empty.editor.patch({ notes: 'Own text' }); assert.equal(empty.editor.dirty(), false);
});

test('mobile split and readiness results adopt the correct clean document and never replace another order or unsaved changes', () => {
  const response = { groupId: 'group', current: split(), later: { ...document(), order: { ...document().order, id: 74, number: 'INV-74' } } };
  const clean = harness(); clean.editor.mobileSplitSaved(response); assert.ok(clean.editor.view().fulfillment); assert.equal(clean.editor.dirty(), false); assert.deepEqual(clean.calls, ['REFRESH']);
  const dirty = harness(); dirty.editor.patch({ notes: 'User edit' }); dirty.editor.mobileSplitSaved(response); assert.equal(dirty.editor.view().order.notes, 'User edit'); assert.equal(dirty.editor.view().fulfillment, undefined);
  const other = harness({ ...document(), order: { ...document().order, id: 99 } }); other.editor.mobileSplitSaved(response); assert.equal(other.editor.view().order.id, 99); assert.deepEqual(other.calls, []);
  const ready = harness(split()); ready.editor.mobileFulfillmentChanged({ ...split(), fulfillment: { ...split().fulfillment, status: 'WAITING_FOR_STOCK' } }); assert.equal(ready.editor.view().fulfillment.status, 'WAITING_FOR_STOCK');
  ready.editor.patch({ notes: 'Keep draft' }); ready.editor.mobileFulfillmentChanged(split()); assert.equal(ready.editor.view().order.notes, 'Keep draft');
});

test('mobile template contains the split sheet and fulfillment card, preserves customer note and allows only fixed shipping', () => {
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1]; assert.ok(template); assert.equal(parseTemplate(template, 'sales-editor.html').errors, null);
  assert.match(template, /app-sales-split-sheet/); assert.match(template, /busyChange\)="mobileSplitBusy.set/); assert.match(template, /app-sales-fulfillment-card/);
  assert.match(template, /id="so-notes" \[readonly\]="mobileCustomerAuthoredMessage\(data\)"/);
  assert.match(template, /id="mobile-split-manual-freight"/); assert.match(template, /\[canEdit\]="mobileCommercialEditable\(\)"/);
  assert.match(template, /extraDiscountPct/); assert.match(template, /Order splitsen/);
});
