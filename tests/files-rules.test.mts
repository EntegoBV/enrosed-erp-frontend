import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveWarning, areaActions, buildTree, bulkSummary, canLink, canReplace, canShare, costTargetMeta, crumbsFor,
  deleteBlock, fileActions, folderActions, folderCanLand, folderCounts, folderMeta, joinLabels, parentChoices,
  pathLabel, pathTail, recordGroups, sensitiveNote, isSensitive, sortAssets, uploadDestination, whereLine,
} from '../src/app/features/files/files-rules.ts';
import { FILES_HOME, parseFilesLocation } from '../src/app/features/files/files-collections.ts';
import type { FilesLocation } from '../src/app/features/files/files-collections.ts';
import type { MediaAssetLink, MediaAssetSummary, MediaFolder, MediaTargetType } from '../src/app/core/api/media-models.ts';

const parse = (query: string): FilesLocation => {
  const params = new URLSearchParams(query);
  return parseFilesLocation((key) => params.get(key));
};

/* Productfoto's (1) > Rose Box (2) > Klein (4); Kosten (3) > 2026 (5); Overig (6) */
const folders: MediaFolder[] = [
  { id: 1, name: 'Productfoto’s', parentId: null, assetCount: 30 },
  { id: 2, name: 'Rose Box', parentId: 1, assetCount: 12 },
  { id: 3, name: 'Kosten', parentId: null, assetCount: 7 },
  { id: 4, name: 'Klein', parentId: 2, assetCount: 5 },
  { id: 5, name: '2026', parentId: 3, assetCount: 7 },
  { id: 6, name: 'Overig', parentId: null, assetCount: 0 },
];

let linkId = 0;
const link = (targetType: MediaTargetType, targetId: number, targetLabel: string | null = null, createdBy = 'emre'): MediaAssetLink => ({
  id: ++linkId, targetType, targetId, targetLabel, role: 'INTERNAL', primary: false, pinnedVersionId: null,
  createdAt: '2026-09-01T10:00:00Z', createdBy,
});

const asset = (id: number, extra: Partial<MediaAssetSummary> = {}): MediaAssetSummary => ({
  id, name: `Bestand ${id}`, originalFilename: `bestand-${id}.pdf`, contentType: 'application/pdf', sizeBytes: 1000 * id,
  sha256: 'x', kind: 'DOCUMENT', widthPx: null, heightPx: null, archived: false, createdAt: '2026-09-01T10:00:00Z',
  updatedAt: `2026-09-${String(10 + id).padStart(2, '0')}T10:00:00Z`, currentVersionId: id, roles: [], links: [], versionCount: 1,
  folderId: null, share: null, web: null, createdBy: 'emre', createdByName: 'Emre', ...extra,
});

test('folder counts: direct is the total minus the totals of the direct children', () => {
  const counts = folderCounts(folders);
  assert.deepEqual(counts.get(1), { direct: 18, total: 30, subfolders: 1 });
  assert.deepEqual(counts.get(2), { direct: 7, total: 12, subfolders: 1 });
  assert.deepEqual(counts.get(4), { direct: 5, total: 5, subfolders: 0 });
  assert.deepEqual(counts.get(3), { direct: 0, total: 7, subfolders: 1 });
  assert.equal(folderMeta(counts.get(1)), '18 bestanden · 1 submap');
  assert.equal(folderMeta(counts.get(3)), '1 submap · 7 in totaal');
  assert.equal(folderMeta(counts.get(4)), '5 bestanden');
  assert.equal(folderMeta({ direct: 1, total: 1, subfolders: 0 }), '1 bestand');
});

test('the tree is depth first in Dutch order and stops below eight levels', () => {
  assert.deepEqual(buildTree(folders).map((node) => `${node.depth}:${node.name}`),
    ['0:Kosten', '1:2026', '0:Overig', '0:Productfoto’s', '1:Rose Box', '2:Klein']);
  const deep: MediaFolder[] = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `L${index}`, parentId: index ? index : null, assetCount: 0 }));
  const tree = buildTree(deep);
  assert.equal(tree.length, 9);
  assert.equal(Math.max(...tree.map((node) => node.depth)), 8);
});

