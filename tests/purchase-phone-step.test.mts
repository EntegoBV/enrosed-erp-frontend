import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal, untracked } from '@angular/core';
import { linePriceText, parseTab, rootSectionOf, stepTarget, type StepHandoff } from '../src/app/features/purchasing/purchase-phone-model.ts';

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
const screenJs = isolatedClass(screenSource, 'purchase-screen.ts', 'PurchaseScreen',
  new Set(['runHandedStep', 'returnFromStep', 'returnAfterStep', 'dropUntakenStep']));

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
    id: signal('50'), mode: signal<'view' | 'edit'>('edit'), editor: signal<ReturnType<typeof editorStub> | null>(editor),
    stepHandoff: {
      take: (orderId: number, now: number) => {
        calls.push(['take', orderId, typeof now]);
        const taken = pending && pending.orderId === orderId ? pending : null;
        if (taken) pending = null;
        return taken;
      },
      waiting: (orderId: number) => !!pending && pending.orderId === orderId,
      discard: (orderId: number) => { calls.push(['discard', orderId]); if (pending?.orderId === orderId) pending = null; },
      get pending() { return pending; },
    },
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
  assert.equal(state.editor.handedFromView(), true, 'history is [list, edit] all the same: back leads to the view');
  state.run();
  assert.deepEqual(state.calls.filter((call) => call[0] === 'navigate'), [['navigate', ['/purchasing', '50'], { queryParams: { tab: 'betalingen' }, replaceUrl: true }]]);
});

test('without a handoff the editor is left alone', () => {
  const state = screenHarness(null);
  state.run();
  assert.deepEqual(state.editor.calls, []);
  assert.deepEqual(state.calls.map((call) => call[0]), ['take']);
  assert.equal(state.editor.handedFromView(), false, 'back stays one history entry back');
});

test('an editor a handoff waits for counts as handed at once, so back leads to the view while it still loads', () => {
  const state = screenHarness(handoff());
  state.editor.view.set(null);
  state.run();
  assert.equal(state.editor.handedFromView(), true);
  assert.deepEqual(state.editor.calls, [], 'the step waits for the order and its payments');
  assert.equal(state.screen.stepHandoff.pending?.step, 'VERTROKKEN', 'still waiting, not taken');
  const other = screenHarness(handoff({ orderId: 49 }));
  other.editor.view.set(null);
  other.run();
  assert.equal(other.editor.handedFromView(), false, 'another order\'s handoff');
});

test('leaving the edit screen before its editor took the step drops it: a later editor never runs it unasked', () => {
  // The finding's path: back from the loading editor, reopen the same container, Bewerken within 30 s.
  const left = screenHarness(handoff());
  left.editor.view.set(null);
  left.run();
  left.screen.dropUntakenStep();
  assert.deepEqual(left.calls.filter((call) => call[0] === 'discard'), [['discard', 50]]);
  const later = screenHarness(left.screen.stepHandoff.pending);
  later.run();
  assert.deepEqual(later.editor.calls, [], 'no PUT status from a step the user walked away from');
  assert.equal(later.editor.handedFromView(), false);
  // The read view's own screen goes away right after it offered the step: that one keeps it.
  const view = screenHarness(handoff());
  view.screen.mode.set('view');
  view.screen.dropUntakenStep();
  assert.equal(view.calls.some((call) => call[0] === 'discard'), false);
  assert.equal(view.screen.stepHandoff.pending?.orderId, 50);
  assert.match(screenSource, /inject\(DestroyRef\)\.onDestroy\(\(\) => this\.dropUntakenStep\(\)\)/, 'registered on destroy');
});

/* ---- PurchaseView: the route's order and tab ------------------------------ */

const viewSource = await readFile(new URL('../src/app/features/purchasing/purchase-view.ts', import.meta.url), 'utf8');
const viewJs = isolatedClass(viewSource, 'purchase-view.ts', 'PurchaseView', new Set(['loadRouteOrder', 'applyRouteTab']));

function viewHarness(route: { id: string; tab?: string; section?: string }) {
  const loads: number[] = [];
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(viewJs, { exports, untracked, parseTab, rootSectionOf });
  const view = new exports['PurchaseView']();
  Object.assign(view, {
    id: signal(route.id), tab: signal<string | undefined>(route.tab), section: signal<string | undefined>(route.section),
    workspaceSection: signal('purchase-overview'),
    // As the real load: it reads the tab before its first await.
    load: (id: number) => { loads.push(id); view.workspaceSection.set(rootSectionOf(parseTab(view.tab()))); return Promise.resolve(); },
  });
  // A computed tracks what an effect would: it reruns only when something it read changes.
  const loadEffect = computed(() => { view.loadRouteOrder(); return loads.length; });
  const tabEffect = computed(() => { view.applyRouteTab(); return view.workspaceSection(); });
  return { view, loads, loadEffect, tabEffect };
}

test('a ?tab= change keeps the order on screen; only another id loads again', () => {
  const state = viewHarness({ id: '21', tab: 'producten' });
  state.loadEffect();
  assert.deepEqual(state.loads, [21]);
  state.view.tab.set(undefined);
  state.view.section.set('payments');
  state.loadEffect();
  assert.deepEqual(state.loads, [21], 'no skeleton, no refetch of the order, payments and documents');
  state.view.id.set('22');
  state.loadEffect();
  assert.deepEqual(state.loads, [21, 22]);
});

