import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { advanceInvoiceScheduleRequest, cents, schedulePreset, scheduleRowAmounts, scheduleDraft, shouldRecalculateLegacySchedule, recreatedScheduleDraft } from '../src/app/features/purchasing/partner-advance-schedule-state.ts';
import { messageOf } from '../src/app/core/api/errors.ts';
import type { PartnerAdvanceSchedule } from '../src/app/core/api/models.ts';

const source = await readFile(new URL('../src/app/features/purchasing/purchase-quote-sheet.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('sheet.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseQuoteSheet');
assert.ok(original);
const names = ['agreementEur', 'costKnown', 'setCost', 'termsLocked', 'recalculateLegacyTerms', 'loadTerms', 'create'];
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
assert.equal(members.length, names.length);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const exports: Record<string, any> = {};
  vm.runInNewContext(javascript, { exports, computed, cents, shouldRecalculateLegacySchedule, recreatedScheduleDraft,
    scheduleDraft, schedulePreset, advanceInvoiceScheduleRequest, messageOf, Error });
  const sheet = new exports.PurchaseQuoteSheet();
  Object.assign(sheet, {
    advanceBasisEur: signal<number | null>(54435.82), costPct: signal(100), partner: signal(true),
    savedTerms: signal(null), terms: signal([]), termsLoading: signal(false), termsError: signal(''),
    lines: signal([{ productId: 1, quantity: 8540, landedUnitEur: 6.375 }]),
    reconciliation: signal({ totals: { forecastExternalEur: 53189.64 }, lines: [{ productId: 1, forecastExternalUnitEur: 6.229 }] }),
    order: signal({ id: 45, partnerCustomerId: 2 }), customers: signal([{ id: 2, company: 'Partner' }]), chosen: signal(2),
    loading: signal(false), busy: signal(false), createError: signal(null), pricing: signal('COST'),
    chosenCosts: signal([]), sharePct: signal(50), markupPct: signal(0), deliveryWeek: signal(''),
    closed: { emit() {} }, ui: { toast() {} }, router: { navigate: async () => true },
  });
  return sheet;
}

test('PO total 53,189.64 plus 1,246.18 separate costs creates exact 18,145.27 and 36,290.55 advances', () => {
  const sheet = harness();
  assert.equal(cents(53189.64 + 1246.18), 54435.82);
  assert.equal(sheet.agreementEur(), 54435.82);
  const terms = schedulePreset('THIRDS', sheet.agreementEur());
  assert.deepEqual(scheduleRowAmounts(terms, sheet.agreementEur()), [18145.27, 36290.55]);
  const request = advanceInvoiceScheduleRequest(terms, sheet.agreementEur());
  assert.deepEqual(request.rows.map(row => row.amountEur), [18145.27, 36290.55]);
  assert.deepEqual(scheduleRowAmounts(schedulePreset('FULL', sheet.agreementEur()), sheet.agreementEur()), [54435.82]);
});

test('funding share applies before production terms and never subtracts revenue or rebuilds rounded unit prices', () => {
  const sheet = harness();
  sheet.setCost('50');
  assert.equal(sheet.agreementEur(), 27217.91);
  assert.deepEqual(scheduleRowAmounts(schedulePreset('THIRDS', sheet.agreementEur()), sheet.agreementEur()), [9072.64, 18145.27]);
  sheet.reconciliation.set({ totals: { forecastExternalEur: 99000 }, lines: [] });
  sheet.lines.set([{ productId: 1, quantity: 8540, landedUnitEur: 6.38 }]);
  assert.equal(sheet.agreementEur(), 27217.91, 'Only the exact purchase total is the financing basis');
});

test('one remaining historical invoice freezes the agreement and prevents percentage changes', () => {
  const sheet = harness();
  const legacy = legacyPlan();
  legacy.rows[1].invoiceId = 58;
  sheet.savedTerms.set(legacy);
  assert.equal(sheet.agreementEur(), 53189.64);
  sheet.advanceBasisEur.set(55000);
  assert.equal(sheet.agreementEur(), 53189.64, 'Current PO edits never silently change previously agreed invoice claims');
  assert.equal(sheet.termsLocked(), true); sheet.setCost('50');
  assert.equal(sheet.costPct(), 100);
  assert.equal(shouldRecalculateLegacySchedule(legacy), false);
  assert.equal(legacy.agreedAmountEur, 53189.64);
  assert.deepEqual(recreatedScheduleDraft(legacy, 55000).map(row => row.value), [17729.88, 35459.76]);
});

function legacyPlan(): PartnerAdvanceSchedule {
  return { purchaseOrderId: 45, partnerCustomerId: 2, financingPct: 100,
    financingBasis: 'EXTERNAL_FORECAST', financingBasisEur: 53189.64, externalCostEur: 53189.64,
    agreedAmountEur: 53189.64, allocatedEur: 53189.64, unallocatedEur: 0, reservedOutsideScheduleEur: 0,
    rows: schedulePreset('THIRDS', 53189.64).map((row, index) => ({ id: index + 1, label: row.label,
      amountEur: row.value, percentage: null, dueDate: index ? null : '2026-10-01',
      invoiceId: null, invoiceNumber: null, invoiceStatus: null, receivedEur: 0, remainingEur: row.value })) };
}

test('deleting all legacy invoices previews fresh thirds and recalculates only on explicit creation', async () => {
  for (const financingBasis of ['EXTERNAL_FORECAST', null] as const) {
    const sheet = harness(), original = { ...legacyPlan(), financingBasis }, writes: any[] = [];
    const before = JSON.stringify(original);
    sheet.sourcing = { partnerAdvanceSchedule: async () => original };
    sheet.sales = { createFromPurchaseOrder: async (request: any) => { writes.push(request); return { order: {
      id: 81, docType: 'FACTUUR', number: 'V-81', status: 'CONCEPT', lines: [], extraLines: [] } }; } };
    await sheet.loadTerms();
    assert.equal(writes.length, 0, 'Opening the sheet never rewrites the saved agreement');
    assert.equal(sheet.agreementEur(), 54435.82);
    assert.deepEqual(scheduleRowAmounts(sheet.terms(), sheet.agreementEur()), [18145.27, 36290.55]);
    assert.equal(sheet.terms()[0].dueDate, '2026-10-01');
    await sheet.create();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].advanceSchedule.recalculateAgreement, true);
    assert.deepEqual(writes[0].advanceSchedule.rows.map((row: any) => row.amountEur), [18145.27, 36290.55]);
    assert.deepEqual(writes[0].advanceSchedule.rows.map((row: any) => row.id), [1, 2]);
    assert.equal(JSON.stringify(original), before, 'The loaded agreement and prior invoice history stay untouched');
  }
});

