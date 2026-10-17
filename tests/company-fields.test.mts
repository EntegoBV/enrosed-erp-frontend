import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyProfile, DiscountTier, HsCode } from '../src/app/core/api/models.ts';
import {
  bankSummary, contactLine, dateNl, deviceLines, dutySummary, fiscalSummary, footerSummary, ibanDisplay, identityLine,
  legalPill, lineDiscountSummary, numberingSummary, shortDateTimeNl, tierSummary, todayCount, trashSummary, usablePattern,
  websiteSyncValue,
} from '../src/app/features/settings/company-fields.ts';

export const profile = (extra: Partial<CompanyProfile> = {}): CompanyProfile => ({
  name: 'Enrosed', legalName: 'Enrosed BV', vatNumber: 'BE 1034.273.386', registrationNumber: '1034.273.386',
  addressLine: 'Vekeblok 17', postalCode: '2400', city: 'Mol', countryCode: 'BE', email: 'hello@enrosed.com',
  phone: '+324 4 70 02 42 07', website: 'ENROSED.COM', iban: 'BE94731074082814', bic: 'KREDBEBB',
  documentFooter: '', documentFooterEn: null, termsAndConditions: null, termsAndConditionsEn: null,
  privacyPolicy: null, privacyPolicyEn: null, fiscalRepresentativeName: null, fiscalRepresentativeVat: null,
  quoteNumberPrefix: null, invoiceNumberPrefix: null, partnerQuoteNumberPattern: null, partnerInvoiceNumberPattern: null,
  partnerQuoteNextNumber: null, partnerInvoiceNextNumber: null, creditNoteNumberPrefix: null, importVatDeferred: false,
  ...extra,
});
const tier = (minQuantity: number, percent: number, productId: number | null = null): DiscountTier =>
  ({ id: null, scope: productId == null ? 'ORDER' : 'LINE', productId, minQuantity, percent } as DiscountTier);
const code = (dutyRatePct: number): HsCode => ({ id: null, code: '0603', description: '', dutyRatePct } as HsCode);

test('overview strings for tiers and tariffs read as the owner says them', () => {
  assert.equal(tierSummary([tier(1500, 2), tier(3000, 4), tier(5000, 10), tier(20000, 15)]), '4 staffels · 2 tot 15 %');
  assert.equal(tierSummary([tier(1500, 2)]), '1 staffel · 2 %');
  assert.equal(tierSummary([]), 'Geen staffels');
  assert.equal(dutySummary([code(4.7), code(10), code(6.5)]), '3 tarieven · 4,7 tot 10 %');
  assert.equal(dutySummary([code(10)]), '1 tarief · 10 %');
  assert.equal(lineDiscountSummary([]), '0 producten');
  assert.equal(lineDiscountSummary([tier(1, 2, 5), tier(100, 4, 5), tier(1, 1, 9), tier(1, 1)]), '2 producten');
});

test('company rows: identity, bank in groups of four, numbering with the defaults said', () => {
  const p = profile();
  assert.equal(identityLine(p), 'BE 1034.273.386 · Vekeblok 17, 2400 Mol');
  assert.equal(contactLine(p), 'hello@enrosed.com · +324 4 70 02 42 07');
  assert.equal(ibanDisplay('BE94731074082814'), 'BE94 7310 7408 2814');
  assert.equal(ibanDisplay(' be94 7310 7408 2814 '), 'BE94 7310 7408 2814');
  assert.equal(bankSummary(p), 'BE94 7310 7408 2814 · KREDBEBB');
  assert.equal(bankSummary(profile({ iban: '' })), 'Geen IBAN');
  assert.equal(numberingSummary(p), 'ENR · F · CN · container/{jaar}/{nr:3}');
  assert.equal(numberingSummary(profile({ quoteNumberPrefix: 'OFF', partnerInvoiceNumberPattern: 'partner/{jaar}/{nr:3}' })),
    'OFF · F · CN · container/{jaar}/{nr:3}');
  assert.equal(footerSummary(p), 'Geen voettekst');
  assert.equal(footerSummary(profile({ documentFooter: 'x', documentFooterEn: 'y' })), 'Voettekst NL en EN');
  assert.equal(fiscalSummary(p), 'ET 14000 uit · NL: 24/7 Customs BV (standaard)');
  assert.equal(fiscalSummary(profile({ importVatDeferred: true, fiscalRepresentativeName: 'Fisc BV' })), 'ET 14000 aan · NL: Fisc BV');
});

test('patterns the backend ignores fall back', () => {
  assert.equal(usablePattern('partner/{jaar}/{nr:3}'), null);
  assert.equal(usablePattern('container/{jaar}'), null);
  assert.equal(usablePattern('pf/{jaar}/{nr:4}'), 'pf/{jaar}/{nr:4}');
});

test('legal pills: built-in unless a text is filled in', () => {
  assert.deepEqual(legalPill(null, null), { label: 'Ingebouwd voorstel', custom: false });
  assert.deepEqual(legalPill('  ', ''), { label: 'Ingebouwd voorstel', custom: false });
  assert.deepEqual(legalPill('Eigen', null), { label: 'Eigen tekst (NL)', custom: true });
  assert.deepEqual(legalPill('Eigen', 'Own'), { label: 'Eigen tekst', custom: true });
});

test('dates, devices, trash, Logboek and the website row', () => {
  const now = new Date(2026, 9, 16, 12, 0);
  assert.equal(dateNl(new Date(2026, 9, 3, 9, 0).toISOString()), '03/10/2026');
  assert.equal(shortDateTimeNl(new Date(2026, 9, 16, 10, 48).toISOString(), now), '16/10, 10:48');
  assert.deepEqual(deviceLines({ device: 'Android', since: new Date(2026, 9, 3).toISOString(), lastStatus: 201, lastAt: new Date(2026, 9, 16, 10, 48).toISOString() }, now),
    { title: 'Android · aangemeld sinds 03/10/2026', sub: 'laatste melding 16/10, 10:48' });
  assert.equal(deviceLines({ device: 'iPhone', since: null, lastStatus: null, lastAt: null }, now).sub, 'nog geen melding gestuurd');
  assert.equal(deviceLines({ device: 'iPhone', since: null, lastStatus: 410, lastAt: null }, now).sub, 'laatste melding geweigerd (410)');
  assert.equal(trashSummary(9, 90), '9 documenten · 90 dagen');
  assert.equal(trashSummary(1, 90), '1 document · 90 dagen');
  assert.equal(trashSummary(0, null), 'Leeg');
  const at = (h: number, day = 16) => ({ at: new Date(2026, 9, day, h).toISOString() });
  assert.equal(todayCount([at(11), at(10), at(9, 15)], true, now), '2 vandaag');
  assert.equal(todayCount([at(11), at(10)], true, now), '2+ vandaag');
  assert.equal(todayCount([at(11), at(10)], false, now), '2 vandaag');
  assert.equal(websiteSyncValue(null), '');
  assert.match(websiteSyncValue({ status: 'LIVE', liveAt: new Date(2026, 9, 16, 23, 40).toISOString() } as never), /^Live sinds 16\/10\/2026, 23:40$/);
  assert.equal(websiteSyncValue({ status: 'QUEUED' } as never), 'In wachtrij');
});
