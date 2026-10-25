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
  for (const words of ['Afspraak', '{{ g.verschilTitle }}', '{{ g.verschilText }}', '{{ g.reviewText }}', 'Volledige nacalculatie', 'Nacalculatie laden…', 'De nacalculatie is nog niet beschikbaar.']) {
    assert.ok(glance.includes(words), words);
  }
  assert.doesNotMatch(glance, /Verschil met afspraak|verschilWords/, "2026-10-25: 'Verschil · 5,0 %' beside '€ x minder', one line");
  assert.doesNotMatch(glance, /begroot/i);
});

test('the read view: one card over five panes, every section once, the Nacalculatie whole on Kosten', async () => {
  const source = await read('app/features/purchasing/purchase-view.ts');
  const template = templateOf(source);
  assert.equal(parseTemplate(template, 'purchase-view.html').errors, null);
  for (const id of ['purchase-overview', 'purchase-receipt-section', 'purchase-actions-section', 'purchase-products-section', 'purchase-capacity-section',
    'purchase-costs-section', 'purchase-calc-section', 'purchase-result-section', 'purchase-payments-section', 'purchase-partner-section', 'purchase-files-section',
    'purchase-reports-section']) {
    assert.ok(template.includes(`id="${id}"`), id);
  }
  for (const id of ['purchase-costs-section', 'purchase-calc-section', 'purchase-result-section']) assert.equal(count(template, `id="${id}"`), 1, id);
  for (const tag of ['<app-purchase-nacalc-overview mode="read"', '<app-purchase-payment-overview mode="read"', '<app-purchase-partner-payments',
    '<app-purchase-partner-panel', '<app-purchase-nacalc-glance', '<app-purchase-step-confirm-sheet', '<app-purchase-payee-sheet']) {
    assert.equal(count(template, tag), 1, tag);
  }
  const at = (marker: string) => { const index = template.indexOf(marker); assert.ok(index >= 0, marker); return index; };
  const kosten = at('id="mpo-pane-kosten"');
  const nacalc = at('<app-purchase-nacalc-overview mode="read"');
  assert.ok(kosten < nacalc && nacalc < at('id="mpo-pane-betalingen"'), 'the Nacalculatie sits in the Kosten pane');
  assert.doesNotMatch(template.slice(kosten, nacalc), /<details/, 'never collapsed');
  // 2026-10-25: once ordered the Nacalculatie opens Kosten and the calculation follows; a concept keeps the calculation first.
  const calc = at('id="purchase-calc-section"');
  assert.ok(at('id="purchase-costs-section"') < nacalc && nacalc < calc && calc < at('id="mpo-pane-betalingen"'), 'the Nacalculatie before the calculation');
  assert.match(template, /@if \(data\.order\.status === 'CONCEPT'\) \{ <ng-container \[ngTemplateOutlet\]="calcBlock" \/> \}\s*<!-- Nacalculatie/);
  assert.match(template, /@if \(data\.order\.status !== 'CONCEPT'\) \{ <ng-container \[ngTemplateOutlet\]="calcBlock" \/> \}\s*<ng-template #calcBlock>\s*<div id="purchase-calc-section"/);
  assert.match(template, /<h2 id="mpo-costs-title">Calculatie<\/h2><p>Gelande kostprijs · intern<\/p>/);
  // The Totaal geland tile goes to the calculation, the Betalingen cell to the Nacalculatie at the top.
  assert.match(template, /\(click\)="scrollToCard\('purchase-calc-section', 'purchase-costs-section'\)"/);
  // A payee tapped in the Nacalculatie opens on top of Kosten; the tab stays.
  assert.match(template, /\(openPayee\)="kostenPayee\.set\(\$event\)"/);
  assert.match(template, /<app-purchase-payee-sheet \[payee\]="item" mode="read"[^>]*\(add\)="afterKostenSheet\(recordPayment, \$event\)" \(edit\)="afterKostenSheet\(showPayment, \$event\)"/);
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
  for (const sheet of ['<app-context-menu', '<app-purchase-step-confirm-sheet', '<app-sheet title="Productregel"', '<app-purchase-quote-sheet', '<app-purchase-pdf-sheet',
    '<app-purchase-payee-sheet']) {
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
  assert.match(templateOf(await read('app/features/purchasing/purchase-nacalc-glance.ts')), /<span class="ios-cell__title mpo-wrap">\{\{ g\.verschilTitle \}\}<\/span>/);
  assert.match(await read('styles/purchase-phone.scss'), /\.mpo-tile__label\{display:-webkit-box;[^}]*-webkit-line-clamp:2\}/);
});

test('review round 2: a custom port stacks under its label, and a focused field clears the bars', async () => {
  const editor = templateOf(await read('app/features/purchasing/purchase-editor.ts'));
  // 'Andere aankomsthaven', a long port and 'Typ de aankomsthaven' do not fit beside each other at 360 or 390.
  for (const id of ['po-custom-departure-port', 'po-custom-destination-port']) {
    assert.match(editor, new RegExp(`<label class="ios-cell mpo-field-row mpo-field-row--stack" for="${id}">`), id);
  }
  // Focus and scrollIntoView keep a field out from under the sticky nav plus tabs and the dock or the save bar:
  // on the root, which scrolls, once; a section's own scroll-margin (partner-advance-schedule's :host) would add to it.
  const scss = await read('styles/purchase-phone.scss');
  const top = 'calc\\(var\\(--safe-t\\) \\+ var\\(--ios-nav-h\\) \\+ 74px\\)';
  assert.match(scss, new RegExp(`:root:has\\(app-purchase-view \\.mpo-phone\\)\\{scroll-padding:${top} 0 calc\\(var\\(--safe-b\\) \\+ var\\(--tabbar-h\\) \\+ 90px\\)\\}`));
  assert.match(scss, new RegExp(`:root:has\\(app-purchase-editor \\.mpo-phone\\)\\{scroll-padding:${top} 0 calc\\(var\\(--safe-b\\) \\+ 110px\\)\\}`));
  assert.match(scss, /--mpo-tabs-h:74px/, 'the padding\'s 74px is the tabs\' height');
  assert.match(scss, /:is\(app-purchase-view,app-purchase-editor\) \[id\^="purchase-"\]\{scroll-margin-top:0\}/);
  // Besides the bars' own controls (review round 3), nothing keeps a scroll-margin.
  assert.deepEqual(scss.match(/scroll-margin[a-z-]*:[^;}]*/g)?.filter((rule) => !/^scroll-margin:calc\(-1 \* /.test(rule)), ['scroll-margin-top:0']);
  assert.match(await read('app/features/purchasing/partner-advance-schedule.ts'), /host: \{ id: 'purchase-advance-invoices'/);
});

test('review round 3: focus on a nav button or a stuck tab leaves the page and the bar where they are', async () => {
  // The root's top padding (nav + tabs) covers the bars themselves: a Tab, Shift+Tab or a sheet handing focus back
  // onto a nav button or a stuck tab scrolled the page to centre it, unsticking the bar (635 -> 309 on PO-21).
  // Their scroll area moves down past the part of the padding they sit in, by as much at the bottom as at the top,
  // so it keeps its height: an inverted area would count as hidden and scroll all the same.
  const scss = await read('styles/purchase-phone.scss');
  const nav = 'calc\\(var\\(--ios-nav-h\\) \\+ var\\(--mpo-tabs-h\\)\\)';
  assert.match(scss, new RegExp(`\\.mpo-phone \\.ios-nav :is\\(a,button\\)\\{scroll-margin:calc\\(-1 \\* \\(var\\(--ios-nav-h\\) \\+ var\\(--mpo-tabs-h\\)\\)\\) 0 ${nav}\\}`));
  // Tabs only once stuck, which is when the nav has condensed (the stick point): lower down they are plain content,
  // and a moved area near the dock would scroll a tab that is in plain view at the top of a short screen.
  assert.match(scss, /\.mpo-phone \.ios-nav--condensed~\.mpo-tabs \[role="tab"\]\{scroll-margin:calc\(-1 \* var\(--mpo-tabs-h\)\) 0 var\(--mpo-tabs-h\)\}/);
  // '~' needs the tabs to follow the bar as siblings: IosNav is display:contents and projects [below] after its header.
  const navSource = await read('app/shared/ios-nav.ts');
  const navTemplate = /template: `([\s\S]*?)`,/.exec(navSource)?.[1] ?? '';
  assert.ok(navTemplate.indexOf('<header #bar class="ios-nav"') >= 0);
  assert.ok(navTemplate.indexOf('</header>') < navTemplate.indexOf('<ng-content select="[below]" />'));
  assert.match(navTemplate, /\[class\.ios-nav--condensed\]="condensed\(\) \|\| !large"/);
  for (const file of ['purchase-view.ts', 'purchase-editor.ts']) {
    assert.match(templateOf(await read(`app/features/purchasing/${file}`)), /<div below class="ios-subbar mpo-tabs">\s*<app-segmented [^>]*semantics="tabs"/, file);
  }
  assert.match(await read('app/shared/segmented.ts'), /\[attr\.role\]="tabs\(\) \? 'tab' : 'radio'"/);
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

test('the supplier\'s address in the phone editor wraps instead of ending in an ellipsis (cut at 360 px)', async () => {
  const editor = templateOf(await read('app/features/purchasing/purchase-editor.ts'));
  assert.equal(count(editor, '<span class="ios-cell__sub mpo-address"><app-supplier-address [supplier]="supplier()" [inline]="true" [showEmpty]="true" /></span>'), 1);
  // Three classes on the address and its span: the component's own encapsulated nowrap rules carry an attribute each.
  assert.match(await read('styles/purchase-phone.scss'), /app-purchase-editor \.mpo-address \.supplier-address\.supplier-address--inline span\{[^}]*white-space:normal\}/);
});

test('the partner panel\'s document line wraps on the phone, as on the desk (cut without a title at 390 and 360)', async () => {
  const phone = await read('styles/purchase-phone.scss');
  assert.match(phone, /:is\(app-purchase-view,app-purchase-editor\) \.po-partner__doc small\{overflow:visible;text-overflow:clip;white-space:normal\}/);
  // The global rule it overrides (0,1,1) stays for every other place the panel is used.
  assert.match(await read('styles.scss'), /\.po-partner__doc small \{ overflow: hidden;[^}]*white-space: nowrap; \}/);
});

test('the phone styles load once and every rule stays scoped to the purchase hosts', async () => {
  const styles = await read('styles.scss');
  assert.equal(count(styles, "@include meta.load-css('styles/purchase-phone');"), 1);
  assert.match(styles, /@include meta\.load-css\('styles\/purchase-nacalc'\);\n@include meta\.load-css\('styles\/purchase-phone'\);/);
  const scss = (await read('styles/purchase-phone.scss')).replace(/\/\*[\s\S]*?\*\//g, '');
  const scope = /^(@media|\s*(app-purchase-view|app-purchase-editor|:is\(app-purchase-view, ?app-purchase-editor\)|\.mpo-|(:root|body):has\(app-purchase-))/;
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

test('the Nacalculatie\'s Kostprijzen toepassen says what it does on the phone: it opens the apply sheet, as the dock does', async () => {
  const overview = await read('app/features/purchasing/purchase-nacalc-overview.ts');
  const template = /template:\s*`([\s\S]*?)`,\n\}\)/.exec(overview)?.[1] ?? '';
  assert.equal(parseTemplate(template, 'purchase-nacalc-overview.html').errors, null);
  assert.match(template, /\(click\)="applyCosts\.emit\(\)">Kostprijzen toepassen ›<\/button>/);
  assert.doesNotMatch(template, /bij Afronden/, 'the phone has no Afronden tab');
  // Hoe is dit berekend? neither: the phone lists the notes without the desk's tab, the desk keeps them as they are.
  assert.match(template, /<ul class="np-notes">@for \(note of notes\(\); track \$index\)/);
  assert.doesNotMatch(template, /n\.notes/);
  assert.match(overview, /readonly notes = computed\(\(\) => nacalcPhoneNotes\(this\.nacalc\(\)\?\.notes \?\? \[\]\)\);/);
  assert.match(await read('app/features/purchasing/purchase-nacalc-workbench.ts'), /<ul class="nc-notes">@for \(note of n\.notes; track \$index\)/);
  // The read view: the button and the dock both open the step, and the step skips the view's question for the editor's sheet.
  const view = await read('app/features/purchasing/purchase-view.ts');
  assert.match(view, /\(applyCosts\)="openStep\('KOSTPRIJZEN'\)"/);
  // Applied once, the dock says opnieuw like the card above it, in the words of the sheet's button (it fits at 375 px).
  assert.match(view, /\(click\)="openStep\(step\)">\{\{ stepLabel\(step, costsApplied\(\), true\) \}\}<\/button>/);
  assert.match(view, /if \(step === 'KOSTPRIJZEN'\) this\.handOff\(step, null\);/);
  // The editor: its Nacalculatie opens the same sheet.
  assert.match(await read('app/features/purchasing/purchase-editor.ts'), /\(applyCosts\)="apply\(\)"/);
});

test('the payment sheet opened from the phone\'s Betalingen tab is bound as the desk\'s: the share inputs and outputs, no [bankAccount]', async () => {
  for (const file of ['purchase-editor.ts', 'purchase-desk.ts']) {
    const template = templateOf(await read(`app/features/purchasing/${file}`));
    assert.equal(count(template, '<app-purchase-payment-sheet '), 1, `${file}: one payment sheet host`);
    const host = /<app-purchase-payment-sheet [\s\S]*?\/>/.exec(template)?.[0] ?? '';
    for (const binding of ['[orderName]="containerName(data.order)"', '[lineShares]="payingLineShares()"', '[alsoState]="alsoState()"',
      '[supplierId]="data.order.supplierId ?? null"', '(alsoLoad)="loadAlso(data.order.id, data.order.supplierId ?? null, pay.payee)"']) {
      assert.ok(host.includes(binding), `${file}: ${binding}`);
    }
    assert.doesNotMatch(host, /\[bankAccount\]/, `${file}: the picked transaction is the movement`);
  }
  // The phone host sits at host level after the phone frame; the Betalingen pane's overview opens it.
  const editor = templateOf(await read('app/features/purchasing/purchase-editor.ts'));
  const pane = editor.indexOf('id="mpo-pane-betalingen"');
  const overview = editor.indexOf('<app-purchase-payment-overview mode="edit"', pane);
  assert.ok(pane > 0 && overview > pane && overview < editor.indexOf('id="mpo-pane-dossier"'));
  assert.match(editor.slice(overview, editor.indexOf('/>', overview)), /\(add\)="requestPayment\(\$event\)" \(edit\)="requestEdit\(\$event\)" \(addTransfer\)="requestAddTransfer\(\$event\)"/);
});

test('Betalingen, the payee sheet and the Nacalculatie on the phone say one net Verschil, in rows of two lines (PO-2026-005, 2026-10-25)', async () => {
  const body = (source: string, file: string): string => {
    const template = /template:\s*`([\s\S]*?)`,\n(?:\s*styles:|\}\))/.exec(source)?.[1];
    assert.ok(template, file);
    assert.equal(parseTemplate(template, file).errors, null, file);
    return template;
  };
  const overviewSource = await read('app/features/purchasing/purchase-payment-overview.ts');
  const sheetSource = await read('app/features/purchasing/purchase-payee-sheet.ts');
  const nacalcSource = await read('app/features/purchasing/purchase-nacalc-overview.ts');
  const overview = body(overviewSource, 'purchase-payment-overview.html');
  const sheet = body(sheetSource, 'purchase-payee-sheet.html');
  const nacalc = body(nacalcSource, 'purchase-nacalc-overview.html');
  for (const [name, template] of [['overview', overview], ['sheet', sheet], ['nacalc', nacalc]] as const) {
    // "Wat is daar minder betaald en meer betaald? die + - etc?": no gross pair, no begroot, the Afspraak by its name.
    assert.doesNotMatch(template, /Minder betaald|Meer betaald|differenceLines|goedkoper dan|duurder dan|begroot\b/, name);
    assert.ok(template.includes('Afspraak'), name);
  }
  // Betalingen: the card has no operator column; Verschil, the payees it comes from, Open; the Afspraak closes Hoe is dit opgebouwd?.
  const card = overview.slice(overview.indexOf('<section class="ios-card pp-summary"'), overview.indexOf('@if (todos().length'));
  assert.doesNotMatch(card, /wk-equation__op/);
  for (const words of ['<div class="pp-summary__status wk-amount--in"><app-icon name="tick" [size]="14" /> Alles betaald</div>', '<dt>Afspraak</dt>', '<dt>Betaald</dt>',
    '<div class="pp-summary__verschil"><dt>Verschil', '@for (line of byPayee(); track line.payee)', 'waarvan te veel betaald · nakijken', '<dt>Open</dt>',
    '@for (row of bridgeRows(); track row.key)', '[class.is-sum]="row.sum"', 'meterOf(sum)']) {
    assert.ok(card.includes(words), words);
  }
  assert.doesNotMatch(overview, /Afgesproken, betaald en open per ontvanger|Nacalculatie en kostprijs/);
  // Ontvangers: one two-line row per payee; its terms, invoice files and credits are one tap away in its sheet.
  const payees = overview.slice(overview.indexOf('<h2>Ontvangers</h2>'), overview.indexOf('<h2>Alle betalingen'));
  assert.match(payees, /<span class="pp-payee__top"><span class="ios-cell__title">\{\{ item\.label \}\}<\/span><span class="ios-cell__meta" \[class\]="tone\(word\.tone\)">\{\{ word\.word \}\}<\/span><\/span>/);
  assert.match(payees, /<span class="ios-cell__sub">\{\{ figures\(item\) \}\}<\/span>/);
  assert.doesNotMatch(payees, /item\.terms|item\.credits|invoiceFiles|Nog geen factuur|pp-payee__trail/);
  // A payment: two lines, the bank as a mark with its words for a screen reader; Afrekening stays in its detail.
  for (const template of [overview, sheet]) {
    assert.match(template, /class="ios-cell pp-row pp-row2"/);
    assert.match(template, /\{\{ line\(row\) \}\}@if \(mark\(row\); as proof\)/);
    assert.match(template, /role="img" \[attr\.aria-label\]="proof\.label"/);
    assert.doesNotMatch(template.slice(template.indexOf('pp-row2'), template.indexOf('pp-row2') + 900), /settlesLabel/);
  }
  assert.match(overview, /<span class="ios-cell__body">Afrekening<\/span><span class="ios-cell__value">\{\{ row\.settlesLabel \|\| 'Niet afgerekend' \}\}<\/span>/);
  assert.match(overview, /<span class="ios-cell__title">Nacalculatie<\/span><\/span>\s*@if \(nacalc\(\); as n\) \{ <span class="ios-cell__trail"><span class="ios-cell__meta" \[class\]="pillTone\(n\.pill\.tone\)">\{\{ n\.pill\.label \}\}/);

  // The payee sheet: the status on the receipt, one Verschil, Termijnen before Factuur, a term in two lines with one word.
  const receipt = sheet.slice(sheet.indexOf('<div class="ios-card payee-sheet__receipt">'), sheet.indexOf('<h2>Termijnen</h2>'));
  assert.doesNotMatch(receipt, /wk-equation__op/);
  assert.match(receipt, /<div class="payee-sheet__status" \[class\]="tone\(word\.tone\)">/);
  assert.match(receipt, /@if \(difference\(\); as verschil\) \{\s*<div><dt>Verschil/);
  assert.ok(sheet.indexOf('<h2>Termijnen</h2>') < sheet.indexOf('<h2>Factuur</h2>'), 'the terms explain the receipt\'s Verschil');
  assert.match(sheet, /<h2>Termijnen<\/h2><span class="ios-section__trail">\{\{ trail\(\) \}\}<\/span>/);
  assert.match(sheet, /<span class="pp-line2"><span class="ios-cell__sub">\{\{ term\.paidEur \| eur \}\} van \{\{ term\.fullEur \| eur \}\}<\/span>/);
  assert.match(sheet, /@if \(term\.statusNote\) \{ <span class="ios-cell__sub">\{\{ term\.statusNote \}\}<\/span> \}/, 'a netted term keeps its note');
  assert.match(sheet, /<h2>Opbouw van de afspraak<\/h2>@if \(item\.payee === 'LOGISTICS'\) \{ <span class="ios-section__trail">uit Kosten<\/span> \}/);
  assert.match(sheet, /<span class="pp-line2"><span class="ios-cell__title">\{\{ fw\.title \}\}<\/span>@if \(fw\.note\) \{ <span class="ios-cell__meta">\{\{ fw\.note \}\}<\/span> \}<\/span>/);
  assert.match(sheet, /verlaagt \} @else \{ Verlaagt \} de eindkost, niet Betaald of Open\./);
  assert.match(sheetSource, /readonly lead = computed\(\(\) => sheetLead\(this\.payee\(\), this\.supplierName\(\)\)\);/);
  // Every edit action stays where it was.
  for (const words of ['Betaalplan wijzigen', 'Tegoed noteren…', 'Factuur toevoegen…', 'Inspectie via leverancier', 'Afrekening ongedaan maken', 'Afrekenen…',
    'Verschil van {{ item.openEur | eur }} afrekenen', 'Extra betaling noteren', 'Gegevens invullen', 'Toewijzen aan alle betalingen']) {
    assert.ok(sheet.includes(words), words);
  }

  // The Nacalculatie: the story card, where the difference sits, the receipt, per product with the list visible, then the cost basis.
  const order = ['<div class="ios-card np-story">', '<h2>Waar het verschil zit</h2>', '<h2>Ontvangst</h2>', '<h2>Per product</h2>', '<h2>Kostbasis</h2>', '<h2>Partner</h2>', '<h2>Toelichting</h2>'];
  order.reduce((last, marker) => { const at = nacalc.indexOf(marker); assert.ok(at > last, marker); return at; }, -1);
  const story = nacalc.slice(nacalc.indexOf('<div class="ios-card np-story">'), nacalc.indexOf('<h2>Waar het verschil zit</h2>'));
  assert.doesNotMatch(story, /wk-equation__op/);
  for (const words of ['{{ storySub(head) }}', 'meterOf(book.summary)', '<dt>Afspraak</dt>', '<div class="is-total"><dt>Verschil@if (pct(head); as p)', 'waarvan te veel betaald · nakijken',
    'waarvan bijkomende kosten', 'waarvan koersverschil (bank)', 'head.sentence']) {
    assert.ok(story.includes(words), words);
  }
  assert.match(nacalc, /<h2>Waar het verschil zit<\/h2><span class="ios-section__trail">afspraak → eindkost<\/span>/);
  assert.match(nacalc, /@for \(row of chain\(\); track row\.key\)/);
  assert.match(nacalc, /\(click\)="openPayee\.emit\(row\.payee\)"/);
  assert.match(nacalc, /@if \(todo\(\); as todo\)/, 'the one action cell stays');
  assert.match(nacalc, /@else if \(grossLine\(\); as gross\)/, 'the gross pair as one sentence');
  assert.doesNotMatch(nacalc, /Tik op een ontvanger|Afgerekende verschillen|Hoe verhoudt dit zich tot Kosten\?|Kostprijs per product|np-hero|np-payee|np-mix/);
  const products = nacalc.slice(nacalc.indexOf('<h2>Per product</h2>'), nacalc.indexOf('<h2>Kostbasis</h2>'));
  assert.doesNotMatch(products, /<details/, 'the list is visible');
  for (const words of ['@for (line of productLines(); track', '(click)="productOpen.set(line.row)"', 'Toon alle {{ n.products.length }} producten', 'Incl. Enrosed kost']) {
    assert.ok(products.includes(words), words);
  }
  assert.match(nacalc, /<app-sheet \[title\]="row\.name" variant="ios" \(closed\)="productOpen\.set\(null\)">/);
  assert.match(nacalc, /<a class="btn btn--primary" \[routerLink\]="\['\/products', row\.productId\]">Naar product<\/a>/);
  const basis = nacalc.slice(nacalc.indexOf('<h2>Kostbasis</h2>'), nacalc.indexOf('<h2>Partner</h2>'));
  for (const words of ['Enrosed kost', 'Kostbasis voor prijzen', 'Van calculatie naar afspraak', '@for (row of bridge(); track row.key)', 'Kostprijzen toepassen ›']) {
    assert.ok(basis.includes(words), words);
  }
  assert.match(nacalcSource, /readonly bridge = computed\(\(\) => afspraakBridge\(this\.nacalc\(\)\?\.bridge\.rows \?\? \[\]\)\);/);
});

test('the phone money styles stay on their hosts and their own classes; the retired list classes are gone', async () => {
  const payments = await read('styles/purchase-payments.scss');
  const nacalc = await read('styles/purchase-nacalc.scss');
  assert.doesNotMatch(payments, /\.pp-payee__trail|\.pp-term\b|\.pp-invoice/);
  assert.doesNotMatch(nacalc, /\.np-hero|\.np-mix|\.np-payee|\.np-term\b/);
  for (const rule of ['.pp-summary__status{', '.pp-payee__top{', '.pp-line2{', ':is(app-purchase-payment-overview,app-purchase-payee-sheet) .pp-row2 ', '.pp-bridge .wk-equation>.is-sum{']) {
    assert.ok(payments.includes(rule), rule);
  }
  for (const rule of ['.np-story{', '.np-chain{', '.np-chain__row{', '.np-product__line{', '.np .np-range ']) assert.ok(nacalc.includes(rule), rule);
});
