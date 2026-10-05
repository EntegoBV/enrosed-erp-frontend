import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomerLogin } from '../src/app/core/api/login-request-api.ts';
import {
  linkToast, loginActions, loginBadge, loginDate, loginHints, loginRowText,
} from '../src/app/features/customers/customer-login-state.ts';

const login = (status: CustomerLogin['status'], changes: Partial<CustomerLogin> = {}): CustomerLogin => ({
  id: 7, customerId: 345, customerCompany: 'Rozen NV', email: 'an@bloemen.example', contactName: null, language: 'NL',
  status, passwordSetAt: null, lastLoginAt: null, lastLinkSentAt: null, lastLinkError: null, linkExpiresAt: null,
  createdAt: '2026-10-01T10:00:00Z', createdBy: 'emre', disabledAt: null, disabledBy: null, activeSessions: 0, ...changes,
});

/* Midday instants: the local day is the same in every zone the suite runs in. */
const NOW = new Date('2026-10-05T12:00:00Z');

test('an invited login names the send date and the expiry the server gave', () => {
  const invited = login('INVITED', { lastLinkSentAt: '2026-10-03T12:00:00Z', linkExpiresAt: '2026-10-10T12:00:00Z' });
  assert.equal(loginRowText(invited, NOW), 'Link verstuurd op 03/10/2026, geldig tot 10/10/2026');
});

test('an invited login without a live link reads as expired', () => {
  assert.equal(loginRowText(login('INVITED', { lastLinkSentAt: '2026-09-20T12:00:00Z' }), NOW), 'Link verlopen');
  assert.equal(loginRowText(login('INVITED', {
    lastLinkSentAt: '2026-09-20T12:00:00Z', linkExpiresAt: '2026-09-27T12:00:00Z',
  }), NOW), 'Link verlopen');
  assert.equal(loginRowText(login('INVITED', { linkExpiresAt: NOW.toISOString() }), NOW), 'Link verlopen');
  assert.equal(loginRowText(login('INVITED', { linkExpiresAt: 'geen datum' }), NOW), 'Link verlopen');
});

test('a live link whose mail never left shows only the expiry', () => {
  assert.equal(loginRowText(login('INVITED', { linkExpiresAt: '2026-10-10T12:00:00Z' }), NOW),
    'Link geldig tot 10/10/2026');
});

test('an active login shows the last login or that there was none', () => {
  assert.equal(loginRowText(login('ACTIVE', { lastLoginAt: '2026-10-04T12:00:00Z' }), NOW), 'Laatst ingelogd 04/10/2026');
  assert.equal(loginRowText(login('ACTIVE'), NOW), 'Nog niet ingelogd');
  /* A pending new link does not change the line of an active login. */
  assert.equal(loginRowText(login('ACTIVE', { linkExpiresAt: '2026-10-10T12:00:00Z' }), NOW), 'Nog niet ingelogd');
});

test('a withdrawn login names who withdrew it and when', () => {
  assert.equal(loginRowText(login('DISABLED', { disabledBy: 'berat', disabledAt: '2026-10-02T12:00:00Z' }), NOW),
    'Ingetrokken door berat op 02/10/2026');
  assert.equal(loginRowText(login('DISABLED', { disabledAt: '2026-10-02T12:00:00Z' }), NOW),
    'Ingetrokken door onbekend op 02/10/2026');
});

test('badges per status', () => {
  assert.deepEqual(loginBadge('INVITED'), { label: 'Uitgenodigd', css: 'badge--gold' });
  assert.deepEqual(loginBadge('ACTIVE'), { label: 'Actief', css: 'badge--ok' });
  assert.deepEqual(loginBadge('DISABLED'), { label: 'Ingetrokken', css: 'badge--neutral' });
});

test('an invited login gets a new link or is withdrawn, without a hint', () => {
  assert.deepEqual(loginActions('INVITED'), [
    { key: 'send', label: 'Nieuwe link sturen', hint: null, danger: false },
    { key: 'withdraw', label: 'Login intrekken', hint: null, danger: true },
  ]);
});

test('an active login explains that the current password keeps working', () => {
  const actions = loginActions('ACTIVE');
  assert.deepEqual(actions.map((action) => [action.key, action.label, action.danger]), [
    ['send', 'Nieuwe link sturen', false], ['withdraw', 'Login intrekken', true],
  ]);
  assert.equal(actions[0].hint,
    'Voor een vergeten wachtwoord. Het huidige wachtwoord blijft werken tot de klant een nieuw kiest.');
  assert.equal(actions[1].hint, null);
});

test('next to a second button a hint names the button it belongs to', () => {
  assert.deepEqual(loginHints(loginActions('ACTIVE')), [
    'Nieuwe link sturen: voor een vergeten wachtwoord. Het huidige wachtwoord blijft werken tot de klant een nieuw kiest.',
  ]);
  assert.deepEqual(loginHints(loginActions('INVITED')), []);
  assert.deepEqual(loginHints(loginActions('DISABLED')),
    ['De klant kiest dan een nieuw wachtwoord; het oude werkt niet meer.']);
});

test('a withdrawn login can only be given again', () => {
  assert.deepEqual(loginActions('DISABLED'), [{
    key: 'send', label: 'Login opnieuw geven', danger: false,
    hint: 'De klant kiest dan een nieuw wachtwoord; het oude werkt niet meer.',
  }]);
});

test('the toast names the address and the expiry of the invitation', () => {
  assert.deepEqual(linkToast('an@bloemen.example', { sent: true, expiresAt: '2026-10-12T12:00:00Z' }),
    { kind: 'ok', text: 'Link verstuurd naar an@bloemen.example, geldig tot 12/10/2026' });
});

test('a mail that did not leave is an error toast, whatever the expiry', () => {
  const failed = { kind: 'err', text: 'De mail is niet vertrokken. Probeer het opnieuw met Nieuwe link sturen.' };
  assert.deepEqual(linkToast('an@bloemen.example', { sent: false, expiresAt: '2026-10-12T12:00:00Z' }), failed);
  assert.deepEqual(linkToast('an@bloemen.example', { sent: false, expiresAt: null }), failed);
});

test('dates read dd/mm/yyyy, with a dash for none', () => {
  assert.equal(loginDate('2026-05-25T12:00:00Z'), '25/05/2026');
  assert.equal(loginDate(null), '—');
  assert.equal(loginDate('geen datum'), 'geen datum');
});
