import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { cents, shouldRecalculateLegacySchedule } from '../src/app/features/purchasing/partner-advance-schedule-state.ts';
import { isPartnerDocument } from '../src/app/features/sales/sales-payment-state.ts';
import { canCreateInvoiceFromQuote } from '../src/app/features/sales/sales-invoice-actions.ts';

/** Run the production guards with actual Angular signals, without HTTP or a browser. */
async function productionMembers(file: string, className: string, names: string[]) {
  const source = await readFile(new URL(`../src/app/features/${file}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className);
  assert.ok(original);
  const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
  assert.equal(members.length, names.length, 'All tested production members still exist');
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
    original.name, original.typeParameters, undefined, members);
  return ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

const agreementSource = await readFile(new URL('../src/app/features/sales/sales-advance-agreement.ts', import.meta.url), 'utf8');
const agreementParsed = ts.createSourceFile('agreement.ts', agreementSource, ts.ScriptTarget.Latest, true);
const helper = agreementParsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'advanceAgreementFor');
assert.ok(helper);
const helperJs = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(agreementParsed, [helper])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const helperExports: { advanceAgreementFor?: (value: any) => any } = {};
vm.runInNewContext(helperJs, { exports: helperExports });
const advanceAgreementFor = helperExports.advanceAgreementFor!;

const deskJs = await productionMembers('sales/sales-desk', 'SalesDesk', ['makeInvoice', 'createInvoice']);
const viewJs = await productionMembers('sales/sales-view', 'SalesView', ['makeInvoice', 'createInvoice']);
const editorJs = await productionMembers('sales/sales-editor', 'SalesEditor', ['advanceAgreement', 'canEdit', 'canEditTerms', 'duplicate']);
const editorConversionJs = await productionMembers('sales/sales-editor', 'SalesEditor', ['makeInvoiceFromEditor', 'createDraftInvoice']);
const portalJs = await productionMembers('portal/portal-page', 'PortalPage', ['openProposal', 'propose', 'setLanguage', 'agreementSettlementText']);

const agreement = { purchaseOrderId: 48, financingPct: 50, agreedAmountEur: 5000, sharePct: 50,
  rows: [{ scheduleRowId: 1, label: 'Start productie', percentage: 30, amountEur: 1500, dueDate: null },
    { scheduleRowId: 2, label: 'Container gereed', percentage: 70, amountEur: 3500, dueDate: null }] };
function quote(snapshot = true) { return { order: { id: 9, number: 'O-9', docType: 'OFFERTE', purpose: 'PARTNER_ADVANCE', status: 'CONCEPT' }, ...(snapshot ? { advanceAgreement: agreement } : {}) }; }

function makeHarness(javascript: string, className: string, snapshot = true) {
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, advanceAgreementFor, isPartnerDocument, canCreateInvoiceFromQuote, computed, signal, Intl,
    escapeHtml: (value: string) => value, messageOf: () => 'Error', localStorage: { setItem() {} } });
  const screen = new exports[className]();
  const routes: unknown[] = [];
  const api: unknown[] = [];
  let confirmation: (() => void) | null = null;
  const router = { navigate: async (...args: unknown[]) => { routes.push(args); return true; } };
  Object.assign(screen, {
    view: signal(quote(snapshot)), quote: signal(quote(snapshot)), invoiceBusy: signal(false), documentMutationBusy: signal(false), busy: signal(false),
    dirty: signal(false), saving: signal(false), sending: signal(false), sendingQuote: signal(false),
    invoiceConversionBusy: signal(false), refreshWorkQueue() {}, work: { refresh: async () => {} },
    router, routerNav: router,
    sales: { createInvoiceFrom: async (id: number) => { api.push(id); return { order: { id: 22, number: 'F-22' } }; },
      duplicateOrder: async (id: number) => { api.push(id); return { order: { id: 23 } }; } },
    ui: { confirm: (_options: unknown, fn: () => void) => { confirmation = fn; }, toast() {} },
  });
  return { screen, routes, api, get confirmation() { return confirmation; } };
}

test('only active, uninvoiced quotations can create a draft invoice directly', () => {
  const ordinary = quote(false) as any;
  assert.equal(canCreateInvoiceFromQuote(ordinary), true);
  assert.equal(canCreateInvoiceFromQuote({ ...ordinary, order: { ...ordinary.order, status: 'GEACCEPTEERD' } }), true);
  for (const status of ['AFGEWEZEN', 'GEANNULEERD', 'VERLOPEN', 'WIJZIGING_GEVRAAGD', 'BETAALD']) {
    assert.equal(canCreateInvoiceFromQuote({ ...ordinary, order: { ...ordinary.order, status } }), false);
  }
  assert.equal(canCreateInvoiceFromQuote({ ...ordinary, order: { ...ordinary.order, docType: 'FACTUUR' } }), false);
  assert.equal(canCreateInvoiceFromQuote({ ...ordinary, order: { ...ordinary.order, archivedAt: '2026-09-10T10:00:00Z' } }), false);
  assert.equal(canCreateInvoiceFromQuote({ ...ordinary, invoicedAsId: 22 }), false);
  assert.equal(canCreateInvoiceFromQuote({ ...ordinary, invoicedAs: 'F-22' }), false);
  assert.equal(canCreateInvoiceFromQuote(quote() as any), false, 'Agreement snapshots use their separate term invoices');
});

for (const [name, javascript, open, create] of [
  ['SalesDesk', deskJs, 'makeInvoice', 'createInvoice'],
  ['SalesView', viewJs, 'makeInvoice', 'createInvoice'],
  ['SalesEditor', editorConversionJs, 'makeInvoiceFromEditor', 'createDraftInvoice'],
]) {
  test(`${name} converts a never-sent draft without changing its send history or sending mail`, async () => {
    const state = makeHarness(javascript, name, false);
    const draft = { ...quote(false), order: { ...quote(false).order, notes: 'Keep original terms', sentAt: null } };
    state.screen.view.set(draft);
    const before = JSON.stringify(draft);
    state.screen[open](draft);
    assert.ok(state.confirmation, 'An explicit conversion confirmation is shown');
    assert.equal(state.api.length, 0, 'Opening the action does not create or send anything');
    await state.screen[create](draft);
    assert.deepEqual(state.api, [9], 'Only the conversion endpoint is called; no send API exists in this harness');
    assert.equal(JSON.stringify(draft), before, 'The app never fabricates a sent or accepted status');
    assert.equal(JSON.stringify(state.routes), JSON.stringify([[['/sales', 22]]]));
  });

  test(`${name} opens an already linked invoice and blocks conversion after route changes`, async () => {
    const state = makeHarness(javascript, name, false);
    state.screen[open]({ ...quote(false), invoicedAsId: 22 });
    assert.equal(state.api.length, 0);
    assert.equal(JSON.stringify(state.routes), JSON.stringify([[['/sales', 22]]]));
    state.screen.view.set({ ...quote(false), order: { ...quote(false).order, id: 99 } });
    await state.screen[create](quote(false));
    assert.equal(state.api.length, 0, 'A stale confirmation cannot convert the previous route');
  });

  if (name !== 'SalesView') {
    test(`${name} never drops unsaved edits through direct conversion or its delayed confirmation`, async () => {
      const state = makeHarness(javascript, name, false);
      state.screen.dirty.set(true);
      state.screen[open](quote(false));
      assert.equal(state.confirmation, null);
      await state.screen[create](quote(false));
      assert.equal(state.api.length, 0);
      state.screen.dirty.set(false);
      state.screen[open](quote(false));
      assert.ok(state.confirmation);
      state.screen.saving.set(true);
      await state.screen[create](quote(false));
      assert.equal(state.api.length, 0);
    });
  }
}

test('only an immutable quotation snapshot changes the workflow; legacy quotes and invoices stay unchanged', () => {
  assert.equal(advanceAgreementFor(quote()), agreement);
  assert.equal(advanceAgreementFor(quote(false)), null);
  assert.equal(advanceAgreementFor({ ...quote(), order: { ...quote().order, docType: 'FACTUUR' } }), null);
  assert.equal(advanceAgreementFor(null), null);
});

for (const [name, javascript] of [['SalesDesk', deskJs], ['SalesView', viewJs]]) {
  test(`${name} routes an agreement quote to its container terms without creating a full invoice`, async () => {
    const state = makeHarness(javascript, name);
    state.screen.makeInvoice(quote());
    assert.equal(state.api.length, 0);
    assert.equal(state.confirmation, null);
    assert.equal(JSON.stringify(state.routes), JSON.stringify([[['/purchasing', 48], { queryParams: { section: 'payments' } }]]));
    await state.screen.createInvoice(quote());
    assert.equal(state.api.length, 0, 'The callback itself is protected too');
  });

  test(`${name} retains whole-quote conversion for historical unsnapshotted documents`, async () => {
    const state = makeHarness(javascript, name, false);
    state.screen.makeInvoice(quote(false));
    assert.ok(state.confirmation);
    assert.equal(state.routes.length, 0);
    await state.screen.createInvoice(quote(false));
    assert.deepEqual(state.api, [9]);
    assert.equal(state.screen.invoiceBusy(), false);
  });

  test(`${name} cannot navigate away through the conversion action while an invoice mutation is busy`, () => {
    const state = makeHarness(javascript, name);
    state.screen.invoiceBusy.set(true);
    state.screen.makeInvoice(quote());
    assert.equal(state.routes.length, 0);
    assert.equal(state.confirmation, null);
  });
}

test('saved agreement quotes lock commercial and delivery edits while ordinary drafts remain editable', () => {
  const { screen } = makeHarness(editorJs, 'SalesEditor');
  assert.equal(screen.canEdit(), false);
  assert.equal(screen.canEditTerms(), false);
  screen.view.set(quote(false));
  assert.equal(screen.canEdit(), true);
  assert.equal(screen.canEditTerms(), true);
});

test('copying an agreement cannot create an unsnapshotted duplicate and bypass the term workflow', async () => {
  const state = makeHarness(editorJs, 'SalesEditor');
  await state.screen.duplicate();
  assert.equal(state.api.length, 0);
  assert.equal(state.routes.length, 1);
  state.screen.view.set({ ...quote(false), order: { ...quote(false).order, purpose: 'STANDARD' } });
  await state.screen.duplicate();
  assert.deepEqual(state.api, [9]);
});

test('agreement portal disallows product/cart proposals at the action boundaries', async () => {
  const { screen } = makeHarness(portalJs, 'PortalPage');
  screen.openProposal();
  await screen.propose();
  // No proposal state/API was provided: reaching either would throw.
});

test('switching agreement portal language never fetches the regular-price catalogue', async () => {
  const { screen } = makeHarness(portalJs, 'PortalPage');
  let catalogs = 0;
  Object.assign(screen, { token: () => 'fixture-token', language: signal('NL'), catalog: signal(['old']),
    sales: { portalQuote: async () => quote(), portalCatalog: async () => { catalogs++; return ['catalog']; } } });
  await screen.setLanguage('EN');
  assert.equal(screen.language(), 'EN');
  assert.equal(screen.catalog().length, 0);
  assert.equal(catalogs, 0);
  screen.sales.portalQuote = async () => quote(false);
  await screen.setLanguage('NL');
  assert.equal(catalogs, 1);
});

test('the customer final-invoice notice uses the stored profit share without raw printf placeholders', () => {
  const { screen } = makeHarness(portalJs, 'PortalPage');
  screen.locale = () => 'nl-BE';
  screen.t = () => 'Winstaandeel van ENROSED (%s%%)';
  assert.equal(screen.agreementSettlementText(), 'Winstaandeel van ENROSED (50%)');
});

const scheduleJs = await productionMembers('purchasing/partner-advance-schedule', 'PartnerAdvanceSchedule',
  ['canCreateInvoice', 'hasInvoices', 'makeInvoice']);
const selectionJs = await productionMembers('purchasing/purchase-quote-sheet', 'PurchaseQuoteSheet',
  ['choose', 'useCustomerAgreement', 'setPurpose', 'setCost', 'setShare', 'agreementEur', 'recalculateLegacyTerms']);

function planFixture() {
  return { purchaseOrderId: 48, partnerCustomerId: 2, agreedAmountEur: 5000, financingPct: 50,
    invoicingBlocked: false, reservedOutsideScheduleEur: 0,
    rows: agreement.rows.map(row => ({ id: row.scheduleRowId, label: row.label, percentage: row.percentage,
      amountEur: row.amountEur, dueDate: row.dueDate, invoiceId: null as number | null })) };
}

function scheduleHarness() {
  const exports: { PartnerAdvanceSchedule?: new () => any } = {};
  vm.runInNewContext(scheduleJs, { exports, computed, messageOf: () => 'Error' });
  const screen = new exports.PartnerAdvanceSchedule!();
  const calls: unknown[] = [];
  Object.assign(screen, { documents: signal([]), schedule: signal(planFixture()),
    purchaseOrderId: signal(48), busy: signal(false), loading: signal(false), error: signal(''),
    sourcing: { invoicePartnerAdvance: async (...args: unknown[]) => { calls.push(args); return {}; } },
    invoiceCreated: { emit() {} }, load: async () => {},
  });
  return { screen, calls };
}

test('a saved positive partner term creates its concept invoice without any quotation', async () => {
  const { screen, calls } = scheduleHarness();
  assert.equal(screen.canCreateInvoice(), true);
  await screen.makeInvoice(2);
  assert.equal(JSON.stringify(calls), JSON.stringify([[48, 2]]));
  assert.equal(screen.busy(), false);
  screen.documents.set([quote(), { ...quote(), order: { ...quote().order, status: 'VERLOPEN' } }]);
  screen.schedule.update((plan: any) => ({ ...plan, rows: plan.rows.map((row: any) => ({ ...row, label: 'Updated milestone' })) }));
  assert.equal(screen.canCreateInvoice(), true, 'Historical quote snapshots do not gate the current invoice plan');
});

test('zero advance, missing partner, stale route, settlement and existing invoice guard term creation', async () => {
  const { screen, calls } = scheduleHarness();
  for (const change of [{ agreedAmountEur: 0 }, { partnerCustomerId: null }, { purchaseOrderId: 49 }, { invoicingBlocked: true }]) {
    screen.schedule.set({ ...planFixture(), ...change });
    assert.equal(screen.canCreateInvoice(), false);
    await screen.makeInvoice(2);
  }
  screen.schedule.set(planFixture());
  await screen.makeInvoice(999);
  screen.schedule.update((plan: any) => ({ ...plan, rows: plan.rows.map((row: any) => ({ ...row, invoiceId: 12 })) }));
  await screen.makeInvoice(2);
  assert.equal(calls.length, 0, 'A delayed click cannot duplicate an already-linked or removed term');
  screen.schedule.set(planFixture()); screen.loading.set(true);
  await screen.makeInvoice(2);
  screen.loading.set(false); screen.busy.set(true);
  await screen.makeInvoice(2);
  assert.equal(calls.length, 0);
});

function selectionHarness(locked = false) {
  const exports: { PurchaseQuoteSheet?: new () => any } = {};
  vm.runInNewContext(selectionJs, { exports, computed, cents, shouldRecalculateLegacySchedule });
  const screen = new exports.PurchaseQuoteSheet!();
  const linked = { id: 2, partnerCostPct: 100, partnerSharePct: 25 };
  const other = { id: 3, partnerCostPct: 100, partnerSharePct: 20 };
  Object.assign(screen, { chosen: signal(2), partner: signal(true), termsLocked: signal(locked),
    createError: signal(null), costPct: signal(50), sharePct: signal(50), costKnown: () => true,
    pricing: signal('COST'), showAll: signal(false), customers: signal([linked, other]),
    order: () => ({ partnerCustomerId: 2, partnerCostPct: 50, partnerSharePct: 50 }),
    presetCostPct: signal(50), presetSharePct: signal(50), savedTerms: () => ({ partnerCustomerId: 2 }),
    chosenCustomer: () => screen.customers().find((row: { id: number }) => row.id === screen.chosen()),
  });
  return { screen, linked, other };
}

test('reselecting the linked customer and changing document purpose preserves container-specific shares', () => {
  const { screen, linked } = selectionHarness();
  screen.choose(linked);
  assert.equal(screen.costPct(), 50);
  assert.equal(screen.sharePct(), 50);
  screen.setPurpose(false);
  screen.setPurpose(true);
  assert.equal(screen.costPct(), 50, 'Customer default 100% must not replace container 50%');
  assert.equal(screen.sharePct(), 50, 'Customer default 25% must not replace container 50%');
});

test('existing invoices prevent changing the financing customer/share through alternate controls', () => {
  const { screen, other } = selectionHarness(true);
  screen.choose(other);
  screen.setCost('100');
  screen.setShare('25');
  assert.equal(screen.chosen(), 2);
  assert.equal(screen.costPct(), 50);
  assert.equal(screen.sharePct(), 50);
  screen.setPurpose(false);
  screen.choose(other);
  assert.equal(screen.chosen(), 3, 'Regular sales still allow another customer');
  screen.setPurpose(true);
  assert.equal(screen.chosen(), 2, 'Returning to the locked financing flow restores its customer');
  assert.equal(screen.costPct(), 50);
});

test('zero-percent container financing is retained instead of replaced by customer defaults', () => {
  const { screen, linked } = selectionHarness();
  screen.presetCostPct.set(0);
  screen.presetSharePct.set(0);
  screen.useCustomerAgreement(linked);
  assert.equal(screen.costPct(), 0);
  assert.equal(screen.sharePct(), 0);
});

test('an empty schedule already using the purchase total keeps its basis until explicitly changed', () => {
  const { screen } = selectionHarness();
  screen.savedTerms = signal({ partnerCustomerId: 2, financingPct: 50, agreedAmountEur: 5000, financingBasis: 'PURCHASE_TOTAL_WITH_SEPARATE_COSTS', rows: [] });
  screen.advanceBasisEur = signal(12000);
  screen.reconciliation = () => ({ totals: { forecastExternalEur: 19000 } });
  assert.equal(screen.agreementEur(), 5000, 'Removing all unused rows must not silently recalculate the fixed basis to 6000');
  screen.setCost('100');
  assert.equal(screen.agreementEur(), 12000);
  screen.savedTerms.set({ partnerCustomerId: 2, financingPct: 0, agreedAmountEur: 0, rows: [] });
  screen.setCost('0');
  assert.equal(screen.agreementEur(), 0);
});
