import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import type { DrillRow, DrillView } from '../src/app/features/analyses/drill-model.ts';
import {
  DEFAULT_GAP_LABEL, columnSum, columnTrack, compareCells, drillGap, drillTable, firstSortDir, headerWidth, linkKind, nextSort, phoneParts, sortRows, summedColumns,
} from '../src/app/features/analyses/drill-table.ts';

/*
 * The Analyses drill-down kit (design/analyses2/design.md §A): the pure table rules of drill-table.ts and the source
 * rules that keep the dialog at page level and the row builders node-testable.
 */
const analyses = new URL('../src/app/features/analyses/', import.meta.url);
const read = (file: string) => readFile(new URL(file, analyses), 'utf8');

function view(rows: DrillRow[], extra: Partial<DrillView> = {}): DrillView {
  return {
    id: 'test.margin', title: 'Brutomarge', scope: 'Dit jaar · excl. btw',
    columns: [
      { key: 'doc', label: 'Document', format: 'text', phone: 'title' },
      { key: 'date', label: 'Datum', format: 'day', phone: 'sub' },
      { key: 'revenue', label: 'Omzet excl.', format: 'eur', phone: 'none', sum: true },
      { key: 'margin', label: 'Marge', format: 'eur', phone: 'value' },
    ],
    rows, valueKey: 'margin', total: { value: 330, format: 'eur', of: 'sum' }, gapLabel: 'Creditnota’s',
    sort: { key: 'margin', dir: 'desc' }, empty: 'Geen omzet in deze periode.', ...extra,
  };
}

const rows: DrillRow[] = [
  { key: 'a', cells: { doc: 'INV-1', date: '2026-03-01', revenue: 1000, margin: 300 }, group: 'docs' },
  { key: 'b', cells: { doc: 'INV-2', date: '2026-04-01', revenue: 400, margin: 60 }, group: 'docs' },
  { key: 'c', cells: { doc: 'CN-3', date: '2026-04-20', revenue: -100, margin: null }, pill: 'Creditnota', group: 'docs' },
  { key: 't', cells: { doc: 'TICA · okt', date: '2026-10-31', revenue: 200, margin: 100 }, pill: 'TICA', group: 'tica' },
  { key: 'x', cells: { doc: 'Los', date: null, revenue: 0, margin: 0 } },
];

test('the table: a first unnamed group, then the groups in their order, each sorted inside, with its sums (null as 0)', () => {
  const table = drillTable(view(rows, { groups: [{ key: 'tica', label: 'TICA' }, { key: 'docs', label: 'Facturen' }] }));
  assert.deepEqual(table.sections.map((section) => section.key), ['', 'tica', 'docs'], 'rows without a group come first, then view.groups order');
  assert.deepEqual(table.sections[2].rows.map((row) => row.key), ['a', 'b', 'c'], 'margin desc inside the group, the credit note (null) last');
  assert.deepEqual(table.sections[2].sums, { revenue: 1300, margin: 360 });
  assert.deepEqual(table.summed, ['revenue', 'margin'], 'the valueKey column and the sum columns; never text or dates');
  assert.equal(table.valueColumn, 'margin');
  assert.equal(table.tracks, 'minmax(0,1.6fr) 84px 112px 112px', 'the A.1 defaults');
});

test('the sum rule: the total shows the figure itself; a gap of € 0,50 or more is one named row (a credit note shows no margin)', () => {
  const table = drillTable(view(rows));
  assert.equal(table.total?.value, 330, 'the figure, not the Σ of the rows');
  assert.equal(table.total?.sums['revenue'], 1500);
  assert.deepEqual(table.gap, { label: 'Creditnota’s', value: -130, format: 'eur' }, '330 − Σ 460');
  assert.equal(drillTable(view(rows, { total: { value: 460.4, format: 'eur', of: 'sum' } })).gap, null, 'under € 0,50: no gap row');
  assert.equal(drillGap(view(rows, { total: { value: 461, format: 'eur', of: 'sum' }, gapLabel: null }))?.label, DEFAULT_GAP_LABEL);
  assert.equal(drillTable(view(rows, { total: null })).total, null, 'a plain list has no total and no gap');
  assert.equal(drillTable(view(rows, { total: null })).gap, null);
});

