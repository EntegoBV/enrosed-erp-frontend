import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { productSalesUnit, rememberUnitNames } from '../src/app/features/products/product-sales-unit.ts';
import { bookingReady, bookingPreview, newBookingDraft, refreshBookingDraft, switchBookingKind } from '../src/app/features/products/stock-booking.ts';
import { validTicaDay } from '../src/app/features/tica/tica-format.ts';
import type { Product } from '../src/app/core/api/models.ts';

async function isolated(path: string, keep: (node: ts.Statement) => boolean, context: Record<string, unknown>) {
  const parsed = ts.createSourceFile(path, await readFile(new URL(`../src/app/features/${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, parsed.statements.filter(keep))), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, ...context });
  return exports;
}
const quantities = await isolated('products/stock-quantity.ts', node => !ts.isImportDeclaration(node), { productSalesUnit });
const rules = await isolated('tica/tica-stock-rules.ts', node => !ts.isImportDeclaration(node), { validTicaDay });
const sourceRules = await isolated('products/stock-movement-source.ts', ts.isFunctionDeclaration, {});
rememberUnitNames([{ key: 'steel', one: 'steel', other: 'stelen', short: 'st.', per: 'per steel' }]);
const stem = { id: 106, packaging: { kind: 'DISPLAY', salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'steel' } } as Product;
const levels = [{ locationId: 2, name: 'TICA Brussel', quantity: 7, loosePieces: 11, piecesPerUnit: 12 }];

test('one loose stem sold from eight displays reads -1 steel and 7 displays + 11 losse stelen', () => {
  const move = { delta: -1, looseDelta: 11, quantityAfter: 7, loosePiecesAfter: 11, unitPieces: 12, sourceUnit: 'PIECE' };
  assert.equal(quantities.stockMovementDelta(move, stem), '-1 steel');
  assert.equal(quantities.stockMovementAfter(move, stem), '7 displays + 11 losse stelen');
  assert.equal(quantities.stockAmountText(levels[0], stem), '7 displays + 11 losse stelen');
});
test('loose corrections, returns, and complete display transfers retain their exact basis', () => {
  assert.equal(quantities.stockMovementDelta({ delta: 0, looseDelta: -1, unitPieces: 12 }, stem), '-1 steel');
  assert.equal(quantities.stockMovementDelta({ delta: 1, looseDelta: -11, unitPieces: 12, sourceUnit: 'PIECE' }, stem), '+1 steel');
  assert.equal(quantities.stockMovementDelta({ delta: -2, looseDelta: 0, unitPieces: 12 }, stem), '-2 displays');
  assert.equal(quantities.stockMovementDelta({ delta: 2 }, stem), '+2 displays', 'Legacy unit counts stay in their original basis');
  assert.equal(quantities.stockMovementDelta({ delta: 2, unitPieces: 1 }, stem), '+2 stelen', 'A frozen historical piece basis remains pieces after a packaging change');
  assert.equal(quantities.stockMovementAfter({ quantityAfter: 95, unitPieces: 1 }, stem), '95 stelen');
});
test('recount starts with both complete and loose counts, and books a loose-only correction', () => {
  const draft = newBookingDraft('RECOUNT', levels, 2);
  assert.equal(draft.quantity, 7); assert.equal(draft.loosePieces, 11);
  assert.equal(bookingReady(draft, levels), false);
  const changed = { ...draft, loosePieces: 10 };
  assert.equal(bookingReady(changed, levels), true);
  assert.equal(bookingPreview(changed, levels)?.state, 'change');
  for (const loosePieces of [-1, 12, 1.5, null]) assert.equal(bookingReady({ ...draft, loosePieces }, levels), false);
  const looseOnly = newBookingDraft('RECOUNT', [{ locationId: 1, name: 'Magazijn', quantity: 0 }, { ...levels[0], quantity: 0 }]);
  assert.equal(looseOnly.locationId, 2, 'Loose stock still counts when choosing the location to recount');
});
test('a refresh preserves a typed loose count and a kind change uses the current complete units', () => {
  const draft = { ...newBookingDraft('RECOUNT', levels, 2), loosePieces: 8 };
  assert.equal(refreshBookingDraft(draft, levels, 2, true).loosePieces, 8);
  assert.equal(refreshBookingDraft(draft, levels, 2, false).loosePieces, 11);
  const transfer = switchBookingKind(draft, 'TRANSFER', [...levels, { locationId: 1, name: 'Magazijn', quantity: 0 }]);
  assert.equal(transfer.quantity, null); assert.equal(transfer.loosePieces, 11);
});
test('TICA source movements cannot be deleted, including older responses without the deletable flag', () => {
  assert.equal(sourceRules.stockMovementDeletable({ ticaSaleId: 18 }), false);
  assert.equal(sourceRules.stockMovementDeletable({ ticaSaleId: null, deletable: false }), false);
  assert.equal(sourceRules.stockMovementDeletable({}), true);
});
test('stock activation requires a real start day and explicit location; pausing does not require remapping', () => {
  const draft = { enabled: true, fromDate: null, locations: [], productUnits: [] };
  assert.match(rules.ticaStockSettingsError(draft), /verkoopdatum/);
  assert.match(rules.ticaStockSettingsError({ ...draft, fromDate: '2026-02-30' }), /geldige/);
  assert.match(rules.ticaStockSettingsError({ ...draft, fromDate: '2026-10-20' }), /vestiging/);
  assert.equal(rules.ticaStockSettingsError({ ...draft, fromDate: '2026-10-20', locations: [{ sourceLocation: 'TICA - Brussel', stockLocationId: 2 }] }), null);
  assert.equal(rules.ticaStockSettingsError({ ...draft, enabled: false }), null);
  assert.equal(rules.ticaStockLabel({ stockStatus: 'POSTED', stockQuantity: -1 }), 'Retour bijgeschreven');
  assert.equal(rules.ticaStockNeedsAttention({ stockStatus: 'UNIT_MISMATCH' }), true);
});

async function classMethods(file: string, className: string, names?: string[]) {
  const parsed = ts.createSourceFile(file, await readFile(new URL(`../src/app/features/products/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className)!;
  const members = original.members.filter(member => ts.isMethodDeclaration(member) && (!names || member.name && ts.isIdentifier(member.name) && names.includes(member.name.text)))
    .map(member => ts.factory.updateMethodDeclaration(member, member.modifiers?.filter(modifier => !ts.isDecorator(modifier)), member.asteriskToken, member.name, member.questionToken, member.typeParameters, member.parameters, member.type, member.body));
  const cls = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, original.typeParameters, undefined, members);
  return ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [cls])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
const priceJs = await classMethods('product-channel-price.ts', 'ProductChannelPrice');
const guardJs = await classMethods('product-editor.ts', 'ProductEditor', ['loadProductAfterChannelGuard']);
function priceHarness() {
  const exports: any = {}, writes: any[] = [], toasts: string[] = [];
  let leave = false;
  vm.runInNewContext(priceJs, { exports, productSalesUnit, messageOf: (_: unknown, fallback: string) => fallback, confirmLeave: async () => leave });
  const card = new exports.ProductChannelPrice();
  const automatic = { channel: 'TICA', priceExclVat: 3.95, unit: 'PIECE', source: 'TICA', manualPriceExclVat: null, manualUnit: null, observedPriceExclVat: 3.95, observedUnit: 'PIECE' };
  Object.assign(card, {
    product: signal(stem), editable: signal(true), disabled: signal(false), price: signal(automatic), loading: signal(false), saving: signal(false), error: signal(null),
    editing: signal(false), amount: signal(null), unit: signal('PIECE'), formError: signal(null), historyOpen: signal(false), history: signal([]), historyLoading: signal(false), historyError: signal(null),
    destroy: { destroyed: false }, request: 0,
    api: { prices: async () => [automatic], saveTica: async (...args: any[]) => { writes.push(args); return { ...automatic, priceExclVat: args[1] ?? 3.95, manualPriceExclVat: args[1], source: args[1] === null ? 'TICA' : 'MANUAL', manualUnit: args[2] }; } },
    ui: { toast: (message: string) => toasts.push(message) },
  });
  card.salesUnit = computed(() => productSalesUnit(card.product()));
  card.dirty = computed(() => card.editing() && (card.price()?.manualPriceExclVat == null || card.amount() !== card.price()?.manualPriceExclVat || card.unit() !== card.price()?.manualUnit));
  return { card, writes, toasts, allowLeave: () => { leave = true; } };
}
test('editing a TICA price does not save until its own action; payload retains the piece basis', async () => {
  const { card, writes, toasts } = priceHarness();
  card.edit(); card.setAmount(4.25);
  assert.equal(card.dirty(), true); assert.equal(writes.length, 0);
  assert.equal(await card.save(), true);
  assert.deepEqual(writes, [[106, 4.25, 'PIECE']]);
  assert.equal(card.editing(), false); assert.equal(card.dirty(), false);
  assert.equal(toasts[0], 'TICA-prijs opgeslagen in ERP');
});
test('invalid channel prices never write, and a failed save retains the draft', async () => {
  const { card, writes } = priceHarness(); card.edit();
  for (const value of [null, 0, -1, NaN]) { card.amount.set(value); assert.equal(await card.save(), false); }
  assert.equal(writes.length, 0);
  card.amount.set(4.25); card.api.saveTica = async () => { throw new Error('offline'); };
  assert.equal(await card.save(), false); assert.equal(card.dirty(), true); assert.equal(card.amount(), 4.25);
});
test('using the TICA source removes only the manual override and never claims to update the portal', async () => {
  const { card, writes, toasts } = priceHarness();
  await card.useObserved();
  assert.deepEqual(writes, [[106, null, 'PIECE']]);
  assert.equal(toasts[0], 'ERP gebruikt weer de prijs uit TICA');
});
test('price drafts can block leaving, confirmed discard clears dirty, and in-flight saves block leaving', async () => {
  const { card, allowLeave } = priceHarness(); card.edit(); card.setAmount(4.25);
  assert.equal(await card.canDeactivate(), false); assert.equal(card.dirty(), true);
  allowLeave(); assert.equal(await card.canDeactivate(), true); assert.equal(card.dirty(), false);
  card.saving.set(true); assert.equal(await card.canDeactivate(), false);
});
test('a late response for the previous product cannot replace the new product price', async () => {
  const { card } = priceHarness();
  const pending: ((value: any) => void)[] = [];
  card.api.prices = () => new Promise(resolve => pending.push(resolve));
  const old = card.load(106); const latest = card.load(107);
  pending[1]([{ channel: 'TICA', priceExclVat: 9 }]); await latest;
  pending[0]([{ channel: 'TICA', priceExclVat: 3.95 }]); await old;
  assert.equal(card.price().priceExclVat, 9);
});
test('reusing the editor for another variant respects channel draft refusal and the latest route', async () => {
  const exports: any = {}; vm.runInNewContext(guardJs, { exports });
  const editor = new exports.ProductEditor(), loads: number[] = [], navigations: any[] = [];
  Object.assign(editor, { activeProductId: 106, id: signal('107'), channelPrices: () => ({ canDeactivate: async () => false }), loadProduct: async (id: number) => loads.push(id), router: { navigate: async (...args: any[]) => navigations.push(args) } });
  await editor.loadProductAfterChannelGuard(107);
  assert.equal(loads.length, 0); assert.equal(navigations[0][0][1], 106);
  editor.channelPrices = () => ({ canDeactivate: async () => true });
  await editor.loadProductAfterChannelGuard(107); assert.deepEqual(loads, [107]);
  editor.id.set('108'); await editor.loadProductAfterChannelGuard(107); assert.deepEqual(loads, [107]);
});

const bookingJs = await classMethods('stock-booking-sheet.ts', 'StockBookingSheet', ['submit']);
test('the shared recount action sends complete units and loose pieces together, even with no whole-unit delta', async () => {
  const exports: any = {}, writes: any[] = [], notices: string[] = [], events: any[] = [];
  vm.runInNewContext(bookingJs, { exports, messageOf: (_: unknown, fallback: string) => fallback });
  const sheet = new exports.StockBookingSheet();
  const draft = { ...newBookingDraft('RECOUNT', levels, 2), loosePieces: 10 };
  Object.assign(sheet, {
    product: () => stem, draft: () => draft, preview: () => bookingPreview(draft, levels), ready: () => bookingReady(draft, levels),
    busy: signal(false), needsContainer: () => false, containers: () => [], unitPieces: () => 12,
    recountAmount: () => quantities.stockAmountText({ quantity: 7, loosePieces: 10, piecesPerUnit: 12 }, stem),
    catalog: { setStock: async (...args: any[]) => { writes.push(args); return stem; } },
    ui: { toast: (notice: string) => notices.push(notice) }, booked: { emit: (event: any) => events.push(event) },
  });
  await sheet.submit();
  assert.deepEqual(writes, [[106, 7, 2, null, 10]]);
  assert.match(notices[0], /7 displays \+ 10 losse stelen/);
  assert.equal(events[0].delta, 0); assert.equal(events[0].kind, 'RECOUNT');
});

const settingsJs = await classMethods('../tica/tica-stock-settings.ts', 'TicaStockSettings', ['setProductUnit']);
test('piece products always submit PIECE, display products stay unconfirmed until explicitly chosen, and used mappings stay locked', () => {
  const exports: any = {}; vm.runInNewContext(settingsJs, { exports });
  const settings = new exports.TicaStockSettings();
  Object.assign(settings, { settings: () => ({ productUnits: [
    { productId: 1, productSalesUnit: 'PIECE', locked: false },
    { productId: 106, productSalesUnit: 'DISPLAY', locked: false },
    { productId: 107, productSalesUnit: 'DISPLAY', locked: true },
  ] }), draft: signal({ productUnits: [{ productId: 1, sourceUnit: null }, { productId: 106, sourceUnit: null }, { productId: 107, sourceUnit: 'PIECE' }] }) });
  settings.setProductUnit(1, ''); assert.equal(settings.draft().productUnits[0].sourceUnit, 'PIECE');
  settings.setProductUnit(106, ''); assert.equal(settings.draft().productUnits[1].sourceUnit, null);
  settings.setProductUnit(106, 'PIECE'); assert.equal(settings.draft().productUnits[1].sourceUnit, 'PIECE');
  settings.setProductUnit(107, 'DISPLAY'); assert.equal(settings.draft().productUnits[2].sourceUnit, 'PIECE');
});
