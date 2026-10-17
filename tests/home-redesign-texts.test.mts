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
