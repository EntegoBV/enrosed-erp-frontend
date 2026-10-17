import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LAST_ACCOUNT_KEY, readLastAccount, rememberLastAccount } from '../src/app/features/login/last-account.ts';

function store(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

test('the last account is remembered by name only, and read back', () => {
  const s = store();
  assert.equal(readLastAccount(s), '');
  rememberLastAccount(s, 'berat');
  assert.equal(s.data.get(LAST_ACCOUNT_KEY), 'berat');
  assert.equal(readLastAccount(s), 'berat');
  rememberLastAccount(s, 'someone-else');
  assert.equal(readLastAccount(s), 'berat', 'only the two accounts');
  assert.equal(readLastAccount(store({ [LAST_ACCOUNT_KEY]: 'hacker' })), '');
  assert.deepEqual([...s.data.keys()], [LAST_ACCOUNT_KEY], 'nothing else is stored');
});

test('a blocked store behaves as before', () => {
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readLastAccount(blocked), '');
  assert.doesNotThrow(() => rememberLastAccount(blocked, 'emre'));
  assert.equal(readLastAccount(null), '');
});

test('the login page: the eye toggle, the focus and the 375x667 fit', () => {
  const page = readFileSync(new URL('../src/app/features/login/login-page.ts', import.meta.url), 'utf8');
  assert.match(page, /\[attr\.aria-label\]="showPassword\(\) \? 'Wachtwoord verbergen' : 'Wachtwoord tonen'"/);
  assert.match(page, /\[attr\.aria-pressed\]="showPassword\(\)"/);
  assert.match(page, /\[type\]="showPassword\(\) \? 'text' : 'password'"/);
  assert.match(page, /\.login__password \.input\{padding-right:48px\}/);
  assert.match(page, /@media\(max-width:679px\) and \(max-height:700px\)\{\.login\{padding-top:clamp\(120px,24vh,190px\)\}\}/);
  assert.match(page, /rememberLastAccount\(deviceStore\(\), this\.username\(\)\)/);
  /* the error texts stay */
  for (const text of ['Account of wachtwoord klopt niet.', 'Kies je account en vul je wachtwoord in.', 'Privé werkruimte voor Emre en Berat']) {
    assert.ok(page.includes(text), text);
  }
});
