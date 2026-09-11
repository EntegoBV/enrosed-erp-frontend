import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { parseTemplate } from '@angular/compiler';
import { ROW_LONG_PRESS_MS, ROW_LONG_PRESS_SLOP_PX } from '../src/app/shared/row-actions.ts';

const source = await readFile(new URL('../src/app/features/sales/sales-menu-gesture.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
class TrackedTarget extends EventTarget {
  listeners = new Map<string, Set<any>>();
  override addEventListener(type: string, listener: any, options?: any) { super.addEventListener(type, listener, options); if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener); }
  override removeEventListener(type: string, listener: any, options?: any) { super.removeEventListener(type, listener, options); this.listeners.get(type)?.delete(listener); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
class FakeElement extends TrackedTarget {
  isConnected = true;
  ownerDocument = new TrackedTarget();
  control: FakeElement | null = this;
  closest(_selector: string) { return this.control; }
}
function event(type: string, extra: Record<string, unknown> = {}) {
  const value = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, data] of Object.entries(extra)) Object.defineProperty(value, key, { value: data });
  return value;
}
function setup(t: any) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const exports: any = {}; vm.runInNewContext(js, { exports, Element: FakeElement, Date, setTimeout, clearTimeout,
    require: (name: string) => { assert.equal(name, '../../shared/row-actions'); return { ROW_LONG_PRESS_MS, ROW_LONG_PRESS_SLOP_PX }; },
  });
  const host = new FakeElement(), opened: boolean[] = [], clicks: boolean[] = [];
  let disabled = false;
  const gesture = new exports.SalesMenuGesture(host, () => disabled, () => opened.push(true));
  host.addEventListener('click', () => clicks.push(true));
  const send = (type: string, changes: Record<string, unknown> = {}, outside = false) => {
    const values = { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100, ...changes };
    const value = event(type, values);
    if (outside || ['pointermove', 'pointerup', 'pointercancel', 'scroll'].includes(type)) host.ownerDocument.dispatchEvent(value);
    else host.dispatchEvent(value);
    return value;
  };
  return { host, gesture, opened, clicks, send, disable: () => { disabled = true; } };
}

test('ordinary touch tap and desktop left hold keep their normal click without opening actions', t => {
  const state = setup(t); state.send('pointerdown'); t.mock.timers.tick(100); state.send('pointerup'); state.send('click');
  assert.equal(state.opened.length, 0); assert.equal(state.clicks.length, 1);
  state.send('pointerdown', { pointerType: 'mouse' }); t.mock.timers.tick(2000); state.send('click');
  assert.equal(state.opened.length, 0); assert.equal(state.clicks.length, 2);
});

test('touch or pen hold opens once and swallows its click even after a long continued press', t => {
  for (const pointerType of ['touch', 'pen']) {
    const state = setup(t); state.send('pointerdown', { pointerType }); t.mock.timers.tick(ROW_LONG_PRESS_MS);
    assert.equal(state.opened.length, 1); t.mock.timers.tick(5000); state.send('pointerup');
    assert.equal(state.send('click').defaultPrevented, true); assert.equal(state.clicks.length, 0);
    t.mock.timers.tick(701); state.send('pointerdown'); state.send('pointerup'); state.send('click');
    assert.equal(state.clicks.length, 1); state.gesture.destroy(); t.mock.timers.reset();
  }
});

test('movement, actual scrolling, pointer cancellation and a second finger each cancel the pending hold', t => {
  for (const cancel of [
    (state: any) => state.send('pointermove', { clientX: 108 }),
    (state: any) => state.send('pointermove', { clientY: 120 }),
    (state: any) => state.send('scroll'),
    (state: any) => state.send('pointercancel'),
    (state: any) => state.send('pointerdown', { pointerId: 2, isPrimary: false }, true),
  ]) {
    const state = setup(t); state.send('pointerdown'); cancel(state); t.mock.timers.tick(2000);
    assert.equal(state.opened.length, 0); assert.equal(state.host.ownerDocument.listenerCount(), 0);
    state.send('contextmenu'); assert.equal(state.opened.length, 0, 'A late native touch menu cannot revive a cancelled hold');
    state.gesture.destroy(); t.mock.timers.reset();
  }
});

test('right-click and Shift+F10 or Menu key open actions while normal keyboard navigation stays intact', t => {
  const state = setup(t);
  assert.equal(state.send('contextmenu', { pointerType: 'mouse' }).defaultPrevented, true); assert.equal(state.opened.length, 1);
  assert.equal(state.send('keydown', { key: 'Enter' }).defaultPrevented, false);
  assert.equal(state.send('keydown', { key: 'F10', shiftKey: false }).defaultPrevented, false);
  assert.equal(state.send('keydown', { key: 'F10', shiftKey: true }).defaultPrevented, true);
  assert.equal(state.send('keydown', { key: 'ContextMenu' }).defaultPrevented, true); assert.equal(state.opened.length, 3);
});

