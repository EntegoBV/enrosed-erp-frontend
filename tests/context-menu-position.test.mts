import assert from 'node:assert/strict';
import test from 'node:test';
import { clampMenuPosition } from '../src/app/shared/context-menu-position.ts';

const viewport = { width: 1000, height: 600 };
const size = { width: 240, height: 200 };

test('a menu opens at the pointer when there is room', () => {
  assert.deepEqual(clampMenuPosition({ x: 300, y: 200 }, size, viewport), { x: 300, y: 200 });
});

test('a menu near the right or bottom edge is pulled back onto the screen', () => {
  assert.deepEqual(clampMenuPosition({ x: 950, y: 550 }, size, viewport), { x: 752, y: 392 });
});

test('a menu wider than the window still keeps the margin', () => {
  assert.deepEqual(clampMenuPosition({ x: 5, y: -3 }, { width: 2000, height: 100 }, viewport), { x: 8, y: 8 });
});
