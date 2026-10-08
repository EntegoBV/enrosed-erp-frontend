import assert from 'node:assert/strict';
import test from 'node:test';
import { TAKEOVER_BLOCKED_HINT, TAKEOVER_KEPT, TAKEOVER_WRITTEN, customerAddressNotice, focusPlaceAfterTakeover, missingAddressText, takeoverAnswerFor } from '../src/app/features/sales/sales-customer-address.ts';

/*
 * The notice on a document whose customer record lacks the address an
 * invoice needs. The blocks below are the shapes the backend sends
 * (SalesOrderResource.OrderView.invoiceCustomer, CustomerInvoiceData.Notice).
 */

/* A record with a country and no address: every address field comes from the delivery, the country is the record's. */
const OFFER = { address: 'Stationsstraat 9', postalCode: '9000', city: 'Gent', countryCode: 'BE' };
const shown = (takeover: { fields: { label: string; value: string; written: boolean }[] }) =>
  takeover.fields.map((field) => `${field.label}: ${field.value} (${field.written ? 'written' : 'kept'})`);
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
    fields: [
      { label: 'Straat en nummer', value: 'Stationsstraat 9', written: true },
      { label: 'Postcode', value: '9000', written: true },
      { label: 'Stad', value: 'Gent', written: true },
      /* The record's own country: shown, never written. */
      { label: 'Land', value: 'België', written: false },
    ],
    request: { address: 'Stationsstraat 9', postalCode: '9000', city: 'Gent' },
  });
  assert.equal(notice.customerQuery, 'Bloemen Anna');
  assert.equal(notice.customerId, 42);
});

test('one missing field is singular; a record without a country shows no country, none is written', () => {
  const notice = customerAddressNotice(view(block({ missing: ['POSTAL_CODE'], takeover: { ...OFFER, countryCode: null } })))!;
  assert.equal(notice.lead, 'bij Bloemen Anna ontbreekt postcode. Zonder volledig adres kan de factuur niet uitgereikt worden.');
  /* Only the postal code is written; street and city are the record's own and stay. */
  assert.deepEqual(shown(notice.takeover!), ['Straat en nummer: Stationsstraat 9 (kept)', 'Postcode: 9000 (written)', 'Stad: Gent (kept)']);
});

test('a field the record already has is shown in the record\'s own spelling and still travels in the call', () => {
  /* CustomerInvoiceData.afterwards: the record says "GENT ", the delivery "Gent"; the server sends the record's
     value unstripped and compares the body with it ignoring capitals and outer spaces. */
  const notice = customerAddressNotice(view(block({ missing: ['ADDRESS', 'POSTAL_CODE'], takeover: { ...OFFER, city: 'GENT ', countryCode: null } })), names)!;
  assert.deepEqual(shown(notice.takeover!), ['Straat en nummer: Stationsstraat 9 (written)', 'Postcode: 9000 (written)', 'Stad: GENT (kept)']);
  assert.deepEqual(notice.takeover!.request, { address: 'Stationsstraat 9', postalCode: '9000', city: 'GENT' });
  assert.equal(notice.lead, 'bij Bloemen Anna ontbreken straat en nummer en postcode. Zonder volledig adres kan de factuur niet uitgereikt worden.');
});

test('the country is the record\'s own or absent, whatever the document says', () => {
  /* The document is for France, the record has no country: the server sends null and nothing about a country is shown. */
  const none = customerAddressNotice(view(block({ takeover: { ...OFFER, countryCode: null } }), { countryCode: 'FR' }), names)!;
  assert.deepEqual(none.takeover!.fields.map((field) => field.label), ['Straat en nummer', 'Postcode', 'Stad']);
  for (const empty of [undefined, '', '  ']) {
    const notice = customerAddressNotice(view(block({ takeover: { ...OFFER, countryCode: empty } })), names)!;
    assert.equal(notice.takeover!.fields.length, 3);
  }
  const own = customerAddressNotice(view(block()), names)!;
  assert.deepEqual(own.takeover!.fields[3], { label: 'Land', value: 'België', written: false });
  assert.equal('countryCode' in own.takeover!.request, false);
});

test('the words beside each part of the confirmation', () => {
  assert.equal(TAKEOVER_WRITTEN, 'wordt ingevuld');
  assert.equal(TAKEOVER_KEPT, 'staat er al');
});

test('without a country name lookup the code is shown', () => {
  assert.equal(customerAddressNotice(view(block()))!.takeover!.fields[3].value, 'BE');
});