test('a count: the rows against the figure, the count in the label cell when no column carries it', () => {
  const count = view(rows, { valueKey: null, total: { value: 6, format: 'int', of: 'rows', label: 'Offertes' } });
  const table = drillTable(count);
  assert.equal(table.valueColumn, '');
  assert.deepEqual(table.gap, { label: 'Creditnota’s', value: 1, format: 'int' }, 'six counted, five listed');
  assert.equal(drillTable(view(rows, { valueKey: null, total: { value: 5, format: 'int', of: 'rows' } })).gap, null);
  assert.deepEqual(summedColumns(count), ['revenue'], 'a count never sums its value column');
});

test('sorting: empty cells last in both directions, text by name, numbers by value, ties keep the builder order', () => {
  assert.equal(compareCells(null, 3, 'asc'), 1);
  assert.equal(compareCells(null, 3, 'desc'), 1);
  assert.ok(compareCells('appel', 'Banaan', 'asc') < 0);
  assert.ok(compareCells(2, 10, 'desc') > 0);
  assert.deepEqual(sortRows(rows, { key: 'date', dir: 'asc' }).map((row) => row.key), ['a', 'b', 'c', 't', 'x']);
  assert.deepEqual(sortRows([{ key: '1', cells: { v: 1 } }, { key: '2', cells: { v: 1 } }], { key: 'v', dir: 'desc' }).map((row) => row.key), ['1', '2']);
  assert.deepEqual(sortRows([{ key: 'b', cells: { rank: 1 } }, { key: 'a', cells: { rank: 0 } }], { key: 'rank', dir: 'asc' }).map((row) => row.key), ['a', 'b'],
    'a sort key that is no column keeps a given order (rank)');
  assert.equal(firstSortDir({ format: 'text' }), 'asc');
  assert.equal(firstSortDir({ format: 'day' }), 'desc');
  assert.deepEqual(nextSort({ key: 'margin', dir: 'desc' }, { key: 'margin', format: 'eur' }), { key: 'margin', dir: 'asc' }, 'the same header flips');
  assert.deepEqual(nextSort({ key: 'margin', dir: 'asc' }, { key: 'doc', format: 'text' }), { key: 'doc', dir: 'asc' });
});

test('columns, links and phone cells', () => {
  assert.equal(columnTrack({ key: 'a', label: 'A', format: 'eur', phone: 'title' }, 0), 'minmax(0,1.6fr)');
  assert.equal(columnTrack({ key: 'a', label: 'A', format: 'text', phone: 'sub' }, 1), 'minmax(0,1fr)');
  assert.equal(columnTrack({ key: 'a', label: 'A', format: 'days', phone: 'sub' }, 1), '84px');
  assert.equal(columnTrack({ key: 'a', label: 'A', format: 'pct', phone: 'sub', width: '70px' }, 1), '70px');
  assert.equal(linkKind({ path: ['/sales', 3] }), 'route');
  assert.equal(linkKind({ href: 'https://www.enrosed.com/' }), 'href');
  assert.equal(linkKind({ run: () => undefined }), 'run');
  assert.equal(linkKind(null), null);
  assert.deepEqual(phoneParts(view(rows)), { title: 'doc', subs: ['date'], value: 'margin' });
  assert.equal(phoneParts(view(rows, { valueKey: null })).value, 'margin', 'without a valueKey the phone value column');
  assert.equal(columnSum(rows, 'margin'), 460);
});

test('a fixed track grows to its header\'s longest word plus the sort chevron; a header of several words wraps', () => {
  /* Measured in the system font at 11 px bold capitals (review-layout-headers.log), + 16 px for the chevron and its gap. */
  const measured: [string, number][] = [['Vervaldatum', 92.7], ['Doorlooptijd', 98.5], ['Ontvangen', 78.3], ['Verkoopwaarde', 113.1],
    ['Kostwaarde', 87.1], ['Beschadigd', 82.3], ['Documenten', 88.4], ['Kost/eenheid', 91.7]];
  for (const [label, px] of measured) assert.ok(headerWidth(label) >= px + 16, `${label}: ${headerWidth(label)} ≥ ${px + 16}`);
  assert.equal(columnTrack({ key: 'due', label: 'Vervaldatum', format: 'day', phone: 'sub' }, 2), `${headerWidth('Vervaldatum')}px`, 'wider than 84 px');
  assert.equal(columnTrack({ key: 'sales', label: 'Verkoopwaarde', format: 'eur', phone: 'none' }, 4), `${headerWidth('Verkoopwaarde')}px`, 'wider than 112 px');
  assert.equal(columnTrack({ key: 'claim', label: 'Te factureren excl.', format: 'eur', phone: 'value' }, 4), '112px', 'it wraps between its words');
  assert.equal(columnTrack({ key: 'lead', label: 'Doorlooptijd', format: 'days', phone: 'none', width: '84px' }, 3), `${headerWidth('Doorlooptijd')}px`, 'a px width too');
  assert.equal(columnTrack({ key: 'a', label: 'Een heel lange kop', format: 'text', phone: 'sub', width: 'minmax(0,2fr)' }, 1), 'minmax(0,2fr)');
});

