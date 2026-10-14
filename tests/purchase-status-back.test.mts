import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import type { PurchaseOrder, PurchaseOrderView, PurchasePayment } from '../src/app/core/api/models.ts';
import {
  STATUS_BACK_LABEL, defaultStatusBack, statusBackOptions, type StatusBackInput,
} from '../src/app/features/purchasing/purchase-status-back.ts';

const payment: PurchasePayment = { id: 70, orderId: 50, paidOn: '2026-10-01', amount: 5_000, amountEur: 5_000,
  currency: 'EUR', label: '30% bij bestelling', actor: null, recordedAt: '2026-10-01T10:00:00Z', payee: 'SUPPLIER',
  settles: false, instalmentDue: 'ORDERED' };

function input(overrides: Partial<StatusBackInput> = {}): StatusBackInput {
  return { status: 'ONDERWEG', payments: [], paymentStateError: null, paidEur: null, creditCount: 0, ...overrides };
}

/* ---- the helper: which statuses, which reasons ----------------------- */

test('Vertrokken offers Besteld first and Concept second; Besteld offers Concept; Concept and Ontvangen offer nothing', () => {
  assert.deepEqual(statusBackOptions(input()).map(option => option.to), ['BESTELD', 'CONCEPT']);
  assert.deepEqual(statusBackOptions(input({ status: 'BESTELD' })).map(option => option.to), ['CONCEPT']);
  assert.deepEqual(statusBackOptions(input({ status: 'CONCEPT' })), []);
  assert.deepEqual(statusBackOptions(input({ status: 'ONTVANGEN' })), []);
  assert.deepEqual(statusBackOptions(input()).map(option => option.label), ['Besteld', 'Concept']);
  assert.equal(STATUS_BACK_LABEL.ONDERWEG, 'Vertrokken');
});

test('the lines name the consequences; only a departed container mentions the departure date', () => {
  const [ordered, conceptFromDeparted] = statusBackOptions(input());
  assert.deepEqual(ordered.lines, [
    'De vertrekdatum wordt gewist. Bij het echte vertrek komt de juiste datum.',
    'Track & trace, B/L en documenten blijven.',
    'Betaalde termijnen bij vertrek blijven betaald; wat open staat schuift naar later.',
    'Er gaat geen melding uit.',
  ]);
  assert.deepEqual(conceptFromDeparted.lines, [
    'De vertrekdatum wordt gewist.',
    'De order telt niet meer als inkomende voorraad.',
    'Bij opnieuw bestellen worden de bestelde aantallen opnieuw vastgelegd.',
    'Track & trace, B/L en documenten blijven.',
    'Er gaat geen melding uit.',
  ]);
  const [conceptFromOrdered] = statusBackOptions(input({ status: 'BESTELD' }));
  assert.equal(conceptFromOrdered.lines.includes('De vertrekdatum wordt gewist.'), false);
  assert.equal(conceptFromOrdered.lines[0], 'De order telt niet meer als inkomende voorraad.');
});

test('Concept is blocked with the first reason that applies, in the server order', () => {
  const blocked = (overrides: Partial<StatusBackInput>) =>
    statusBackOptions(input({ status: 'BESTELD', ...overrides }))[0].blocked;
  assert.equal(blocked({}), undefined);
  assert.equal(blocked({ payments: null }), 'Betalingen nog niet geladen');
  assert.equal(blocked({ paymentStateError: 'Verbinding verbroken' }), 'Betalingen nog niet geladen');
  assert.equal(blocked({ payments: null, paidEur: 100, creditCount: 1 }), 'Betalingen nog niet geladen');
  assert.equal(blocked({ payments: [payment] }), 'Er zijn al betalingen geboekt');
  assert.equal(blocked({ paidEur: 1_250 }), 'Er zijn al betalingen geboekt');
  assert.equal(blocked({ paidEur: -10 }), 'Er zijn al betalingen geboekt', 'the server refuses any non-zero legacy total');
  assert.equal(blocked({ paidEur: 0 }), undefined);
  assert.equal(blocked({ payments: [payment], creditCount: 2 }), 'Er zijn al betalingen geboekt');
  assert.equal(blocked({ creditCount: 1 }), 'Er staat een tegoed van de leverancier op');
  assert.equal('blocked' in statusBackOptions(input({ status: 'BESTELD' }))[0], false, 'an open option carries no blocked key');
});

test('Besteld is never blocked, whatever was paid, credited or failed to load', () => {
  for (const overrides of [{ payments: null }, { paymentStateError: 'kapot' }, { payments: [payment] },
    { paidEur: 900 }, { creditCount: 3 }] satisfies Partial<StatusBackInput>[]) {
    const [ordered, concept] = statusBackOptions(input(overrides));
    assert.equal(ordered.to, 'BESTELD');
    assert.equal(ordered.blocked, undefined, JSON.stringify(overrides));
    assert.ok(concept.blocked, JSON.stringify(overrides));
  }
});