test('crumbs and paths', () => {
  assert.deepEqual(crumbsFor(folders, 4).map((crumb) => crumb.name), ['Productfoto’s', 'Rose Box', 'Klein']);
  assert.deepEqual(crumbsFor(folders, null), []);
  assert.equal(pathLabel(folders, 5), 'Kosten › 2026');
  assert.equal(pathLabel(folders, null), 'Zonder map');
  assert.equal(pathTail(folders, 4), 'Rose Box › Klein');
  assert.equal(pathTail(folders, 3), 'Kosten');
});

test('a folder never lands in itself, a descendant or where it already is', () => {
  const rose = folders[1];
  assert.equal(folderCanLand(folders, rose, 2), false, 'itself');
  assert.equal(folderCanLand(folders, rose, 4), false, 'descendant');
  assert.equal(folderCanLand(folders, rose, 1), false, 'current parent');
  assert.equal(folderCanLand(folders, rose, 3), true, 'a sibling branch');
  assert.equal(folderCanLand(folders, rose, null), true, 'the top level');
  assert.equal(folderCanLand(folders, folders[0], null), false, 'already at the top');
  assert.deepEqual(parentChoices(buildTree(folders), 2).map((node) => node.id), [3, 5, 6, 1]);
  assert.equal(parentChoices(buildTree(folders), null).length, 6);
});

test('delete waits for the archive and never takes a linked file', () => {
  assert.equal(deleteBlock(asset(1), 'folders'), 'archive-first');
  assert.equal(deleteBlock(asset(1, { links: [link('PRODUCT', 1)] }), 'recent'), 'archive-first');
  assert.equal(deleteBlock(asset(1, { links: [link('PRODUCT', 1)] }), 'archive'), 'linked');
  assert.equal(deleteBlock(asset(1), 'archive'), null);
  assert.equal(deleteBlock(asset(1, { archived: true }), 'folders'), null, 'an archived file outside Archief');
  assert.equal(deleteBlock(asset(1, { archived: true, links: [link('PRODUCT', 1)] }), 'recent'), 'linked');
});

test('archive warnings: nothing without links, one line per kind, two names then a count', () => {
  assert.equal(archiveWarning([asset(1)]), null);
  assert.deepEqual(archiveWarning([asset(1, { links: [link('PRODUCT', 1, 'Rose Box 12')] })]),
    ['Het verdwijnt uit Bestanden bij Rose Box 12.']);
  assert.deepEqual(archiveWarning([asset(1, { links: [link('COMPANY_COST', 9, 'Factuur Proximus'), link('PURCHASE_ORDER', 46, 'INK-2026-014', 'system')] })]),
    ['Bij Factuur Proximus blijft het staan met het label ‘gearchiveerd’.', 'In INK-2026-014 blijft het gewoon staan.']);
  const many = archiveWarning([
    asset(1, { links: [link('PRODUCT', 1, 'A'), link('PRODUCT', 2, 'B')] }),
    asset(2, { links: [link('PRODUCT', 3, 'C'), link('PRODUCT', 4, null)] }),
  ]);
  assert.deepEqual(many, ['Het verdwijnt uit Bestanden bij A, B en 2 andere.']);
  assert.equal(joinLabels(['A', 'A']), 'A');
  assert.equal(joinLabels(['A', 'B']), 'A en B');
});

test('cost and purchase documents are sensitive; archived files cannot be shared, linked or re-versioned', () => {
  assert.equal(isSensitive(asset(1, { links: [link('COMPANY_COST', 1)] })), true);
  assert.equal(isSensitive(asset(1, { links: [link('PURCHASE_ORDER', 1)] })), true);
  assert.equal(isSensitive(asset(1, { links: [link('PRODUCT', 1)] })), false);
  assert.equal(sensitiveNote(asset(1, { links: [link('COMPANY_COST', 1)] })), 'Let op: dit is een kostendocument.');
  assert.equal(sensitiveNote(asset(1, { links: [link('PURCHASE_ORDER', 1)] })), 'Let op: dit is een inkoopdocument.');
  assert.equal(sensitiveNote(asset(1)), null);
  const archived = asset(1, { archived: true });
  assert.equal(canShare(archived), false);
  assert.equal(canLink(archived), false);
  assert.equal(canReplace(archived), false);
  assert.equal(canShare(asset(1)), true);
});

