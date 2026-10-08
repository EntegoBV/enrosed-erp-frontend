import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { LANGUAGES } from '../src/app/core/api/models.ts';
import { PORTAL_NOT_FOUND, portalRefusalOf } from '../src/app/features/portal/portal-refusal.ts';

/*
 * What the customer's quotation page (offerte/:token) makes of a failed load.
 * The bodies are the ones the backend sends (BusinessRuleMapper for a
 * PortalRefusal, NotFoundMapper for a link that does not exist); HttpClient
 * hands them over as { status, error: <parsed body> }.
 */

const CODES = LANGUAGES.map(({ code }) => code);
const UPDATING_MESSAGE = 'Deze offerte wordt momenteel bijgewerkt. De nieuwe versie is pas zichtbaar nadat Enrosed ze opnieuw heeft verstuurd.';
const updating = (changes: Record<string, unknown> = {}) => ({ status: 409, error: {
  status: 409, code: 'QUOTE_BEING_UPDATED', message: UPDATING_MESSAGE, language: 'FR', timestamp: '2026-10-08T14:00:00Z', ...changes } });
const cancelled = (changes: Record<string, unknown> = {}) => ({ status: 409, error: {
  status: 409, code: 'QUOTE_CANCELLED', message: 'Deze offerte is geannuleerd.', language: 'NL', timestamp: '2026-10-08T14:00:00Z', ...changes } });
const notFound = { status: 404, error: { status: 404, message: 'Offertelink bestaat-niet niet gevonden', timestamp: '2026-10-08T14:00:00Z' } };

test('a quotation that is being updated is its own notice, in the language of the customer file', () => {
  assert.deepEqual(portalRefusalOf(updating(), CODES), { kind: 'updating', staffMessage: null, language: 'FR' });
  /* A staff message has no place on this notice, whatever the body carries. */
  assert.equal(portalRefusalOf(updating({ cancellationMessage: 'Niet tonen' }), CODES).staffMessage, null);
});

test('a quotation cancelled as an unsent draft is its own notice, without and with the staff message', () => {
  assert.deepEqual(portalRefusalOf(cancelled(), CODES), { kind: 'cancelled', staffMessage: null, language: 'NL' });
  const typed = '  Het product is uit het gamma.\n\nBel ons gerust: 2 dozen i.p.v. 3. ';
  const withMessage = portalRefusalOf(cancelled({ message: 'Deze offerte is geannuleerd. ' + typed, cancellationMessage: typed }), CODES);
  assert.equal(withMessage.kind, 'cancelled');
  /* Exactly as staff typed it: line breaks and outer spaces included, never taken from the Dutch message. */
  assert.equal(withMessage.staffMessage, typed);
  /* A staff sentence that itself starts with the notice is not shortened. */
  assert.equal(portalRefusalOf(cancelled({ cancellationMessage: 'Deze offerte is geannuleerd. Zie onze mail.' }), CODES).staffMessage,
    'Deze offerte is geannuleerd. Zie onze mail.');
});

test('the staff message is null when absent, null, blank or not a text', () => {
  for (const none of [undefined, null, '', '   ', '\n', 7, {}, ['x']]) {
    assert.equal(portalRefusalOf(cancelled({ cancellationMessage: none }), CODES).staffMessage, null, JSON.stringify(none));
  }
  /* The sentence inside `message` is never cut out: only the field counts. */
  assert.equal(portalRefusalOf(cancelled({ message: 'Deze offerte is geannuleerd. Uit het gamma' }), CODES).staffMessage, null);
});

test('a link that does not exist, a lost connection and any other failure stay "not found"', () => {
  for (const failure of [notFound, { status: 0, error: new Error('Failed to fetch') }, { status: 500, error: 'Internal Server Error' },
    { status: 503, error: null }, null, undefined, 'x', new Error('x'), {}]) {
    assert.equal(portalRefusalOf(failure, CODES), PORTAL_NOT_FOUND);
  }
  assert.deepEqual(PORTAL_NOT_FOUND, { kind: 'notFound', staffMessage: null, language: null });
});

test('an older backend sends the 409 without a code: today\'s text, also when the message says more', () => {
  const old = { status: 409, error: { status: 409, message: UPDATING_MESSAGE, timestamp: '2026-10-08T14:00:00Z' } };
  assert.equal(portalRefusalOf(old, CODES), PORTAL_NOT_FOUND);
  assert.equal(portalRefusalOf({ status: 409, error: { status: 409, message: 'Deze offerte is geannuleerd. Uit het gamma' } }, CODES), PORTAL_NOT_FOUND);
  /* The older PDF route printed a map as text; a body that is no object is no code. */
  assert.equal(portalRefusalOf({ status: 409, error: '{status=409, message=Deze offerte is geannuleerd.}' }, CODES), PORTAL_NOT_FOUND);
});

