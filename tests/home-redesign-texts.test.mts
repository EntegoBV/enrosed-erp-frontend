import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/*
 * Words and places of the home redesign round (redesign/home design.md + critique.md) that the templates must
 * keep. The components import Angular at run time, so their sources are read as text.
 */
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
const widget = (name: string) => read(`app/features/dashboard/widgets/${name}.ts`);

test('H4: no dark block any more; a negative result is red', async () => {
  assert.doesNotMatch(await widget('home-w'), /dark = input|home-w--dark/);
  assert.doesNotMatch(await read('styles/home-widgets.scss'), /home-w--dark/);
  const result = await widget('home-resultaat');
  assert.match(result, /\[class\.is-neg\]="year\(\)\.resultEur < 0"/);
  assert.match(result, /<dt>Marge<\/dt>/);
  assert.match(result, /<dt>Eigen kosten<\/dt>/);
  assert.match(result, /<div class="is-warn"><dt>Kosten \{\{ desk \? data\.windows\(\)\.monthName : monthShort\(\) \}\}<\/dt>/);
});

test('H4: the small blocks keep every figure as label/value rows, with the phone labels of critique N2', async () => {
  const received = await widget('home-ontvangen');
  for (const label of ['Ontvangen', 'Terugbetaald']) assert.match(received, new RegExp(`<dt>${label}</dt>`));
  assert.match(received, /'Netto partnervoorschotten' : 'Voorschotten'/);
  assert.match(received, /<span class="home-w__note">incl\. btw<\/span>/);
  const stock = await widget('home-voorraad');
  assert.match(stock, /'Met bekende kost' : 'Met kost'/);
  /* N3: "Zonder kost" only with pieces without a cost; the note on the old rule. */
  assert.match(stock, /@if \(stock\(\)\.unvalued\) \{ <div class="is-warn"><dt>Zonder kost<\/dt>/);
  assert.match(stock, /@if \(stock\(\)\.unvalued \|\| stock\(\)\.unknown\) \{/);
  const partners = await widget('home-partners');
  assert.match(partners, /'Partnercontainers' : 'Containers'/);
  assert.match(partners, /'Werkelijk ontvangen' : 'Ontvangen'/);
  assert.match(partners, /Eigen kasinleg<small>betaald min ontvangsten<\/small>\} @else \{Kasinleg\}/);
  assert.match(partners, /<dt>Nog te ontvangen<\/dt>/);
  assert.match(partners, /@if \(financing\(\)\.awaitingSettlement\) \{[\s\S]*'Afrekeningen nog te maken' : 'Af te rekenen'/);
  /* A label wraps, a value never does. */
  const scss = await read('styles/home-widgets.scss');
  assert.match(scss, /\.home-w__kv dd \{[^}]*white-space: nowrap;/);
  assert.doesNotMatch(/\.home-w__kv dt \{[^}]*\}/.exec(scss)?.[0] ?? '', /ellipsis|nowrap/);
});

test('H4: the two "te ontvangen" say why, the Kas names the next krap periods, Inkoop keeps the late arrival words', async () => {
  const kas = await widget('home-kas');
  assert.match(kas, /klant &amp; partner, na tegoed/);
  assert.match(kas, /@if \(more\(c\.tightCount\); as more\) \{ · \{\{ more \}\}\}/);
  assert.match(kas, /bijgewerkt \{\{ age \}\}/);
  assert.match(await widget('home-verkoop'), /counted\(data\.receivables\(\)\.count, 'open factuur', 'open facturen'\)/);
  const inkoop = await widget('home-inkoop');
  assert.match(inkoop, /\{\{ event\.text \}\}/);
  assert.match(inkoop, /short\(event\.supplier\)/);
  assert.match(inkoop, /\[title\]="full\(event, ' · '\)"/);
  assert.match(await widget('home-markt'), /t\.o\.v\. een maand geleden <span aria-hidden="true">›<\/span>/);
});

test('H2: the desk home sits under the foundation toolbar "Dashboard" with one Nieuw button; the greeting starts the brief', async () => {
  const desk = await read('app/features/dashboard/home-desk.ts');
  assert.match(desk, /<app-page-header title="Dashboard" \[subtitle\]="over\(\)" \[parent\]="null">/);
  assert.match(desk, /aria-label="Nieuw: kies wat je toevoegt"/);
  assert.doesNotMatch(desk, /wk-split|home-desk__head|setTitle/);
  assert.match(desk, /<b class="home-desk__hello">\{\{ hello \}\}<\/b>/);
  assert.match(desk, /briefHello\(this\.data\.hour\(\), firstName\(this\.auth\.username\(\)\)\)/);
  /* N5: the status words give way, Opnieuw stays outside them. */
  assert.match(desk, /<span class="home-desk-status__text">\{\{ status\(\)\.text \}\}<\/span> ·\s*<button/);
  /* The page's own bell for Klanten wachten, hidden for good (B6). */
  assert.match(desk, /<app-notification-bell class="home-bell-host" \/>/);
  assert.match(await read('styles/home-phone.scss'), /\.home-bell-host > \.bell \{ display: none !important; \}/);
});

test('H2: the Ook nog preview and the footer that says how many are for today (B3, B5)', async () => {
  const desk = await read('app/features/dashboard/home-desk.ts');
  assert.match(desk, /t\.ookNog\.slice\(0, Math\.max\(0, Math\.min\(t\.ookNog\.length, 6 - t\.top\.length\)\)\)/);
  assert.match(desk, /if \(!this\.wide\(\) \|\| !this\.data\.tasksReady\(\)\) return \[\];/);
  assert.match(desk, /<h3 class="home-todo__group"><b class="is-ooknog">Ook nog<\/b> · opruimen zonder termijn<\/h3>/);
  assert.match(desk, /othersOf\(this\.data\.tasks\(\), this\.preview\(\)\.length\)/);
  assert.match(desk, /\{\{ others\(\)\.urgent \}\} voor vandaag/);
  assert.match(desk, /'ander open punt' : 'andere open punten'/);
  /* No second row pattern for the preview. */
  assert.doesNotMatch(await read('styles/home-desk.scss'), /home-task--peek/);
});

test('H5: the phone rows read whole and the footer says what the desk says', async () => {
  const cells = await read('app/features/dashboard/home-task-cells.ts');
  assert.match(cells, /class="ios-cell__title ios-cell__title--strong ios-cell__title--2"/);
  const phone = await read('app/features/dashboard/home-phone.ts');
  assert.doesNotMatch(phone, /klusje/);
  assert.match(phone, /'ander open punt' : 'andere open punten'/);
  assert.match(phone, /\{\{ others\.urgent \}\} voor vandaag/);
  assert.match(phone, /<app-agenda-strip variant="phone" \[cards\]="cards" \/>/);
  /* N17: the tab bar keeps the kit's room beside the '+'. */
  assert.match(await read('styles/home-phone.scss'), /right: calc\(var\(--safe-r\) \+ 12px \+ var\(--tabbar-h\)\)/);
});

test('H5: agenda rows open like Agenda › Dag, say no repeated "dag", and the page has one way back to today', async () => {
  const strip = await read('app/features/dashboard/agenda-strip.ts');
  assert.doesNotMatch(strip, /\[interactive\]="false"/);
  assert.equal((strip.match(/class="home-strip__raise" \[variant\]="variant\(\)"/g) ?? []).length, 2);
  /* Komend is dated: no tick there, so a task's day stays in the date column with the others (fix round 1). */
  assert.match(strip, /\[entries\]="komend\(\)" \[dated\]="true"[^>]*\[ticks\]="false"/);
  assert.doesNotMatch(strip, /\[entries\]="today\(\)"[^>]*\[ticks\]/);
  const rows = await read('app/features/dashboard/agenda-month.ts');
  assert.match(rows, /if \(entry\.type !== 'afspraak'\) return '';/);
  assert.match(rows, /return this\.interactive\(\) && this\.ticks\(\) && entry\.type === 'taak' && entry\.plannerId !== null;/);
  assert.match(rows, /@if \(hasCheck\(entry\)\) \{/);
  /* The tick's inset follows the tick, not the task: a task without one lines up with the other rows. */
  const css = await read('styles/home-agenda.scss');
  assert.match(css, /\.home-arow\.has-check \.home-arow__main \{ padding-left: 8px; \}/);
  assert.doesNotMatch(css, /\.home-arow\.is-task \.home-arow__main/);
  assert.match(rows, /return \[entry\.term, entry\.sub\]\.filter\(Boolean\)\.join\(' · '\) \|\| null;/);
  const page = await read('app/features/dashboard/agenda-page.ts');
  assert.match(page, /@if \(selected\(\) !== data\.today\(\)\) \{[\s\S]*>Naar vandaag<\/button>/);
  assert.match(page, /<h2 class="home-agenda__month sr-only">/);
  /* B4: the advances without a due day, one row after Komend's days. */
  assert.match(page, /title: 'Zonder datum'/);
  assert.match(page, /'voorschot' : 'voorschotten'/);
  assert.match(page, /link: \{ path: \['\/analyses\/cash'\] \}/);
});

test('H3: the desk agenda gives busy days the width, merges empty runs below 1280 and keeps the legend off line one', async () => {
  const agenda = await read('app/features/dashboard/home-desk-agenda.ts');
  assert.match(agenda, /day\.today \|\| day\.entries\.length \? 'minmax\(0, 1fr\)' : 'minmax\(0, \.55fr\)'/);
  assert.match(agenda, /dayRuns\(/);
  assert.match(agenda, /run\.weekendOnly \? 'Vrij' : 'Niets gepland'/);
  assert.match(agenda, /Agenda laden…/);
  assert.match(agenda, /@if \(view\(\) === 'week' && wide\(\)\) \{ <ng-container \[ngTemplateOutlet\]="legend" \/> \}/);
  assert.match(agenda, /@if \(view\(\) !== 'taken'\) \{\s*<button class="wk-btn wk-btn--sm home-ag__add"/);
  /* B4: the advances without a due day after the Daarna moments. */
  assert.match(agenda, /`zonder datum · \$\{undated\.count\} \$\{undated\.count === 1 \? 'voorschot' : 'voorschotten'\} · \$\{signed\(undated\.eur\)\}`/);
  /* N16: the fade on the view roots only, never on the planner host. */
  assert.match(agenda, /<div class="home-ag__view mo-fade">/);
  assert.match(agenda, /<div class="home-ag__month mo-fade">/);
  assert.doesNotMatch(agenda, /<app-planner-cards[^>]*mo-fade/);
  assert.match(await read('styles/home-desk.scss'), /\.home-ag__week:not\(\.home-ag__week--rows\) > \.home-ag__day \{ min-height: 132px;/);
});
