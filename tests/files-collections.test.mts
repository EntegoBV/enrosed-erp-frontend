import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FILES_HOME, LINK_VIEWS, LEGACY_VIEWS, badgeText, dateGroupLabel, datesGroupable, extensionToneClass,
  fileKindChip, fileKindLabel, filesQueryParams, groupByDate, isSourceLink, linkLabel, locationChange,
  leavesFiles, navFolderId, navSection, parseFilesLocation, parseSort, recordOpenLabel, sourceCaption, sourceRoute,
  targetLabel, targetRoute, toggleSort,
} from '../src/app/features/files/files-collections.ts';
import type { FilesLocation } from '../src/app/features/files/files-collections.ts';

const parse = (query: string): FilesLocation => {
  const params = new URLSearchParams(query);
  return parseFilesLocation((key) => params.get(key));
};

test('no parameters is Mappen; map picks a folder and a bad map falls back to Mappen', () => {
  assert.deepEqual(parse(''), FILES_HOME);
  assert.deepEqual(parse('map=12'), { ...FILES_HOME, folderId: 12 });
  assert.deepEqual(parse('map=abc'), FILES_HOME);
  assert.deepEqual(parse('map=0'), FILES_HOME);
  assert.deepEqual(parse('map=-4'), FILES_HOME);
});

test('view=all is Recent, kind filters it and an unknown kind is ignored', () => {
  assert.equal(parse('view=all').place, 'recent');
  assert.deepEqual(parse('view=all&kind=IMAGE'), { ...FILES_HOME, place: 'recent', kind: 'IMAGE' });
  assert.equal(parse('view=all&kind=DOCUMENT').kind, 'DOCUMENT');
  assert.equal(parse('view=all&kind=PDF').kind, null);
});

test('archief=1 is Archief, a place of its own', () => {
  const archive = parse('view=all&archief=1');
  assert.equal(archive.place, 'archive');
  assert.equal(archive.view, null);
  assert.equal(parse('archief=1&view=cost&doel=4').targetId, null);
  assert.equal(parse('archief=0&view=all').place, 'recent');
});

test('a record view reads doel and bestand; doel needs a record view', () => {
  assert.deepEqual(parse('view=cost&doel=7&bestand=3'), {
    ...FILES_HOME, place: 'view', view: 'cost', targetId: 7, fileId: 3,
  });
  assert.equal(parse('map=5&doel=7').targetId, null);
  assert.equal(parse('view=all&doel=7').targetId, null);
  assert.equal(parse('view=unused&doel=7').targetId, null);
  assert.equal(parse('view=product&doel=x').targetId, null);
  assert.equal(parse('view=product&bestand=0').fileId, null);
});

test('retired views land on Recent and ask for a rewrite; a view makes map meaningless', () => {
  for (const view of ['quote', 'invoice']) {
    const location = parse(`view=${view}&kind=IMAGE&q=roos`);
    assert.equal(location.place, 'recent');
    assert.equal(location.redirected, true);
    assert.equal(location.kind, 'IMAGE');
    assert.equal(location.query, 'roos');
    assert.equal(LEGACY_VIEWS[view], 'all');
  }
  assert.equal(parse('view=all').redirected, false);
  const withMap = parse('view=purchase&map=12');
  assert.equal(withMap.place, 'view');
  assert.equal(withMap.folderId, 'root');
});

test('q is trimmed and an empty search is no search', () => {
  assert.equal(parse('q=%20%20rozen%20').query, 'rozen');
  assert.equal(parse('q=%20%20').query, null);
  assert.equal(parse('q=').query, null);
});

test('filesQueryParams reads back to the same location', () => {
  const cases = ['', 'map=12', 'view=all', 'view=all&kind=IMAGE', 'view=all&archief=1', 'view=cost&doel=7&bestand=3',
    'view=unused&q=offerte', 'map=4&kind=DOCUMENT&q=factuur&bestand=9', 'view=planner', 'view=family&doel=2'];
  for (const query of cases) {
    const location = parse(query);
    const params = filesQueryParams(location);
    assert.deepEqual(parseFilesLocation((key) => params[key] ?? null), location, query);
  }
  assert.deepEqual(filesQueryParams(parse('view=all&archief=1')), { view: 'all', archief: '1' });
  assert.deepEqual(filesQueryParams(parse('view=quote&kind=IMAGE')), { view: 'all', kind: 'IMAGE' });
  assert.deepEqual(filesQueryParams(FILES_HOME), {});
});

