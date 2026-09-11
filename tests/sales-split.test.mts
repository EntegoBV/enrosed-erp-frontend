import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import { firstValueFrom, of } from 'rxjs';
import { messageOf } from '../src/app/core/api/errors.ts';
import { salesSplitBlockReason, salesSplitRequest, salesSplitPreviewMatches } from '../src/app/features/sales/sales-split-state.ts';

const source = await readFile(new URL('../src/app/features/sales/sales-split-sheet.ts', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/app/core/api/sales-api.ts', import.meta.url), 'utf8');
function isolate(source: string, name: string, names: string[], globals: Record<string, any> = {}) {
  const parsed = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name); assert.ok(original);
  const members = original.members.filter(member => member.name && names.includes(member.name.getText(parsed))); assert.equal(members.length, names.length);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {}; vm.runInNewContext(js, { exports, ...globals }); return exports[name];
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const eligibility = () => ({ allowed: true, reason: null, sourceId: 72, sourceNumber: 'INV-72', existingGroupId: null, lines: [
  { lineId: 101, productId: 7, description: 'Rode roos', quantity: 48, piecesPerCarton: 24, stockQuantity: 24, inventoryKnown: true },
  { lineId: 102, productId: 7, description: 'Rode roos, tweede regel', quantity: 24, piecesPerCarton: 24, stockQuantity: 24, inventoryKnown: true },
] });
const view = () => ({ order: { id: 72, number: 'INV-72', docType: 'FACTUUR', purpose: 'STANDARD', status: 'CONCEPT', notes: '', extraDiscountPct: 5,
  lines: eligibility().lines.map(line => ({ id: line.lineId, productId: line.productId, quantity: line.quantity })) }, priced: { lines: [{ productId: 7, sku: 'ROSE-RED', photoUrl: '/api/photo/7' }] } });
const part = (quantity: number, goodsEur: number, freightEur = 0, handlingEur = 0, extraLinesEur = 0) => {
  const totalExclVatEur = goodsEur + freightEur + handlingEur + extraLinesEur;
  const vatEur = Math.round(totalExclVatEur * 21) / 100;
  return { quantity, goodsEur, freightEur, handlingEur, extraLinesEur, totalExclVatEur, vatEur, totalInclVatEur: Math.round((totalExclVatEur + vatEur) * 100) / 100 };
};
const preview = () => ({ sourceId: 72, previewToken: 'server-token', original: part(72, 720, 12, 3, 5), current: part(48, 480, 12, 3, 5), later: part(24, 240), warnings: ['Handling blijft op deel 1.'], deltaExclVatEur: 0, deltaInclVatEur: 0 });
const result = () => ({ groupId: 'split-uuid', current: view(), later: { ...view(), order: { ...view().order, id: 74, number: 'INV-74' } } });
const request = () => salesSplitRequest(eligibility(), { 101: 24, 102: 0 }, '2026-W45');

class ElementStub { control: any = null; closest() { return this.control; } }
const Sheet = isolate(source, 'SalesSplitSheet', ['load', 'laterQuantity', 'remaining', 'laneLines', 'laneQuantity', 'photo', 'sku', 'setQuantity', 'step', 'move', 'setWeek', 'freight', 'extraDiscount', 'discount', 'setOverride', 'invalidatePreview', 'startDrag', 'allowDrop', 'drop', 'endDrag', 'check', 'edit', 'confirm', 'close', 'current', 'ngOnDestroy'],
  { messageOf, salesSplitBlockReason, salesSplitPreviewMatches, salesSplitRequest, crypto: { randomUUID }, Element: ElementStub, Error });
function harness() {
  const sheet = new Sheet(), calls: any[] = [], saved: any[] = [], busy: boolean[] = [], closed: boolean[] = [];
  Object.assign(sheet, { view: signal(view()), dirty: signal(false), externalBusy: signal(false), eligibility: signal(null), quantities: signal({}), quantityErrors: signal({}), overrides: signal({}), deliveryWeek: signal(''), preview: signal(null), loading: signal(false), checking: signal(false), saving: signal(false), uncertain: signal(false), error: signal(''), dragOver: signal(null), desktopDrag: true, freightRequired: () => sheet.view().order.freight === 'TE_BEPALEN',
    version: 0, destroyed: false, draggedLineId: null, checkedRequest: null, commitRequest: null, reloadAfterSave: false,
    saved: { emit: (value: any) => saved.push(value) }, closed: { emit: () => closed.push(true) }, busyChange: { emit: (value: boolean) => busy.push(value) },
    api: { splitEligibility: async (id: number) => { calls.push(['GET', id]); return eligibility(); },
      previewSplit: async (id: number, body: any) => { calls.push(['PREVIEW', id, plain(body)]); return preview(); },
      splitOrder: async (id: number, body: any) => { calls.push(['SPLIT', id, plain(body)]); return result(); } },
  });
  sheet.locked = computed(() => sheet.loading() || sheet.checking() || sheet.saving() || sheet.uncertain() || sheet.dirty() || sheet.externalBusy());
  return { sheet, calls, saved, busy, closed };
}
async function prepared() { const h = harness(); await h.sheet.load(); h.sheet.setQuantity(eligibility().lines[0], 24); h.sheet.setWeek('2026-W45'); await h.sheet.check(); return h; }

test('selection uses stable line ids, leaves product duplicates separate and preserves quantities', () => {
  assert.deepEqual(request(), { lines: [{ lineId: 101, laterQuantity: 24 }, { lineId: 102, laterQuantity: 0 }], deliveryWeek: '2026-W45', currentFreightEur: null, laterFreightEur: null, currentExtraDiscountPct: null, laterExtraDiscountPct: null });
  assert.equal(salesSplitRequest(eligibility(), { 101: null, 102: 24 }, '').deliveryWeek, null);
});

test('both parts need products and only valid whole-carton quantities may be confirmed', () => {
  for (const value of [-1, 49, 1.5, Number.NaN, Infinity]) assert.throws(() => salesSplitRequest(eligibility(), { 101: value }, ''), /geheel aantal/);
  assert.throws(() => salesSplitRequest(eligibility(), { 101: 1 }, ''), /volle dozen van 24/);
  assert.throws(() => salesSplitRequest(eligibility(), {}, ''), /minstens/);
  assert.throws(() => salesSplitRequest(eligibility(), { 101: 48, 102: 24 }, ''), /eerste deel/);
  assert.throws(() => salesSplitRequest(eligibility(), { 101: 24 }, '2026-W99'), /leverweek/);
  assert.throws(() => salesSplitRequest({ ...eligibility(), allowed: false, reason: 'Al uitgeboekt' }, { 101: 24 }, ''), /Al uitgeboekt/);
});

test('freight and full extra-discount overrides distinguish zero from retained defaults and validate inputs', () => {
  const body = salesSplitRequest(eligibility(), { 101: 24 }, '', { currentFreightEur: 0, laterFreightEur: 25.55, currentExtraDiscountPct: 0, laterExtraDiscountPct: 12.5 });
  assert.equal(body.currentFreightEur, 0); assert.equal(body.currentExtraDiscountPct, 0); assert.equal(body.laterExtraDiscountPct, 12.5);
  for (const overrides of [{ currentFreightEur: -1 }, { laterFreightEur: NaN }, { currentExtraDiscountPct: 101 }, { laterExtraDiscountPct: -1 }, { laterFreightEur: 1.001 }]) assert.throws(() => salesSplitRequest(eligibility(), { 101: 24 }, '', overrides));
});

test('unknown original freight requires explicit amounts for both parts and never defaults to free delivery', async () => {
  for (const overrides of [{}, { currentFreightEur: 0 }, { laterFreightEur: 0 }]) {
    assert.throws(() => salesSplitRequest(eligibility(), { 101: 24 }, '', overrides, true), /voor beide delen een vrachtbedrag/);
  }
  const explicitZero = salesSplitRequest(eligibility(), { 101: 24 }, '', { currentFreightEur: 0, laterFreightEur: 0 }, true);
  assert.equal(explicitZero.currentFreightEur, 0); assert.equal(explicitZero.laterFreightEur, 0);
  const { sheet, calls } = harness(); sheet.view.set({ ...view(), order: { ...view().order, freight: 'TE_BEPALEN' } });
  await sheet.load(); sheet.setQuantity(eligibility().lines[0], 24); await sheet.check(); assert.equal(calls.length, 1); assert.match(sheet.error(), /nog niet bepaald/);
  sheet.setOverride('current', 'FreightEur', 12); await sheet.check(); assert.equal(calls.length, 1);
  sheet.setOverride('later', 'FreightEur', 0); await sheet.check(); assert.equal(calls.length, 2); assert.ok(sheet.preview());
});

test('preview requires the same quantity allocation and explicit cent-accurate total differences', () => {
  assert.equal(salesSplitPreviewMatches(preview(), eligibility(), request()), true);
  assert.equal(salesSplitPreviewMatches({ ...preview(), sourceId: 99 }, eligibility(), request()), false);
  assert.equal(salesSplitPreviewMatches({ ...preview(), later: { ...preview().later, quantity: 48 } }, eligibility(), request()), false);
  assert.equal(salesSplitPreviewMatches({ ...preview(), deltaInclVatEur: 0.01 }, eligibility(), request()), false);
  assert.equal(salesSplitPreviewMatches({ ...preview(), later: { ...preview().later, goodsEur: NaN } }, eligibility(), request()), false);
  const changed = { ...preview(), later: part(24, 240, 20), deltaExclVatEur: 20, deltaInclVatEur: 24.2 };
  assert.equal(salesSplitPreviewMatches(changed, eligibility(), { ...request(), laterFreightEur: 20 }), true);
  assert.equal(salesSplitPreviewMatches(changed, eligibility(), { ...request(), laterFreightEur: 25 }), false);
  assert.equal(salesSplitPreviewMatches({ ...changed, deltaExclVatEur: 0 }, eligibility(), request()), false);
});

test('local eligibility clearly excludes accepted quotes, existing invoice history, partner documents and already split documents', () => {
  assert.equal(salesSplitBlockReason(view() as any), null);
  for (const patch of [{ status: 'VERZONDEN' }, { status: 'UITGEREIKT' }, { sentAt: '2026-09-10' }, { goodsShippedAt: '2026-09-10' }, { archivedAt: '2026-09-10' }, { purpose: 'PARTNER_ADVANCE' }, { purpose: 'PARTNER_SETTLEMENT' }, { paidAt: '2026-09-10' }]) assert.ok(salesSplitBlockReason({ ...view(), order: { ...view().order, ...patch } } as any));
  assert.match(salesSplitBlockReason({ ...view(), order: { ...view().order, docType: 'OFFERTE', status: 'GEACCEPTEERD' } } as any)!, /conceptfactuur/);
  assert.ok(salesSplitBlockReason({ ...view(), fulfillment: { groupId: 'existing' } } as any));
  assert.ok(salesSplitBlockReason({ ...view(), paymentSummary: { payments: [{ amountEur: 1 }] } } as any));
});

test('loading eligibility is read only; dirty orders and stale responses never authorize a split', async () => {
  const h = harness(); h.sheet.dirty.set(true); await h.sheet.load(); assert.equal(h.calls.length, 0);
  h.sheet.dirty.set(false); await h.sheet.load(); assert.deepEqual(h.calls, [['GET', 72]]); assert.deepEqual(plain(h.sheet.quantities()), { 101: 0, 102: 0 });
  let finish!: (value: any) => void; h.sheet.api.splitEligibility = () => new Promise(resolve => { finish = resolve; }); const pending = h.sheet.load(); h.sheet.close(); finish(eligibility()); await pending;
  assert.equal(h.sheet.eligibility(), null); assert.equal(h.closed.length, 1); assert.equal(h.saved.length, 0);
});

test('whole-line move, return and carton steppers subtract from the source and preserve the original total', async () => {
  const { sheet } = harness(); await sheet.load(); const line = eligibility().lines[0];
  sheet.move(line, 'later'); assert.equal(sheet.laneQuantity('current'), 24); assert.equal(sheet.laneQuantity('later'), 48);
  sheet.step(line, -1); assert.equal(sheet.laneQuantity('current'), 48); assert.equal(sheet.laneQuantity('later'), 24);
  sheet.move(line, 'current'); assert.equal(sheet.laneQuantity('current'), 72); assert.equal(sheet.laneQuantity('later'), 0);
  sheet.setQuantity(line, 49); assert.equal(sheet.laterQuantity(line), 0); assert.match(sheet.error(), /geheel aantal/);
  sheet.step(line, 1); assert.equal(sheet.laneQuantity('current') + sheet.laneQuantity('later'), 72);
  assert.equal(sheet.laneLines('current').length, 2); assert.equal(sheet.laneLines('later').length, 1);
});

test('native desktop drag accepts only this dialog product and moves it without copying; nested controls remain editable', async () => {
  const { sheet } = harness(); await sheet.load(); const line = eligibility().lines[0]; let prevented = 0;
  const event = { target: new ElementStub(), preventDefault: () => prevented++, dataTransfer: { effectAllowed: '', dropEffect: '', setData() {} } };
  sheet.drop(event, 'later'); assert.equal(sheet.laneQuantity('later'), 0, 'External drag payload cannot move a product');
  sheet.startDrag(event, line); sheet.allowDrop(event, 'later'); assert.equal(sheet.dragOver(), 'later'); sheet.drop(event, 'later');
  assert.equal(sheet.laneQuantity('current'), 24); assert.equal(sheet.laneQuantity('later'), 48); assert.equal(sheet.dragOver(), null);
  event.target.control = {}; sheet.startDrag(event, line); assert.equal(sheet.draggedLineId, null);
  sheet.desktopDrag = false; event.target.control = null; sheet.startDrag(event, line); assert.equal(sheet.draggedLineId, null); assert.ok(prevented >= 3);
});

test('checking prices never splits; all quantity, week, freight or discount edits invalidate its token', async () => {
  for (const edit of [(s: any) => s.move(eligibility().lines[0], 'current'), (s: any) => s.setWeek('2026-W46'), (s: any) => s.setOverride('later', 'FreightEur', 0), (s: any) => s.setOverride('current', 'ExtraDiscountPct', 10)]) {
    const { sheet, calls, saved } = await prepared(); assert.ok(sheet.preview()); assert.deepEqual(calls.map(c => c[0]), ['GET', 'PREVIEW']);
    edit(sheet); assert.equal(sheet.preview(), null); await sheet.confirm(); assert.equal(saved.length, 0); assert.equal(calls.length, 2);
  }
});

test('invalid typed quantities erase the preview and block preview and confirm until that field is corrected', async () => {
  for (const invalid of [-1, 49, 1.5, NaN, Infinity]) {
    const { sheet, calls, saved } = await prepared();
    sheet.setQuantity(eligibility().lines[0], invalid);
    assert.equal(sheet.preview(), null); assert.ok(sheet.quantityErrors()[101]);
    sheet.setWeek('2026-W46'); sheet.setOverride('later', 'ExtraDiscountPct', 0);
    await sheet.check(); await sheet.confirm();
    assert.equal(calls.length, 2, 'The old valid quantity is never silently sent instead');
    assert.match(sheet.error(), /geheel aantal/); assert.equal(saved.length, 0);
    sheet.setQuantity(eligibility().lines[0], 24); assert.equal(sheet.quantityErrors()[101], undefined);
    await sheet.check(); assert.ok(sheet.preview()); assert.equal(calls.length, 3);
  }
});

test('invalid freight or discount overrides remain invalid and cannot reuse a previous server preview', async () => {
  for (const [kind, invalid, corrected] of [['FreightEur', -5, 0], ['ExtraDiscountPct', 101, 0], ['FreightEur', NaN, 0], ['ExtraDiscountPct', 2.555, 0]] as const) {
    const { sheet, calls } = await prepared(); sheet.setOverride('later', kind, invalid);
    assert.equal(sheet.preview(), null); await sheet.check(); await sheet.confirm();
    assert.equal(calls.length, 2); assert.ok(sheet.error());
    sheet.setOverride('later', kind, corrected); await sheet.check(); assert.ok(sheet.preview());
  }
});

test('reloading for another order keeps its eligibility loading state and ignores the old response', async () => {
  const { sheet } = harness(); const finishes: ((value: any) => void)[] = [];
  sheet.api.splitEligibility = () => new Promise(resolve => finishes.push(resolve));
  const old = sheet.load(); sheet.view.set({ ...view(), order: { ...view().order, id: 99 } }); const fresh = sheet.load();
  finishes[0](eligibility()); await old;
  assert.equal(sheet.loading(), true); assert.equal(sheet.eligibility(), null);
  finishes[1]({ ...eligibility(), sourceId: 99, sourceNumber: 'INV-99' }); await fresh;
  assert.equal(sheet.loading(), false); assert.equal(sheet.eligibility().sourceId, 99);
});

test('a constructor reload while saving waits for completion, clears busy and loads only the newly opened order', async () => {
  const { sheet, saved, busy, calls } = await prepared(); let finish!: (value: any) => void;
  sheet.api.splitOrder = () => new Promise(resolve => { finish = resolve; });
  const pending = sheet.confirm(); sheet.view.set({ ...view(), order: { ...view().order, id: 99 } });
  await sheet.load(); assert.equal(sheet.reloadAfterSave, true); assert.equal(sheet.saving(), true); assert.equal(sheet.preview(), null);
  sheet.api.splitEligibility = async (id: number) => { calls.push(['GET', id]); return { ...eligibility(), sourceId: id, sourceNumber: 'INV-99' }; };
  finish(result()); await pending;
  assert.equal(saved.length, 0); assert.deepEqual(busy, [true, false]); assert.equal(sheet.saving(), false);
  assert.equal(sheet.loading(), false); assert.equal(sheet.reloadAfterSave, false); assert.equal(sheet.eligibility().sourceId, 99);
  assert.deepEqual(calls.at(-1), ['GET', 99]);
});

test('confirm is explicit and single-flight; a network retry uses the exact original token, selection and request id', async () => {
  const { sheet, calls, saved, busy, closed } = await prepared(); let finish!: (value: any) => void;
  sheet.api.splitOrder = (id: number, body: any) => { calls.push(['SPLIT', id, plain(body)]); return new Promise(resolve => { finish = resolve; }); };
  const pending = sheet.confirm(); await sheet.confirm(); sheet.close(); sheet.move(eligibility().lines[0], 'current');
  assert.equal(calls.length, 3); assert.equal(closed.length, 0); assert.equal(sheet.laterQuantity(eligibility().lines[0]), 24);
  finish(result()); await pending; assert.equal(saved.length, 1); assert.deepEqual(busy, [true, false]); assert.match(calls[2][2].requestId, /^[0-9a-f-]{36}$/);
  const retry = await prepared(); retry.sheet.api.splitOrder = async (id: number, body: any) => { retry.calls.push(['SPLIT', id, plain(body)]); throw { status: 502 }; };
  await retry.sheet.confirm(); assert.equal(retry.sheet.uncertain(), true); assert.ok(retry.sheet.preview()); retry.sheet.edit(); retry.sheet.setOverride('later', 'FreightEur', 50); assert.equal(retry.sheet.freight('later'), null);
  retry.sheet.api.splitOrder = async (id: number, body: any) => { retry.calls.push(['SPLIT', id, plain(body)]); return result(); }; await retry.sheet.confirm();
  assert.deepEqual(retry.calls[2][2], retry.calls[3][2]); assert.equal(retry.saved.length, 1);
});

test('a definite conflict requires a fresh server preview while retaining user-selected quantities', async () => {
  const { sheet, calls } = await prepared(); sheet.api.splitOrder = async () => { calls.push(['SPLIT']); throw { status: 409, error: { message: 'Deze order is gewijzigd.' } }; };
  await sheet.confirm(); assert.equal(sheet.preview(), null); assert.equal(sheet.uncertain(), false); assert.match(sheet.error(), /order is gewijzigd/); assert.equal(sheet.laterQuantity(eligibility().lines[0]), 24);
  await sheet.confirm(); assert.equal(calls.length, 3); await sheet.check(); assert.equal(calls.at(-1)[0], 'PREVIEW');
});

test('route changes, closing and dirty state prevent stale previews and late split responses reaching another document', async () => {
  const { sheet, saved, busy } = await prepared(); let finish!: (value: any) => void;
  sheet.api.splitOrder = () => new Promise(resolve => { finish = resolve; }); const pending = sheet.confirm(); sheet.view.set({ ...view(), order: { ...view().order, id: 99 } }); finish(result()); await pending;
  assert.equal(saved.length, 0); assert.deepEqual(busy, [true, false]);
  const dirty = await prepared(); dirty.sheet.dirty.set(true); await dirty.sheet.confirm(); assert.equal(dirty.calls.length, 2);
  const stale = harness(); await stale.sheet.load(); stale.sheet.move(eligibility().lines[1], 'later'); stale.sheet.api.previewSplit = () => new Promise(resolve => { finish = resolve; });
  const checking = stale.sheet.check(); stale.sheet.close(); finish(preview()); await checking; assert.equal(stale.sheet.preview(), null);
});

test('API calls only the dedicated eligibility, preview, split and readiness endpoints with explicit bodies', async () => {
  const Api = isolate(apiSource, 'SalesApi', ['splitEligibility', 'previewSplit', 'splitOrder', 'markFulfillmentReady'], { firstValueFrom, api: (path: string) => path });
  const instance = new Api(), calls: any[] = []; instance.http = { get: (path: string) => { calls.push(['GET', path]); return of(eligibility()); }, post: (path: string, body: any) => { calls.push(['POST', path, plain(body)]); return of(result()); } };
  const body = { ...request(), requestId: 'uuid', previewToken: 'token' }; await instance.splitEligibility(72); await instance.previewSplit(72, request()); await instance.splitOrder(72, body); await instance.markFulfillmentReady(74);
  assert.deepEqual(calls.map(c => c.slice(0, 2)), [['GET', '/api/sales-orders/72/split'], ['POST', '/api/sales-orders/72/split/preview'], ['POST', '/api/sales-orders/72/split'], ['POST', '/api/sales-orders/74/fulfillment-ready']]);
  assert.deepEqual(calls[2][2], body); assert.deepEqual(calls[3][2], {});
});

test('template exposes two accessible lanes, carton controls, financial differences and authentic photo binding', () => {
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1]; assert.ok(template); assert.equal(parseTemplate(template, 'sales-split-sheet.html').errors, null);
  assert.match(template, /data-split-lane/); assert.match(template, /Alles later/); assert.match(template, /Alles terug/); assert.match(template, /Later leveren/);
  assert.match(template, /type="number" inputmode="numeric"/); assert.match(template, /aria-label/); assert.match(template, /Verdeling controleren/); assert.match(template, /Order splitsen/);
  assert.match(template, /deltaExclVatEur/); assert.match(template, /deltaInclVatEur/); assert.match(template, /appAuthSrc/); assert.doesNotMatch(template, /innerHTML/);
  assert.match(source, /prefers-reduced-motion/); assert.match(source, /untracked/);
});
