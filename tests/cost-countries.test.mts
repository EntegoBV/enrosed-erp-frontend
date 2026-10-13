import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EU_MEMBERS, SUPPLIER_COUNTRIES, cleanVatNumber, countryName, isEuMember, isValidVatNumber, suggestRegime,
} from '../src/app/features/finance/cost-countries.ts';

test('the 27 member states decide reverse charge', () => {
  assert.equal(EU_MEMBERS.length, 27);
  assert.equal(new Set(EU_MEMBERS).size, 27);
  assert.equal(isEuMember('nl'), true);
  assert.equal(isEuMember('GB'), false);
  assert.equal(isEuMember(null), false);
  assert.equal(SUPPLIER_COUNTRIES[0].code, 'BE');
  assert.equal(countryName('NL'), 'Nederland');
  assert.equal(countryName('ie'), 'Ierland');
  assert.equal(countryName('JP', [{ code: 'JP', name: 'Japan' }]), 'Japan', 'the loaded names fill the gaps');
  assert.equal(countryName('ZZ'), 'ZZ');
  assert.equal(countryName(null), '');
});

test('VAT numbers are cleaned and checked like the server does', () => {
  assert.equal(cleanVatNumber('be 0123.456.749'), 'BE0123456749');
  assert.equal(isValidVatNumber('BE0123456749'), true);
  assert.equal(isValidVatNumber('BE2123456749'), false);
  assert.equal(isValidVatNumber('NL858617262B02'), true);
  assert.equal(isValidVatNumber('X'), false);
  assert.equal(isValidVatNumber(cleanVatNumber('ie 6388047v')), true);
});

test('the country suggests a regime, unconfirmed, with its reason', () => {
  const reason = 'Afgeleid van het land · controleer';
  assert.deepEqual(suggestRegime({ country: 'BE', vatNumber: null, category: 'SOFTWARE' }), { regime: 'BE', reason });
  assert.deepEqual(suggestRegime({ country: null, vatNumber: 'BE0123456749', category: null }), { regime: 'BE', reason });
  assert.deepEqual(suggestRegime({ country: 'IE', vatNumber: null, category: 'SOFTWARE' }), { regime: 'EU_SERVICES', reason });
  assert.deepEqual(suggestRegime({ country: null, vatNumber: 'IE6388047V', category: 'SOFTWARE' }), { regime: 'EU_SERVICES', reason }, 'the number tells the country');
  assert.deepEqual(suggestRegime({ country: 'DE', vatNumber: null, category: 'MATERIAAL' }), { regime: 'EU_GOODS', reason });
  assert.deepEqual(suggestRegime({ country: 'NL', vatNumber: null, category: 'BEURS' }), { regime: 'EU_SERVICES', reason }, 'a fair organiser (TICA, Ede) reverse charges the stand');
  assert.deepEqual(suggestRegime({ country: 'NL', vatNumber: null, category: 'REIS' }), { regime: 'FOREIGN_VAT', reason });
  assert.deepEqual(suggestRegime({ country: 'US', vatNumber: null, category: 'SOFTWARE' }), { regime: 'NON_EU_SERVICES', reason });
  assert.equal(suggestRegime({ country: 'CN', vatNumber: null, category: 'MATERIAAL' }), null, 'goods from outside the EU go through customs');
  assert.deepEqual(suggestRegime({ country: 'XI', vatNumber: null, category: 'MATERIAAL' }), { regime: 'EU_GOODS', reason }, 'Northern Ireland counts for goods');
  assert.deepEqual(suggestRegime({ country: 'XI', vatNumber: null, category: 'SOFTWARE' }), { regime: 'NON_EU_SERVICES', reason });
  assert.equal(suggestRegime({ country: null, vatNumber: null, category: 'SOFTWARE' }), null);
});
