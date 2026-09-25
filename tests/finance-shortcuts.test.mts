import assert from 'node:assert/strict';
import test from 'node:test';
import { FINANCE_SHORTCUT_HELP, financeShortcut } from '../src/app/features/finance/finance-shortcuts.ts';
import type { ShortcutContext, ShortcutKey } from '../src/app/features/finance/finance-shortcuts.ts';

const free: ShortcutContext = { typing: false, overlayOpen: false, inWorkspace: true };
const press = (key: string, extra: Partial<ShortcutKey> = {}): ShortcutKey =>
  ({ key, code: extra.code ?? '', shift: false, meta: false, ctrl: false, alt: false, ...extra });

test('nothing fires while typing, behind an overlay or outside the workspace', () => {
  for (const context of [{ ...free, typing: true }, { ...free, overlayOpen: true }, { ...free, inWorkspace: false }]) {
    assert.equal(financeShortcut(press('n'), context), null);
    assert.equal(financeShortcut(press('1', { code: 'Digit1' }), context), null);
    assert.equal(financeShortcut(press('Escape'), context), null);
  }
});

test('the digits choose a section by their physical key', () => {
  assert.deepEqual(financeShortcut(press('1', { code: 'Digit1' }), free), { section: 1 });
  assert.deepEqual(financeShortcut(press('&', { code: 'Digit6' }), free), { section: 6 }, 'an AZERTY 6 is still Digit6');
  assert.equal(financeShortcut(press('7', { code: 'Digit7' }), free), null);
  assert.equal(financeShortcut(press('!', { code: 'Digit1', shift: true }), free), null);
});

test('letters and keys map to their commands', () => {
  const expect: [string, string][] = [
    ['/', 'search'], ['n', 'new-cost'], ['N', 'new-cost'], ['b', 'new-movement'], ['e', 'edit'], ['p', 'pay'], ['l', 'link'],
    ['Delete', 'delete'], ['Backspace', 'delete'], ['Escape', 'escape'], ['r', 'refresh'], ['Enter', 'open'], [' ', 'toggle'],
    ['ArrowUp', 'up'], ['ArrowDown', 'down'], ['k', 'up'], ['j', 'down'],
  ];
  for (const [key, command] of expect) assert.equal(financeShortcut(press(key), free), command, key);
  assert.equal(financeShortcut(press('?', { shift: true }), free), 'help');
  assert.equal(financeShortcut(press('/', { shift: true, code: 'Period' }), free), 'search', "an AZERTY '/' is Shift+':'");
  assert.equal(financeShortcut(press('x'), free), null);
});

test('Shift with the arrows extends the selection', () => {
  assert.equal(financeShortcut(press('ArrowUp', { shift: true }), free), 'extend-up');
  assert.equal(financeShortcut(press('ArrowDown', { shift: true }), free), 'extend-down');
});

test('only ⌘/Ctrl+A passes with a modifier', () => {
  assert.equal(financeShortcut(press('a', { meta: true }), free), 'select-all');
  assert.equal(financeShortcut(press('a', { ctrl: true }), free), 'select-all');
  assert.equal(financeShortcut(press('n', { meta: true }), free), null);
  assert.equal(financeShortcut(press('r', { ctrl: true }), free), null, 'the browser keeps its reload');
  assert.equal(financeShortcut(press('n', { alt: true }), free), null);
  assert.equal(financeShortcut(press('1', { code: 'Digit1', meta: true }), free), null);
});

test('the help sheet lists every command', () => {
  assert.equal(FINANCE_SHORTCUT_HELP[0].label, 'Onderdelen');
  assert.ok(FINANCE_SHORTCUT_HELP.some((row) => row.label === 'Betaald zetten'));
  assert.ok(FINANCE_SHORTCUT_HELP.some((row) => row.label === 'Deze lijst'));
});