test('a credit note names the credit note', () => {
  const notice = customerAddressNotice(view(block(), { docType: 'CREDITNOTA' }))!;
  assert.match(notice.lead, /kan de creditnota niet uitgereikt worden\.$/);
  assert.match(customerAddressNotice(view(block(), { docType: 'FACTUUR' }))!.lead, /kan de factuur niet uitgereikt worden\.$/);
  /* The confirmation names the same document as the lead. */
  assert.equal(notice.document, 'de creditnota');
  assert.equal(customerAddressNotice(view(block(), { docType: 'FACTUUR' }))!.document, 'de factuur');
  assert.equal(customerAddressNotice(view(block()))!.document, 'de factuur');
});

test('no takeover: each reason of the server gets its sentence and the link to the customer', () => {
  const blocked = (code: string | null) => customerAddressNotice(view(block({ takeover: null, takeoverBlockedBy: code })))!;
  assert.equal(blocked('PICKUP').takeover, null);
  assert.match(blocked('PICKUP').reason!, /wordt afgehaald/);
  assert.match(blocked('OTHER_COUNTRY').reason!, /ander land/);
  /* The server sends INCOMPLETE both for a delivery that lacks a field and for a record that says something
     else (CustomerInvoiceData.fits): the sentence must hold for an empty record too. */
  assert.equal(blocked('INCOMPLETE').reason, 'Het leveradres is onvolledig of past niet bij wat al in de klantgegevens staat. Vul het adres in bij de klant.');
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
  assert.deepEqual(notice.takeover!.fields.map((field) => field.value), ['Stationsstraat 9', '9000', 'Gent', 'België']);
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

test('the reason of a disabled takeover is a sentence, in the words of the neighbouring cards', () => {
  assert.equal(TAKEOVER_BLOCKED_HINT, 'Sla openstaande wijzigingen eerst op om het leveradres over te nemen.');
});

test('an answer that arrives while nothing else happened is shown whole', () => {
  const started = view(block());
  const answer = { ...view(null), delivery: { address: 'Stationsstraat 9', differsFromCustomerRecord: false } } as any;
  assert.equal(takeoverAnswerFor(started, started, answer), answer);
});

test('an answer that arrives after a save only brings the notice and the delivery block', () => {
  const started = view(block(), { internalNotes: '' });
  /* Staff typed and saved while the takeover was under way: the host shows the saved view. */
  const saved = { ...view(block(), { internalNotes: 'Teamnotitie' }), delivery: { address: 'Stationsstraat 9', differsFromCustomerRecord: true } } as any;
  const answer = { ...view(null, { internalNotes: '' }), delivery: { address: 'Stationsstraat 9', differsFromCustomerRecord: false } } as any;
  const shown = takeoverAnswerFor(started, saved, answer)!;
  assert.equal(shown.order, saved.order);
  assert.equal(shown.order.internalNotes, 'Teamnotitie');
  assert.equal(shown.invoiceCustomer, null);
  assert.equal(shown.delivery!.differsFromCustomerRecord, false);
  assert.equal(customerAddressNotice(shown), null);
  /* An answer without a delivery block (older backend) keeps the one on screen. */
  assert.equal(takeoverAnswerFor(started, saved, view(null))!.delivery, saved.delivery);
  /* A refusal reloads the view: the notice of that reload is laid over the saved view the same way. */
  const stale = block({ takeover: { ...OFFER, address: 'Nieuwe Kaai 3' } });
  assert.equal(takeoverAnswerFor(started, saved, view(stale))!.invoiceCustomer, stale);
});

test('an answer for a document the host no longer shows is dropped', () => {
  const started = view(block());
  assert.equal(takeoverAnswerFor(started, view(block(), { id: 8 }), view(null)), null);
  assert.equal(takeoverAnswerFor(started, null, view(null)), null);
});

test('after the takeover the focus goes to the element above the notice, unless staff moved it', () => {
  const body = {};
  const banner = { previousElementSibling: null, contains: () => false };
  const button = {};
  const host = { previousElementSibling: banner, contains: (other: unknown) => other === button };
  /* The button vanished with the notice: the browser reports the body (or nothing). */
  assert.equal(focusPlaceAfterTakeover(host, body, body), banner);
  assert.equal(focusPlaceAfterTakeover(host, null, body), banner);
  assert.equal(focusPlaceAfterTakeover(host, button, body), banner);
  /* Staff clicked into a field meanwhile: leave the focus there. */
  assert.equal(focusPlaceAfterTakeover(host, {}, body), null);
  /* Nothing above the notice: nowhere better than where the browser left it. */
  assert.equal(focusPlaceAfterTakeover({ previousElementSibling: null, contains: () => false }, body, body), null);
});
