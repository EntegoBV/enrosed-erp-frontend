import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

/*
 * The phone purchase order's templates (2026-10-15): they parse, every place
 * a figure or a deep link needs is there exactly once, and the new styles
 * stay inside their hosts.
 */
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
const templateOf = (source: string): string => {
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1];
  assert.ok(template, 'a template followed by styles');
  return template;
};
const count = (text: string, pattern: string): number => text.split(pattern).length - 1;

test('the step confirmation and the Nacalculatie glance parse and only take inputs', async () => {
  for (const file of ['purchase-step-confirm-sheet.ts', 'purchase-nacalc-glance.ts']) {
    const source = await read(`app/features/purchasing/${file}`);
    const template = templateOf(source);
    assert.equal(parseTemplate(template, file).errors, null, file);
    assert.doesNotMatch(source, /inject\(/, `${file} has inputs and outputs only`);
  }
  const sheet = templateOf(await read('app/features/purchasing/purchase-step-confirm-sheet.ts'));
  assert.match(sheet, /<app-sheet \[title\]="text\(\)\.title" variant="ios" \(closed\)="cancel\.emit\(\)">/);
  assert.match(sheet, /Je openstaande wijzigingen worden mee opgeslagen\./);
  assert.match(sheet, /id="mpo-step-tracking"/);
  const glance = templateOf(await read('app/features/purchasing/purchase-nacalc-glance.ts'));
  for (const words of ['Afspraak', 'Verschil met afspraak', 'Volledige nacalculatie', 'Nacalculatie laden…', 'De nacalculatie is nog niet beschikbaar.']) {
    assert.ok(glance.includes(words), words);
  }
  assert.doesNotMatch(glance, /begroot/i);
});

test('the read view: one card over five panes, every section once, the Nacalculatie whole on Kosten', async () => {
  const source = await read('app/features/purchasing/purchase-view.ts');
  const template = templateOf(source);
  assert.equal(parseTemplate(template, 'purchase-view.html').errors, null);
  for (const id of ['purchase-overview', 'purchase-receipt-section', 'purchase-actions-section', 'purchase-products-section', 'purchase-capacity-section',
    'purchase-costs-section', 'purchase-result-section', 'purchase-payments-section', 'purchase-partner-section', 'purchase-files-section',
    'purchase-reports-section']) {
    assert.ok(template.includes(`id="${id}"`), id);
  }
  for (const tag of ['<app-purchase-nacalc-overview mode="read"', '<app-purchase-payment-overview mode="read"', '<app-purchase-partner-payments',
    '<app-purchase-partner-panel', '<app-purchase-nacalc-glance', '<app-purchase-step-confirm-sheet']) {
    assert.equal(count(template, tag), 1, tag);
  }
  const at = (marker: string) => { const index = template.indexOf(marker); assert.ok(index >= 0, marker); return index; };
  const kosten = at('id="mpo-pane-kosten"');
  const nacalc = at('<app-purchase-nacalc-overview mode="read"');
  assert.ok(kosten < nacalc && nacalc < at('id="mpo-pane-betalingen"'), 'the Nacalculatie sits in the Kosten pane');
  assert.doesNotMatch(template.slice(kosten, nacalc), /<details/, 'never collapsed');
  const glance = at('<app-purchase-nacalc-glance');
  assert.ok(at('id="mpo-pane-overzicht"') < glance && glance < at('id="mpo-pane-producten"'), 'the headline sits on Overzicht');
  assert.ok(at('<app-purchase-payment-overview mode="read"') > at('id="mpo-pane-betalingen"') && at('<app-purchase-payment-overview mode="read"') < at('id="mpo-pane-dossier"'));
  assert.match(template, /semantics="tabs"/);
  assert.match(template, /class="ios-seg--stacked"/);
  assert.match(template, /\[customLarge\]="true"/);
  assert.match(template, /erp-workspace__mobile-actions[\s\S]*openStep\(/);
  for (const pane of ['overzicht', 'producten', 'kosten', 'betalingen', 'dossier']) {
    assert.match(template, new RegExp(`id="mpo-pane-${pane}" role="tabpanel" aria-label="[A-Z][a-z]+" \\[hidden\\]="activeTab\\(\\) !== '${pane}'"`), pane);
  }
  assert.doesNotMatch(source, /journey-hero|jhero-|#27211f|#151210|#ffd57a|workflow-nav|trackWorkspaceSection/);
  assert.doesNotMatch(source, /begroot/i);
  assert.doesNotMatch(template, /desktop\.active\(\)/, 'phone only: the desk is PurchaseDesk');
  // Sheets and menus render at host level: after the phone frame, never in the nav, the tabs or a pane.
  const frameEnd = at('<!-- Sheets and menus at host level');
  for (const sheet of ['<app-context-menu', '<app-purchase-step-confirm-sheet', '<app-sheet title="Productregel"', '<app-purchase-quote-sheet', '<app-purchase-pdf-sheet']) {
    assert.ok(at(sheet) > frameEnd, sheet);
  }
});

test('the editor: the product editor\'s shell over the same five panes, a save bar and Acties', async () => {
  const source = await read('app/features/purchasing/purchase-editor.ts');
  const template = templateOf(source);
  assert.equal(parseTemplate(template, 'purchase-editor.html').errors, null);
  assert.doesNotMatch(template, /purchase-mobile-dock|data-phone-step|purchase-editor__mobile-nav|<app-page-header/);
  for (const words of ['mpo-savebar', 'Niet opgeslagen', 'Alles opgeslagen', '<app-context-menu title="Acties"', '[customLarge]="true"', 'semantics="tabs"']) {
    assert.ok(template.includes(words), words);
  }
  for (const tag of ['<app-purchase-step-confirm-sheet', '<app-purchase-status-back-sheet ', '<app-purchase-nacalc-overview mode="edit"',
    '<app-purchase-payment-overview mode="edit"', 'ios-seg--stacked', '<app-purchase-nacalc-glance']) {
    assert.equal(count(template, tag), 1, tag);
  }
  const at = (marker: string) => { const index = template.indexOf(marker); assert.ok(index >= 0, marker); return index; };
  const nacalc = at('<app-purchase-nacalc-overview mode="edit"');
  assert.ok(at('id="mpo-pane-kosten"') < nacalc && nacalc < at('id="mpo-pane-betalingen"'), 'the Nacalculatie sits in the Kosten pane');
  const payments = at('<app-purchase-payment-overview mode="edit"');
  assert.ok(at('id="mpo-pane-betalingen"') < payments && payments < at('id="mpo-pane-dossier"'), 'the payments sit in the Betalingen pane');
  const glance = at('<app-purchase-nacalc-glance');
  assert.ok(at('id="mpo-pane-overzicht"') < glance && glance < at('id="mpo-pane-producten"'));
  for (const pane of ['overzicht', 'producten', 'kosten', 'betalingen', 'dossier']) {
    assert.match(template, new RegExp(`id="mpo-pane-${pane}" role="tabpanel" aria-label="[A-Z][a-z]+" \\[hidden\\]="phoneTab\\(\\) !== '${pane}'"`), pane);
  }
  // The phone's sheets and every existing sheet stay at host level, after the phone frame.
  const frameEnd = at('<!-- The phone\'s own sheets, at host level');
  for (const sheet of ['<app-context-menu title="Acties"', '<app-purchase-step-confirm-sheet', '<app-purchase-status-back-sheet ', '<app-purchase-payment-sheet',
    '<app-purchase-quote-sheet', '<app-purchase-pdf-sheet', '<app-purchase-ordered-success']) {
    assert.ok(at(sheet) > frameEnd, sheet);
  }
  assert.match(template, /<app-purchase-ordered-success \[orderNumber\]="data\.order\.number" \[overviewAvailable\]="!handedFromView\(\)"/);
  assert.doesNotMatch(source, /begroot/i);
});

test('review round 1: figures and their words reach a screen reader, a keyboard and a 360px phone', async () => {
  const view = templateOf(await read('app/features/purchasing/purchase-view.ts'));
  const editor = templateOf(await read('app/features/purchasing/purchase-editor.ts'));
  // A tile's aria-label replaces its content: it carries the sub line too.
  assert.match(view, /\[attr\.aria-label\]="'Totaal geland ' \+ landedText \+ ', ' \+ landed\.sub \+ ', naar Kosten'"/);
  assert.match(view, /\[attr\.aria-label\]="pay\.label \+ \(payText \? ' ' \+ payText : ''\) \+ \(pay\.sub \? ', ' \+ pay\.sub : ''\) \+ ', naar Betalingen'"/);
  // A line row is a button: Enter and Space open it.
  assert.match(editor, /role="button" tabindex="0"[^>]*\(keydown\.enter\)="lineSheet\.set\(line\.productId\)"\s*\(keydown\.space\)="\$event\.preventDefault\(\); lineSheet\.set\(line\.productId\)"/);
  // Lading: the fill as the value, the pieces as its sub; '103% · 12.400 st' never runs past the tile.
  assert.match(editor, /@let lading = ladingFill \? \(ladingFill\.fillPercent \| num: 0\) \+ '%' : ladingPieces;/);
  assert.match(editor, /@if \(ladingFill\) \{ <span class="mpo-tile__sub">\{\{ ladingPieces \}\}<\/span> \}/);
  assert.match(editor, /'Lading ' \+ lading \+ \(ladingFill \? ', ' \+ ladingPieces : ''\)/);
  // A display product's landed total is per display, with the per-piece figure beside it, in both sheets.
  for (const [name, template, line] of [['view', view, 'entry.line'], ['editor', editor, 'line']] as const) {
    assert.ok(template.includes("perPiece() ? (display ? 'Geland per display' : 'Geland per stuk') : 'Geland totaal'"), name);
    assert.ok(template.includes(`@if (perPiece() && display) { <span class="ios-cell__meta">{{ ${line}.landedUnitEur / display | eurUp: 3 }} /stuk</span> }`), name);
  }
  assert.ok(!editor.includes("{{ perPiece() && display ? ' /display' : '' }}"), 'the label says display; the value has no unit tail');
  // The glance's row title wraps rather than cutting the difference.
  assert.match(templateOf(await read('app/features/purchasing/purchase-nacalc-glance.ts')), /<span class="ios-cell__title mpo-wrap">Verschil met afspraak<\/span>/);
  assert.match(await read('styles/purchase-phone.scss'), /\.mpo-tile__label\{display:-webkit-box;[^}]*-webkit-line-clamp:2\}/);
});

test('the kit gains the stacked segments and the nav its [hero] slot', async () => {
  assert.match(await read('styles/workspace-kit.scss'), /\.ios-seg\.ios-seg--stacked\{/);
  const nav = await read('app/shared/ios-nav.ts');
  assert.match(nav, /customLarge/);
  assert.match(nav, /<ng-content select="\[hero\]" \/>/);
  const navTemplate = /template:\s*`([\s\S]*?)`,/.exec(nav)?.[1];
  assert.ok(navTemplate);
  assert.equal(parseTemplate(navTemplate, 'ios-nav.html').errors, null);
});

test('the phone styles load once and every rule stays scoped to the purchase hosts', async () => {
  const styles = await read('styles.scss');
  assert.equal(count(styles, "@include meta.load-css('styles/purchase-phone');"), 1);
  assert.match(styles, /@include meta\.load-css\('styles\/purchase-nacalc'\);\n@include meta\.load-css\('styles\/purchase-phone'\);/);
  const scss = (await read('styles/purchase-phone.scss')).replace(/\/\*[\s\S]*?\*\//g, '');
  const scope = /^(@media|\s*(app-purchase-view|app-purchase-editor|:is\(app-purchase-view, ?app-purchase-editor\)|\.mpo-|body:has\(app-purchase-))/;
  const selectors: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const char of scss) {
    if (char === '{') {
      const text = buffer.trim();
      if (text) selectors.push(text);
      buffer = '';
      depth++;
    } else if (char === '}') { buffer = ''; depth--; } else if (char === ';') { buffer = ''; } else { buffer += char; }
  }
  assert.equal(depth, 0);
  assert.ok(selectors.length > 40, String(selectors.length));
  const outside = selectors.flatMap((selector) => splitTopLevel(selector)).filter((selector) => !scope.test(selector));
  assert.deepEqual(outside, []);
});

/** The selectors of a list, split on the commas outside parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let level = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') level++;
    if (char === ')') level--;
    if (char === ',' && level === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}
