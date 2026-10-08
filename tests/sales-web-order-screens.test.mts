import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { messageOf } from '../src/app/core/api/errors.ts';
import * as status from '../src/app/features/sales/quote-status.ts';
import * as actions from '../src/app/features/sales/sales-invoice-actions.ts';
import { isLocallyDeletableSalesDocument, isSwipeDeletableSalesDocument } from '../src/app/features/sales/sales-list-swipe.ts';

/*
 * What the website-order round depends on in the screens themselves: nothing
 * is written while the customer can still change the order, every write
 * presents the revision of the copy on screen, and a conflict is handled the
 * same way everywhere. The production members run here in isolation, with
 * only their collaborators replaced.
 */

const sourceOf = (file: string) => readFile(new URL(`../src/app/${file}.ts`, import.meta.url), 'utf8');

async function isolate(file: string, name: string, names: string[], globals: Record<string, unknown> = {}) {
  const source = ts.createSourceFile(file, await sourceOf(file), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(cls, `${name} exists`);
  const members = cls.members.filter((member) => member.name && names.includes(member.name.getText(source)));
  assert.deepEqual(names.filter((wanted) => !members.some((member) => member.name!.getText(source) === wanted)), [], 'all tested production members still exist');
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter((modifier) => !ts.isDecorator(modifier)), cls.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(source, [isolated])),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, signal, computed, setTimeout, clearTimeout, structuredClone, JSON, Map, Promise, globalThis: {}, messageOf, ...status, ...actions,
    isLocallyDeletableSalesDocument, isSwipeDeletableSalesDocument, ...globals });
  return exports[name];
}

const CONFLICT = { status: 409, error: { code: 'WEB_ORDER_CHANGED', message: 'De klant heeft deze bestelling intussen gewijzigd of geannuleerd. Je wijzigingen zijn niet opgeslagen; laad de laatste versie.' } };
const REFUSED = { status: 409, error: { message: 'Deze bestelling kan niet gefactureerd worden.' } };

const block = (changes: Record<string, unknown> = {}) => ({
  revision: 1, accountEmail: 'inkoop@bloemist.example', placedAt: '2026-10-07T09:00:00Z', customerEditable: false,
  customerChangedAt: null, customerChangeSummary: null, customerCancelledAt: null,
  processingStartedAt: '2026-10-07T10:00:00Z', processingStartedBy: 'Emre', processingTrigger: 'KNOP', termsState: 'ORDER_EQUAL',
  orderedTotalExclVat: 210.72, orderedTotalInclVat: 254.97, differences: [], receivedMailSentAt: null, processingMailSentAt: null, mailError: null, mailDue: false,
  ...changes,
});
const untaken = (changes: Record<string, unknown> = {}) => block({ customerEditable: true, processingStartedAt: null, processingStartedBy: null, processingTrigger: null, termsState: null, ...changes });
const doc = (order: Record<string, unknown> = {}, webOrder: Record<string, unknown> | null = null, extra: Record<string, unknown> = {}): any => ({
  order: { id: 101, number: 'ENR-2026-0101', docType: 'OFFERTE', status: 'CONCEPT', archivedAt: null, sentAt: null, viewedAt: null, viewCount: 0, decidedAt: null,
    internalNotes: '', lines: [{ productId: 7, quantity: 48, deliveryWeek: null }], ...order },
  ...(webOrder ? { webOrder } : {}), ...extra,
});

/* ------------------------------------------------------------------ pure rules */

test('an order the customer cancelled gets a banner of its own; the address hint only applies to a working concept', () => {
  const when = (value: string | null | undefined) => `<${value}>`;
  assert.deepEqual(actions.webOrderNotice(doc({ status: 'GEANNULEERD' }, untaken({ customerEditable: false, customerCancelledAt: '2026-10-07T11:05:00Z' })), when),
    { lead: 'door de klant geannuleerd op <2026-10-07T11:05:00Z>', lines: [] });
  assert.equal(status.webOrderDeliveryHint(doc({}, untaken())), true, 'untaken concept');
  assert.equal(status.webOrderDeliveryHint(doc({}, block())), true, 'taken concept: staff can still set a fixed freight');
  assert.equal(status.webOrderDeliveryHint(doc({ status: 'VERZONDEN' }, block())), false, 'sent');
  assert.equal(status.webOrderDeliveryHint(doc({ status: 'GEACCEPTEERD' }, block())), false, 'accepted');
  assert.equal(status.webOrderDeliveryHint(doc({ status: 'GEANNULEERD' }, untaken({ customerEditable: false, customerCancelledAt: '2026-10-07T11:05:00Z' }))), false, 'cancelled');
  assert.equal(status.webOrderDeliveryHint(doc({ archivedAt: '2026-10-08T08:00:00Z' }, block())), false, 'archived');
  assert.equal(status.webOrderDeliveryHint(doc({ docType: 'FACTUUR', status: 'UITGEREIKT' }, null, { delivery: {} })), false, 'a derived invoice has no order block');
});