test('uploads land where the place says', () => {
  const view = (key: string) => ({ targetType: ({ product: 'PRODUCT', cost: 'COMPANY_COST', planner: 'PLANNER_ITEM', unused: null } as Record<string, MediaTargetType | null>)[key], canUpload: key !== 'planner' });
  assert.deepEqual(uploadDestination(parse('map=5'), folders, null), { kind: 'folder', folderId: 5, label: 'Kosten › 2026' });
  for (const query of ['', 'view=all', 'map=5&q=factuur']) {
    assert.deepEqual(uploadDestination(parse(query), folders, null), { kind: 'auto', label: 'Overig (automatisch)' }, query);
  }
  assert.deepEqual(uploadDestination(parse('view=unused'), folders, view('unused')), { kind: 'auto', label: 'Overig (automatisch)' });
  assert.deepEqual(uploadDestination(parse('view=cost&doel=9'), folders, view('cost'), 'Factuur Proximus'),
    { kind: 'record', targetType: 'COMPANY_COST', targetId: 9, label: 'Overig (automatisch) · gekoppeld aan Factuur Proximus' });
  assert.deepEqual(uploadDestination(parse('view=product'), folders, view('product')),
    { kind: 'record', targetType: 'PRODUCT', targetId: null, label: 'Overig (automatisch)' });
  assert.deepEqual(uploadDestination(parse('view=all&archief=1'), folders, null), { kind: 'none', reason: 'In het archief kun je niets toevoegen.' });
  assert.deepEqual(uploadDestination(parse('view=planner'), folders, view('planner')), { kind: 'none', reason: 'Bijlagen voor de planner voeg je in de planner toe.' });
});

test('whereLine says link or folder, never both, and nothing where the place says it', () => {
  const linked = asset(1, { folderId: 5, links: [link('COMPANY_COST', 9, 'Factuur Proximus'), link('PRODUCT', 2, 'Rose Box')] });
  assert.deepEqual(whereLine(linked, FILES_HOME, folders), { kind: 'link', text: 'Factuur Proximus +1' });
  assert.deepEqual(whereLine(asset(2, { folderId: 4 }), parse('view=all'), folders), { kind: 'folder', text: 'Rose Box › Klein' });
  assert.deepEqual(whereLine(asset(2, { folderId: 4 }), parse('map=4'), folders), { kind: 'none', text: '' });
  assert.deepEqual(whereLine(asset(2, { folderId: 4 }), parse('map=4&q=x'), folders), { kind: 'folder', text: 'Rose Box › Klein' });
  assert.deepEqual(whereLine(linked, parse('view=cost'), folders), { kind: 'none', text: '' });
  assert.deepEqual(whereLine(asset(3), parse('view=all'), folders), { kind: 'folder', text: 'Zonder map' });
  assert.deepEqual(whereLine(asset(3), FILES_HOME, folders), { kind: 'none', text: '' });
});

test('costTargetMeta: party, date and amount', () => {
  const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(1234.5);
  assert.equal(costTargetMeta({ party: 'Proximus', date: '2026-09-03', amountInclEur: 1234.5, amountExclEur: 1020 }), `Proximus · 03/09/2026 · ${euro}`);
  assert.equal(costTargetMeta({ party: null, date: '2026-09-03', amountExclEur: 10 }).startsWith('03/09/2026 · '), true);
  assert.equal(costTargetMeta({ party: ' ', date: null }), '');
});

test('sorting loaded files, with a stable fallback', () => {
  const list = [asset(1, { name: 'b', folderId: 5 }), asset(2, { name: 'a', folderId: 4 }), asset(3, { name: 'C', folderId: null })];
  assert.deepEqual(sortAssets(list, { key: 'name', dir: 'asc' }, folders).map((item) => item.name), ['a', 'b', 'C']);
  assert.deepEqual(sortAssets(list, { key: 'updated', dir: 'desc' }, folders).map((item) => item.id), [3, 2, 1]);
  assert.deepEqual(sortAssets(list, { key: 'size', dir: 'desc' }, folders).map((item) => item.id), [3, 2, 1]);
  assert.deepEqual(sortAssets(list, { key: 'folder', dir: 'asc' }, folders).map((item) => item.id), [1, 2, 3]);
  const tied = [asset(1, { name: 'x' }), asset(2, { name: 'x' })];
  assert.deepEqual(sortAssets(tied, { key: 'name', dir: 'asc' }, folders).map((item) => item.id), [2, 1]);
});

