import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';
import { messageOf } from '../src/app/core/api/errors.ts';
import * as orderSteps from '../src/app/features/products/product-order-step.ts';

const source = (file: string) => readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');

async function isolate(names: string[]) {
  const parsed = ts.createSourceFile('sales-editor', await source('sales-editor'), ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((n): n is ts.ClassDeclaration => ts.isClassDeclaration(n) && n.name?.text === 'SalesEditor'); assert.ok(cls);
  const members = cls.members.filter(m => m.name && names.includes(m.name.getText(parsed))); assert.equal(members.length, names.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  /* The timers are looked up per call, so the mocked clock of a test is the one the editor uses. */
  vm.runInNewContext(js, { exports, signal, messageOf, Math, Number, ...orderSteps,
    setTimeout: (run: () => void, ms: number) => globalThis.setTimeout(run, ms), clearTimeout: (id: any) => globalThis.clearTimeout(id) });
  return exports.SalesEditor;
}
const Editor = await isolate(['enqueue', 'schedulePreview', 'flushPreview', 'preview', 'setLine', 'setLineQuantity', 'currentQuantity',
  'unitsPerStep', 'lineOrderStep', 'lineStepNotice']);

/** A quote with one line of 60 pieces in cartons of 30; the server prices whole cartons, as the real one does. */
function harness() {
  const requests: number[] = [], answers: Array<() => void> = [];
  const priced = (quantity: number) => { const whole = Math.ceil(quantity / 30) * 30; return { lines: [{ productId: 1, quantity: whole, net: whole * 5.75 }] }; };
  const screen = new Editor();
  Object.assign(screen, {
    view: signal({ order: { id: 78, lines: [{ productId: 1, quantity: 60 }] }, priced: priced(60) }),
    products: () => [{ id: 1, carton: { piecesPerCarton: 30 } }],
    previewError: signal(null), figuresWaiting: signal(false), linePending: signal({}), creditPriceOver: signal({}),
    previewTimer: null, previewVersion: 0,
    canEdit: () => true, mobileCommercialEditable: () => true, mobileAcceptsDraft: () => true,
    lineUnavailable: () => false, creditLineCap: () => null, canToggleLineAvailability: () => false,
    sales: { previewOrder: (_id: number, order: any) => {
      const quantity = order.lines[0].quantity; requests.push(quantity);
      return new Promise(resolve => answers.push(() => resolve({ order, priced: priced(quantity) })));
    } },
  });
  /** Lets every answer that is under way land. */
  const answer = async () => { for (const land of answers.splice(0)) land(); await new Promise(setImmediate); };
  return { screen, requests, answer, shown: () => screen.view().priced.lines[0] };
}
const clock = (t: { mock: { timers: { enable(options: { apis: string[] }): void; tick(ms: number): void } } }) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); return t.mock.timers;
};

test('a typed quantity is priced five seconds after the last digit, once, and without saving', async (t) => {
  const timers = clock(t), { screen, requests, answer, shown } = harness();
  screen.setLineQuantity(1, 9);
  timers.tick(1000);
  assert.deepEqual(requests, [], 'nothing is priced between two digits');
  assert.equal(shown().quantity, 60, 'the field is not rewritten while typing');
  screen.setLineQuantity(1, 90);
  assert.equal(screen.figuresWaiting(), true);
  timers.tick(4999);
  assert.deepEqual(requests, []);
  timers.tick(1);
  assert.deepEqual(requests, [90]);
  await answer();
  assert.equal(shown().quantity, 90); assert.equal(shown().net, 517.5);
  assert.equal(screen.figuresWaiting(), false);
  assert.equal(screen.view().order.lines[0].quantity, 90, 'the draft keeps what was typed');
});

test('leaving the field or pressing Enter prices at once', async (t) => {
  const timers = clock(t), { screen, requests, answer, shown } = harness();
  screen.setLineQuantity(1, 120);
  screen.flushPreview();
  assert.deepEqual(requests, [120]);
  await answer();
  assert.equal(shown().net, 690);
  screen.flushPreview(); timers.tick(10000);
  assert.deepEqual(requests, [120], 'nothing waits, so nothing is priced again');
});

test('an answer for an older number does not land on a newer one', async (t) => {
  const timers = clock(t), { screen, requests, answer, shown } = harness();
  screen.setLineQuantity(1, 9);
  screen.flushPreview();
  screen.setLineQuantity(1, 90);
  await answer();
  assert.equal(shown().quantity, 60, 'the answer for 9 would write 30 into the field');
  assert.equal(screen.figuresWaiting(), true);
  timers.tick(5000); await answer();
  assert.deepEqual(requests, [9, 90]); assert.equal(shown().quantity, 90);
});

test('every other edit prices right away and takes a waiting quantity along', async (t) => {
  const timers = clock(t), { screen, requests, answer, shown } = harness();
  screen.setLineQuantity(1, 90);
  screen.setLine(1, { manualDiscountPct: 10 });
  timers.tick(250);
  assert.deepEqual(requests, [90]);
  await answer();
  assert.equal(shown().quantity, 90); assert.equal(screen.figuresWaiting(), false);
  assert.equal(screen.view().order.lines[0].manualDiscountPct, 10);
});