test('an unchanged order is invoiced first; every send of a concept order asks for approval and never calls it an offerte', () => {
  assert.equal(actions.webOrderInvoiceFirst(doc({}, block())), true);
  assert.equal(actions.webOrderInvoiceFirst(doc({}, block({ termsState: 'ORDER_DIFFERENT' }))), false);
  assert.equal(actions.webOrderInvoiceFirst(doc({}, untaken())), false, 'not before it is taken');
  assert.equal(actions.webOrderInvoiceFirst(doc({ status: 'GEACCEPTEERD' }, block({ termsState: 'APPROVED' }))), false, 'an accepted order already has the invoice as its only way on');
  assert.equal(actions.webOrderInvoiceFirst(doc()), false, 'a plain quote keeps Versturen as its primary action');

  assert.equal(actions.webOrderSendsForApproval(doc({}, block())), true);
  assert.equal(actions.webOrderSendsForApproval(doc({}, block({ termsState: 'ORDER_UNKNOWN' }))), true);
  assert.equal(actions.webOrderSendsForApproval(doc({}, untaken())), false);
  assert.equal(actions.webOrderSendsForApproval(doc({ status: 'VERZONDEN' }, block())), false, 'a sent order is resent');
  assert.equal(actions.webOrderSendsForApproval(doc({ archivedAt: '2026-10-08T08:00:00Z' }, block())), false);
  assert.equal(actions.webOrderSendsForApproval(doc()), false);

  assert.equal(actions.webOrderSendCopy(doc()), null, 'a plain document keeps its own sheet texts');
  const copy = actions.webOrderSendCopy(doc({}, block()))!;
  assert.equal(copy.confirm, 'Versturen ter goedkeuring');
  for (const text of Object.values(copy)) assert.doesNotMatch(text, /offerte|aanvraag/i);
  assert.doesNotMatch(actions.WEB_ORDER_RELOADED, /niet opgeslagen|laad de laatste/i, 'the automatic reload does not ask the user to reload');
});

test('Verwijderen on a document: a website order once it is cancelled or declined, any other document by its own rule', () => {
  const plain = (allowed: boolean) => () => allowed;
  assert.equal(status.documentDeletable(null, plain(true)), false);
  assert.equal(status.documentDeletable(doc(), plain(true)), true);
  assert.equal(status.documentDeletable(doc(), plain(false)), false);
  assert.equal(status.documentDeletable(doc({}, untaken()), plain(true)), false, 'the customer still sees an open order');
  assert.equal(status.documentDeletable(doc({}, block()), plain(true)), false);
  assert.equal(status.documentDeletable(doc({ status: 'GEANNULEERD' }, block()), plain(false)), true, 'cancelled: the plain concept rule does not apply');
  assert.equal(status.documentDeletable(doc({ status: 'AFGEWEZEN' }, block()), plain(false)), true);
});

test('the list pill tells a row that waits on us apart from one that waits on the customer', () => {
  const pill = (order: Record<string, unknown>, webOrder: Record<string, unknown> | null) => status.webOrderListPill(doc(order, webOrder))?.label ?? null;
  assert.equal(pill({}, null), null);
  assert.equal(pill({ status: 'GEANNULEERD' }, untaken({ customerEditable: false, customerCancelledAt: '2026-10-07T11:05:00Z' })), 'Door klant geannuleerd');
  assert.equal(pill({}, untaken({ revision: 2 })), 'Door klant gewijzigd');
  assert.equal(pill({}, untaken()), 'Klant kan nog wijzigen');
  assert.equal(pill({}, block()), 'In verwerking');
  assert.equal(pill({}, block({ termsState: 'RESEND_REQUIRED' })), 'Opnieuw versturen');
  assert.equal(pill({ status: 'BEKEKEN' }, block({ termsState: 'RESEND_REQUIRED' })), 'Opnieuw versturen');
  assert.equal(pill({ status: 'GEACCEPTEERD' }, block({ termsState: 'RESEND_REQUIRED' })), 'Gewijzigd na akkoord');
  assert.equal(pill({ status: 'VERZONDEN' }, block({ termsState: 'AWAITING_APPROVAL' })), 'Wacht op klant');
  assert.equal(pill({ status: 'GEACCEPTEERD' }, block({ termsState: 'APPROVED' })), null, 'the status pill says Geaccepteerd');
  assert.equal(pill({ status: 'VERZONDEN', archivedAt: '2026-10-08T08:00:00Z' }, block({ termsState: 'RESEND_REQUIRED' })), null, 'an archived row shows no compare state');
});