test('navSection lights up the place, navFolderId the open folder', () => {
  assert.equal(navSection(parse('')), 'folders');
  assert.equal(navSection(parse('map=3')), 'folders');
  assert.equal(navSection(parse('view=all&kind=IMAGE')), 'recent');
  assert.equal(navSection(parse('view=all&archief=1')), 'archive');
  assert.equal(navSection(parse('view=cost&doel=2')), 'cost');
  assert.equal(navSection(parse('view=unused')), 'unused');
  assert.equal(navFolderId(parse('map=3')), 3);
  assert.equal(navFolderId(parse('')), null);
  assert.equal(navFolderId(parse('view=all')), null);
});

test('locationChange names the biggest step', () => {
  assert.equal(locationChange(parse('map=3'), parse('map=4')), 'place');
  assert.equal(locationChange(parse('view=cost'), parse('view=cost&doel=2')), 'place');
  assert.equal(locationChange(parse('view=cost&bestand=1'), parse('view=product&bestand=1')), 'place');
  assert.equal(locationChange(parse('map=3'), parse('map=3&kind=IMAGE')), 'filter');
  assert.equal(locationChange(parse('map=3&q=a'), parse('map=3&q=b&bestand=2')), 'filter');
  assert.equal(locationChange(parse('map=3'), parse('map=3&bestand=2')), 'file');
  assert.equal(locationChange(parse('map=3&bestand=2'), parse('map=3&bestand=2')), 'none');
});

test('records open where they live; planner items have no route', () => {
  assert.deepEqual(targetRoute({ targetType: 'PRODUCT', targetId: 5 }), { link: ['/products', 5], query: null });
  assert.deepEqual(targetRoute({ targetType: 'PURCHASE_ORDER', targetId: 46 }), { link: ['/purchasing', 46], query: null });
  assert.deepEqual(targetRoute({ targetType: 'COMPANY_COST', targetId: 9 }), { link: ['/costs'], query: { view: 'costs', cost: 9 } });
  assert.deepEqual(targetRoute({ targetType: 'PRODUCT_FAMILY', targetId: 2 }), { link: ['/files'], query: { view: 'family', doel: 2 } });
  assert.equal(targetRoute({ targetType: 'PLANNER_ITEM', targetId: 1 }), null);
  assert.equal(leavesFiles(targetRoute({ targetType: 'PRODUCT', targetId: 5 })), true);
  assert.equal(leavesFiles(targetRoute({ targetType: 'PRODUCT_FAMILY', targetId: 2 })), false, 'a reeks opens as this same view');
  assert.equal(leavesFiles(null), false);
});

test('source links are managed at their source', () => {
  assert.deepEqual(sourceRoute({ targetType: 'PRODUCT', targetId: 5 }), { link: ['/products', 5, 'edit'], query: null });
  assert.deepEqual(sourceRoute({ targetType: 'PRODUCT_FAMILY', targetId: 2 }), { link: ['/website/products'], query: null });
  assert.deepEqual(sourceRoute({ targetType: 'PURCHASE_ORDER', targetId: 46 }), { link: ['/purchasing', 46], query: null });
  assert.equal(sourceRoute({ targetType: 'PLANNER_ITEM', targetId: 1 }), null);
  assert.equal(sourceRoute({ targetType: 'COMPANY_COST', targetId: 1 }), null);
  assert.equal(isSourceLink({ createdBy: 'system' }), true);
  assert.equal(isSourceLink({ createdBy: 'emre' }), false);
  assert.equal(isSourceLink({ createdBy: null }), false);
  assert.equal(sourceCaption({ targetType: 'PRODUCT' }), 'productfoto uit de producteditor');
  assert.equal(sourceCaption({ targetType: 'PRODUCT_FAMILY' }), 'reeksfoto (website)');
  assert.equal(sourceCaption({ targetType: 'PURCHASE_ORDER' }), 'via inkoopdossier');
  assert.equal(sourceCaption({ targetType: 'PLANNER_ITEM' }), 'bijlage uit de planner');
});

test('record types read as one Dutch word, and a nameless record gets its number', () => {
  assert.equal(targetLabel('COMPANY_COST'), 'Kost');
  assert.equal(targetLabel('PRODUCT_FAMILY'), 'Productreeks');
  assert.equal(linkLabel({ targetType: 'COMPANY_COST', targetId: 9, targetLabel: null }), 'Kost #9');
  assert.equal(linkLabel({ targetType: 'PRODUCT', targetId: 9, targetLabel: 'Rose Box' }), 'Rose Box');
  assert.equal(recordOpenLabel('COMPANY_COST'), 'Openen in Kosten & bank');
  assert.equal(recordOpenLabel('PURCHASE_ORDER'), 'Inkooporder openen');
});

