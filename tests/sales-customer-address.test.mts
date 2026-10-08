import assert from 'node:assert/strict';
import test from 'node:test';
import { customerAddressNotice, missingAddressText } from '../src/app/features/sales/sales-customer-address.ts';

/*
 * The notice on a document whose customer record lacks the address an
 * invoice needs. The blocks below are the shapes the backend sends
 * (SalesOrderResource.OrderView.invoiceCustomer, CustomerInvoiceData.Notice).
 */

const OFFER = { address: 'Stationsstraat 9', postalCode: '9000', city: 'Gent', countryCode: 'BE' };
const block = (changes: Record<string, unknown> = {}) => ({
  customerId: 42, company: 'Bloemen Anna', missing: ['ADDRESS', 'POSTAL_CODE', 'CITY'], takeover: OFFER, takeoverBlockedBy: null, ...changes,
});
const view = (invoiceCustomer: unknown, order: Record<string, unknown> = {}) =>
  ({ order: { id: 7, customerId: 42, docType: 'OFFERTE', ...order }, invoiceCustomer }) as any;
const names = (code: string) => ({ BE: 'België', FR: 'Frankrijk' })[code] ?? code;

test('the missing fields read as in the refusal of the server', () => {
  assert.equal(missingAddressText(['ADDRESS', 'POSTAL_CODE', 'CITY']), 'straat en nummer, postcode en stad');
  assert.equal(missingAddressText(['POSTAL_CODE', 'CITY']), 'postcode en stad');
  assert.equal(missingAddressText(['ADDRESS', 'CITY']), 'straat en nummer en stad');
  assert.equal(missingAddressText(['POSTAL_CODE']), 'postcode');
  assert.equal(missingAddressText([]), '');
  assert.equal(missingAddressText(null), '');
});

test('no block, no notice: nothing missing, the list, an older backend', () => {
  assert.equal(customerAddressNotice(null), null);
  assert.equal(customerAddressNotice(undefined), null);
  assert.equal(customerAddressNotice(view(null)), null);
  assert.equal(customerAddressNotice({ order: { id: 7, customerId: 42 } } as any), null);
  assert.equal(customerAddressNotice(view(block({ missing: [] }))), null);
  assert.equal(customerAddressNotice(view(block({ missing: undefined }))), null);
});

test('a website order with a delivery address offers the takeover and shows the address that will be written', () => {
  const notice = customerAddressNotice(view(block()), names)!;
  assert.equal(notice.lead, 'bij Bloemen Anna ontbreken straat en nummer, postcode en stad. Zonder volledig adres kan de factuur niet uitgereikt worden.');
  assert.equal(notice.reason, null);
  assert.deepEqual(notice.takeover, {
    lines: ['Stationsstraat 9', '9000 Gent', 'België'],
    request: { address: 'Stationsstraat 9', postalCode: '9000', city: 'Gent' },
  });
  assert.equal(notice.customerQuery, 'Bloemen Anna');
  assert.equal(notice.customerId, 42);
});

test('one missing field is singular; the country line is left out when the server has none', () => {
  const notice = customerAddressNotice(view(block({ missing: ['POSTAL_CODE'], takeover: { ...OFFER, countryCode: null } })))!;
  assert.equal(notice.lead, 'bij Bloemen Anna ontbreekt postcode. Zonder volledig adres kan de factuur niet uitgereikt worden.');
  assert.deepEqual(notice.takeover!.lines, ['Stationsstraat 9', '9000 Gent']);
});

test('without a country name lookup the code is shown', () => {
  assert.deepEqual(customerAddressNotice(view(block()))!.takeover!.lines, ['Stationsstraat 9', '9000 Gent', 'BE']);
});

test('a credit note names the credit note', () => {
  const notice = customerAddressNotice(view(block(), { docType: 'CREDITNOTA' }))!;
  assert.match(notice.lead, /kan de creditnota niet uitgereikt worden\.$/);
  assert.match(customerAddressNotice(view(block(), { docType: 'FACTUUR' }))!.lead, /kan de factuur niet uitgereikt worden\.$/);
});

test('no takeover: each reason of the server gets its sentence and the link to the customer', () => {
  const blocked = (code: string | null) => customerAddressNotice(view(block({ takeover: null, takeoverBlockedBy: code })))!;
  assert.equal(blocked('PICKUP').takeover, null);
  assert.match(blocked('PICKUP').reason!, /wordt afgehaald/);
  assert.match(blocked('OTHER_COUNTRY').reason!, /ander land/);
  assert.match(blocked('INCOMPLETE').reason!, /past niet bij wat al in de klantgegevens staat/);
  for (const code of ['PICKUP', 'OTHER_COUNTRY', 'INCOMPLETE']) assert.match(blocked(code).reason!, /Vul het adres in bij de klant\.$/);
  /* A plain quotation has no delivery address at all: nothing to explain, only the link. */
  assert.equal(blocked('NO_DELIVERY').reason, null);
  assert.equal(blocked('NO_DELIVERY').customerQuery, 'Bloemen Anna');
  /* A code this build does not know still gives the notice and the link. */
  assert.equal(blocked('SOMETHING_NEW').reason, null);
  assert.equal(blocked(null).takeover, null);
});

test('a half address is never offered for confirmation', () => {
  for (const hole of ['address', 'postalCode', 'city']) {
    const notice = customerAddressNotice(view(block({ takeover: { ...OFFER, [hole]: '  ' } })))!;
    assert.equal(notice.takeover, null, hole);
    assert.match(notice.lead, /ontbreken/);
  }
});

test('the confirmed values are the trimmed ones the server compares', () => {
  const notice = customerAddressNotice(view(block({ takeover: { address: ' Stationsstraat 9 ', postalCode: '9000 ', city: ' Gent', countryCode: ' be ' } })), names)!;
  assert.deepEqual(notice.takeover!.request, { address: 'Stationsstraat 9', postalCode: '9000', city: 'Gent' });
  assert.deepEqual(notice.takeover!.lines, ['Stationsstraat 9', '9000 Gent', 'België']);
});

test('an unsaved customer change in the editor hides the notice of the saved customer', () => {
  assert.equal(customerAddressNotice(view(block(), { customerId: 43 })), null);
  assert.equal(customerAddressNotice(view(block(), { customerId: null })), null);
});

test('a record without a company name still gets a readable sentence', () => {
  const notice = customerAddressNotice(view(block({ company: ' ' })))!;
  assert.match(notice.lead, /^bij deze klant ontbreken/);
  assert.equal(notice.customerQuery, '');
});
