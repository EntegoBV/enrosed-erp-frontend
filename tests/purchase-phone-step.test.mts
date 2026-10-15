import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { stepTarget, type StepHandoff } from '../src/app/features/purchasing/purchase-phone-model.ts';

/*
 * The phone's confirmed next step: the read view hands it over in memory, the
 * editor runs it once its payments are in, and the screen goes back to the
 * view on the same tab once every sheet of the step has closed. The real
 * members run here; the editor, the router and the toasts are stubs.
 */

/** The class as plain JavaScript, decorator and imports dropped; only `names` kept. */
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

/* ---- PurchaseScreen: take, run, return ---------------------------------- */

const screenSource = await readFile(new URL('../src/app/features/purchasing/purchase-screen.ts', import.meta.url), 'utf8');
const screenJs = isolatedClass(screenSource, 'purchase-screen.ts', 'PurchaseScreen', new Set(['runHandedStep', 'returnFromStep', 'returnAfterStep']));

function editorStub(started = true) {
  const calls: unknown[][] = [];
  return {
    calls,
    view: signal<{ order: { id: number } } | null>({ order: { id: 50 } }), payments: signal<unknown[] | null>([]),
    paymentStateLoading: signal(false), paymentStateError: signal<string | null>(null),
    stepFlowBusy: signal(false), keepAfterStep: signal(false), dirty: signal(false), handedFromView: signal(false),
    runStep: (step: string, tracking: string | null) => { calls.push(['run', step, tracking]); return started; },
  };
}

function screenHarness(handoff: StepHandoff | null, editor = editorStub()) {
  const calls: unknown[][] = [];
  let pending = handoff;
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(screenJs, { exports, signal, untracked: (callback: () => void) => callback() });
  const screen = new exports['PurchaseScreen']();
  Object.assign(screen, {
    id: signal('50'), editor: signal<ReturnType<typeof editorStub> | null>(editor),
    stepHandoff: { take: (orderId: number, now: number) => {
      calls.push(['take', orderId, typeof now]);
      const taken = pending && pending.orderId === orderId ? pending : null;
      if (taken) pending = null;
      return taken;
    } },
    ui: { toast: (text: string) => calls.push(['toast', text]) },
    router: { navigate: (commands: unknown[], extras: unknown) => { calls.push(['navigate', structuredClone(commands), structuredClone(extras)]); return Promise.resolve(true); } },
  });
  return { screen, editor, calls, run: () => { screen.runHandedStep(); screen.returnFromStep(); } };
}

const handoff = (extra: Partial<StepHandoff> = {}): StepHandoff =>
  ({ orderId: 50, step: 'VERTROKKEN', tracking: 'MSKU 7741203', tab: 'kosten', at: Date.now(), ...extra });

test('the editor runs the handed step only once the order and its payments are in, and only once', () => {
  const state = screenHarness(handoff());
  state.editor.view.set(null); state.run();
  state.editor.view.set({ order: { id: 49 } }); state.run();
  state.editor.view.set({ order: { id: 50 } }); state.editor.payments.set(null); state.run();
  state.editor.payments.set([]); state.editor.paymentStateLoading.set(true); state.run();
  state.editor.paymentStateLoading.set(false); state.editor.paymentStateError.set('Niet actueel'); state.run();
  assert.deepEqual(state.calls, [], 'nothing is taken before the editor is ready');
  state.editor.paymentStateError.set(null);
  state.editor.stepFlowBusy.set(true);
  state.run();
  assert.deepEqual(state.editor.calls, [['run', 'VERTROKKEN', 'MSKU 7741203']]);
  assert.equal(state.editor.handedFromView(), true);
  state.run();
  assert.equal(state.editor.calls.length, 1, 'the handoff is taken once');
  assert.equal(state.calls.filter((call) => call[0] === 'navigate').length, 0, 'no return while the step runs');
});

test('back to the view on the same tab once the step is idle; Overzicht leaves the tab out', () => {
  for (const [tab, extras] of [['kosten', { queryParams: { tab: 'kosten' }, replaceUrl: true }], ['overzicht', { replaceUrl: true }]] as const) {
    const state = screenHarness(handoff({ tab }));
    state.editor.stepFlowBusy.set(true);
    state.run();
    state.run();
    assert.equal(state.calls.some((call) => call[0] === 'navigate'), false);
    state.editor.stepFlowBusy.set(false);
    state.run();
    assert.deepEqual(state.calls.filter((call) => call[0] === 'navigate'), [['navigate', ['/purchasing', '50'], extras]]);
    state.run();
    assert.equal(state.calls.filter((call) => call[0] === 'navigate').length, 1, 'once');
  }
});

