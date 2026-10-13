import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EU_MEMBERS, FAIR_REGIME_QUESTION, SUPPLIER_COUNTRIES, cleanVatNumber, countryName, fairRegimeQuestion, isEuMember, isFairCategory, isValidVatNumber, suggestRegime,
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
  const fair = 'Beursfactuur: btw verlegd · staat er Nederlandse btw op? Kies dan Buitenlandse btw';
  assert.deepEqual(suggestRegime({ country: 'NL', vatNumber: null, category: 'BEURS' }), { regime: 'EU_SERVICES', reason: fair }, 'a fair organiser (TICA, Ede) reverse charges the stand, and the reason names the exception');
  assert.deepEqual(suggestRegime({ country: null, vatNumber: 'NL858617262B02', category: 'beurs' }), { regime: 'EU_SERVICES', reason: fair });
  assert.deepEqual(suggestRegime({ country: 'NL', vatNumber: null, category: 'TICA' }), { regime: 'EU_SERVICES', reason: fair }, 'the retired fair category reads the same');
  assert.deepEqual(suggestRegime({ country: 'DE', vatNumber: null, category: 'BEURS' }),
    { regime: 'EU_SERVICES', reason: 'Beursfactuur: btw verlegd · staat er buitenlandse btw op? Kies dan Buitenlandse btw' }, 'a German organiser does not charge Dutch VAT');
  assert.deepEqual(suggestRegime({ country: 'BE', vatNumber: null, category: 'BEURS' }), { regime: 'BE', reason }, 'a Belgian organiser charges Belgian VAT');
  assert.deepEqual(suggestRegime({ country: 'GB', vatNumber: null, category: 'BEURS' }), { regime: 'NON_EU_SERVICES', reason }, 'outside the EU the general reason stays');
  assert.deepEqual(suggestRegime({ country: 'NL', vatNumber: null, category: 'MARKETING' }), { regime: 'EU_SERVICES', reason }, 'other categories keep the general reason');
  assert.deepEqual(suggestRegime({ country: 'NL', vatNumber: null, category: 'REIS' }), { regime: 'FOREIGN_VAT', reason });
  assert.deepEqual(suggestRegime({ country: 'US', vatNumber: null, category: 'SOFTWARE' }), { regime: 'NON_EU_SERVICES', reason });
  assert.equal(suggestRegime({ country: 'CN', vatNumber: null, category: 'MATERIAAL' }), null, 'goods from outside the EU go through customs');
  assert.deepEqual(suggestRegime({ country: 'XI', vatNumber: null, category: 'MATERIAAL' }), { regime: 'EU_GOODS', reason }, 'Northern Ireland counts for goods');
  assert.deepEqual(suggestRegime({ country: 'XI', vatNumber: null, category: 'SOFTWARE' }), { regime: 'NON_EU_SERVICES', reason });
  assert.equal(suggestRegime({ country: null, vatNumber: null, category: 'SOFTWARE' }), null);
});

test('a fair invoice to a name nothing is known about raises the question, and only then', () => {
  assert.equal(FAIR_REGIME_QUESTION, 'Beursfactuur: Belgische btw of btw verlegd? Controleer');
  const nothing = { regime: null, country: null, vatNumber: null };
  assert.equal(fairRegimeQuestion({ category: 'BEURS', ...nothing }), FAIR_REGIME_QUESTION);
  assert.equal(fairRegimeQuestion({ category: ' beurs ', ...nothing, country: ' ', vatNumber: ' . ' }), FAIR_REGIME_QUESTION, 'blanks are nothing');
  assert.equal(fairRegimeQuestion({ category: 'TICA', ...nothing }), FAIR_REGIME_QUESTION, 'a name still on the retired fair category');
  for (const category of ['ANDERE', 'REIS', 'MARKETING', 'MATERIAAL', '', null]) {
    assert.equal(fairRegimeQuestion({ category, ...nothing }), null, `not for ${category}`);
  }
  assert.equal(fairRegimeQuestion({ category: 'BEURS', ...nothing, regime: 'BE' }), null, 'a regime confirmed before answers it');
  assert.equal(fairRegimeQuestion({ category: 'BEURS', ...nothing, regime: 'EU_SERVICES' }), null);
  assert.equal(fairRegimeQuestion({ category: 'BEURS', ...nothing, country: 'NL' }), null, 'a country suggests a regime by itself');
  assert.equal(fairRegimeQuestion({ category: 'BEURS', ...nothing, country: 'BE' }), null);
  assert.equal(fairRegimeQuestion({ category: 'BEURS', ...nothing, vatNumber: 'nl 8586.17.262 B02' }), null, 'and so does a VAT number');
  assert.equal(isFairCategory('Beurs'), true);
  assert.equal(isFairCategory('REIS'), false);
  assert.equal(isFairCategory(null), false);
});
