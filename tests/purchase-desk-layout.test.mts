import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

// The container desk of the Inkoop redesign (2026-10-17, I2/I3): the summary card, the panel docked or in a drawer, the kept products.
const read = (path: string) => readFile(new URL(`../src/app/features/purchasing/${path}`, import.meta.url), 'utf8');
const desk = await read('purchase-desk.ts');
const template = /template: `([\s\S]*?)`,\n  styles:/.exec(desk)?.[1] ?? '';
const count = (text: string, part: string) => text.split(part).length - 1;

test('the desk template parses and the panel content is written once, rendered docked or in the drawer', () => {
  assert.ok(template.length > 1000);
  assert.equal(parseTemplate(template, 'purchase-desk.html').errors, null);
  assert.equal(count(template, '<ng-template #railPanel>'), 1);
  assert.equal(count(template, '*ngTemplateOutlet="railPanel"'), 2);
  assert.match(template, /@if \(railShown\(\)\) \{[\s\S]*?<aside class="pdk-rail"/);
  assert.match(template, /@if \(drawerShown\(\)\) \{\s*<aside id="pdk-drawer" class="wk-inspector wk-inspector--drawer pdk-drawer"/);
  assert.match(desk, /export const PDK_DOCK_MIN_PX = 1140;/);
  assert.match(desk, /readonly drawerShown = computed\(\(\) => !this\.railDocked\(\) && this\.drawerOpen\(\)\);/);
});

test('the products stay mounted behind the other views; the old hero, KPI and rail classes are gone from the purchase desk', () => {
  assert.match(template, /<div class="pdk-pane pdk-card" \[hidden\]="mainView\(\) !== 'products'">/);
  for (const gone of ['desk-hero', 'desk-kpi', 'desk-attention', 'desk-body', 'desk-rail', 'desk-tabs', 'desk-panel', 'titleEditable']) {
    assert.ok(!template.includes(gone), gone);
  }
});

test('the summary card: inklaring on line 1, the next step through one method, Afronden as the attention link', () => {
  assert.match(template, /@if \(!data\.order\.clearance\) \{ <span class="wk-pill tone-warn">inklaring te bevestigen<\/span> \}/);
  assert.match(template, /<button class="pdk-tile pdk-tile--go" type="button" \[disabled\]="step === 'BIJBOEKEN' && booking\(\)" \(click\)="runNextStep\(\)">/);
  assert.match(desk, /if \(step === 'KOSTPRIJZEN'\) \{ void this\.apply\(\); return; \}/);
  assert.match(template, /data-pdk-rail \(click\)="showRail\('done'\)">Afronden ›<\/button>/);
  assert.doesNotMatch(template, /Bekijken ›/);
});

test('every way into the panel goes through showRail, the deep link included (B3)', async () => {
  const screen = await read('purchase-screen.ts');
  assert.match(screen, /desk\.showRail\('partner', false\);/);
  assert.doesNotMatch(screen, /desk\.railTab\.set\(/);
  assert.match(desk, /this\.showRail\('order', false\);\n    setTimeout\(\(\) => document\.getElementById\('dk-tracking'\)\?\.focus\(\), 150\);/);
  assert.match(desk, /showRail\(tab: RailTab, focusTab = true\): void \{[\s\S]*?if \(this\.railDocked\(\)\) return;[\s\S]*?this\.openDrawer\(focusTab\);/);
});

test('the B/L of a departure is uploaded only after the status save went through (F9)', () => {
  assert.match(desk, /this\.enqueue\(\(order\) => \(\{ \.\.\.order, trackingReference: tracking, status: 'ONDERWEG' \}\), \(\) => \{\s*this\.statusCelebration\.set\('SHIPPED'\);\s*if \(file\) void this\.attachBillOfLading\(data\.order\.id, file, bill\);/);
});