test('a code of another refusal, or the right code under another status, is not one of the two notices', () => {
  for (const code of ['WEB_ORDER_CHANGED', 'LOCALIZATION_INCOMPLETE', 'quote_cancelled', 'toString', '__proto__', '', 7, null]) {
    assert.equal(portalRefusalOf(cancelled({ code }), CODES), PORTAL_NOT_FOUND, String(code));
  }
  assert.equal(portalRefusalOf({ ...cancelled(), status: 404 }, CODES), PORTAL_NOT_FOUND);
  assert.equal(portalRefusalOf({ ...updating(), status: 422 }, CODES), PORTAL_NOT_FOUND);
});

test('the language is one the page has, else none', () => {
  assert.equal(portalRefusalOf(updating({ language: ' el ' }), CODES).language, 'EL');
  for (const unknown of [undefined, null, '', 'XX', 'Frans', 3]) {
    const refusal = portalRefusalOf(updating({ language: unknown }), CODES);
    assert.equal(refusal.kind, 'updating');
    assert.equal(refusal.language, null, String(unknown));
  }
  assert.equal(portalRefusalOf(updating()).language, null);
});

/* ------------------------------------------------------------------ the page
 * load(), setLanguage(), local() and the page's own dictionary, lifted out of
 * the component the way tests/portal-greek-language.test.mts does. */