test('the sheet starts on the nearest open option and keeps a choice while it stays open', () => {
  const open = statusBackOptions(input());
  assert.equal(defaultStatusBack(open), 'BESTELD');
  assert.equal(defaultStatusBack(open, 'CONCEPT'), 'CONCEPT');
  const paid = statusBackOptions(input({ payments: [payment] }));
  assert.equal(defaultStatusBack(paid, 'CONCEPT'), 'BESTELD', 'a choice that became blocked falls back');
  assert.equal(defaultStatusBack(statusBackOptions(input({ status: 'BESTELD', creditCount: 1 }))), null);
  assert.equal(defaultStatusBack(statusBackOptions(input({ status: 'BESTELD' }))), 'CONCEPT');
  assert.equal(defaultStatusBack([]), null);
});

/* ---- the editor: the real members, transport and toasts mocked -------- */

const source = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseEditor');
assert.ok(original);
const names = new Set(['stepBack', 'stepBackOptions', 'stepBackBusy', 'openStepBack', 'closeStepBack', 'confirmStepBack',
  'save', 'savedOrder', 'saving', 'deletingOrder', 'dirty', 'previewTimer', 'previewVersion', 'payments', 'paymentStateError',
  'paymentPlanBusy', 'payingBusy', 'orderPlaced', 'statusCelebration', 'firstInstalmentPrompt', 'adjustments']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

function departed(status: PurchaseOrder['status'] = 'ONDERWEG'): PurchaseOrderView {
  return {
    order: { id: 50, number: 'PO-50', status, supplierId: 7, alias: 'Container', notes: '',
      shippedOn: status === 'ONDERWEG' ? '2026-10-13' : null, trackingReference: 'MSKU1234567',
      expectedArrival: '2026-11-20', lines: [{ id: 1, productId: 10, quantity: 24 }] },
    costing: { totals: { goodsEur: 10_000, totalEur: 12_000 } },
    supplierCredits: [],
  } as unknown as PurchaseOrderView;
}

function setup(view = departed()) {
  const puts: PurchaseOrder[] = [];
  const toasts: [string, string | undefined][] = [];
  const api = {
    update: async (_id: number, order: PurchaseOrder): Promise<PurchaseOrderView> =>
      ({ ...departed(order.status), order: { ...clone(order), shippedOn: order.status === 'ONDERWEG' ? order.shippedOn : null } }),
  };
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, signal, computed, clearTimeout, statusBackOptions,
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback });
  const editor = new exports['PurchaseEditor']();
  Object.assign(editor, {
    view: signal(view),
    negativeExtra: () => false,
    ui: { toast: (text: string, kind?: string) => toasts.push([text, kind]) },
    sourcing: { updatePurchaseOrder: (id: number, order: PurchaseOrder) => { puts.push(clone(order)); return api.update(id, order); } },
    catalog: { products: async () => [] },
  });
  editor.savedOrder.set(JSON.stringify(view.order));
  editor.payments.set([]);
  return { editor, api, puts, toasts };
}

test('Vertrokken back to Besteld saves the status with the departure date cleared and keeps track & trace', async () => {
  const { editor, puts, toasts } = setup();
  editor.openStepBack();
  assert.equal(editor.stepBack(), true);
  await editor.confirmStepBack('BESTELD');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].status, 'BESTELD');
  assert.equal(puts[0].shippedOn, null);
  assert.equal(puts[0].trackingReference, 'MSKU1234567');
  assert.equal(puts[0].expectedArrival, '2026-11-20');
  assert.equal(editor.view().order.status, 'BESTELD');
  assert.equal(editor.dirty(), false);
  assert.equal(editor.stepBack(), false, 'the sheet closes on success');
  assert.deepEqual(toasts.at(-1), ['Status teruggezet naar Besteld', 'ok']);
  assert.equal(editor.orderPlaced(), false, 'no ordered celebration');
  assert.equal(editor.statusCelebration(), null, 'no departure celebration');
  assert.equal(editor.firstInstalmentPrompt(), null, 'no first-instalment prompt');
});

test('Vertrokken back to Concept goes in one save when nothing was paid', async () => {
  const { editor, puts, toasts } = setup();
  editor.openStepBack();
  await editor.confirmStepBack('CONCEPT');
  assert.deepEqual(puts.map(order => [order.status, order.shippedOn]), [['CONCEPT', null]]);
  assert.equal(editor.view().order.status, 'CONCEPT');
  assert.deepEqual(toasts.at(-1), ['Status teruggezet naar Concept', 'ok']);
  editor.openStepBack();
  assert.equal(editor.stepBack(), false, 'a concept container has nowhere to go back to');
});

test('a refused save puts status and departure date back in the draft and keeps the sheet open', async () => {
  const { editor, api, puts, toasts } = setup();
  api.update = async () => { throw new Error('Terug naar Concept kan niet: er zijn al betalingen geboekt op deze container.'); };
  editor.openStepBack();
  await editor.confirmStepBack('CONCEPT');
  assert.equal(puts.length, 1);
  assert.equal(editor.view().order.status, 'ONDERWEG');
  assert.equal(editor.view().order.shippedOn, '2026-10-13');
  assert.equal(editor.dirty(), false, 'the restored draft equals the saved order');
  assert.equal(editor.stepBack(), true);
  assert.equal(editor.saving(), false);
  assert.deepEqual(toasts, [['Terug naar Concept kan niet: er zijn al betalingen geboekt op deze container.', 'err']]);
});

