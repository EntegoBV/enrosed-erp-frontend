import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  blankCustomer, defaultCustomerCountry, VAT_REQUIRED_MESSAGE, vatCountryMismatch, vatNumberMissing,
} from '../src/app/features/customers/customer-form.ts';

test('a new customer starts on Klanten defaults wherever it is made', () => {
  const customer = blankCustomer('NL');
  assert.equal(customer.id, null);
  assert.equal(customer.countryCode, 'NL');
  assert.equal(customer.paymentTerms, 'Vooruitbetaling');
  assert.equal(customer.incoterm, 'DAP');
  assert.equal(customer.language, 'NL');
  assert.equal(customer.vatNumber, '');
  assert.equal(customer.partner, false);
  assert.equal(customer.fiscalRepresentative, false);
});

test('the default country is Belgium when it ships, else the first configured one', () => {
  assert.equal(defaultCustomerCountry(['AT', 'BE', 'NL']), 'BE');
  assert.equal(defaultCustomerCountry(['NL', 'DE']), 'NL');
  assert.equal(defaultCustomerCountry([]), '');
});

test('an empty or blank VAT number is missing: the server refuses it', () => {
  assert.equal(vatNumberMissing(''), true);
  assert.equal(vatNumberMissing('   '), true);
  assert.equal(vatNumberMissing(null), true);
  assert.equal(vatNumberMissing(undefined), true);
  assert.equal(vatNumberMissing('BE0123456789'), false);
  assert.match(VAT_REQUIRED_MESSAGE, /BTW-nummer/);
});

test('the VAT prefix is compared with the country, with the Greek and Northern Irish exceptions', () => {
  assert.equal(vatCountryMismatch('BE 0123.456.789', 'BE'), null);
  assert.deepEqual(vatCountryMismatch('nl123456789B01', 'BE'), { prefix: 'NL', country: 'BE' });
  assert.equal(vatCountryMismatch('EL123456789', 'GR'), null);
  assert.equal(vatCountryMismatch('XI123456789', 'GB'), null);
  assert.equal(vatCountryMismatch('0123456789', 'BE'), null, 'no letters, nothing to compare');
  assert.equal(vatCountryMismatch('BE0123456789', ''), null);
});

test('the quick-add at Verkoop asks the VAT number and uses the shared rules', async () => {
  const list = await readFile(new URL('../src/app/features/sales/sales-list.ts', import.meta.url), 'utf8');
  assert.match(list, /from '\.\.\/customers\/customer-form'/);
  assert.match(list, /id="nc-vat"/);
  assert.match(list, /vatNumberMissing\(this\.newCustomer\(\)\.vatNumber\)/);
  assert.doesNotMatch(list, /'30 dagen'/, 'no quick-add default of its own');
  const klanten = await readFile(new URL('../src/app/features/customers/customer-list.ts', import.meta.url), 'utf8');
  assert.match(klanten, /from '\.\/customer-form'/);
});
