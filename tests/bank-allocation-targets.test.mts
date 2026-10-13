import assert from 'node:assert/strict';
import test from 'node:test';
import { bankAllocationTargets, filterBankAllocationTargets } from '../src/app/features/finance/bank-allocation-targets.ts';
const cost = (id: number, amount: number, open = amount): any => ({ id, description: 'Factuur drukwerk', party: 'Drukkerij België', reference: `PRINT-${id}`, date: '2026-10-13', amountInclEur: amount, openEur: open });
const invoice = (id: number, extra: any = {}): any => ({ order: { id, number: `INV-${id}`, customerId: 1, orderDate: '2026-10-13', docType: 'FACTUUR', status: 'UITGEREIKT', ...extra }, paymentSummary: { invoiceTotalEur: 100, remainingEur: 50, refundableEur: 0, payments: [] } });
const targets = (bank: number, costs: any[] = [], sales: any[] = [], containers: any[] = []) => bankAllocationTargets(bank, costs, sales, containers, () => 'Klant', cost => cost.amountInclEur, cost => cost.openEur);

test('local manual costs need no Odoo source and credit documents follow the bank direction', () => {
  assert.deepEqual(targets(-50, [cost(1, 100), cost(2, -95.58)]).map(row => row.key), ['cost:1']);
  assert.deepEqual(targets(95.58, [cost(1, 100), cost(2, -95.58)]).map(row => row.key), ['cost:2']);
  const credit = targets(95.58, [cost(2, -95.58)])[0]; assert.equal(credit.openBankEur, 95.58); assert.equal(credit.totalEur, -95.58);
});

test('search matches normalized supplier, reference, Belgian date and decimal amounts; exact balance sorts first', () => {
  const rows = targets(-100, [cost(1, 500), cost(2, 100), cost(3, 40, 0)]);
  for (const query of ['belgie', 'PRINT-2', '13/10/2026', '100,00']) assert.ok(filterBankAllocationTargets(rows, query, { amountEur: -100 }).some(row => row.key === 'cost:2'));
  assert.equal(filterBankAllocationTargets(rows, '', { amountEur: -100 })[0].key, 'cost:2');
  assert.equal(filterBankAllocationTargets(rows, 'betaald', { amountEur: -100 })[0].key, 'cost:3');
});

test('only issued sales documents participate and purchase budget remains explicitly estimated', () => {
  assert.deepEqual(targets(50, [], [invoice(1), invoice(2, { status: 'CONCEPT' }), invoice(3, { docType: 'OFFERTE' })]).map(row => row.id), [1]);
  const term: any = { key: 'container:4:SUPPLIER:ORDERED', orderId: 4, orderNumber: 'PO-4', alias: 'Rozen', payee: 'SUPPLIER', termLabel: 'Voorschot', due: 'ORDERED', plannedEur: 1000, remainingEur: 800, paidEur: 200 };
  assert.equal(targets(-500, [], [], [term])[0].estimated, true); assert.equal(targets(500, [], [], [term]).length, 0);
});