test('Track & trace invullen keeps the editor; so does a draft a refused save left behind', () => {
  const kept = screenHarness(handoff());
  kept.editor.stepFlowBusy.set(true); kept.run();
  kept.editor.keepAfterStep.set(true); kept.editor.stepFlowBusy.set(false); kept.run();
  kept.editor.keepAfterStep.set(false); kept.run();
  assert.equal(kept.calls.some((call) => call[0] === 'navigate'), false);
  const refused = screenHarness(handoff());
  refused.editor.stepFlowBusy.set(true); refused.run();
  refused.editor.dirty.set(true); refused.editor.stepFlowBusy.set(false); refused.run();
  refused.editor.dirty.set(false); refused.run();
  assert.equal(refused.calls.some((call) => call[0] === 'navigate'), false, 'the unsaved-changes question never interrupts');
});

test('a new editor or another order clears the way back', () => {
  for (const leave of ['editor', 'id'] as const) {
    const state = screenHarness(handoff());
    state.editor.stepFlowBusy.set(true); state.run();
    if (leave === 'editor') state.screen.editor.set(editorStub());
    else state.screen.id.set('51');
    state.run();
    assert.equal(state.screen.returnAfterStep(), null, leave);
    state.screen.editor.set(state.editor); state.screen.id.set('50'); state.editor.stepFlowBusy.set(false); state.run();
    assert.equal(state.calls.some((call) => call[0] === 'navigate'), false, leave);
  }
});

test('a step that no longer applies says so and goes back to the view', () => {
  const state = screenHarness(handoff({ tab: 'betalingen' }), editorStub(false));
  state.run();
  assert.deepEqual(state.calls.filter((call) => call[0] === 'toast'), [['toast', 'De container staat al verder; er is niets gewijzigd.']]);
  assert.equal(state.editor.handedFromView(), false);
  state.run();
  assert.deepEqual(state.calls.filter((call) => call[0] === 'navigate'), [['navigate', ['/purchasing', '50'], { queryParams: { tab: 'betalingen' }, replaceUrl: true }]]);
});

test('without a handoff the editor is left alone', () => {
  const state = screenHarness(null);
  state.run();
  assert.deepEqual(state.editor.calls, []);
  assert.deepEqual(state.calls.map((call) => call[0]), ['take']);
});

/* ---- PurchaseEditor.runStep and stepFlowBusy ----------------------------- */

const editorSource = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const editorJs = isolatedClass(editorSource, 'purchase-editor.ts', 'PurchaseEditor', new Set(['runStep', 'stepFlowBusy', 'applyCostsNow', 'applyingCosts']));

function editorHarness(order: Record<string, unknown>, nextTo: string | null, dirty = false) {
  const calls: unknown[][] = [];
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(editorJs, { exports, signal, computed, stepTarget,
    messageOf: (failure: unknown, fallback: string) => failure instanceof Error ? failure.message : fallback });
  const editor = new exports['PurchaseEditor']();
  Object.assign(editor, {
    view: signal({ order: { id: 50, supplierId: 7, number: 'PO-50', trackingReference: null, stockBooked: null, ...order } }),
    nextStep: () => nextTo ? { action: 'x', to: nextTo } : null,
    dirty: () => dirty,
    patch: (changes: unknown) => calls.push(['patch', structuredClone(changes)]),
    advanceStatus: () => calls.push(['advance']),
    bookStock: async () => { calls.push(['book']); },
    save: async () => { calls.push(['save']); return { order: {} }; },
    saving: signal(false), booking: signal(false), receiving: signal(null), orderPlaced: signal(false), statusCelebration: signal(null),
    firstInstalmentPrompt: signal(null), paying: signal(null), payingBusy: signal(false),
    sourcing: { applyLandedCosts: async (id: number) => calls.push(['apply', id]) },
    catalog: { products: async (supplier: number) => { calls.push(['products', supplier]); return []; } },
    products: { set: () => calls.push(['products set']) },
    reloadOrderQuietly: async () => calls.push(['reload']),
    ui: { toast: (text: string, kind?: string) => calls.push(['toast', text, kind]) },
  });
  return { editor, calls };
}

