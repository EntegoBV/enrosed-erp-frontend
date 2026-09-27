import assert from 'node:assert/strict';
import test from 'node:test';
import { FILES_SHORTCUTS, filesCommand } from '../src/app/features/files/files-keys.ts';
import type { FilesKeyPress } from '../src/app/features/files/files-keys.ts';

const press = (key: string, extra: Partial<FilesKeyPress> = {}): FilesKeyPress => ({
  key, mod: false, shift: false, alt: false, targetIsField: false, overlayOpen: false, place: 'folders', layout: 'list', ...extra,
});
const type = (key: string, extra: Partial<FilesKeyPress> = {}) => filesCommand(press(key, extra))?.type ?? null;

test('opening, looking and climbing', () => {
  assert.equal(type(' '), 'quick-look');
  assert.equal(type('Enter'), 'open');
  assert.equal(type('ArrowDown', { mod: true }), 'open');
  assert.equal(type('ArrowUp', { mod: true }), 'parent');
  assert.equal(type('F2'), 'rename');
});

test('selecting and removing', () => {
  assert.equal(type('a', { mod: true }), 'select-all');
  assert.equal(type('A', { mod: true }), 'select-all');
  assert.equal(type('Delete'), 'archive');
  assert.equal(type('Backspace'), 'archive');
  assert.equal(type('Backspace', { mod: true }), 'archive');
  assert.equal(type('Delete', { place: 'archive' }), 'delete');
  assert.equal(type('Backspace', { mod: true, place: 'archive' }), 'delete');
});

test('search, inspector, shortcuts and escape', () => {
  assert.equal(type('/'), 'search');
  assert.equal(type('i', { mod: true }), 'inspector');
  assert.equal(type('?', { shift: true }), 'shortcuts');
  assert.equal(type('Escape'), 'escape');
});

test('arrows move; shift extends; sideways only in the grid', () => {
  assert.deepEqual(filesCommand(press('ArrowDown')), { type: 'move', direction: 'down', extend: false });
  assert.deepEqual(filesCommand(press('ArrowDown', { shift: true })), { type: 'move', direction: 'down', extend: true });
  assert.deepEqual(filesCommand(press('ArrowUp')), { type: 'move', direction: 'up', extend: false });
  assert.equal(filesCommand(press('ArrowLeft')), null);
  assert.deepEqual(filesCommand(press('ArrowRight', { layout: 'grid', shift: true })), { type: 'move', direction: 'right', extend: true });
});

test('nothing fires in a field or behind an overlay', () => {
  for (const key of [' ', 'Enter', 'Delete', '/', 'a', 'Escape', 'ArrowDown']) {
    assert.equal(filesCommand(press(key, { targetIsField: true, mod: key === 'a' })), null, `field ${key}`);
    assert.equal(filesCommand(press(key, { overlayOpen: true, mod: key === 'a' })), null, `overlay ${key}`);
  }
  assert.equal(filesCommand(press('Delete', { alt: true })), null);
});

test('browser shortcuts stay the browser’s', () => {
  assert.equal(filesCommand(press('f', { mod: true })), null);
  assert.equal(filesCommand(press('1', { mod: true })), null);
  assert.equal(filesCommand(press('2', { mod: true })), null);
  assert.equal(filesCommand(press('N', { mod: true, shift: true })), null);
  assert.equal(filesCommand(press('ArrowLeft', { mod: true, layout: 'grid' })), null);
  assert.equal(filesCommand(press('[', { mod: true })), null);
  assert.ok(FILES_SHORTCUTS.length >= 10);
});
