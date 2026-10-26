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
  assert.deepEqual(financeShortcut(press('7', { code: 'Digit7' }), free), { section: 7 }, '7 is Facturen');
  assert.deepEqual(financeShortcut(press('è', { code: 'Digit7' }), free), { section: 7 }, 'an AZERTY 7 is still Digit7');
  assert.equal(financeShortcut(press('8', { code: 'Digit8' }), free), null);
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

test('S, C, U and O work on Transacties and the transaction detail only; every older key keeps its command', () => {
  const transactions: ShortcutContext = { ...free, transactions: true };
  assert.deepEqual(['s', 'c', 'u', 'o'].map((key) => financeShortcut(press(key), transactions)), ['split', 'book-as', 'unlink', 'open-linked']);
  assert.deepEqual(['S', 'C'].map((key) => financeShortcut(press(key, { shift: true }), transactions)), ['split', 'book-as']);
  for (const key of ['s', 'c', 'u', 'o']) assert.equal(financeShortcut(press(key), free), null, `${key} outside Transacties`);
  for (const [key, command] of [['l', 'link'], ['Enter', 'open'], ['b', 'new-movement'], ['n', 'new-cost'], ['e', 'edit'], ['p', 'pay'], ['r', 'refresh'], ['/', 'search']] as const) {
    assert.equal(financeShortcut(press(key), transactions), command, `${key} on Transacties`);
  }
  assert.deepEqual(financeShortcut(press('2', { code: 'Digit2' }), transactions), { section: 2 }, '2 is Transacties');
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
  assert.deepEqual(FINANCE_SHORTCUT_HELP[0].keys, ['1–7'], 'seven places since Facturen');
  assert.ok(FINANCE_SHORTCUT_HELP.some((row) => row.label === 'Betaald zetten'));
  assert.ok(FINANCE_SHORTCUT_HELP.some((row) => row.label === 'Deze lijst'));
  assert.equal(FINANCE_SHORTCUT_HELP.find((row) => row.keys[0] === 'B')?.label, 'Transactie noteren');
  assert.deepEqual(FINANCE_SHORTCUT_HELP.filter((row) => row.group === 'Transacties').map((row) => [row.keys[0], row.label]),
    [['S', 'Splitsen…'], ['C', 'Boeken als…'], ['U', 'Koppeling losmaken'], ['O', 'Gekoppeld document openen']]);
});