test('a departure writes a changed track & trace first, then the status, the way the desk does', () => {
  const run = (current: string | null, typed: string | null) => {
    const state = editorHarness({ status: 'BESTELD', trackingReference: current }, 'ONDERWEG');
    assert.equal(state.editor.runStep('VERTROKKEN', typed), true);
    return state.calls;
  };
  assert.deepEqual(run(null, ' MSKU 7741203 '), [['patch', { trackingReference: 'MSKU 7741203' }], ['advance']]);
  assert.deepEqual(run('MSKU 7741203', 'MSKU 7741203'), [['advance']], 'unchanged: no patch');
  assert.deepEqual(run('OLD', null), [['advance']], 'no field, no patch');
  assert.deepEqual(run(null, '   '), [['advance']]);
  assert.deepEqual(run('OLD', ''), [['patch', { trackingReference: null }], ['advance']], 'emptied on purpose');
  const ordered = editorHarness({ status: 'CONCEPT' }, 'BESTELD');
  assert.equal(ordered.editor.runStep('BESTELLEN', null), true);
  assert.deepEqual(ordered.calls, [['advance']]);
  const received = editorHarness({ status: 'ONDERWEG' }, 'ONTVANGEN');
  assert.equal(received.editor.runStep('ONTVANGEN', null), true);
  assert.deepEqual(received.calls, [['advance']]);
});

test('a step the container has passed returns false and calls nothing', () => {
  for (const [step, status, next] of [['VERTROKKEN', 'ONDERWEG', 'ONTVANGEN'], ['BESTELLEN', 'BESTELD', 'ONDERWEG'], ['ONTVANGEN', 'ONTVANGEN', null],
    ['BIJBOEKEN', 'ONDERWEG', 'ONTVANGEN'], ['KOSTPRIJZEN', 'BESTELD', 'ONDERWEG']] as const) {
    const state = editorHarness({ status, trackingReference: null }, next);
    assert.equal(state.editor.runStep(step, 'MSKU 1'), false, step);
    assert.deepEqual(state.calls, [], step);
  }
});

test('Bijboeken needs an unbooked receipt and saves a dirty draft first; Kostprijzen applies without asking again', async () => {
  for (const stockBooked of [null, true]) {
    const state = editorHarness({ status: 'ONTVANGEN', stockBooked }, null);
    assert.equal(state.editor.runStep('BIJBOEKEN', null), false, String(stockBooked));
    assert.deepEqual(state.calls, []);
  }
  const clean = editorHarness({ status: 'ONTVANGEN', stockBooked: false }, null);
  assert.equal(clean.editor.runStep('BIJBOEKEN', null), true);
  assert.deepEqual(clean.calls, [['book']]);
  const dirty = editorHarness({ status: 'ONTVANGEN', stockBooked: false }, null, true);
  assert.equal(dirty.editor.runStep('BIJBOEKEN', null), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(dirty.calls, [['save'], ['book']]);
  const costs = editorHarness({ status: 'ONTVANGEN', stockBooked: true }, null);
  assert.equal(costs.editor.runStep('KOSTPRIJZEN', null), true);
  assert.equal(costs.editor.stepFlowBusy(), true, 'busy at once, so the screen waits');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(costs.calls, [['apply', 50], ['products', 7], ['products set'], ['reload'], ['toast', 'Kostprijzen bijgewerkt in de catalogus', undefined]]);
  assert.equal(costs.editor.stepFlowBusy(), false);
});

test('applying the costs twice at once runs once; a failure says so and frees the step', async () => {
  const state = editorHarness({ status: 'ONTVANGEN' }, null);
  const first = state.editor.applyCostsNow();
  const second = state.editor.applyCostsNow();
  await Promise.all([first, second]);
  assert.equal(state.calls.filter((call) => call[0] === 'apply').length, 1);
  const failing = editorHarness({ status: 'ONTVANGEN' }, null);
  failing.editor.sourcing = { applyLandedCosts: async () => { throw new Error('Geen verbinding'); } };
  await failing.editor.applyCostsNow();
  assert.deepEqual(failing.calls, [['toast', 'Geen verbinding', 'err']]);
  assert.equal(failing.editor.applyingCosts(), false);
});

test('stepFlowBusy follows every save, sheet, celebration and payment of a step', () => {
  const { editor } = editorHarness({ status: 'BESTELD' }, 'ONDERWEG');
  assert.equal(editor.stepFlowBusy(), false);
  const flags: [string, unknown][] = [['saving', true], ['booking', true], ['applyingCosts', true], ['receiving', {}], ['orderPlaced', true],
    ['statusCelebration', 'SHIPPED'], ['firstInstalmentPrompt', {}], ['paying', {}], ['payingBusy', true]];
  for (const [name, value] of flags) {
    const before = editor[name]();
    editor[name].set(value);
    assert.equal(editor.stepFlowBusy(), true, name);
    editor[name].set(before);
    assert.equal(editor.stepFlowBusy(), false, name);
  }
});
