import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { regimeToConfirm } from '../src/app/features/finance/finance-metrics.ts';

test('the warn dot after a cost says what is to be confirmed, and which regime was derived (§3.8, §10)', () => {
  assert.equal(regimeToConfirm('BE', false), 'Btw-regeling afgeleid · te bevestigen · België');
  assert.equal(regimeToConfirm('EU_SERVICES', null), 'Btw-regeling afgeleid · te bevestigen · EU · dienst');
  assert.equal(regimeToConfirm('BE', true), '', 'a confirmed regime has no dot');
  assert.equal(regimeToConfirm(null, true), 'Btw-regeling nog te bepalen', 'without a regime there is nothing derived yet');
  assert.equal(regimeToConfirm(undefined, false), 'Btw-regeling nog te bepalen');
});

test('the cost rows (Facturen & kosten, Te betalen, phone) take the dot\'s words from regimeToConfirm', async () => {
  const source = await readFile(new URL('../src/app/features/finance/cost-row.ts', import.meta.url), 'utf8');
  assert.match(source, /readonly regimeNote = computed\(\(\) => regimeToConfirm\(this\.cost\(\)\.vatRegime, this\.cost\(\)\.vatRegimeConfirmed\)\);/);
  assert.doesNotMatch(source, /· te bevestigen`/, 'no second spelling of the title');
});
