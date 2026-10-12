import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeChannels } from '../src/app/features/finance/channel-choices.ts';
import type { Fair } from '../src/app/core/api/models.ts';
import type { SalesChannel } from '../src/app/features/sales/sales-channels.ts';

const builtIn: SalesChannel[] = [
  { code: 'DIRECT', label: 'Rechtstreeks', hint: 'eigen klanten' },
  { code: 'WEBSITE', label: 'Website', hint: 'enrosed.com' },
  { code: 'TICA', label: 'TICA', hint: 'de stand' },
  { code: 'FAIR', label: 'Beurs', hint: 'op een beurs' },
];
const fairs: Fair[] = [
  { id: 1, code: 'TICA', label: 'TICA Trends & Trade', active: true },
  { id: 2, code: 'EDE', label: 'Ede', active: false },
  { id: 3, code: 'OUD', label: 'Oude beurs', active: false },
];

test('fairs come first, inactive ones only while a booking carries them, and TICA appears once as a fair', () => {
  const choices = mergeChannels(builtIn, fairs, ['ede', null, '', 'WEBSITE']);
  assert.deepEqual(choices.map((channel) => channel.code), ['TICA', 'EDE', 'DIRECT', 'WEBSITE', 'FAIR']);
  assert.deepEqual(choices.filter((channel) => channel.hint === 'Beurs').map((channel) => channel.label), ['TICA Trends & Trade', 'Ede']);
  assert.equal(choices.filter((channel) => channel.code === 'TICA').length, 1);
  assert.equal(choices.find((channel) => channel.code === 'TICA')?.hint, 'Beurs', 'the fair wins over the built-in channel');
});

test('without fairs the built-in channels stand as they are', () => {
  assert.deepEqual(mergeChannels(builtIn, [], []), builtIn);
  assert.deepEqual(mergeChannels(builtIn, fairs, []).map((channel) => channel.code), ['TICA', 'DIRECT', 'WEBSITE', 'FAIR'], 'an inactive fair nobody uses stays out');
});