test('a failed recalculation says so and stops waiting', async (t) => {
  const timers = clock(t), { screen } = harness();
  screen.sales.previewOrder = () => Promise.reject(new Error('offline'));
  screen.setLineQuantity(1, 90); timers.tick(5000); await new Promise(setImmediate);
  assert.equal(screen.figuresWaiting(), false); assert.ok(screen.previewError());
});

test('both quantity fields end the pause on blur and on Enter, and show which amounts wait', async () => {
  for (const file of ['sales-desk', 'sales-editor']) {
    const text = await source(file);
    const field = text.match(/\(ngModelChange\)="setLineQuantity\(line\.productId, \$event\)"\s*\n\s*\(blur\)="flushPreview\(\)" \(keydown\.enter\)="flushPreview\(\)"/g);
    assert.equal(field?.length, 1, file);
    assert.equal(text.match(/setLineQuantity\(line\.productId, \$event\)/g)?.length, 1, file);
    assert.match(text, /--waiting\]="figuresWaiting\(\)"/, file);
  }
});

/** The quote of the harness, with one product as the catalogue has it and, optionally, the server's answer for the line. */
function stepHarness(product: Record<string, unknown>, pricedLine: Record<string, unknown> = {}) {
  const screen = new Editor();
  Object.assign(screen, {
    view: signal({ order: { id: 78, lines: [{ productId: 1, quantity: 12 }] }, priced: { lines: [{ productId: 1, quantity: 12, ...pricedLine }] } }),
    products: () => [{ id: 1, ...product }],
    previewError: signal(null), figuresWaiting: signal(false), linePending: signal({}), creditPriceOver: signal({}),
    previewTimer: null, previewVersion: 0,
    canEdit: () => true, mobileCommercialEditable: () => true, mobileAcceptsDraft: () => true,
    lineUnavailable: () => false, creditLineCap: () => null, canToggleLineAvailability: () => false,
    sales: { previewOrder: () => new Promise(() => {}) },
  });
  return screen;
}
const stolp = (orderStep?: string) => ({ carton: { piecesPerCarton: 12 }, packaging: { kind: 'NONE', unitKey: 'stolp', orderStep } });
const bowlDisplay = (orderStep?: string) => ({ carton: { piecesPerCarton: 40 },
  packaging: { kind: 'DISPLAY', piecesPerUnit: 8, salesUnit: 'PIECE', unitKey: 'bowl', orderStep } });

test('the hint follows the order step: a full carton, a display, never one unit', (t) => {
  clock(t);
  const carton = stepHarness(stolp());
  carton.setLineQuantity(1, 13);
  assert.equal(carton.linePending()[1], 24);
  assert.equal(carton.lineStepNotice(1), 'Volle doos');

  const display = stepHarness(bowlDisplay('PACKAGE'));
  display.setLineQuantity(1, 10);
  assert.equal(display.linePending()[1], 16);
  assert.equal(display.lineStepNotice(1), 'Per display van 8');
  display.setLineQuantity(1, 24);
  assert.equal(display.linePending()[1], undefined, 'three whole displays need no notice');

  const unit = stepHarness(stolp('UNIT'));
  unit.setLineQuantity(1, 3);
  assert.deepEqual({ ...unit.linePending() }, {}, 'per stolp every number stands');
  assert.equal(unit.view().order.lines[0].quantity, 3, 'the draft keeps what was typed');
});

test('the priced line decides: the server\'s step wins over the catalogue, a step of one shows nothing', (t) => {
  clock(t);
  // A partner deal or a container-cost quote: the server does not round, so neither does the hint.
  const exempt = stepHarness(stolp(), { unitsPerOrderStep: 1, orderStep: 'CARTON' });
  exempt.setLineQuantity(1, 13);
  assert.deepEqual({ ...exempt.linePending() }, {});
  // A document stamped with an earlier step keeps it until it is saved again.
  const stamped = stepHarness(stolp('UNIT'), { unitsPerOrderStep: 12, orderStep: 'CARTON' });
  stamped.setLineQuantity(1, 13);
  assert.equal(stamped.linePending()[1], 24);
  // Fixtures and older servers without any step read as full cartons.
  const older = stepHarness({ carton: { piecesPerCarton: 30 } });
  older.setLineQuantity(1, 31);
  assert.equal(older.linePending()[1], 60);
  assert.equal(older.lineStepNotice(1), 'Volle doos');
});

test('both quantity hints name the step and the save toast no longer promises full cartons', async () => {
  for (const file of ['sales-desk', 'sales-editor']) {
    const text = await source(file);
    assert.match(text, /\{\{ lineStepNotice\(line\.productId\) \}\}: wordt/, file);
    assert.doesNotMatch(text, /Volle doos: wordt/, file);
  }
  const editor = await source('sales-editor');
  assert.match(editor, /aantal afgerond op het bestelveelvoud/);
  assert.doesNotMatch(editor, /naar volle dozen berekend/);
});