/* ------------------------------------------------------------------ API client */

test('the API client sends webOrderRevision only when it is a number', async () => {
  const js = ts.transpileModule(await sourceOf('core/api/sales-api'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const calls: string[] = [];
  const http = Object.fromEntries(['get', 'post', 'put', 'delete'].map((verb) => [verb, (url: string) => { calls.push(`${verb.toUpperCase()} ${url}`); return {}; }]));
  const exports: any = {};
  vm.runInNewContext(js, { exports, require: (path: string) => {
    if (path === '@angular/core') return { Injectable: () => (target: unknown) => target, inject: () => http };
    if (path === '@angular/common/http') return { HttpClient: class {} };
    if (path === 'rxjs') return { firstValueFrom: (value: unknown) => Promise.resolve(value) };
    if (path === './api.config') return { API_BASE: '', api: (url: string) => url };
    return new Proxy({}, { get: () => () => '' });
  } });
  const api = new exports.SalesApi();
  const order = { id: 5 };
  await api.updateOrder(5, order, 3); await api.updateOrder(5, order, null); await api.updateOrder(5, order);
  await api.updateShipping(5, {}, 3); await api.updateDeliveryTerms(5, [], 3);
  await api.deleteOrder(5, 3); await api.archiveOrder(5, 3); await api.unarchiveOrder(5, 3);
  await api.sendQuote(5, '', 3); await api.cancelQuote(5, '', true, 3); await api.reopenQuote(5, 3);
  await api.createInvoiceFrom(5, 3); await api.createAdvanceInvoice(5, {}, 3); await api.takeIntoProcessing(5, 3);
  await api.deleteOrder(5); await api.takeIntoProcessing(5, null);
  const withRevision = calls.filter((call) => call.includes('webOrderRevision=3'));
  assert.equal(withRevision.length, 12, calls.join('\n'));
  assert.equal(calls.filter((call) => call.includes('webOrderRevision')).length, 12, 'null and undefined send nothing');
  assert.ok(calls.includes('PUT /api/sales-orders/5?webOrderRevision=3'));
  assert.ok(calls.includes('POST /api/sales-orders/5/take-into-processing?webOrderRevision=3'));
  assert.ok(calls.includes('POST /api/sales-orders/5/take-into-processing'));
});

/* ------------------------------------------------------------------ desk and phone editor */

const Editor = await isolate('features/sales/sales-editor', 'SalesEditor', [
  'documentMutationBusy', 'mobileSplitBusy', 'canEdit', 'canEditTerms', 'canEditShipping', 'canDelete', 'deleting', 'isWebOrder', 'webOrderOpen', 'takeSheet', 'conflictMessage', 'saveConflict',
  'openTake', 'take', 'actionFailed', 'showSaveConflict', 'reloadAfterConflict', 'persistOrder', 'save', 'saveOperation', 'saveDeliveryWeek', 'openSend', 'send', 'cancel',
  'cancelMailPossible', 'webOrderMailed', 'adopt', 'dirty', 'documentDirty', 'shippingDirty', 'savedOrder', 'saveError', 'previewTimer', 'previewVersion', 'sendSheet', 'cancelSheet', 'sending', 'busy',
  'cancelNotify', 'cancelMessage', 'sendMessage', 'createDraftInvoice', 'invoiceConversionBusy',
], { isAdvanceBillingInvoice: () => false, shippingSnapshot: (order: unknown) => order, mergeOrderAfterSave: (saved: unknown) => saved, canCreateInvoiceFromQuote: actions.canCreateInvoiceFromQuote });

function editor(initial: any, api: Record<string, (...args: any[]) => any> = {}) {
  const screen = new Editor(), calls: string[] = [], toasts: string[] = [], reloads: number[] = [];
  const record = (name: string, answer: (...args: any[]) => any) => async (...args: any[]) => { calls.push(`${name} ${JSON.stringify(args)}`); return answer(...args); };
  Object.assign(screen, {
    view: signal(initial), advanceAgreement: () => null, revisions: signal([]), previewError: signal(null), saving: signal(false), linePending: signal({}),
    transportSaving: () => false, customerEmail: signal('inkoop@bloemist.example'), sendIssues: () => [], loadCreditContext: () => undefined, schedulePreview: () => undefined,
    flushTransport: async () => true, flushPendingEdits: async () => true, loadHistory: async () => undefined, lineUnit: () => ({ short: 'st' }), refreshWorkQueue: () => undefined,
    reload: async (id: number) => { reloads.push(id); }, scrollToSection: () => undefined,
    ui: { toast: (text: string) => toasts.push(text) }, work: { refresh: async () => undefined }, router: { navigate: async () => true },
    sales: Object.fromEntries(Object.entries({
      updateOrder: (_id: number, order: unknown) => ({ ...initial, order }), updateShipping: () => initial, updateDeliveryTerms: () => initial,
      takeIntoProcessing: () => doc({}, block()), sendQuote: () => doc({ status: 'VERZONDEN' }, block()), cancelQuote: () => doc({ status: 'GEANNULEERD' }, block()),
      createInvoiceFrom: () => doc({ id: 900, docType: 'FACTUUR' }), ...api,
    }).map(([name, answer]) => [name, record(name, answer)])),
  });
  screen.savedOrder.set(JSON.stringify(initial.order));
  const edit = (internalNotes: string) => screen.view.update((current: any) => ({ ...current, order: { ...current.order, internalNotes } }));
  return { screen, calls, toasts, reloads, edit };
}

test('an order the customer can still change is read-only, and no save or autosave can take it behind the user\'s back', async () => {
  const open = editor(doc({}, untaken()));
  assert.equal(open.screen.canEdit(), false);
  assert.equal(open.screen.canEditTerms(), false);
  assert.equal(open.screen.canEditShipping(), false);
  assert.equal(editor(doc({}, block())).screen.canEdit(), true, 'taken: the normal concept screen');
  assert.equal(editor(doc()).screen.canEdit(), true, 'a plain quote is untouched');
  assert.equal(editor(doc({ status: 'VERZONDEN' }, block())).screen.canEditTerms(), true);

  await open.screen.openSend();
  assert.equal(open.screen.sendSheet(), false, 'the send sheet does not open before the order is taken');
  const takenClean = editor(doc({}, block()));
  await takenClean.screen.openSend();
  assert.equal(takenClean.screen.sendSheet(), true);

  /* Even with edits that got on screen some other way, nothing is written. */
  open.edit('Teamnotitie');
  assert.equal(await open.screen.save(), false);
  await open.screen.saveDeliveryWeek(7, '2026-W44');
  await open.screen.openSend();
  assert.deepEqual(open.calls, [], 'no write left the screen');
  assert.equal(open.screen.sendSheet(), false);
  assert.match(open.screen.saveError(), /Neem ze eerst in verwerking/);
});

test('saves, the delivery-week autosave, take, send, cancel and invoice present the revision of the copy on screen', async () => {
  const taken = editor(doc({}, block({ revision: 4 })));
  taken.edit('Teamnotitie');
  assert.equal(await taken.screen.save(), true);
  assert.match(taken.calls[0], /^updateOrder \[101,.*,4\]$/);

  const sent = editor(doc({ status: 'VERZONDEN' }, block({ revision: 4 })));
  await sent.screen.saveDeliveryWeek(7, '2026-W44');
  assert.match(sent.calls[0], /^updateDeliveryTerms \[101,\[\{"productId":7,"deliveryWeek":"2026-W44"\}\],4\]$/);

  const open = editor(doc({}, untaken({ revision: 2 })));
  await open.screen.take();
  assert.deepEqual(open.calls, ['takeIntoProcessing [101,2]']);
  assert.deepEqual(open.toasts, ['In verwerking genomen · de klant krijgt een e-mail'], 'the button reports itself; no second "is nu in verwerking" toast');
  await open.screen.take();
  assert.equal(open.calls.length, 1, 'a taken order is not taken again');

  const forSend = editor(doc({}, block({ revision: 4, termsState: 'ORDER_DIFFERENT' })));
  await forSend.screen.send();
  assert.deepEqual(forSend.calls, ['sendQuote [101,"",4]']);
  assert.deepEqual(forSend.toasts, ['Bestelling ter goedkeuring verstuurd']);
  const plainSend = editor(doc());
  await plainSend.screen.send();
  assert.deepEqual(plainSend.calls, ['sendQuote [101,"",null]']);
  assert.deepEqual(plainSend.toasts, ['Offerte verstuurd naar de klant'], 'a plain quote keeps its toast');

  const forCancel = editor(doc({}, block({ revision: 4 })));
  forCancel.screen.cancelNotify.set(true);
  await forCancel.screen.cancel();
  assert.deepEqual(forCancel.calls, ['cancelQuote [101,"",true,4]']);
  assert.deepEqual(forCancel.toasts, ['Bestelling geannuleerd; de klant is verwittigd']);

  const forInvoice = editor(doc({}, block({ revision: 4 })));
  await forInvoice.screen.createDraftInvoice(forInvoice.screen.view());
  assert.deepEqual(forInvoice.calls, ['createInvoiceFrom [101,4]']);
});

test('without an e-mail address on the customer record the cancel screen promises no mail, for a website order too', async () => {
  const { screen, calls, toasts } = editor(doc({}, block()));
  screen.customerEmail.set('');
  assert.equal(screen.cancelMailPossible(), false);
  screen.cancelNotify.set(true);
  await screen.cancel();
  assert.deepEqual(calls, ['cancelQuote [101,"",false,1]']);
  assert.deepEqual(toasts, ['Bestelling geannuleerd']);
});

test('a refused action reloads only for the conflict, only the order it ran on, and never over unsaved edits', async () => {
  const stale = editor(doc({}, untaken()), { takeIntoProcessing: () => { throw CONFLICT; } });
  stale.screen.takeSheet.set(true);
  await stale.screen.take();
  assert.deepEqual(stale.reloads, [101]);
  assert.deepEqual(stale.toasts, [actions.WEB_ORDER_RELOADED]);
  assert.equal(stale.screen.takeSheet(), false);

  const refused = editor(doc({}, block()), { createInvoiceFrom: () => { throw REFUSED; } });
  await refused.screen.createDraftInvoice(refused.screen.view());
  assert.deepEqual(refused.reloads, [], 'an ordinary refusal is only a toast');
  assert.deepEqual(refused.toasts, ['Deze bestelling kan niet gefactureerd worden.']);

  /* The answer for order 101 arrives after the user moved to order 115, which has unsaved edits. */
  let release: () => void = () => undefined;
  const moved = editor(doc({}, block()), { cancelQuote: () => new Promise((_resolve, reject) => { release = () => reject(CONFLICT); }) });
  const pending = moved.screen.cancel();
  moved.screen.view.set(doc({ id: 115 }, block())); moved.screen.savedOrder.set(JSON.stringify(moved.screen.view().order));
  moved.edit('Aantal aangepast'); moved.screen.cancelSheet.set(true);
  release(); await pending;
  assert.deepEqual(moved.reloads, [], 'order 115 was never refused and is not reloaded');
  assert.equal(moved.screen.saveError(), null, 'and gets no conflict alert');
  assert.equal(moved.screen.saveConflict(), false);
  assert.equal(moved.screen.cancelSheet(), true, 'its own sheet stays open');
  assert.equal(moved.screen.view().order.internalNotes, 'Aantal aangepast');
  assert.deepEqual(moved.toasts, [CONFLICT.error.message]);

  /* Unsaved edits on the order itself: the alert with the one way out, no silent reload. */
  const dirty = editor(doc({}, block()), { cancelQuote: () => { throw CONFLICT; } });
  dirty.edit('Teamnotitie');
  await dirty.screen.cancel();
  assert.deepEqual(dirty.reloads, []);
  assert.equal(dirty.screen.saveConflict(), true);
  assert.equal(dirty.screen.view().order.internalNotes, 'Teamnotitie');
});

test('a stale save keeps the edits, shows the conflict alert and is not sent a second time', async () => {
  const { screen, calls, reloads, edit } = editor(doc({}, block()), { updateOrder: () => { throw CONFLICT; } });
  edit('Teamnotitie');
  assert.equal(await screen.save(), false);
  assert.equal(screen.saveConflict(), true);
  assert.equal(screen.saveError(), CONFLICT.error.message);
  assert.deepEqual(reloads, [], 'typed work is never dropped by itself');
  assert.equal(await screen.save(), false);
  assert.equal(calls.length, 1, 'saving the refused copy again can only be refused again');
  assert.equal(screen.view().order.internalNotes, 'Teamnotitie');

  /* The transport autosave of a fixed version holds nothing but the refused change: it reloads. */
  const sent = editor(doc({ status: 'VERZONDEN' }, block()), { updateDeliveryTerms: () => { throw CONFLICT; } });
  await sent.screen.saveDeliveryWeek(7, '2026-W44');
  assert.deepEqual(sent.reloads, [101]);
  assert.deepEqual(sent.toasts, [actions.WEB_ORDER_RELOADED]);
});

test('a customer mail sent from the note never drops unsaved edits', () => {
  const answer = doc({}, block({ processingMailSentAt: '2026-10-08T07:31:00Z' }));
  const dirty = editor(doc({}, block()));
  dirty.edit('Teamnotitie');
  dirty.screen.webOrderMailed(answer);
  assert.equal(dirty.screen.view().order.internalNotes, 'Teamnotitie');
  assert.equal(dirty.screen.dirty(), true, 'Opslaan stays');
  assert.equal(dirty.screen.view().webOrder.processingMailSentAt, '2026-10-08T07:31:00Z', 'the mail state is taken over');

  const clean = editor(doc({}, block()));
  clean.screen.webOrderMailed(answer);
  assert.equal(clean.screen.view(), answer);
  clean.screen.webOrderMailed(doc({ id: 999 }, block()));
  assert.equal(clean.screen.view(), answer, 'an answer for another document is ignored');
});

test('Verwijderen is offered on a cancelled or declined website order, on desk and phone editor', () => {
  assert.equal(editor(doc({ status: 'GEANNULEERD', decidedAt: '2026-10-07T11:05:00Z' }, untaken({ customerEditable: false, customerCancelledAt: '2026-10-07T11:05:00Z' }))).screen.canDelete(), true);
  assert.equal(editor(doc({ status: 'AFGEWEZEN', sentAt: '2026-10-07T12:00:00Z' }, block())).screen.canDelete(), true);
  assert.equal(editor(doc({}, untaken())).screen.canDelete(), false);
  assert.equal(editor(doc({}, block())).screen.canDelete(), false);
  assert.equal(editor(doc()).screen.canDelete(), true, 'a never-used plain concept as before');
  assert.equal(editor(doc({ status: 'GEANNULEERD' })).screen.canDelete(), false, 'a cancelled plain quote as before');
  const withCredit = editor(doc({ status: 'GEANNULEERD' }, block(), { creditNotes: [{ id: 1 }] }));
  assert.equal(withCredit.screen.canDelete(), false);
});

/* ------------------------------------------------------------------ read view */

const View = await isolate('features/sales/sales-view', 'SalesView', [
  'isWebOrder', 'webOrderOpen', 'takeSheet', 'openTake', 'take', 'show', 'actionFailed', 'reloadAfterConflict', 'canDelete', 'sendFromView', 'cancel', 'cancelMailPossible',
  'invoiceBusy', 'sendSheetOpen', 'sendMessage', 'sendingQuote', 'cancelSheet', 'cancelNotify', 'cancelMessage', 'cancelling',
]);

function readView(initial: any, api: Record<string, (...args: any[]) => any> = {}) {
  const screen = new View(), calls: string[] = [], toasts: string[] = [], reloads: number[] = [];
  const record = (name: string, answer: (...args: any[]) => any) => async (...args: any[]) => { calls.push(`${name} ${JSON.stringify(args)}`); return answer(...args); };
  Object.assign(screen, {
    view: signal(initial), revisions: signal([]), history: signal([]), customerEmail: signal('inkoop@bloemist.example'), allProductsUnavailable: () => false,
    isRequest: () => false, isInvoice: () => false, load: async (id: number) => { reloads.push(id); },
    ui: { toast: (text: string) => toasts.push(text) }, work: { refresh: async () => undefined },
    sales: Object.fromEntries(Object.entries({
      takeIntoProcessing: () => doc({}, block()), sendQuote: () => doc({ status: 'VERZONDEN' }, block()), cancelQuote: () => doc({ status: 'GEANNULEERD' }, block()),
      history: () => [], ...api,
    }).map(([name, answer]) => [name, record(name, answer)])),
  });
  return { screen, calls, toasts, reloads };
}

test('the read view takes, sends and cancels with its own revision and handles the conflict like the editor', async () => {
  const open = readView(doc({}, untaken({ revision: 2 })));
  await open.screen.sendFromView();
  assert.deepEqual(open.calls, [], 'nothing is sent while the customer can still change the order');
  open.screen.openTake();
  assert.equal(open.screen.takeSheet(), true);
  await open.screen.take();
  assert.equal(open.calls[0], 'takeIntoProcessing [101,2]');

  const taken = readView(doc({}, block({ revision: 4 })));
  taken.screen.openTake();
  assert.equal(taken.screen.takeSheet(), false);
  await taken.screen.sendFromView();
  assert.deepEqual(taken.calls, ['sendQuote [101,"",4]']);
  assert.deepEqual(taken.toasts, ['Bestelling ter goedkeuring verstuurd']);

  const noMail = readView(doc({}, block({ revision: 4 })));
  noMail.screen.customerEmail.set(''); noMail.screen.cancelNotify.set(true);
  await noMail.screen.cancel();
  assert.deepEqual(noMail.calls, ['cancelQuote [101,"",false,4]']);
  assert.deepEqual(noMail.toasts, ['Bestelling geannuleerd']);

  const stale = readView(doc({}, untaken()), { takeIntoProcessing: () => { throw CONFLICT; } });
  await stale.screen.take();
  assert.deepEqual(stale.reloads, [101]);
  assert.deepEqual(stale.toasts, [actions.WEB_ORDER_RELOADED]);

  let release: () => void = () => undefined;
  const moved = readView(doc({}, block()), { cancelQuote: () => new Promise((_resolve, reject) => { release = () => reject(CONFLICT); }) });
  const pending = moved.screen.cancel();
  moved.screen.view.set(doc({ id: 103 }, block())); moved.screen.cancelSheet.set(true);
  release(); await pending;
  assert.deepEqual(moved.reloads, [], 'the order now on screen is left alone');
  assert.equal(moved.screen.cancelSheet(), true);

  assert.equal(readView(doc({ status: 'GEANNULEERD', decidedAt: '2026-10-07T11:05:00Z' }, block())).screen.canDelete(), true);
  assert.equal(readView(doc({}, block())).screen.canDelete(), false);
  assert.equal(readView(doc()).screen.canDelete(), true);
});

/* ------------------------------------------------------------------ list */

const List = await isolate('features/sales/sales-list', 'SalesList', [
  'canArchive', 'canDelete', 'toggleArchive', 'actionFailed', 'websiteRequests', 'ordersToTake', 'webOrderPill', 'archivingOrderId', 'containerDeletingId', 'openRow', 'rowMenu',
], { webOrderListPill: status.webOrderListPill });

test('the list never archives an order the customer can still change, deletes only a closed one and reloads on a conflict', async () => {
  const rows = [doc({ id: 1, internalNotes: '[WEBSITE_AANVRAAG]' }, untaken()), doc({ id: 2, internalNotes: '[WEBSITE_AANVRAAG]' }, block({ revision: 3 })),
    doc({ id: 3, status: 'GEANNULEERD' }, block()), doc({ id: 4, internalNotes: '[WEBSITE_AANVRAAG]' }), doc({ id: 5 })];
  const calls: string[] = [], toasts: string[] = []; let loads = 0, conflict = false;
  const list = new List();
  Object.assign(list, {
    all: signal(rows), documentLabel: () => 'Offerte', load: async () => { loads += 1; }, ui: { toast: (text: string) => toasts.push(text) },
    sales: { archiveOrder: async (id: number, revision: number | null) => { calls.push(`archive ${id} ${revision}`); if (conflict) throw CONFLICT; return rows[1]; } },
  });
  assert.deepEqual(rows.map((row) => list.canArchive(row)), [false, true, true, true, true]);
  assert.deepEqual(rows.map((row) => list.canDelete(row)), [false, false, true, true, true]);
  assert.deepEqual(list.websiteRequests().map((row: any) => row.order.id), [1, 4], 'new on the website: untaken orders and legacy requests');
  assert.deepEqual(list.ordersToTake().map((row: any) => row.order.id), [1]);
  assert.equal(list.webOrderPill(rows[0])!.label, 'Klant kan nog wijzigen');

  await list.toggleArchive(rows[0]);
  assert.deepEqual(calls, [], 'one swipe must not take the order and mail the customer');
  await list.toggleArchive(rows[1]);
  assert.deepEqual(calls, ['archive 2 3']);
  conflict = true;
  await list.toggleArchive(rows[1]);
  assert.equal(loads, 1);
  assert.equal(toasts.at(-1), actions.WEB_ORDER_RELOADED);
});

/* ------------------------------------------------------------------ note and templates */

const Note = await isolate('features/sales/sales-web-order-note', 'SalesWebOrderNote', ['busy', 'repeatSheet', 'openRepeat', 'resend']);

test('the mail buttons of the note do nothing while the host has unsaved edits', async () => {
  const calls: string[] = [], emitted: unknown[] = [];
  const note = new Note(); let blocked = true;
  Object.assign(note, { view: () => doc({}, block()), blocked: () => blocked, changed: { emit: (value: unknown) => emitted.push(value) }, ui: { toast: () => undefined },
    sales: { resendWebOrderMails: async (id: number, repeat: boolean) => { calls.push(`mails ${id} ${repeat}`); return doc({}, block()); } } });
  note.openRepeat(); await note.resend(true); await note.resend(false);
  assert.equal(note.repeatSheet(), false);
  assert.deepEqual(calls, []);
  blocked = false;
  note.openRepeat(); assert.equal(note.repeatSheet(), true);
  await note.resend(true);
  assert.deepEqual(calls, ['mails 101 true']);
  assert.equal(emitted.length, 1);
});

test('a plain document keeps its old markup, and a website order is never called an aanvraag or offerte where the order is meant', async () => {
  const [desk, phone, view, note, message] = await Promise.all(['sales-desk', 'sales-editor', 'sales-view', 'sales-web-order-note', 'sales-document-note'].map((file) => sourceOf(`features/sales/${file}`)));
  /* The grid wrapper and the note host exist only for a document with an order or delivery block. */
  assert.match(desk, /@if \(data\.webOrder \|\| data\.delivery\) \{\s*<div class="desk-notes">[\s\S]*?<\/div>\s*\} @else \{\s*<app-sales-document-note \[notes\]="customerNote\(data\)" \[fromCustomer\]="customerAuthoredMessage\(data\)" \/>\s*\}/);
  for (const [name, source] of [['phone editor', phone], ['read view', view]] as const) {
    assert.match(source, /@if \(data\.webOrder \|\| data\.delivery\) \{\s*<app-sales-web-order-note /, name);
    assert.equal(source.match(/<app-sales-web-order-note /g)!.length, 1, name);
  }
  /* The banner sits straight under the hero, before the advance panel, the message and the note. */
  const before = (source: string, first: string, second: string) => source.indexOf(first) > -1 && source.indexOf(first) < source.indexOf(second);
  assert.ok(before(desk, 'desk-attention desk-attention--order', '<app-sales-advance-invoices'));
  assert.ok(before(phone, '<div class="web-order-banner">', '<app-sales-advance-invoices'));
  assert.ok(before(view, '<div class="web-order-banner">', '<app-sales-advance-invoices'));
  assert.match(view, /web-order-banner__take[^>]*\(click\)="openTake\(\)"/, 'the phone read view carries the primary action in the banner');
  /* Only the lead of the banner is a live region; an alert never contains its own button. */
  for (const source of [desk, phone, view]) assert.doesNotMatch(source, /class="(desk-attention desk-attention--order|web-order-banner)" role="status"/);
  assert.doesNotMatch(note, /<p[^>]*role="alert"/);
  assert.match(note, /<span role="alert">\{\{ mailFailure\(\) \}\}<\/span>/);
  assert.match(note, /@if \(hint\(\)\) \{\s*<p class="web-note__hint">/);
  /* Order wording. */
  assert.match(message, /order\(\) \? 'Bij de bestelling · alleen lezen' : 'Originele aanvraag · alleen lezen'/);
  for (const source of [desk, phone, view]) assert.match(source, /sendCopy\(\)\?\.title \?\?/);
  assert.match(phone, /sendForApproval\(\) \? 'Versturen ter goedkeuring' : 'Versturen'/, 'the phone dock uses the contract label');
  assert.match(phone, /isWebOrder\(\) \? 'bestelde' : 'aangevraagde'/);
  for (const source of [desk, phone]) assert.match(source, /\[disabled\]="saving\(\) \|\| saveConflict\(\)"/, 'Opslaan is off while only loading the latest version helps');
});
