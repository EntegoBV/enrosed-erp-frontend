import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CustomerLogin, LoginRequest, LoginRequestDetail, LoginRequestLaterSubmission, LoginRequestMatch,
} from '../src/app/core/api/login-request-api.ts';
import {
  LOGIN_REQUESTS_PATH, LOGIN_REQUEST_PAGE_SIZE, applicantEntries, canApprove, choiceLocked, choiceOf, dateText,
  defaultChoice, draftFromLater, draftFromRequest, emailMismatch, existingAccountAlert, hasMore, intakeFullTexts,
  linkLine, loginStatusLabel, matchReasonLabel, needsMismatchConfirm, newLinkAlert, newLinkMarker,
  olderCustomerPreselected, rejectMessage, segmentToStatus, sourceLabel, statusBadge, subtitle,
} from '../src/app/features/login-requests/login-request-state.ts';

const request = (changes: Partial<LoginRequest> = {}): LoginRequest => ({
  id: 12, reference: 'LGN-0123456789ABCDEF0123', status: 'PENDING', source: 'ORDER_SCREEN', language: 'NL',
  companyName: 'Bloemen BV', companyCountryCode: 'BE', vatNumber: 'BE0123456789', contactName: 'An Peeters',
  email: 'an@bloemen.example', phone: '+32 470 00 00 00', message: null, customerId: null, customerCompany: null,
  salesOrderId: null, salesOrderNumber: null, accountId: null, repeatCount: 0, hasExistingLogin: false,
  previouslyRejected: false, laterSubmissions: [], laterSubmissionsFull: false,
  createdAt: '2026-10-05T10:00:00Z', decidedAt: null, decidedBy: null, decisionNote: null, ...changes,
});

const match = (customerId: number, matchedOn: LoginRequestMatch['matchedOn'], email: string | null = 'an@bloemen.example'): LoginRequestMatch => ({
  customerId, company: 'Klant ' + customerId, contact: null, email, vatNumber: null, countryCode: 'BE', city: 'Gent',
  matchedOn, logins: [],
});

const account = (status: CustomerLogin['status'], changes: Partial<CustomerLogin> = {}): CustomerLogin => ({
  id: 7, customerId: 345, customerCompany: 'Rozen NV', email: 'an@bloemen.example', contactName: null, language: 'NL',
  status, passwordSetAt: null, lastLoginAt: null, lastLinkSentAt: null, lastLinkError: null, linkExpiresAt: null,
  createdAt: '2026-10-01T10:00:00Z', createdBy: 'emre', disabledAt: null, disabledBy: null, activeSessions: 0, ...changes,
});

const detail = (matches: LoginRequestMatch[], existingAccount: CustomerLogin | null = null,
  changes: Partial<LoginRequest> = {}): LoginRequestDetail => ({ request: request(changes), matches, existingAccount });

const later = (changes: Partial<LoginRequestLaterSubmission>): LoginRequestLaterSubmission => ({
  at: '2026-10-05T12:00:00Z', source: 'ORDER_SCREEN', companyName: null, companyCountryCode: null, vatNumber: null,
  contactName: null, phone: null, message: null, language: null, customerId: null, salesOrderId: null,
  salesOrderNumber: null, ...changes,
});

const customerId = (choice: ReturnType<typeof defaultChoice>): number | null =>
  choice?.kind === 'customer' ? choice.customerId : null;

test('the customer of a working login is preselected and locked, whatever its own e-mail is', () => {
  for (const status of ['INVITED', 'ACTIVE'] as const) {
    const d = detail([match(345, ['LOGIN'], 'boekhouding@rozen.example'), match(20, ['EMAIL'])], account(status));
    assert.equal(customerId(defaultChoice(d)), 345, status);
    assert.equal(choiceLocked(d), true, status);
    assert.equal(needsMismatchConfirm(d, defaultChoice(d)), false, status);
  }
});

test('a working login locks its customer even when the server lists no match for it', () => {
  const d = detail([match(20, ['EMAIL'])], account('ACTIVE'));
  assert.equal(customerId(defaultChoice(d)), 345);
  assert.equal(choiceLocked(d), true);
});

