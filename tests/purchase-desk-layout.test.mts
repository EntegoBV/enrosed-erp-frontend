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

test('edit mode keeps its words in the 340-380 px panel: name and number, and the two ports, stacked; money heads whole', async () => {
  const form = /<section class="pdk-sec" aria-label="Order bewerken">([\s\S]*?)<\/section>/.exec(template)?.[1] ?? '';
  assert.ok(form.includes('id="dk-alias"') && form.includes('id="dk-number"') && form.includes('id="dk-from"') && form.includes('id="dk-to"'));
  // A duo beside Ordernummer cut the placeholder 'Bijv. voorjaar, kleurvariant…'; one beside Aankomsthaven cut 'Ningbo — Ningbo-Zhoushan'.
  type Node = { name?: string; attributes?: { name: string; value: string }[]; children?: Node[]; branches?: Node[] };
  const inDuo: string[] = [];
  const walk = (nodes: Node[], duo: boolean): void => {
    for (const node of nodes) {
      const attrs = node.attributes ?? [];
      const here = duo || attrs.some((a) => a.name === 'class' && a.value.split(/\s+/).includes('desk-form__duo'));
      const id = attrs.find((a) => a.name === 'for')?.value;
      if (here && id) inDuo.push(id);
      walk([...(node.children ?? []), ...(node.branches ?? [])], here);
    }
  };
  walk(parseTemplate(form, 'order-form.html').nodes as Node[], false);
  assert.ok(inDuo.includes('dk-date'), inDuo.join());
  for (const id of ['dk-alias', 'dk-number', 'dk-from', 'dk-to']) assert.ok(!inDuo.includes(id), `${id} sits in a duo`);
  const partial = await readFile(new URL('../src/styles/purchase-desk.scss', import.meta.url), 'utf8');
  // 'Goederen / stuk' needs 96 px of text plus 22 px of padding.
  const money = Number(/app-purchase-desk \.desk-table--editing \.c-money\{width:(\d+)px\}/.exec(partial)?.[1]);
  assert.ok(money >= 120, String(money));
  assert.match(partial, /app-purchase-desk \.purchase-payment-plan-trigger\{[^}]*white-space:normal/);
});

test('Afronden\'s CTA is the Volgende stap tile\'s step (readNextStep), never the old status-only nextStep (I-B7)', () => {
  const done = /<div class="desk-done pdk-sec">([\s\S]*?)<div class="desk-actions">/.exec(template)?.[1] ?? '';
  assert.match(done, /@if \(readStep\(\); as step\) \{\s*<button class="btn btn--primary btn--block desk-done__cta" type="button" \[disabled\]="step === 'BIJBOEKEN' && booking\(\)" \(click\)="runNextStep\(\)">/);
  assert.doesNotMatch(done, /nextStep\(\)|advanceStatus\(\)|bookStock\(\)/);
  assert.equal(count(template, 'desk-done__cta'), 1);
  // While the CTA says Kostprijzen toepassen, the action list does not offer the same button a second time.
  assert.match(template, /@if \(readStep\(\) !== 'KOSTPRIJZEN'\) \{\s*<button class="desk-action" type="button" \(click\)="apply\(\)">/);
});

test('Calculatie gemaakt follows the summary steps\' rule: createdAt, else the order date (I-B22)', () => {
  assert.match(desk, /\{ key: 'made', label: 'Calculatie gemaakt', done: true, date: calculationMadeOn\(data\.createdAt, order\.orderDate\),/);
  assert.doesNotMatch(desk, /data\.createdAt \?\? order\.orderDate/);
});

test('the desk Ordernummer is fixed from Besteld on, with a short note (I-B5)', () => {
  const form = /<section class="pdk-sec" aria-label="Order bewerken">([\s\S]*?)<\/section>/.exec(template)?.[1] ?? '';
  assert.match(form, /<input class="input" id="dk-number" autocomplete="off" \[ngModel\]="data\.order\.number" \[disabled\]="numberLocked\(\)"\s*\(ngModelChange\)="\$event\?\.trim\(\) && !numberLocked\(\) && patch\(\{ number: \$event\.trim\(\) \}\)" \/>/);
  assert.match(form, /@if \(numberLocked\(\)\) \{ <span class="hint">Ligt vast sinds de bestelling: de kostprijzen op de productkaarten verwijzen ernaar\.<\/span> \}/);
});
