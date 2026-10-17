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