test('native touch contextmenu before or after the hold opens only once and never activates the row', t => {
  for (const beforeTimer of [true, false]) {
    const state = setup(t); state.send('pointerdown');
    t.mock.timers.tick(beforeTimer ? 350 : ROW_LONG_PRESS_MS);
    assert.equal(state.send('contextmenu').defaultPrevented, true);
    t.mock.timers.tick(2000); assert.equal(state.opened.length, 1);
    state.send('pointerup'); state.send('click'); assert.equal(state.clicks.length, 0);
    state.gesture.destroy(); t.mock.timers.reset();
  }
});

test('retargeted sheet-backdrop click is swallowed but a fresh pointer action on the menu is allowed', t => {
  const state = setup(t); state.send('pointerdown'); t.mock.timers.tick(ROW_LONG_PRESS_MS);
  t.mock.timers.tick(1000); state.send('pointerup');
  const backdrop = new FakeElement();
  const ghost = event('click', { target: backdrop }); state.host.ownerDocument.dispatchEvent(ghost);
  assert.equal(ghost.defaultPrevented, true, 'The sheet must not close on the long press compatibility click');
  state.host.ownerDocument.dispatchEvent(event('pointerdown', { pointerId: 2, isPrimary: true, pointerType: 'touch', target: backdrop }));
  const intentional = event('click', { target: backdrop }); state.host.ownerDocument.dispatchEvent(intentional);
  assert.equal(intentional.defaultPrevented, false, 'A deliberate following tap can close or use the menu');
  assert.equal(state.host.ownerDocument.listenerCount(), 0);
});

test('inner links, inputs, buttons and editable children preserve their own controls and context menu', t => {
  const state = setup(t), child = new FakeElement();
  state.send('pointerdown', { target: child }); t.mock.timers.tick(1000); assert.equal(state.opened.length, 0);
  assert.equal(state.send('contextmenu', { target: child }).defaultPrevented, false);
  assert.equal(state.send('keydown', { key: 'ContextMenu', target: child }).defaultPrevented, false);
  assert.equal(state.opened.length, 0);
  child.control = state.host; state.send('pointerdown', { target: child }); t.mock.timers.tick(ROW_LONG_PRESS_MS);
  assert.equal(state.opened.length, 1, 'Noninteractive label descendants belong to the row itself');
});

test('disabled actions, detached rows and destruction cannot fire late menus or leave document listeners', t => {
  const state = setup(t); state.send('pointerdown'); state.disable(); t.mock.timers.tick(ROW_LONG_PRESS_MS);
  assert.equal(state.opened.length, 0); assert.equal(state.host.ownerDocument.listenerCount(), 0);
  state.gesture.destroy(); assert.equal(state.host.listenerCount(), 1, 'Only the test navigation handler remains');
  t.mock.timers.reset();
  const detached = setup(t); detached.send('pointerdown'); detached.host.isConnected = false; t.mock.timers.tick(ROW_LONG_PRESS_MS);
  assert.equal(detached.opened.length, 0); assert.equal(detached.host.ownerDocument.listenerCount(), 0); detached.gesture.destroy();
  t.mock.timers.reset();
  const destroyed = setup(t); destroyed.send('pointerdown'); destroyed.gesture.destroy(); t.mock.timers.tick(5000);
  assert.equal(destroyed.opened.length, 0); assert.equal(destroyed.host.ownerDocument.listenerCount(), 0);
});

test('sales template retains normal links and group toggle with accessible gesture menus and no ellipsis button', async () => {
  const list = await readFile(new URL('../src/app/features/sales/sales-list.ts', import.meta.url), 'utf8');
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(list)?.[1]; assert.ok(template);
  assert.equal(parseTemplate(template, 'sales-list.html').errors, null);
  assert.doesNotMatch(template, /sales-container__menu|>⋯</);
  assert.match(template, /\(salesMenu\)="openRowMenu\(null, row\)"/);
  assert.match(template, /\(salesMenu\)="openContainerMenu\(null, entry\)"/);
  assert.match(template, /aria-describedby="sales-menu-help"/);
  assert.match(template, /\(click\)="toggleGroup\(entry.key\)"/);
  assert.match(template, /\[routerLink\]="\['\/sales', row.order.id\]"/);
  assert.doesNotMatch(list, /active.hold = setTimeout/);
});