test('a withdrawn login neither preselects nor locks', () => {
  const d = detail([match(345, ['VAT'], 'boekhouding@rozen.example')], account('DISABLED'));
  assert.equal(defaultChoice(d), null);
  assert.equal(choiceLocked(d), false);
  assert.equal(needsMismatchConfirm(d, choiceOf(d.matches[0])), true);
});

test('the oldest customer with the same e-mail beats the customer the quote made', () => {
  const d = detail([match(901, ['QUOTE', 'EMAIL']), match(40, ['EMAIL']), match(77, ['EMAIL', 'VAT'])], null,
    { source: 'QUOTE', customerId: 901, salesOrderId: 5, salesOrderNumber: 'ENR-2026-0901' });
  assert.equal(customerId(defaultChoice(d)), 40);
  assert.equal(choiceLocked(d), false);
  assert.equal(olderCustomerPreselected(d), true);
  const own = detail([match(901, ['QUOTE', 'EMAIL'])], null, { source: 'QUOTE', customerId: 901 });
  assert.equal(customerId(defaultChoice(own)), 901);
  assert.equal(olderCustomerPreselected(own), false);
});

test('a VAT-only or quote-only match is never a default, and no match selects nobody', () => {
  assert.equal(defaultChoice(detail([match(5, ['VAT'])])), null);
  assert.equal(defaultChoice(detail([match(5, ['QUOTE']), match(3, ['VAT'])])), null);
  assert.equal(defaultChoice(detail([])), null);
});

test('decided and new-link requests have no choice to preselect', () => {
  assert.equal(defaultChoice(detail([match(5, ['EMAIL'])], null, { status: 'APPROVED' })), null);
  const newLink = detail([match(345, ['LOGIN'])], account('ACTIVE'), { source: 'NEW_LINK' });
  assert.equal(defaultChoice(newLink), null);
  assert.equal(choiceLocked(newLink), false);
});

test('e-mail comparison ignores case and surrounding whitespace; an empty customer e-mail differs', () => {
  assert.equal(emailMismatch('an@bloemen.example', '  AN@Bloemen.Example '), false);
  assert.equal(emailMismatch('an@bloemen.example', 'jan@bloemen.example'), true);
  assert.equal(emailMismatch('an@bloemen.example', ''), true);
  assert.equal(emailMismatch('an@bloemen.example', null), true);
});

test('a freely chosen customer with another e-mail needs the explicit confirm', () => {
  const d = detail([match(20, ['EMAIL']), match(30, ['VAT'], 'info@ander.example')]);
  assert.equal(needsMismatchConfirm(d, choiceOf(d.matches[0])), false);
  assert.equal(needsMismatchConfirm(d, choiceOf(d.matches[1])), true);
  assert.equal(needsMismatchConfirm(d, { kind: 'customer', customerId: 99, company: 'Zonder mail', email: null }), true);
  assert.equal(needsMismatchConfirm(d, { kind: 'new' }), false);
  assert.equal(needsMismatchConfirm(d, null), false);
});

test('approving needs a choice, and a new customer needs company, VAT number and country', () => {
  const draft = draftFromRequest(request());
  assert.equal(canApprove(null, draft), false);
  assert.equal(canApprove({ kind: 'customer', customerId: 1, company: 'X', email: null }, { ...draft, company: '' }), true);
  assert.equal(canApprove({ kind: 'new' }, draft), true);
  assert.equal(canApprove({ kind: 'new' }, { ...draft, company: '  ' }), false);
  assert.equal(canApprove({ kind: 'new' }, { ...draft, vatNumber: '' }), false);
  assert.equal(canApprove({ kind: 'new' }, { ...draft, countryCode: '' }), false);
});

test('the existing-login warning follows the status of that login', () => {
  assert.equal(existingAccountAlert(null), null);
  assert.equal(existingAccountAlert(account('INVITED'))?.text,
    'Voor dit e-mailadres bestaat al een login bij Rozen NV (Uitgenodigd). Goedkeuren stuurt een nieuwe link naar dezelfde login.');
  assert.equal(existingAccountAlert(account('ACTIVE'))?.text,
    'Voor dit e-mailadres bestaat al een login bij Rozen NV (Actief). Goedkeuren stuurt een nieuwe link naar dezelfde login.');
  const withdrawn = existingAccountAlert(account('DISABLED', { disabledBy: 'berat', disabledAt: '2026-10-02T12:00:00Z' }));
  assert.equal(withdrawn?.tone, 'warn');
  assert.equal(withdrawn?.text,
    'De login voor dit e-mailadres bij Rozen NV is ingetrokken door berat op 02/10/2026. Goedkeuren geeft deze login '
    + 'opnieuw en stuurt een nieuwe link. Kies je een andere klant, dan verhuist de login naar die klant.');
});

