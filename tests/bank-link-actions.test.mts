import assert from 'node:assert/strict';
import test from 'node:test';
import { runLink } from '../src/app/features/finance/bank-link-actions.ts';
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
