import assert from 'node:assert/strict';
import test from 'node:test';
import { runLink, undoLink } from '../src/app/features/finance/bank-link-actions.ts';
import type { LinkApis, LinkChoice } from '../src/app/features/finance/bank-link-actions.ts';
import type { LinkTarget } from '../src/app/features/finance/bank-change-preview.ts';

// The calls behind "Koppelen" on a transaction (spec-bank-forecast §3.6), recorded instead of sent.
function apis() {
  const calls: unknown[][] = [];
  const line = { id: 120, amountEur: -86.73 } as any;
  const banking = {
    addCostPayment: async (...args: unknown[]) => { calls.push(['addCostPayment', ...args]); return line; },
    linkPayments: async (...args: unknown[]) => { calls.push(['linkPayments', ...args]); return line; },
    allocate: async (...args: unknown[]) => { calls.push(['allocate', ...args]); return line; },
  };
  return { calls, line, apis: { banking, sourcing: {}, finance: {} } as unknown as LinkApis };
}
const choice = (over: Partial<LinkChoice> = {}): LinkChoice => ({ follow: true, keepAs: 'BANKKOSTEN', surplus: 'ADJUST', cashRound: true, ...over });
const costNew: LinkTarget = { kind: 'cost-new', costId: 14, title: 'Kost · Proximus oktober', openEur: 86.73 };

test('a new cost payment beside an unbanked one carries the ticked confirmation (the server refuses it otherwise)', async () => {
  // Review 2026-10-16: "Koppelen" on the best match dropped "Ik heb de bestaande betalingen gecontroleerd; dit is een nieuwe betaling."
  const confirmed = apis();
  await runLink(confirmed.apis, confirmed.line, costNew, choice({ confirmNew: true }));
  assert.deepEqual(confirmed.calls, [['addCostPayment', 120, 14, true]]);
  const plain = apis();
  await runLink(plain.apis, plain.line, costNew, choice());
  assert.deepEqual(plain.calls, [['addCostPayment', 120, 14, false]]);
});

test('an existing cost payment or receipt asks the server to follow the bank only when it knows followBank', async () => {
  const costExisting: LinkTarget = { kind: 'cost-existing', costId: 14, costPaymentId: 7, title: 'Kost · Proximus oktober', amountEur: 86.73, paidOn: '2026-10-13', account: null, proofCount: 0 };
  const round = apis(); await runLink(round.apis, round.line, costExisting, choice());
  assert.deepEqual(round.calls, [['linkPayments', 120, { costPaymentId: 7, followBank: true }]]);
  const older = apis(); await runLink(older.apis, older.line, costExisting, choice({ cashRound: false }));
  assert.deepEqual(older.calls, [['linkPayments', 120, { costPaymentId: 7 }]]);
  const receipt: LinkTarget = { kind: 'sales-existing', salesOrderId: 412, paymentId: 9, title: 'Factuur F2026-0412', amountEur: 1452, receivedOn: '2026-10-13', account: null };
  const sales = apis(); await runLink(sales.apis, { ...sales.line, amountEur: 1452 }, receipt, choice({ cashRound: false }));
  assert.deepEqual(sales.calls, [['allocate', 120, 412, 9, false]]);
});

test('"Ongedaan maken" after a purchase link deletes the Transactiekosten that link made, never an older one', async () => {
  // Review 2026-10-20: the server keeps the fee payment on unlink, so the container kept a € 25,40 fee without a bank line.
  const calls: unknown[][] = [];
  const recorded = {
    banking: { unlinkPayments: async (...args: unknown[]) => { calls.push(['unlinkPayments', ...args]); } },
    sourcing: { deletePayment: async (...args: unknown[]) => { calls.push(['deletePayment', ...args]); } },
    finance: {},
  } as unknown as LinkApis;
  const line = { id: 77, amountEur: -20314.96 } as any;
  const target: LinkTarget = { kind: 'purchase-existing', orderId: 5, paymentId: 11, title: 'PO-2026-005', amountEur: 20289.56, paidOn: '2026-10-14',
    currency: 'EUR', amount: 20289.56, account: null, proofCount: 0, hasInspectionAfspraak: false, groupSize: 1 };
  const pay = (id: number, over: Record<string, unknown> = {}) => ({ id, orderId: 5, payee: 'OTHER', label: 'Transactiekosten', bankStatementLineId: 77, ...over }) as any;
  const purchase = [pay(11, { payee: 'SUPPLIER', label: '30% voorschot' }), pay(12), pay(9), pay(13, { label: 'Inspectie' }), pay(14, { bankStatementLineId: 78 })];
  await undoLink(recorded, line, target, { purchase, known: new Set([11, 9]) });
  assert.deepEqual(calls, [['unlinkPayments', 77], ['deletePayment', 5, 12]]);
  calls.length = 0;
  await undoLink(recorded, line, target, { purchase });
  assert.deepEqual(calls, [['unlinkPayments', 77]]);
});
