import assert from 'node:assert/strict';
import test from 'node:test';
import { MEER_ORIGIN, originOf } from '../src/app/features/analyses/analyses-origin.ts';
import { capsuleLabel, isWorkspaceUrl, screenLabel } from '../src/app/core/platform/return-label.ts';

const origin = (url: string | null) => originOf(url, screenLabel, isWorkspaceUrl);

test('home → Analyses goes back to Vandaag', () => {
  assert.deepEqual(origin('/dashboard'), { label: 'Vandaag', url: '/dashboard' });
});

test('a purchase order → Afwijkingen goes back to that order, as a chevron circle (label over ten characters)', () => {
  const back = origin('/purchasing/41?section=receipt');
  assert.deepEqual(back, { label: 'Inkooporder', url: '/purchasing/41?section=receipt' });
  assert.equal(capsuleLabel(back.label), '');
});

test('a deep link, another Analyses tab (a chip switch) or a workspace gives "‹ Meer"', () => {
  assert.deepEqual(origin(null), MEER_ORIGIN);
  assert.deepEqual(origin('/analyses/sales?periode=alle'), MEER_ORIGIN);
  assert.deepEqual(origin('/analyses'), MEER_ORIGIN);
  assert.deepEqual(origin('/costs?view=incoming'), MEER_ORIGIN);
  assert.deepEqual(origin('/'), MEER_ORIGIN);
  assert.deepEqual(origin('/more'), { label: 'Meer', url: '/more' });
});
