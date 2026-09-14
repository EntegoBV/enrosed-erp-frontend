import assert from 'node:assert/strict';
import test from 'node:test';
import { installStaffTouchPolicy } from '../src/app/core/platform/staff-touch-policy.ts';

class FakeClassList {
  values = new Set<string>();
  mutations = 0;
  add(value: string) { this.values.add(value); this.mutations++; }
  remove(value: string) { this.values.delete(value); this.mutations++; }
  contains(value: string) { return this.values.has(value); }
}

class FakeMeta {
  attributes = new Map<string, string>();
  mutations = 0;
  constructor(content: string | null) {
    if (content !== null) this.attributes.set('content', content);
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); this.mutations++; }
  removeAttribute(name: string) { this.attributes.delete(name); this.mutations++; }
}

type ListenerRecord = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean; passive: boolean | undefined };

class FakeDocument extends EventTarget {
  defaultView: { navigator: { maxTouchPoints?: number } } | null;
  documentElement = { classList: new FakeClassList() };
  viewport: FakeMeta | null;
  registrations: ListenerRecord[] = [];
  active: ListenerRecord[] = [];
  removals = 0;

  constructor(touchPoints: number | undefined = 5, content: string | null = 'width=device-width, initial-scale=1, viewport-fit=cover') {
    super();
    this.defaultView = { navigator: { maxTouchPoints: touchPoints } };
    this.viewport = new FakeMeta(content);
  }

  querySelector(selector: string) {
    assert.equal(selector, 'meta[name="viewport"]');
    return this.viewport;
  }

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (!listener) return;
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
    const record = { type, listener, capture, passive: typeof options === 'object' ? options.passive : undefined };
    this.registrations.push(record);
    this.active.push(record);
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
    this.removals++;
    this.active = this.active.filter(record => record.type !== type || record.listener !== listener || record.capture !== capture);
    // Node 24 does not match boolean `true` to a captured listener on removal;
    // normalize its options to preserve the browser's equivalent DOM semantics.
    super.removeEventListener(type, listener, { capture });
  }

  install() { return installStaffTouchPolicy(this as unknown as Document); }

  send(type: string, touches?: number, cancelable = true) {
    const event = new Event(type, { bubbles: true, cancelable });
    if (touches !== undefined) Object.defineProperty(event, 'touches', { value: Array.from({ length: touches }, (_, identifier) => ({ identifier })) });
    this.dispatchEvent(event);
    return event;
  }
}

function viewportOptions(document: FakeDocument) {
  return new Map(document.viewport!.getAttribute('content')!.split(',').map(option => {
    const [key, value] = option.trim().split('=');
    return [key.toLowerCase(), value];
  }));
}

test('desktop or missing browser touch support leaves the viewport, classes and gestures untouched', () => {
  for (const mode of ['desktop', 'missing-points', 'server'] as const) {
    const document = new FakeDocument(0);
    if (mode === 'missing-points') document.defaultView = { navigator: {} };
    if (mode === 'server') document.defaultView = null;
    const original = document.viewport!.getAttribute('content');
    const cleanup = document.install();
    assert.equal(document.documentElement.classList.contains('staff-touch-fixed'), false);
    assert.equal(document.viewport!.getAttribute('content'), original);
    assert.equal(document.registrations.length, 0);
    assert.equal(document.send('gesturestart').defaultPrevented, false);
    assert.equal(document.send('touchmove', 2).defaultPrevented, false);
    cleanup(); cleanup();
    assert.equal(document.documentElement.classList.mutations, 0);
    assert.equal(document.viewport!.mutations, 0);
    assert.equal(document.removals, 0);
  }
});

test('touch policy keeps viewport layout directives and replaces conflicting zoom limits only while installed', () => {
  const original = ' width=device-width, initial-scale=1.0, viewport-fit=cover, Maximum-Scale = 5, minimum-scale=0.5, USER-SCALABLE = yes, interactive-widget=resizes-content ';
  const document = new FakeDocument(1, original);
  const cleanup = document.install();
  assert.equal(document.documentElement.classList.contains('staff-touch-fixed'), true);
  const options = viewportOptions(document);
  assert.equal(options.get('width'), 'device-width');
  assert.equal(options.get('initial-scale'), '1.0');
  assert.equal(options.get('viewport-fit'), 'cover');
  assert.equal(options.get('interactive-widget'), 'resizes-content');
  assert.equal(options.get('minimum-scale'), '1');
  assert.equal(options.get('maximum-scale'), '1');
  assert.equal(options.get('user-scalable'), 'no');
  assert.equal(document.viewport!.getAttribute('content')!.split(',').length, 7, 'No conflicting duplicate zoom directive remains');
  cleanup();
  assert.equal(document.viewport!.getAttribute('content'), original, 'Original spacing and casing must also survive leaving the staff screen');
});