test('the pill and the gap and total labels sit in the row\'s name, also when a list opens on its date (Kasprognose)', () => {
  const dated = view(rows, { columns: [
    { key: 'date', label: 'Datum', format: 'day', phone: 'sub', width: '84px' },
    { key: 'doc', label: 'Omschrijving', format: 'text', phone: 'title' },
    { key: 'margin', label: 'Bedrag', format: 'eurSigned', phone: 'value' },
  ] });
  assert.equal(drillTable(dated).labelColumn, 'doc', 'not the 84 px date cell');
  assert.equal(drillTable(view(rows)).labelColumn, 'doc');
  assert.equal(drillTable(view(rows, { columns: [{ key: 'margin', label: 'Marge', format: 'eur', phone: 'title' }] })).labelColumn, 'margin',
    'a view whose only column is its figure keeps the first column');
});

test('source: the contract has types only and every drill module imports types only (node-tested builders)', async () => {
  const model = await read('drill-model.ts');
  const code = model.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const line of code.split('\n').filter((text) => /^export\b/.test(text))) {
    assert.match(line, /^export (type|interface) /, `drill-model.ts: ${line}`);
  }
  const files = (await readdir(analyses)).filter((file) => /^drill-.+\.ts$/.test(file) && file !== 'drill-host.ts');
  assert.ok(files.includes('drill-table.ts') && files.includes('drill-sales.ts'));
  for (const file of files) {
    for (const line of (await read(file)).split('\n').filter((text) => /^import\b/.test(text))) {
      assert.match(line, /^import type /, `${file}: ${line}`);
    }
  }
});

test('source: the dialog renders once at page level, after the page sheets and outside the body template; ⌥1…8 wait while it is open', async () => {
  const page = await read('analyses-page.ts');
  /* The page has its styleUrls before the template, so its template ends at the decorator's close. */
  const template = /template:\s*`([\s\S]*?)`,\n\}\)/.exec(page)?.[1] ?? '';
  assert.ok(template.length > 1000);
  assert.equal(page.match(/<app-an-drill \/>/g)?.length, 1);
  const drill = template.indexOf('<app-an-drill />');
  assert.ok(drill > template.indexOf('@switch (sheet())'), 'after the page-level sheets');
  assert.ok(drill < template.indexOf('<ng-template #body'), 'outside the faded body (and the Kasprognose size container)');
  assert.match(page, /deskKey\(event: KeyboardEvent\): void \{\n\s+if \(this\.drillHost\.views\(\)\) return;/);
  assert.match(page, /styleUrls: \[[^\]]*'\.\.\/\.\.\/\.\.\/styles\/analyses-drill\.scss'\]/);
  const drillComponent = await read('an-drill.ts');
  assert.match(drillComponent, /selector: 'app-an-drill'/);
  assert.match(drillComponent, /\(closed\)="host\.close\(\)"/);
  assert.doesNotMatch(drillComponent, /styles:/, 'no styles array: styles/analyses-drill.scss');
  /* A read-only dialog: the dimmed area closes it on the desk too (A.2). */
  assert.match(drillComponent, /<app-sheet [^>]*\[backdropCloses\]="true"/);
  const sheet = await readFile(new URL('../src/app/shared/ui.ts', import.meta.url), 'utf8');
  assert.match(sheet, /if \(window\.innerWidth >= 680 && !this\.backdropCloses\(\)\) return;/);
  /* Cmd/Ctrl/Shift/Alt-click opens a tab and keeps the list: only a plain click closes it. */
  assert.doesNotMatch(drillComponent, /\(click\)="host\.close\(\)"/);
  assert.match(drillComponent, /if \(event\.button === 0 && !event\.metaKey && !event\.ctrlKey && !event\.shiftKey && !event\.altKey\) this\.host\.close\(\);/);
  /* The pill and the gap and total labels go in the row's name column, never the narrow first (date) cell. */
  assert.doesNotMatch(drillComponent, /let first = \$first/);
  const styles = await readFile(new URL('../src/styles/analyses-drill.scss', import.meta.url), 'utf8');
  assert.match(styles, /@media \(max-width: 679\.98px\), \(hover: none\)/, 'no hover: the chevron shows');
  assert.match(styles, /app-an-drill \.and__title \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
});