test('a new-link request can only be sent for a login that still works', () => {
  const active = newLinkAlert('ACTIVE');
  assert.deepEqual([active.tone, active.canSend], ['info', true]);
  assert.match(active.text, /^Deze klant heeft al een login en vraagt een nieuwe link/);
  const invited = newLinkAlert('INVITED');
  assert.deepEqual([invited.tone, invited.canSend], ['info', true]);
  assert.match(invited.text, /koos nog geen wachtwoord/);
  for (const status of ['DISABLED', null] as const) {
    const gone = newLinkAlert(status);
    assert.deepEqual([gone.tone, gone.canSend], ['warn', false]);
    assert.equal(gone.text, 'Deze login is intussen ingetrokken. Een nieuwe link sturen kan niet; wijs de aanvraag af '
      + 'of geef de login opnieuw bij de klant (Klanten, blok Websitelogin).');
  }
});

test('an invited login says until when its link works, or that it expired', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  assert.equal(linkLine(account('INVITED', { linkExpiresAt: '2026-10-12T12:00:00Z' }), now), 'Link geldig tot 12/10/2026');
  assert.equal(linkLine(account('INVITED', { linkExpiresAt: '2026-10-04T12:00:00Z' }), now), 'Link verlopen');
  assert.equal(linkLine(account('INVITED'), now), 'Link verlopen');
  assert.equal(linkLine(account('ACTIVE', { linkExpiresAt: '2026-10-12T12:00:00Z' }), now), null);
  assert.equal(linkLine(account('DISABLED'), now), null);
});

test('every later version of an applicant is kept in order; the new-link marker is not one of them', () => {
  const entries = [
    later({ at: '2026-10-05T12:00:00Z', companyName: 'Eerste' }),
    later({ at: '2026-10-05T13:00:00Z', source: 'NEW_LINK' }),
    later({ at: '2026-10-05T14:00:00Z', companyName: 'Tweede', source: 'QUOTE', salesOrderNumber: 'ENR-2026-0902' }),
    later({ at: '2026-10-05T15:00:00Z', companyName: 'Derde' }),
  ];
  const row = request({ laterSubmissions: entries });
  assert.deepEqual(applicantEntries(row).map((entry) => entry.companyName), ['Eerste', 'Tweede', 'Derde']);
  assert.equal(newLinkMarker(row)?.at, '2026-10-05T13:00:00Z');
  assert.deepEqual(applicantEntries(request()), []);
  assert.equal(newLinkMarker(request()), null);
  assert.equal(newLinkMarker(request({ laterSubmissions: [entries[0]] })), null);
});

test('the new-customer form is filled from the version it is given, not from the first request', () => {
  const entry = later({ companyName: 'Andere BV', vatNumber: 'NL001', companyCountryCode: 'NL',
    contactName: 'Piet', phone: '0612', language: 'EN' });
  assert.deepEqual(draftFromLater(entry),
    { company: 'Andere BV', vatNumber: 'NL001', countryCode: 'NL', contact: 'Piet', phone: '0612', language: 'EN' });
  assert.deepEqual(draftFromLater(later({})),
    { company: '', vatNumber: '', countryCode: '', contact: '', phone: '', language: 'NL' });
  assert.deepEqual(draftFromRequest(request()), { company: 'Bloemen BV', vatNumber: 'BE0123456789',
    countryCode: 'BE', contact: 'An Peeters', phone: '+32 470 00 00 00', language: 'NL' });
});

