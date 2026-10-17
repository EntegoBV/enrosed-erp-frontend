import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SHEET_DRAG_CLOSE_PX, SHEET_DRAG_START_PX, sheetBackdropFactor, sheetDragOffset, sheetDragOutcome, sheetDragStarted,
} from '../src/app/shared/sheet-drag.ts';

const ui = readFileSync(new URL('../src/app/shared/ui.ts', import.meta.url), 'utf8');
const motion = readFileSync(new URL('../src/styles/motion.scss', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/styles/shell.scss', import.meta.url), 'utf8');

test('a drag starts after 8 px, closes beyond 120 px or on a flick, springs back otherwise', () => {
  assert.equal(SHEET_DRAG_START_PX, 8);
  assert.equal(sheetDragStarted(7), false);
  assert.equal(sheetDragStarted(8), true);
  assert.equal(sheetDragStarted(-9), true);
  assert.equal(sheetDragOffset(50), 50);
  assert.equal(sheetDragOffset(-100), -35, 'pulled up: a rubber band');
  assert.equal(sheetDragOutcome(SHEET_DRAG_CLOSE_PX + 1, 0), 'close');
  assert.equal(sheetDragOutcome(60, 0.2), 'snap');
  assert.equal(sheetDragOutcome(40, 0.9), 'close', 'a flick');
  assert.equal(sheetDragOutcome(-30, 0), 'snap');
  assert.equal(sheetBackdropFactor(0), 1);
  assert.equal(sheetBackdropFactor(300), 0.5);
  assert.equal(sheetBackdropFactor(-40), 1);
  assert.equal(sheetBackdropFactor(900), 0);
});

test('the sheet leaves through animate.leave and never strands a tap-eating overlay (critique B13)', () => {
  assert.match(ui, /host: \{ 'animate\.leave': 'mo-leaving' \}/);
  assert.match(motion, /app-sheet\.mo-leaving \{ animation: mo-hold var\(--dur-out\) linear; \}/);
  assert.match(motion, /app-sheet\.mo-leaving \.overlay \{ pointer-events: none;/);
  assert.match(motion, /app-sheet\.mo-leaving \.sheet \{ animation: mo-sheet-out/);
  assert.match(motion, /\.toast\.mo-toast-leaving \{ pointer-events: none; animation: mo-toast-out/);
  assert.match(ui, /class="toast" animate\.leave="mo-toast-leaving"/);
  /* refusal is told by the destroyed flag, not by DOM presence */
  assert.match(ui, /ngOnDestroy\(\): void \{\n    this\.destroyed = true;/);
  assert.match(ui, /if \(!this\.destroyed\) this\.springBack\(\)/);
});

test('a press on a control stays a press; capture only once the drag has started', () => {
  assert.match(ui, /closest\('button, a, input, select, textarea, \[role=button\]'\)/);
  const move = ui.slice(ui.indexOf('private readonly onDragMove'), ui.indexOf('private readonly onDragEnd'));
  assert.ok(move.indexOf('sheetDragStarted(raw)') < move.indexOf('setPointerCapture'), 'capture after the 8 px threshold');
  assert.match(ui, /<div class="sheet__grab" aria-hidden="true" \(pointerdown\)="dragStart\(\$event\)"><\/div>/);
  assert.match(motion, /\.sheet__grab::before \{ content: ''; position: absolute; inset: -10px -60px; \}/);
  assert.match(motion, /@media \(max-width: 679\.98px\) and \(pointer: coarse\)/);
});

test('the confirm uses the iOS sheet, its message padded, the main choice on top on a phone (N18)', () => {
  assert.match(ui, /<app-sheet variant="ios" \[title\]="request\.title"/);
  assert.match(ui, /<p class="confirm-message" \[innerHTML\]="request\.message"><\/p>/);
  assert.match(ui, /<div foot class="confirm-actions">/);
  assert.match(shell, /\.sheet--ios \.confirm-message \{ padding: 4px 20px 0; \}/);
  assert.match(shell, /\.confirm-actions \{ flex-direction: column-reverse; \}/);
});