const source = await readFile(new URL('../src/app/features/portal/portal-page.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('portal-page.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PortalPage');
assert.ok(original);
const names = new Set(['language', 'locale', 'load', 'storedLanguage', 'setLanguage', 'local', 't',
  'run', 'showRefusal', 'accept', 'reject', 'withdraw', 'propose']);
const members = original.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)), original.name, undefined, undefined, members);
const constants = parsed.statements.filter((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => ['PORTAL_LOCALES', 'PORTAL_FALLBACKS'].includes(declaration.name.getText(parsed))));
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [...constants, isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + '\nexports.PORTAL_FALLBACKS = PORTAL_FALLBACKS;';

const QUOTE = (language?: string) => ({ language: language ?? 'DE', contactName: 'Kunde', text: { quote: 'Angebot' } });
function harness(answer: (language?: string) => unknown, stored?: string, action?: () => unknown) {
  const toasts: string[][] = [];
  const act = (name: string) => async () => {
    calls.push([name]);
    const result = action ? action() : QUOTE();
    /* A failure is what HttpClient hands over: it has an `error`, also when the status is 0 (no connection). */
    if (result && typeof result === 'object' && 'error' in result) throw result;
    return result;
  };
  const storage = new Map<string, string>(stored ? [['enrosed.portalLanguage.fixture', stored]] : []), calls: any[] = [], exports: any = {};
  vm.runInNewContext(javascript, { exports, signal, computed, LANGUAGES, Intl, portalRefusalOf,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  });
  const page = new exports.PortalPage();
  const state = { answer };
  Object.assign(page, { token: () => 'fixture', quote: signal(null), catalog: signal([]), error: signal(false),
    refusal: signal(PORTAL_NOT_FOUND), proposeBy: signal(''), busy: signal(false),
    signSheet: signal(false), proposalSheet: signal(false), catalogSheet: signal(false), rejectSheet: signal(false),
    signName: signal('Klant'), signNote: signal(''), rejectMessage: signal(''), proposeMessage: signal(''),
    proposalLines: signal([]), additions: signal(new Map()), roundTimers: new Map(),
    ui: { toast: (text: string, kind = 'ok') => toasts.push([text, kind]) },
    sales: {
      portalAccept: act('accept'), portalReject: act('reject'), portalWithdraw: act('withdraw'), portalPropose: act('propose'),
      portalQuote: async (_token: string, language?: string) => {
        calls.push(['quote', language]);
        const result = state.answer(language);
        if ((result as any)?.status) throw result;
        return result;
      },
      portalCatalog: async (_token: string, language: string) => { calls.push(['catalog', language]); return []; },
    },
  });
  return { page, calls, storage, state, toasts, dictionary: exports.PORTAL_FALLBACKS as Record<string, Record<string, string>> };
}

test('every language of the page has the three new texts, and the Dutch ones read as agreed', () => {
  const { dictionary } = harness(() => notFound);
  assert.deepEqual(Object.keys(dictionary).sort(), [...CODES].sort());
  for (const code of CODES) {
    for (const key of ['updatingTitle', 'updatingText', 'cancelledTitle', 'notFound', 'notFoundText']) {
      assert.ok(dictionary[code][key]?.trim(), `${code}.${key}`);
    }
    /* Calm: the notice of a quotation that is being updated mentions Enrosed and asks for nothing. */
    assert.match(dictionary[code].updatingText, /Enrosed/, code);
    assert.notEqual(dictionary[code].updatingText, dictionary[code].notFoundText, code);
    if (code !== 'NL') {
      for (const key of ['updatingTitle', 'updatingText', 'cancelledTitle']) assert.notEqual(dictionary[code][key], dictionary.NL[key], `${code}.${key} is still Dutch`);
    }
  }
  assert.equal(dictionary.NL.cancelledTitle, 'Deze offerte is geannuleerd');
  /* Titles, not sentences: none of the three ends with a full stop, in any language. */
  for (const code of CODES) for (const key of ['updatingTitle', 'cancelledTitle', 'notFound']) assert.doesNotMatch(dictionary[code][key], /\.$/, `${code}.${key}`);
  assert.equal(dictionary.DE.cancelledTitle, 'Dieses Angebot wurde zurückgezogen');
  assert.match(dictionary.FR.updatingText, /envoyée à nouveau\.$/);
  assert.equal(dictionary.NL.updatingTitle, 'Deze offerte wordt bijgewerkt');
  assert.equal(dictionary.NL.updatingText, 'We passen deze offerte momenteel aan. De nieuwe versie is hier zichtbaar zodra Enrosed ze opnieuw heeft verstuurd.');
  assert.doesNotMatch(dictionary.NL.updatingText, /link|contact/i);
  assert.equal(dictionary.NL.notFoundText, 'Deze link is niet meer geldig. Neem contact op, dan sturen we een nieuwe.');
});

test('the load keeps the refusal and words it in the language of the customer file', async () => {
  const { page, calls } = harness(() => updating());
  await page.load('fixture');
  assert.equal(page.error(), true);
  assert.equal(page.refusal().kind, 'updating');
  assert.equal(page.language(), 'FR');
  assert.equal(page.local('updatingTitle'), 'Cette offre est en cours de mise à jour');
  assert.equal(page.quote(), null);
  assert.deepEqual(calls, [['quote', undefined]]);
});

test('a cancelled quotation keeps the staff message as typed; the customer\'s own pick of language wins', async () => {
  const typed = 'Het product is uit het gamma.\nTot later!';
  const { page } = harness(() => cancelled({ cancellationMessage: typed, language: 'FR' }), 'EN');
  await page.load('fixture');
  assert.equal(page.refusal().kind, 'cancelled');
  assert.equal(page.refusal().staffMessage, typed);
  assert.equal(page.language(), 'EN');
  assert.equal(page.local('cancelledTitle'), 'This quotation has been cancelled');
});

test('a link that does not exist shows what it showed before, in Dutch or the remembered language', async () => {
  const dutch = harness(() => notFound);
  await dutch.page.load('fixture');
  assert.equal(dutch.page.error(), true);
  assert.equal(dutch.page.refusal().kind, 'notFound');
  assert.equal(dutch.page.language(), 'NL');
  assert.equal(dutch.page.t('portalNotFound'), 'Offerte niet gevonden');
  assert.equal(dutch.page.t('portalNotFoundText'), 'Deze link is niet meer geldig. Neem contact op, dan sturen we een nieuwe.');
  const greek = harness(() => notFound, 'EL');
  await greek.page.load('fixture');
  assert.equal(greek.page.t('portalNotFound'), 'Η προσφορά δεν βρέθηκε');
  /* An older backend: a 409 without a code is the same text. */
  const older = harness(() => ({ status: 409, error: { status: 409, message: UPDATING_MESSAGE } }));
  await older.page.load('fixture');
  assert.equal(older.page.refusal().kind, 'notFound');
  assert.equal(older.page.language(), 'NL');
});

test('picking a language on a notice changes its words, is remembered and asks the link once more', async () => {
  const { page, calls, storage, state } = harness(() => updating());
  await page.load('fixture');
  await page.setLanguage('DE');
  assert.equal(page.language(), 'DE');
  assert.equal(storage.get('enrosed.portalLanguage.fixture'), 'DE');
  assert.equal(page.error(), true);
  assert.equal(page.refusal().kind, 'updating');
  assert.equal(page.local('updatingTitle'), 'Dieses Angebot wird aktualisiert');
  assert.deepEqual(calls, [['quote', undefined], ['quote', 'DE']]);
  /* Enrosed sent it again meanwhile: the next pick shows the quotation. */
  state.answer = (language) => QUOTE(language);
  await page.setLanguage('EN');
  assert.equal(page.error(), false);
  assert.equal(page.quote().language, 'EN');
  assert.equal(page.language(), 'EN');
  assert.equal(page.t('quote'), 'Angebot');
});

test('the notices offer no PDF and no action: they stand in the branch without a quotation', () => {
  const start = source.indexOf('@if (error()) {'), end = source.indexOf('} @else if (quote(); as data) {');
  assert.ok(start > 0 && end > start);
  const branch = source.slice(start, end);
  for (const kind of ["@case ('updating')", "@case ('cancelled')", '@default']) assert.ok(branch.includes(kind), kind);
  for (const offered of ['pdfUrl', 'portalPdf', '<button', '<a ', 'signSheet', 'rejectSheet', 'proposalSheet', 'withdraw']) {
    assert.equal(branch.includes(offered), false, offered);
  }
  /* The staff message is printed as text, with its line breaks. */
  assert.match(branch, /portal__staff-message">\{\{ message \}\}</);
  assert.match(source, /\.portal__staff-message \{[^}]*white-space: pre-wrap/);
});

/* ---------------------------------------------------------------- an action
 * The quotation was on screen when Enrosed reopened or cancelled it; the
 * customer's accept, reject, proposal or withdraw is then refused with the
 * same codes as the load (every portal route reads the link the same way). */

for (const name of ['accept', 'reject', 'propose', 'withdraw'] as const) {
  test(`${name} refused because the quotation is being updated switches the page to the notice, in the customer's language`, async () => {
    const { page, calls, toasts } = harness((language) => QUOTE(language), 'FR', () => updating({ language: 'NL' }));
    await page.load('fixture');
    assert.equal(page.error(), false);
    assert.equal(page.language(), 'FR');
    page.signSheet.set(true); page.proposalSheet.set(true); page.catalogSheet.set(true); page.rejectSheet.set(true);
    calls.length = 0;
    await page[name]();
    assert.deepEqual(calls, [[name]]);
    assert.equal(page.error(), true);
    assert.equal(page.refusal().kind, 'updating');
    /* The language the customer is reading in stays; the one on the customer file does not take over. */
    assert.equal(page.language(), 'FR');
    assert.equal(page.local('updatingTitle'), 'Cette offre est en cours de mise à jour');
    /* No Dutch sentence as a toast, nothing of the old version kept, no sheet left open over the notice. */
    assert.deepEqual(toasts, []);
    assert.equal(page.quote(), null);
    for (const sheet of ['signSheet', 'proposalSheet', 'catalogSheet', 'rejectSheet']) assert.equal(page[sheet](), false, sheet);
    assert.equal(page.busy(), false);
  });
}

test('an action refused because the quotation was cancelled shows the cancelled notice with the staff message', async () => {
  const typed = 'Uit het gamma.\nTot later!';
  const { page, toasts } = harness((language) => QUOTE(language), undefined, () => cancelled({ cancellationMessage: typed }));
  await page.load('fixture');
  await page.accept();
  assert.equal(page.error(), true);
  assert.equal(page.refusal().kind, 'cancelled');
  assert.equal(page.refusal().staffMessage, typed);
  assert.equal(page.language(), 'DE');
  assert.equal(page.local('cancelledTitle'), 'Dieses Angebot wurde zurückgezogen');
  assert.deepEqual(toasts, []);
});

test('any other refusal of an action stays a toast over the quotation, as before', async () => {
  for (const failure of [
    { status: 409, error: { status: 409, message: 'Deze offerte is al beantwoord.' } },
    { status: 409, error: { status: 409, code: 'WEB_ORDER_CHANGED', message: 'Gewijzigd.' } },
    { status: 422, error: { status: 422, code: 'QUOTE_BEING_UPDATED', message: 'Anders.' } },
  ]) {
    const { page, toasts } = harness((language) => QUOTE(language), undefined, () => failure);
    await page.load('fixture');
    await page.reject();
    assert.equal(page.error(), false);
    assert.notEqual(page.quote(), null);
    assert.deepEqual(toasts, [[failure.error.message, 'err']]);
  }
  const offline = harness((language) => QUOTE(language), 'EN', () => ({ status: 0, error: null }));
  await offline.page.load('fixture');
  await offline.page.withdraw();
  assert.equal(offline.page.error(), false);
  assert.deepEqual(offline.toasts, [['Something went wrong. Please try again.', 'err']]);
});

test('an action that succeeds shows the answer and its own words', async () => {
  const { page, toasts, calls } = harness((language) => QUOTE(language), undefined, () => ({ ...QUOTE('DE'), number: 'OFF-1' }));
  await page.load('fixture');
  calls.length = 0;
  await page.propose();
  assert.equal(page.error(), false);
  assert.equal(page.quote().number, 'OFF-1');
  assert.equal(toasts.length, 1);
  assert.deepEqual(calls, [['propose'], ['catalog', 'DE']]);
});