test('record groups: a file under each of its records, groups by newest file', () => {
  const list = [
    asset(1, { links: [link('PRODUCT', 7, 'Rose Box'), link('PRODUCT', 8, 'Tulip')] }),
    asset(5, { links: [link('PRODUCT', 8, 'Tulip')] }),
    asset(2, { links: [link('COMPANY_COST', 1)] }),
  ];
  const groups = recordGroups(list, 'PRODUCT');
  assert.deepEqual(groups.map((group) => [group.label, group.assets.map((item) => item.id)]), [['Tulip', [1, 5]], ['Rose Box', [1]]]);
});

test('one action list: single, archive, multi, folder and empty area', () => {
  const context = { drawer: false, phone: false, inOwnFolder: false };
  const ids = (items: { id: string }[]) => items.map((item) => item.id);
  assert.deepEqual(ids(fileActions([asset(1)], 'folders', context)),
    ['quick-look', 'download', 'share', 'rename', 'move', 'link', 'version', 'reveal', 'archive']);
  assert.deepEqual(ids(fileActions([asset(1, { share: { token: 't', createdAt: '', createdBy: null, downloads: 0 }, web: { sizeBytes: 10, widthPx: 1, heightPx: 1 } })], 'folders', { ...context, drawer: true, inOwnFolder: true })),
    ['quick-look', 'info', 'download', 'download-web', 'copy-link', 'rename', 'move', 'link', 'version', 'archive']);
  assert.ok(ids(fileActions([asset(1)], 'recent', { ...context, phone: true })).includes('select'));
  assert.ok(!ids(fileActions([asset(1)], 'recent', context)).includes('delete'), 'no delete outside Archief');
  const archived = fileActions([asset(1, { archived: true, links: [link('PRODUCT', 1)] })], 'archive', context);
  assert.deepEqual(ids(archived), ['quick-look', 'download', 'reveal', 'restore', 'delete']);
  const del = archived.find((item) => item.id === 'delete')!;
  assert.equal(del.disabled, true);
  assert.equal(del.hint, 'Nog gekoppeld');
  assert.equal(fileActions([asset(1, { archived: true })], 'archive', context).find((item) => item.id === 'delete')?.disabled, false);
  assert.deepEqual(ids(fileActions([asset(1, { archived: true })], 'folders', context)), ['quick-look', 'download', 'reveal', 'restore', 'delete'],
    'an archived file shown in a folder still gets the Archief actions');
  assert.deepEqual(ids(fileActions([asset(1), asset(2)], 'recent', context)), ['download-zip', 'move', 'link', 'archive']);
  assert.deepEqual(ids(fileActions([asset(1), asset(2)], 'archive', context)), ['download-zip', 'restore', 'delete']);
  assert.deepEqual(ids(folderActions()), ['folder-open', 'folder-new', 'folder-rename', 'folder-move', 'folder-download', 'folder-delete']);
  assert.deepEqual(ids(areaActions({ folderPlace: true, canAdd: true, layout: 'grid', hasFiles: false })), ['new-folder', 'add', 'layout-list', 'layout-grid', 'download-all']);
  assert.equal(areaActions({ folderPlace: false, canAdd: false, layout: 'grid', hasFiles: false }).find((item) => item.id === 'layout-grid')?.checked, true);
  for (const item of [...fileActions([asset(1)], 'folders', context), ...folderActions()]) assert.ok(item.iconName, item.id);
  assert.equal(bulkSummary('gearchiveerd', 12, 2, 'Geen toegang'), '12 gearchiveerd, 2 mislukt: Geen toegang');
  assert.equal(bulkSummary('gearchiveerd', 3, 0, null), '3 gearchiveerd');
});