test('file types read the way people say them', () => {
  const file = (originalFilename: string, kind: 'IMAGE' | 'DOCUMENT' = 'DOCUMENT', contentType = '') =>
    ({ name: 'x', originalFilename, contentType, kind });
  assert.equal(fileKindLabel(file('a.jpg', 'IMAGE')), 'JPEG-afbeelding');
  assert.equal(fileKindChip(file('a.jpg', 'IMAGE')), 'Foto · JPG');
  assert.equal(fileKindLabel(file('a.png', 'IMAGE')), 'PNG-afbeelding');
  assert.equal(fileKindLabel(file('a.PDF')), 'PDF-document');
  assert.equal(fileKindChip(file('a.pdf')), 'Document · PDF');
  assert.equal(fileKindLabel(file('a.xlsx')), 'Excel-werkblad');
  assert.equal(fileKindLabel(file('a.docx')), 'Word-document');
  assert.equal(fileKindLabel(file('a.zip')), 'ZIP-archief');
  assert.equal(fileKindLabel(file('a.heic', 'IMAGE')), 'Afbeelding');
  assert.equal(fileKindLabel(file('noextension')), 'Document');
  assert.equal(fileKindChip(file('noextension')), 'Document');
  assert.equal(fileKindLabel(file('', 'DOCUMENT', 'application/pdf')), 'PDF-document');
  assert.equal(badgeText(file('report.xlsx')), 'XLSX');
  assert.equal(badgeText(file('noextension')), 'DOC');
  assert.equal(extensionToneClass(file('a.pdf')), 'tone-danger');
  assert.equal(extensionToneClass(file('a.csv')), 'tone-green');
  assert.equal(extensionToneClass(file('a.docx')), 'tone-blue');
  assert.equal(extensionToneClass(file('a.zip')), 'tone-grey');
});

test('date sections from a fixed now (Thursday 24 September 2026)', () => {
  const now = new Date(2026, 8, 24, 15, 0);
  const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString();
  assert.equal(dateGroupLabel(at(2026, 9, 24, 8), now), 'Vandaag');
  assert.equal(dateGroupLabel(at(2026, 9, 23), now), 'Gisteren');
  assert.equal(dateGroupLabel(at(2026, 9, 21), now), 'Eerder deze week');
  assert.equal(dateGroupLabel(at(2026, 9, 20), now), 'Eerder deze maand');
  assert.equal(dateGroupLabel(at(2026, 9, 1), now), 'Eerder deze maand');
  assert.equal(dateGroupLabel(at(2026, 8, 31), now), 'Augustus 2026');
  assert.equal(dateGroupLabel(at(2025, 12, 5), now), 'December 2025');
  const monday = new Date(2026, 8, 21, 9, 0);
  assert.equal(dateGroupLabel(at(2026, 9, 20), monday), 'Gisteren');
  assert.equal(dateGroupLabel(at(2026, 9, 19), monday), 'Eerder deze maand');
  const groups = groupByDate([{ updatedAt: at(2026, 9, 24) }, { updatedAt: at(2026, 9, 24, 7) }, { updatedAt: at(2026, 8, 2) }], now);
  assert.deepEqual(groups.map((group) => [group.label, group.assets.length]), [['Vandaag', 2], ['Augustus 2026', 1]]);
});

test('sorting remembers only known keys and flips on a second click', () => {
  assert.deepEqual(parseSort(null), { key: 'updated', dir: 'desc' });
  assert.deepEqual(parseSort('{"key":"kind","dir":"asc"}'), { key: 'updated', dir: 'desc' });
  assert.deepEqual(parseSort('not json'), { key: 'updated', dir: 'desc' });
  assert.deepEqual(parseSort('{"key":"name","dir":"asc"}'), { key: 'name', dir: 'asc' });
  assert.deepEqual(toggleSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
  assert.deepEqual(toggleSort({ key: 'name', dir: 'asc' }, 'size'), { key: 'size', dir: 'desc' });
  assert.deepEqual(toggleSort({ key: 'size', dir: 'desc' }, 'by'), { key: 'by', dir: 'asc' });
  assert.equal(datesGroupable({ key: 'updated', dir: 'desc' }), true);
  assert.equal(datesGroupable({ key: 'updated', dir: 'asc' }), false);
});

test('the record lens has no role views and no image-only product view', () => {
  assert.deepEqual(LINK_VIEWS.map((view) => view.key), ['product', 'family', 'purchase', 'cost', 'planner', 'unused']);
  for (const view of LINK_VIEWS) {
    assert.equal('role' in view, false);
    assert.equal('kind' in view, false);
  }
  assert.equal(LINK_VIEWS.find((view) => view.key === 'product')?.targetType, 'PRODUCT');
  assert.deepEqual(LINK_VIEWS.filter((view) => view.sensitive).map((view) => view.key), ['purchase', 'cost']);
  assert.deepEqual(LINK_VIEWS.filter((view) => !view.canUpload).map((view) => view.key), ['planner']);
  assert.equal(LINK_VIEWS.find((view) => view.key === 'unused')?.linked, false);
});