test('Safari gesture handlers cancel only cancelable gestures and use active capture listeners', () => {
  const document = new FakeDocument();
  const cleanup = document.install();
  assert.deepEqual(document.registrations.map(({ type, capture, passive }) => ({ type, capture, passive })).sort((a, b) => a.type.localeCompare(b.type)),
    ['gesturechange', 'gesturestart', 'touchmove', 'touchstart'].map(type => ({ type, capture: true, passive: false })));
  for (const type of ['gesturestart', 'gesturechange']) {
    assert.equal(document.send(type).defaultPrevented, true);
    assert.equal(document.send(type, undefined, false).defaultPrevented, false);
  }
  cleanup();
});

test('two or more touches block pinch while single-finger taps and scrolling still reach other handlers', () => {
  const document = new FakeDocument();
  const observed: string[] = [];
  for (const type of ['touchstart', 'touchmove', 'touchend', 'click', 'pointerdown']) {
    document.addEventListener(type, () => observed.push(type));
  }
  const cleanup = document.install();
  for (const type of ['touchstart', 'touchmove']) {
    for (const touches of [0, 1]) assert.equal(document.send(type, touches).defaultPrevented, false);
    for (const touches of [2, 3]) assert.equal(document.send(type, touches).defaultPrevented, true);
    assert.equal(document.send(type, 2, false).defaultPrevented, false);
  }
  for (const type of ['touchend', 'click', 'pointerdown']) assert.equal(document.send(type, 1).defaultPrevented, false);
  assert.equal(observed.filter(type => type === 'touchstart').length, 5);
  assert.equal(observed.filter(type => type === 'touchmove').length, 5);
  assert.deepEqual(observed.slice(-3), ['touchend', 'click', 'pointerdown']);
  cleanup();
});

test('cleanup removes every policy handler, restores the viewport exactly and is safe to call repeatedly', () => {
  const document = new FakeDocument();
  const original = document.viewport!.getAttribute('content');
  let applicationGestures = 0;
  document.addEventListener('gesturestart', () => applicationGestures++);
  const cleanup = document.install();
  assert.equal(document.send('gesturestart').defaultPrevented, true);
  cleanup();
  assert.equal(document.active.length, 1, 'An unrelated application listener must remain installed');
  assert.equal(document.removals, 4);
  assert.equal(document.documentElement.classList.contains('staff-touch-fixed'), false);
  assert.equal(document.viewport!.getAttribute('content'), original);
  for (const type of ['gesturestart', 'gesturechange', 'touchstart', 'touchmove']) {
    assert.equal(document.send(type, 2).defaultPrevented, false, `${type} must work normally after cleanup`);
  }
  assert.equal(applicationGestures, 2);
  const mutationCount = document.viewport!.mutations;
  cleanup();
  assert.equal(document.removals, 4);
  assert.equal(document.viewport!.mutations, mutationCount);
  const cleanupAgain = document.install();
  assert.equal(document.send('touchmove', 2).defaultPrevented, true);
  cleanupAgain();
  assert.equal(document.active.length, 1);
  assert.equal(document.viewport!.getAttribute('content'), original);
  assert.equal(document.send('touchmove', 2).defaultPrevented, false);
});

test('a disposed cleanup cannot undo a newer installation when the staff screen is revisited', () => {
  const document = new FakeDocument();
  const firstCleanup = document.install();
  firstCleanup();
  const secondCleanup = document.install();
  const installedViewport = document.viewport!.getAttribute('content');
  firstCleanup();
  assert.equal(document.documentElement.classList.contains('staff-touch-fixed'), true);
  assert.equal(document.viewport!.getAttribute('content'), installedViewport);
  assert.equal(document.send('gesturechange').defaultPrevented, true);
  secondCleanup();
  assert.equal(document.send('gesturechange').defaultPrevented, false);
});

test('cleanup preserves a pre-existing class and restores a missing content attribute', () => {
  const document = new FakeDocument(5, null);
  document.documentElement.classList.add('staff-touch-fixed');
  const cleanup = document.install();
  assert.equal(viewportOptions(document).get('maximum-scale'), '1');
  cleanup();
  assert.equal(document.documentElement.classList.contains('staff-touch-fixed'), true);
  assert.equal(document.viewport!.getAttribute('content'), null);
});

test('a document without a viewport meta still blocks touch zoom and cleans up safely', () => {
  const document = new FakeDocument();
  document.viewport = null;
  const cleanup = document.install();
  assert.equal(document.send('touchstart', 2).defaultPrevented, true);
  cleanup(); cleanup();
  assert.equal(document.viewport, null);
  assert.equal(document.active.length, 0);
  assert.equal(document.documentElement.classList.contains('staff-touch-fixed'), false);
  assert.equal(document.send('touchstart', 2).defaultPrevented, false);
});
