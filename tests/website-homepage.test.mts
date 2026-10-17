import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebsiteBuilderHomepage, WebsiteBuilderSection } from '../src/app/core/api/models.ts';
import { HOMEPAGE_SECTION_KEYS, homepageDifferences, homepageSummary, normalizeSections } from '../src/app/features/website-builder/website-homepage.ts';

const standard = (): WebsiteBuilderSection[] => HOMEPAGE_SECTION_KEYS.map((key) => ({ key, enabled: key !== 'occasion' && key !== 'catalog' }));

function snapshot(draft: WebsiteBuilderSection[], published: WebsiteBuilderSection[], publishedAt: string | null = null): WebsiteBuilderHomepage {
  return { revision: 4, draft: { sections: draft }, published: { sections: published }, updatedAt: '2026-10-17T08:12:00Z', publishedAt };
}

test('normalizing keeps the fixed first and last block and appends missing blocks visible', () => {
  const sections = normalizeSections([{ key: 'quote', enabled: false }, { key: 'soap', enabled: false }, { key: 'soap', enabled: true }]);
  assert.equal(sections.length, 11);
  assert.deepEqual(sections[0], { key: 'hero', enabled: true });
  assert.deepEqual(sections[10], { key: 'quote', enabled: true });
  assert.deepEqual(sections[1], { key: 'soap', enabled: false });
  assert.equal(sections.filter((section) => section.enabled).length, 10);
});

test('a standard layout that was never published', () => {
  const summary = homepageSummary(snapshot(standard(), standard()));
  assert.deepEqual([summary.total, summary.draftVisible, summary.publishedVisible, summary.differs, summary.neverPublished], [11, 9, 9, false, true]);
  assert.deepEqual(homepageDifferences(snapshot(standard(), standard())), []);
});

test('differences name moved and hidden blocks', () => {
  const draft = standard();
  const [flowerbox] = draft.splice(4, 1);
  draft.splice(2, 0, flowerbox);
  draft[draft.findIndex((section) => section.key === 'retail')] = { key: 'retail', enabled: false };
  const value = snapshot(draft, standard(), '2026-10-16T21:40:00Z');
  const summary = homepageSummary(value);
  assert.equal(summary.differs, true);
  assert.equal(summary.draftVisible, 8);
  assert.equal(summary.neverPublished, false);
  const differences = homepageDifferences(value);
  const flower = differences.find((row) => row.key === 'flowerbox')!;
  assert.deepEqual([flower.draftPosition, flower.livePosition], [3, 5]);
  const retail = differences.find((row) => row.key === 'retail')!;
  assert.deepEqual([retail.draftVisible, retail.liveVisible], [false, true]);
});

test('a difference reads as one line', async () => {
  const { differenceLine } = await import('../src/app/features/website-builder/website-homepage.ts');
  assert.equal(differenceLine({ key: 'occasion', draftPosition: 7, livePosition: 7, draftVisible: false, liveVisible: true }),
    'Kleine cadeaus · verborgen in concept, zichtbaar live');
  assert.equal(differenceLine({ key: 'flowerbox', draftPosition: 3, livePosition: 5, draftVisible: true, liveVisible: true }),
    'Glass bowls & flowerboxes · positie 3 in concept, 5 live');
});

test('one ⌥↓ swaps two places but counts one moved block, and only that row is marked', async () => {
  const { editedKeys, layoutEdits, layoutEditsText } = await import('../src/app/features/website-builder/website-homepage.ts');
  const saved = standard();
  const current = saved.map((section) => ({ ...section }));
  [current[3], current[4]] = [current[4], current[3]];
  const edits = layoutEdits(saved, current, new Set([current[4].key]));
  assert.deepEqual(edits.moved, ['counter']);
  assert.equal(layoutEditsText(edits), '1 blok verplaatst');
  assert.deepEqual([...editedKeys(edits)], ['counter'], 'the neighbour that slid up is not marked');
});

test('moves, hides and shows read in words; a block moved back counts no more', async () => {
  const { layoutEdits, layoutEditsText } = await import('../src/app/features/website-builder/website-homepage.ts');
  const saved = standard();
  const current = saved.map((section) => ({ ...section }));
  current[2] = { ...current[2], enabled: false };
  current[6] = { ...current[6], enabled: true };
  [current[4], current[5]] = [current[5], current[4]];
  const acted = new Set(['order', 'occasion', 'soap'] as const);
  assert.equal(layoutEditsText(layoutEdits(saved, current, acted)), '1 blok verplaatst · 1 blok verborgen · 1 blok getoond');
  assert.equal(layoutEditsText(layoutEdits(saved, saved, acted)), 'volgorde gewijzigd', 'nothing he did is left');
  const two = saved.map((section) => ({ ...section }));
  [two[1], two[2], two[3]] = [two[2], two[3], two[1]];
  assert.equal(layoutEditsText(layoutEdits(saved, two, new Set(['range', 'order'] as const))), '2 blokken verplaatst');
});

test('the Homepage page uses the acted-on edits, the save bar can restore, the phone block view never stays blank', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/app/features/website-builder/website-builder-page.ts', import.meta.url), 'utf8');
  assert.match(page, /readonly changedText = computed\(\(\) => layoutEditsText\(this\.edits\(\)\)\);/);
  assert.match(page, /short: 'Niet opgeslagen', detail: 'Sla de tekst eerst op in de editor\.'/);
  assert.match(page, /ws-savebar__revert" type="button" \[disabled\]="busy\(\)" \(click\)="revertLayout\(\)">Herstellen<\/button>/);
  assert.match(page, /<app-ios-nav title="Blok" \[largeTitle\]="false" backLabel="Homepage"[^>]*\(back\)="closeBlock\(\)" \/>/);
  assert.doesNotMatch(page, /Teksten laden…/);
  assert.match(page, /const gap = this\.definition\(section\.key\)\.siteGap;/);
  assert.match(page, /if \(!visible && shown\) \{\s*this\.clearPreviewWatch\(\);\s*this\.previewLoaded\.set\(false\);/);
  assert.match(page, /if \(!this\.sync\.status\(\)\) await this\.sync\.load\(\);\s*const before = this\.sync\.status\(\);/);
  assert.match(page, /if \(before\) this\.publishedFrom\.set\(before\.liveRevision \?\? null\);/);
});
