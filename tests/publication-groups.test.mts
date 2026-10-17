import assert from 'node:assert/strict';
import test from 'node:test';
import { groupPublicationIssues } from '../src/app/features/products/publication-groups.ts';

test('publication points group by where they are fixed, in a fixed order', () => {
  const groups = groupPublicationIssues(['Collectie op de website ontbreekt', 'Foto ontbreekt', 'SEO-titel ontbreekt', 'Status website', 'Beschrijving niet vertaald (FR)']);
  assert.deepEqual(groups.map((group) => [group.label, group.issues.length]),
    [['Websitetekst', 2], ['Foto’s', 1], ['Collectie op de website', 1], ['Publicatie-instellingen', 1]]);
  assert.deepEqual(groupPublicationIssues([]), []);
});