test('recreated percentage plans scale automatically while custom fixed amounts remain explicit', () => {
  const plan = legacyPlan();
  plan.rows[0].percentage = 30; plan.rows[0].amountEur = cents(plan.agreedAmountEur * .3);
  plan.rows[1].percentage = 70; plan.rows[1].amountEur = cents(plan.agreedAmountEur - plan.rows[0].amountEur);
  assert.deepEqual(scheduleRowAmounts(recreatedScheduleDraft(plan, 54435.82), 54435.82), [16330.75, 38105.07]);
  plan.rows[0].percentage = null; plan.rows[0].amountEur = 10000;
  plan.rows[1].percentage = null; plan.rows[1].amountEur = 43189.64;
  const custom = recreatedScheduleDraft(plan, 54435.82);
  assert.deepEqual(custom.map(row => row.value), [10000, 43189.64]);
  assert.throws(() => advanceInvoiceScheduleRequest(custom, 54435.82), /volledig/);
  for (const change of [{ reservedOutsideScheduleEur: 1 }, { invoicingBlocked: true }, { financingBasis: 'PURCHASE_TOTAL_WITH_SEPARATE_COSTS' as const }]) {
    assert.equal(shouldRecalculateLegacySchedule({ ...plan, ...change }), false);
  }
  const customLabels = legacyPlan(); customLabels.rows[0].label = 'Vaste aanbetaling';
  assert.deepEqual(recreatedScheduleDraft(customLabels, 54435.82).map(row => row.value), [17729.88, 35459.76]);
});

test('a partially deleted legacy plan blocks creation; a complete existing plan reopens without recalculation', async () => {
  for (const partial of [true, false]) {
    const sheet = harness(), plan = legacyPlan(), writes: any[] = [];
    plan.rows[0].invoiceId = 57;
    if (!partial) plan.rows[1].invoiceId = 58;
    sheet.sourcing = { partnerAdvanceSchedule: async () => plan };
    sheet.sales = { createFromPurchaseOrder: async (request: any) => { writes.push(request); return { order: {
      id: 57, docType: 'FACTUUR', number: 'V-57', status: 'CONCEPT', lines: [], extraLines: [] } }; } };
    await sheet.loadTerms();
    assert.equal(sheet.agreementEur(), 53189.64);
    assert.equal(sheet.termsLocked(), true);
    await sheet.create();
    if (partial) {
      assert.match(sheet.termsError(), /overige oude conceptfacturen/);
      assert.equal(writes.length, 0);
    } else {
      assert.equal(sheet.termsError(), '');
      assert.equal(writes.length, 1);
      assert.equal(writes[0].advanceSchedule.recalculateAgreement, undefined);
      assert.deepEqual(writes[0].advanceSchedule.rows.map((row: any) => row.amountEur), [17729.88, 35459.76]);
    }
  }
});

test('unknown purchase total blocks advance creation even if external forecasts and unit prices exist', () => {
  const sheet = harness();
  sheet.advanceBasisEur.set(null);
  assert.equal(sheet.costKnown(), false);
  assert.equal(sheet.agreementEur(), 0);
  sheet.advanceBasisEur.set(Number.NaN); assert.equal(sheet.costKnown(), false);
  sheet.advanceBasisEur.set(Number.POSITIVE_INFINITY); assert.equal(sheet.costKnown(), false);
  sheet.advanceBasisEur.set(54435.82);
  sheet.lines.set([{ productId: 1, quantity: 8540, landedUnitEur: null }]);
  assert.equal(sheet.costKnown(), true, 'An advance amount does not require per-product financial prices');
  sheet.partner.set(false);
  assert.equal(sheet.costKnown(), false, 'Ordinary sales retain their unit-price requirement');
});