test('unsaved edits go along with the step back, and stay in the draft when it is refused', async () => {
  const ok = setup();
  ok.editor.view.update((data: PurchaseOrderView) => ({ ...data, order: { ...data.order, alias: 'Nieuwe naam' } }));
  assert.equal(ok.editor.dirty(), true);
  await ok.editor.confirmStepBack('BESTELD');
  assert.equal(ok.puts[0].alias, 'Nieuwe naam');
  assert.equal(ok.editor.dirty(), false);

  const refused = setup();
  refused.api.update = async () => { throw new Error('Inkooporder kan niet van ONDERWEG naar BESTELD gaan'); };
  refused.editor.view.update((data: PurchaseOrderView) => ({ ...data, order: { ...data.order, alias: 'Nieuwe naam' } }));
  await refused.editor.confirmStepBack('BESTELD');
  assert.equal(refused.editor.view().order.status, 'ONDERWEG');
  assert.equal(refused.editor.view().order.shippedOn, '2026-10-13');
  assert.equal(refused.editor.view().order.alias, 'Nieuwe naam');
  assert.equal(refused.editor.dirty(), true);
});

test('a busy editor, a blocked option or a status without that option sends nothing', async () => {
  for (const busy of ['saving', 'deletingOrder', 'paymentPlanBusy', 'payingBusy']) {
    const { editor, puts } = setup();
    editor[busy].set(true);
    await editor.confirmStepBack('BESTELD');
    assert.equal(puts.length, 0, busy);
    assert.equal(editor.view().order.status, 'ONDERWEG', busy);
  }

  const paid = setup(departed('BESTELD'));
  paid.editor.payments.set([payment]);
  await paid.editor.confirmStepBack('CONCEPT');
  assert.equal(paid.puts.length, 0);
  assert.equal(paid.editor.stepBackOptions()[0].blocked, 'Er zijn al betalingen geboekt');

  const credited = setup(departed('BESTELD'));
  credited.editor.view.update((data: PurchaseOrderView) => ({ ...data, supplierCredits: [{ id: 1 }] }));
  await credited.editor.confirmStepBack('CONCEPT');
  assert.equal(credited.puts.length, 0);

  const loading = setup();
  loading.editor.payments.set(null);
  await loading.editor.confirmStepBack('CONCEPT');
  assert.equal(loading.puts.length, 0, 'Concept waits for the payments');
  await loading.editor.confirmStepBack('BESTELD');
  assert.equal(loading.puts.length, 1, 'Besteld does not');

  const ordered = setup(departed('BESTELD'));
  await ordered.editor.confirmStepBack('BESTELD');
  assert.equal(ordered.puts.length, 0, 'Besteld is not a step back from Besteld');

  for (const status of ['CONCEPT', 'ONTVANGEN'] as const) {
    const { editor, puts } = setup(departed(status));
    editor.openStepBack();
    assert.equal(editor.stepBack(), false, status);
    await editor.confirmStepBack('CONCEPT');
    assert.equal(puts.length, 0, status);
  }
});

test('a second confirm while the first save runs sends one PUT', async () => {
  const { editor, api, puts } = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const update = api.update;
  api.update = async (id, order) => { await gate; return update(id, order); };
  const first = editor.confirmStepBack('BESTELD');
  await editor.confirmStepBack('CONCEPT');
  release();
  await first;
  assert.deepEqual(puts.map(order => order.status), ['BESTELD']);
});

/* ---- the templates: one place each, the sheet parses ----------------- */

test('desk and phone offer the step back once, only for Besteld and Vertrokken, and render the sheet', async () => {
  const desk = await readFile(new URL('../src/app/features/purchasing/purchase-desk.ts', import.meta.url), 'utf8');
  for (const [name, text] of [['phone', source], ['desk', desk]] as const) {
    assert.equal(text.match(/\(click\)="openStepBack\(\)"/g)?.length, 1, name);
    assert.equal(text.match(/<app-purchase-status-back-sheet /g)?.length, 1, name);
    assert.match(text, /@if \(data\.order\.status === 'BESTELD' \|\| data\.order\.status === 'ONDERWEG'\) \{\s*(<!--[^>]*-->\s*)?<button[^>]*openStepBack/, name);
    assert.match(text, /Status terugzetten…/, name);
  }
  const sheet = await readFile(new URL('../src/app/features/purchasing/purchase-status-back-sheet.ts', import.meta.url), 'utf8');
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(sheet)?.[1];
  assert.ok(template);
  assert.equal(parseTemplate(template, 'purchase-status-back-sheet.html').errors, null);
  assert.match(template, /title="Status terugzetten"/);
  assert.match(template, /variant="ios"/);
  assert.match(template, /Nu: \{\{ currentLabel\(\) \}\}/);
  assert.match(template, /Je openstaande wijzigingen worden mee opgeslagen\./);
  assert.match(template, /'Terugzetten naar ' \+/);
  assert.doesNotMatch(sheet, /inject\(/, 'the sheet only has inputs and outputs');
});
