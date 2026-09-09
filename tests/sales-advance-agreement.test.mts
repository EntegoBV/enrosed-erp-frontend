import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { cents } from '../src/app/features/purchasing/partner-advance-schedule-state.ts';

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
const portalJs = await productionMembers('portal/portal-page', 'PortalPage', ['openProposal', 'propose', 'setLanguage', 'agreementSettlementText']);

const agreement = { purchaseOrderId: 48, financingPct: 50, agreedAmountEur: 5000, sharePct: 50,
  rows: [{ scheduleRowId: 1, label: 'Start productie', percentage: 30, amountEur: 1500, dueDate: null },
    { scheduleRowId: 2, label: 'Container gereed', percentage: 70, amountEur: 3500, dueDate: null }] };
function quote(snapshot = true) { return { order: { id: 9, number: 'O-9', docType: 'OFFERTE', purpose: 'PARTNER_ADVANCE', status: 'CONCEPT' }, ...(snapshot ? { advanceAgreement: agreement } : {}) }; }

function makeHarness(javascript: string, className: string, snapshot = true) {
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, advanceAgreementFor, computed, signal, Intl,
    escapeHtml: (value: string) => value, messageOf: () => 'Error', localStorage: { setItem() {} } });
  const screen = new exports[className]();
  const routes: unknown[] = [];
  const api: unknown[] = [];
  let confirmation: (() => void) | null = null;
  const router = { navigate: async (...args: unknown[]) => { routes.push(args); return true; } };
  Object.assign(screen, {
    view: signal(quote(snapshot)), quote: signal(quote(snapshot)), invoiceBusy: signal(false), busy: signal(false),
    router, routerNav: router,
    sales: { createInvoiceFrom: async (id: number) => { api.push(id); return { order: { id: 22, number: 'F-22' } }; },
      duplicateOrder: async (id: number) => { api.push(id); return { order: { id: 23 } }; } },
    ui: { confirm: (_options: unknown, fn: () => void) => { confirmation = fn; }, toast() {} },
  });
  return { screen, routes, api, get confirmation() { return confirmation; } };
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
  state.screen.view.set(quote(false));
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

const scheduleSource = await readFile(new URL('../src/app/features/purchasing/partner-advance-schedule.ts', import.meta.url), 'utf8');
const scheduleParsed = ts.createSourceFile('schedule.ts', scheduleSource, ts.ScriptTarget.Latest, true);
const matchFunction = scheduleParsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'matchesAdvanceAgreement');
assert.ok(matchFunction);
const matchJs = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(scheduleParsed, [matchFunction])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const matchExports: { matchesAdvanceAgreement?: (...args: any[]) => boolean } = {};
vm.runInNewContext(matchJs, { exports: matchExports });
const matchesAdvanceAgreement = matchExports.matchesAdvanceAgreement!;
const scheduleJs = await productionMembers('purchasing/partner-advance-schedule', 'PartnerAdvanceSchedule',
  ['hasAgreementQuotes', 'agreementQuote', 'hasQuote', 'needsNewAgreementQuote', 'canCreateInvoice', 'hasInvoices', 'makeInvoice']);
const selectionJs = await productionMembers('purchasing/purchase-quote-sheet', 'PurchaseQuoteSheet',
  ['choose', 'useCustomerAgreement', 'setPurpose', 'setCost', 'setShare', 'agreementEur']);

function planFixture() {
  return { purchaseOrderId: 48, partnerCustomerId: 2, agreedAmountEur: 5000, financingPct: 50,
    invoicingBlocked: false, reservedOutsideScheduleEur: 0,
    rows: agreement.rows.map(row => ({ id: row.scheduleRowId, label: row.label, percentage: row.percentage,
      amountEur: row.amountEur, dueDate: row.dueDate, invoiceId: null })) };
}
function matchingQuote() { return { ...quote(), order: { ...quote().order, customerId: 2 } }; }