test('a deep link and a tab change in one navigation: the deep link\'s card stays open', () => {
  // /purchasing/21?tab=producten → 'Factuurtermijnen openen ›' → /purchasing/21?section=payments.
  const state = viewHarness({ id: '21', tab: 'producten' });
  state.tabEffect();
  assert.equal(state.view.workspaceSection(), 'purchase-products-section');
  state.view.tab.set(undefined);
  state.view.section.set('payments');
  state.view.workspaceSection.set('purchase-payments-section'); // PurchaseScreen.openRequestedSection, which runs first
  state.tabEffect();
  assert.equal(state.view.workspaceSection(), 'purchase-payments-section');
  for (const section of ['ledger', 'payment-result']) {
    state.view.section.set(section);
    state.view.tab.set('dossier');
    state.view.workspaceSection.set('purchase-costs-section');
    state.tabEffect();
    assert.equal(state.view.workspaceSection(), 'purchase-costs-section', section);
  }
  // Back onto an entry without a deep link opens its tab again.
  state.view.section.set(undefined);
  state.view.tab.set('kosten');
  state.tabEffect();
  assert.equal(state.view.workspaceSection(), 'purchase-costs-section');
  state.view.tab.set(undefined);
  state.tabEffect();
  assert.equal(state.view.workspaceSection(), 'purchase-overview');
  assert.match(viewSource, /effect\(\(\) => this\.loadRouteOrder\(\)\);\n\s*effect\(\(\) => this\.applyRouteTab\(\)\);/);
  assert.match(screenSource, /<app-purchase-view \[id\]="id\(\)" \[tab\]="tab\(\)" \[section\]="section\(\)" \/>/);
});

/* ---- PurchaseEditor.runStep and stepFlowBusy ----------------------------- */

const editorSource = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const editorJs = isolatedClass(editorSource, 'purchase-editor.ts', 'PurchaseEditor', new Set(['runStep', 'stepFlowBusy']));

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
    applyFor: signal<number | null>(null), applyBusy: signal(false),
    // The cost history round's apply(): it opens the Kostprijzen toepassen sheet for this order at once.
    apply: async () => { calls.push(['apply sheet']); editor.applyFor.set(50); },
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

test('Bijboeken needs an unbooked receipt and saves a dirty draft first; Kostprijzen opens the apply sheet', async () => {
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
  assert.deepEqual(costs.calls, [['apply sheet']], 'the sheet asks; nothing is applied yet');
  assert.equal(costs.editor.stepFlowBusy(), true, 'busy while the sheet is open, so the screen waits');
  costs.editor.applyBusy.set(true); costs.editor.applyFor.set(null);
  assert.equal(costs.editor.stepFlowBusy(), true, 'and while it applies');
  costs.editor.applyBusy.set(false);
  assert.equal(costs.editor.stepFlowBusy(), false);
});

test('stepFlowBusy follows every save, sheet, celebration and payment of a step', () => {
  const { editor } = editorHarness({ status: 'BESTELD' }, 'ONDERWEG');
  assert.equal(editor.stepFlowBusy(), false);
  const flags: [string, unknown][] = [['saving', true], ['booking', true], ['applyFor', 50], ['applyBusy', true], ['receiving', {}], ['orderPlaced', true],
    ['statusCelebration', 'SHIPPED'], ['firstInstalmentPrompt', {}], ['paying', {}], ['payingBusy', true]];
  for (const [name, value] of flags) {
    const before = editor[name]();
    editor[name].set(value);
    assert.equal(editor.stepFlowBusy(), true, name);
    editor[name].set(before);
    assert.equal(editor.stepFlowBusy(), false, name);
  }
});

/* ---- PurchaseEditor: the line row's price ------------------------------- */

test('an editor line row without its own price states the card price in the card\'s currency, never goodsUsd per piece', () => {
  const js = isolatedClass(editorSource, 'purchase-editor.ts', 'PurchaseEditor', new Set(['rowPriceText', 'effectiveExwCurrency', 'productCardPrice', 'orderLine']));
  const exports: Record<string, new () => any> = {};
  class NumUpPipe { transform(value: number, decimals: number) { return value.toFixed(decimals).replace('.', ','); } }
  vm.runInNewContext(js, { exports, linePriceText, NumUpPipe });
  const editor = new exports['PurchaseEditor']();
  const lines: Record<number, { productId: number; exwPrice: number | null; exwCurrency: string | null }> = {
    1: { productId: 1, exwPrice: null, exwCurrency: null },
    2: { productId: 2, exwPrice: 64, exwCurrency: 'CNY' },
    3: { productId: 3, exwPrice: null, exwCurrency: null },
  };
  Object.assign(editor, {
    // A CNY card at ¥70; the costing's goodsUsd per piece would be 9.8 (70 × 0.14).
    products: () => [{ id: 1, exwPrice: 70, exwCurrency: 'CNY' }, { id: 2, exwPrice: 70, exwCurrency: 'CNY' }, { id: 3, exwPrice: null, exwCurrency: 'EUR' }],
    view: () => ({ order: { lines: Object.values(lines) } }),
  });
  assert.equal(editor.rowPriceText(1), '¥ 70,000 kaartprijs');
  assert.equal(editor.rowPriceText(2), '¥ 64,000 afgesproken');
  assert.equal(editor.rowPriceText(3), null);
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(editorSource)?.[1] ?? '';
  const row = template.slice(template.indexOf('class="ios-cell mpo-line"'), template.indexOf('class="mpo-line__qty"'));
  assert.match(row, /rowPriceText\(line\.productId\)/);
  assert.doesNotMatch(row, /goodsUsd|afgesproken|exwShown/, 'the row never derives a price from the costing');
});
