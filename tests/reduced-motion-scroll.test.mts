import assert from 'node:assert/strict';
import test from 'node:test';
import { calmScrollArgs, installReducedMotionScroll } from '../src/app/core/platform/reduced-motion.ts';

function fakeWindow(reduced: { value: boolean }) {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => function (this: unknown, ...args: unknown[]) { calls.push([name, args]); };
  const proto = { scrollIntoView: record('el.scrollIntoView'), scrollTo: record('el.scrollTo'), scrollBy: record('el.scrollBy') };
  const win = {
    matchMedia: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' && reduced.value }),
    Element: { prototype: proto },
    scrollTo: record('win.scrollTo'),
    scrollBy: record('win.scrollBy'),
  };
  return { win, proto, calls };
}

test('smooth scrolls become instant while reduced motion is on', () => {
  const reduced = { value: true };
  const { win, proto, calls } = fakeWindow(reduced);
  const uninstall = installReducedMotionScroll(win);
  proto.scrollIntoView.call({}, { behavior: 'smooth', block: 'center' });
  proto.scrollTo.call({}, { top: 40, behavior: 'smooth' });
  proto.scrollBy.call({}, { top: 10, behavior: 'smooth' });
  win.scrollTo({ top: 0, behavior: 'smooth' });
  win.scrollBy({ top: 5, behavior: 'smooth' });
  assert.deepEqual(calls.map(([, args]) => (args[0] as { behavior: string }).behavior), ['auto', 'auto', 'auto', 'auto', 'auto']);
  assert.deepEqual(calls[0][1][0], { behavior: 'auto', block: 'center' });
  uninstall();
});

test('the setting is read at call time and other arguments pass unchanged', () => {
  const reduced = { value: false };
  const { win, proto, calls } = fakeWindow(reduced);
  const uninstall = installReducedMotionScroll(win);
  proto.scrollIntoView.call({}, { behavior: 'smooth' });
  reduced.value = true;
  proto.scrollIntoView.call({}, { behavior: 'smooth' });
  proto.scrollIntoView.call({}, true);
  win.scrollTo(0, 120);
  assert.deepEqual(calls.map(([, args]) => args), [[{ behavior: 'smooth' }], [{ behavior: 'auto' }], [true], [0, 120]]);
  uninstall();
});

test('installing twice wraps once, and uninstall restores the originals', () => {
  const { win, proto } = fakeWindow({ value: true });
  const original = proto.scrollIntoView;
  const uninstall = installReducedMotionScroll(win);
  const wrapped = proto.scrollIntoView;
  assert.notEqual(wrapped, original);
  installReducedMotionScroll(win);
  assert.equal(proto.scrollIntoView, wrapped);
  uninstall();
  assert.equal(proto.scrollIntoView, original);
});

test('without matchMedia nothing is patched', () => {
  const proto = { scrollIntoView() {} };
  const before = proto.scrollIntoView;
  installReducedMotionScroll({ Element: { prototype: proto } });
  assert.equal(proto.scrollIntoView, before);
  assert.deepEqual(calmScrollArgs([{ behavior: 'instant' }]), [{ behavior: 'instant' }]);
});
