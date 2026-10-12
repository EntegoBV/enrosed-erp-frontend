import assert from 'node:assert/strict';
import test from 'node:test';
import { PAY_TO_BANK_KEY, defaultBankAccount, readPayToBank, writePayToBank } from '../src/app/features/finance/pay-to-bank-preference.ts';

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
}

test('the preference round-trips through the shared key and reads as off when nothing is stored', () => {
  const store = storage();
  assert.deepEqual(readPayToBank(store), { on: false, accountKey: '' });
  writePayToBank(store, { on: true, accountKey: 'BE68539007547034' });
  assert.equal(store.map.has(PAY_TO_BANK_KEY), true);
  assert.deepEqual(readPayToBank(store), { on: true, accountKey: 'BE68539007547034' });
});

test('a missing, broken or throwing storage never breaks a form', () => {
  assert.deepEqual(readPayToBank(null), { on: false, accountKey: '' });
  assert.deepEqual(readPayToBank(undefined), { on: false, accountKey: '' });
  assert.deepEqual(readPayToBank(storage({ [PAY_TO_BANK_KEY]: '{not json' })), { on: false, accountKey: '' });
  assert.deepEqual(readPayToBank(storage({ [PAY_TO_BANK_KEY]: '{"on":"yes","accountKey":5}' })), { on: false, accountKey: '' });
  const throwing = { getItem: () => { throw new Error('quota'); }, setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(readPayToBank(throwing), { on: false, accountKey: '' });
  assert.doesNotThrow(() => writePayToBank(throwing, { on: true, accountKey: 'X' }));
  assert.doesNotThrow(() => writePayToBank(null, { on: true, accountKey: 'X' }));
});

test('the account chips start on the chosen account, else the remembered one, else the only one', () => {
  const two = [{ key: 'A' }, { key: 'B' }];
  assert.equal(defaultBankAccount(two, 'B', 'A'), 'B');
  assert.equal(defaultBankAccount(two, 'gone', 'A'), 'A');
  assert.equal(defaultBankAccount(two, '', 'gone'), '');
  assert.equal(defaultBankAccount([{ key: 'A' }], '', ''), 'A');
  assert.equal(defaultBankAccount([], 'A', 'A'), '');
});