test('current term plan must match saved amounts, percentages, dates, labels and ownership exactly', () => {
  const document = matchingQuote();
  assert.equal(matchesAdvanceAgreement(document, planFixture(), 50), true);
  for (const change of [{ label: 'Different milestone' }, { percentage: 40 }, { amountEur: 1600 }, { dueDate: '2026-10-01' }, { id: 999 }]) {
    const plan = planFixture();
    Object.assign(plan.rows[0], change);
    assert.equal(matchesAdvanceAgreement(document, plan, 50), false, JSON.stringify(change));
  }
  for (const change of [{ partnerCustomerId: 3 }, { purchaseOrderId: 49 }, { financingPct: 100 }, { agreedAmountEur: 10000 }]) {
    assert.equal(matchesAdvanceAgreement(document, { ...planFixture(), ...change }, 50), false, JSON.stringify(change));
  }
  assert.equal(matchesAdvanceAgreement(document, planFixture(), 25), false, 'The current profit share must also match');
  for (const status of ['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']) {
    assert.equal(matchesAdvanceAgreement({ ...document, order: { ...document.order, status } }, planFixture(), 50), false);
  }
  assert.equal(matchesAdvanceAgreement(document, { ...planFixture(), rows: [] }, 50), false);
});

function scheduleHarness() {
  const exports: { PartnerAdvanceSchedule?: new () => any } = {};
  vm.runInNewContext(scheduleJs, { exports, computed, matchesAdvanceAgreement, messageOf: () => 'Error' });
  const screen = new exports.PartnerAdvanceSchedule!();
  const calls: unknown[] = [];
  Object.assign(screen, { documents: signal([matchingQuote()]), schedule: signal(planFixture()), sharePct: signal(50),
    purchaseOrderId: () => 48, busy: signal(false), loading: signal(false), error: signal(''),
    sourcing: { invoicePartnerAdvance: async (...args: unknown[]) => { calls.push(args); return {}; } },
    invoiceCreated: { emit() {} }, load: async () => {},
  });
  return { screen, calls };
}

test('a changed plan requires a new quote even if an earlier term already has an invoice', async () => {
  const { screen, calls } = scheduleHarness();
  const changed = planFixture();
  changed.rows[0].invoiceId = 12;
  changed.rows[1].label = 'New shipping milestone';
  screen.schedule.set(changed);
  assert.equal(screen.hasInvoices(), true);
  assert.equal(screen.needsNewAgreementQuote(), true);
  assert.equal(screen.canCreateInvoice(), false);
  await screen.makeInvoice(2);
  assert.equal(calls.length, 0);
  screen.schedule.set(planFixture());
  assert.equal(screen.canCreateInvoice(), true);
  await screen.makeInvoice(2);
  assert.equal(calls.length, 1);
});

test('expired snapshots cannot fall back to a legacy quote, but historical invoice flows stay available', () => {
  const { screen } = scheduleHarness();
  const expired = matchingQuote();
  expired.order.status = 'VERLOPEN';
  screen.documents.set([expired, quote(false)]);
  assert.equal(screen.hasQuote(), false);
  assert.equal(screen.needsNewAgreementQuote(), true);
  screen.documents.set([quote(false)]);
  assert.equal(screen.hasQuote(), true);
  assert.equal(screen.canCreateInvoice(), true);
  screen.documents.set([{ ...quote(false), order: { ...quote(false).order, status: 'VERLOPEN' } }]);
  assert.equal(screen.hasQuote(), false);
  assert.equal(screen.canCreateInvoice(), false);
  screen.schedule.set({ ...planFixture(), reservedOutsideScheduleEur: 500 });
  assert.equal(screen.canCreateInvoice(), true, 'No snapshots exist, so already-started legacy invoicing remains available');
});

function selectionHarness(locked = false) {
  const exports: { PurchaseQuoteSheet?: new () => any } = {};
  vm.runInNewContext(selectionJs, { exports, computed, cents });
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

test('an empty saved schedule keeps its agreed financing basis until the percentage is explicitly changed', () => {
  const { screen } = selectionHarness();
  screen.savedTerms = signal({ partnerCustomerId: 2, financingPct: 50, agreedAmountEur: 5000, rows: [] });
  screen.reconciliation = () => ({ totals: { forecastExternalEur: 12000 } });
  assert.equal(screen.agreementEur(), 5000, 'Removing all unused rows must not silently recalculate the fixed basis to 6000');
  screen.setCost('100');
  assert.equal(screen.agreementEur(), 12000);
  screen.savedTerms.set({ partnerCustomerId: 2, financingPct: 0, agreedAmountEur: 0, rows: [] });
  screen.setCost('0');
  assert.equal(screen.agreementEur(), 0);
});