test('a full intake list names its route, and an older backend gets the general sentence', () => {
  const form = intakeFullTexts(['ORDER_SCREEN']);
  assert.equal(form.length, 1);
  assert.match(form[0], /^De lijst met open aanvragen via het loginformulier is vol \(300\)\./);
  const quote = intakeFullTexts(['QUOTE']);
  assert.equal(quote.length, 1);
  assert.match(quote[0], /^De lijst met open login-aanvragen bij een offerte is vol \(300\)\./);
  assert.deepEqual(intakeFullTexts(['QUOTE', 'ORDER_SCREEN']), [form[0], quote[0]]);
  for (const sources of [[], null, undefined]) {
    assert.deepEqual(intakeFullTexts(sources), ['De lijst met open aanvragen is vol. Nieuwe aanvragen van de website '
      + 'worden niet meer bewaard tot er aanvragen zijn goedgekeurd of afgewezen.']);
  }
});

test('a full page offers the next one', () => {
  assert.equal(LOGIN_REQUEST_PAGE_SIZE, 50);
  assert.equal(hasMore(50, LOGIN_REQUEST_PAGE_SIZE), true);
  assert.equal(hasMore(49, LOGIN_REQUEST_PAGE_SIZE), false);
  assert.equal(hasMore(0, LOGIN_REQUEST_PAGE_SIZE), false);
  assert.equal(hasMore(50), true);
});

test('the reject question names the company safely and mentions repeats', () => {
  assert.equal(rejectMessage('Bloemen BV', 0),
    'De aanvraag van <b>Bloemen BV</b> afwijzen? De aanvrager krijgt geen bericht.');
  assert.equal(rejectMessage('Bloemen BV', 3),
    'De aanvraag van <b>Bloemen BV</b> afwijzen? De aanvrager krijgt geen bericht. Er kwamen 3 herhalingen binnen.');
  assert.equal(rejectMessage('<img src=x> & Co', 0),
    'De aanvraag van <b>&lt;img src=x&gt; &amp; Co</b> afwijzen? De aanvrager krijgt geen bericht.');
});

test('labels and badges', () => {
  assert.equal(sourceLabel({ source: 'QUOTE', salesOrderNumber: 'ENR-2026-0901' }), 'Offerteaanvraag ENR-2026-0901');
  assert.equal(sourceLabel({ source: 'QUOTE', salesOrderNumber: null }), 'Offerteaanvraag');
  assert.equal(sourceLabel({ source: 'ORDER_SCREEN' }), 'Loginformulier');
  assert.equal(sourceLabel({ source: 'NEW_LINK' }), 'Nieuwe link gevraagd');
  assert.deepEqual(statusBadge('PENDING'), { label: 'wacht', css: 'badge--gold' });
  assert.deepEqual(statusBadge('APPROVED'), { label: 'goedgekeurd', css: 'badge--ok' });
  assert.deepEqual(statusBadge('REJECTED'), { label: 'afgewezen', css: 'badge--neutral' });
  assert.equal(matchReasonLabel('LOGIN'), 'heeft deze login');
  assert.equal(matchReasonLabel('QUOTE'), 'uit deze offerteaanvraag');
  assert.equal(matchReasonLabel('EMAIL'), 'zelfde e-mailadres');
  assert.equal(matchReasonLabel('VAT'), 'zelfde BTW-nummer');
  assert.deepEqual(['INVITED', 'ACTIVE', 'DISABLED'].map((status) => loginStatusLabel(status as CustomerLogin['status'])),
    ['Uitgenodigd', 'Actief', 'Ingetrokken']);
  assert.equal(dateText(null), '—');
});

test('the segment in the address maps to a status, open by default', () => {
  assert.equal(segmentToStatus('open'), 'PENDING');
  assert.equal(segmentToStatus('goedgekeurd'), 'APPROVED');
  assert.equal(segmentToStatus('afgewezen'), 'REJECTED');
  assert.equal(segmentToStatus(null), 'PENDING');
  assert.equal(segmentToStatus('iets'), 'PENDING');
});

test('the subtitle counts the open requests in singular and plural', () => {
  assert.equal(subtitle(0), 'Geen open aanvragen');
  assert.equal(subtitle(1), '1 wacht op goedkeuring');
  assert.equal(subtitle(2), '2 wachten op goedkeuring');
});

test('the page route keeps the ERP shell: it starts with none of the bare or workspace prefixes', () => {
  assert.equal(LOGIN_REQUESTS_PATH, '/klantlogins');
  for (const prefix of ['/login', '/offerte', '/voorwaarden', '/website', '/files', '/costs']) {
    assert.equal(LOGIN_REQUESTS_PATH.startsWith(prefix), false, prefix);
  }
});
