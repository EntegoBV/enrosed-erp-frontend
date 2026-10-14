import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost, PurchaseOrderView } from '../src/app/core/api/models.ts';
import { costLedger, filterCostLedger } from '../src/app/features/finance/cost-ledger.ts';
import { containerPayables } from '../src/app/features/finance/payables.ts';
import { financeAttention } from '../src/app/features/finance/finance-attention.ts';
import type { AttentionInput } from '../src/app/features/finance/finance-attention.ts';

const clear: AttentionInput = {
  today: '2026-09-24', openCosts: [], dueNowCount: 0, containerNow: { count: 0, eur: 0 }, bankLines: [],
  receiptsWithoutAccount: { count: 0, eur: 0 }, accounts: [], unbanked: { count: 0, eur: 0 }, costs: [], receivables: [], unconfirmedRegimes: { count: 0 },
};
const kinds = (input: Partial<AttentionInput>) => financeAttention({ ...clear, ...input }).map((item) => item.kind);

test('open credit-note tegoeden ask to be settled', () => {
  assert.deepEqual(kinds({ openCredits: { count: 0, eur: 0 } }), []);
  const [item] = financeAttention({ ...clear, openCredits: { count: 2, eur: 516.65 } });
  assert.equal(item.kind, 'open-credits');
  assert.equal(item.tone, 'warn');
  assert.equal(item.title, '2 creditnota\u2019s met een tegoed af te handelen');
  assert.equal(item.amountEur, 516.65);
  assert.deepEqual(item.target, { view: 'incoming', kind: 'credit' });
  assert.equal(financeAttention({ ...clear, openCredits: { count: 1, eur: 220.2 } })[0].title, '1 creditnota met een tegoed af te handelen');
});

test('an all-clear day asks for nothing', () => {
  assert.deepEqual(financeAttention(clear), []);
  assert.deepEqual(kinds({ accounts: [{ key: 'KBC', label: 'KBC Zakelijk', hasReading: true, ageDays: 0 }] }), []);
});

test('old costs count only when strictly older than 30 days', () => {
  assert.deepEqual(kinds({ openCosts: [{ date: '2026-08-25', openEur: 10 }] }), [], 'exactly 30 days');
  const [item] = financeAttention({ ...clear, openCosts: [{ date: '2026-08-24', openEur: 10 }, { date: '2026-08-01', openEur: 5.5 }] });
  assert.equal(item.kind, 'overdue-costs');
  assert.equal(item.tone, 'danger');
  assert.equal(item.title, '2 open kosten ouder dan 30 dagen');
  assert.equal(item.amountEur, 15.5, 'what is still open, not the invoice total');
  assert.equal(financeAttention({ ...clear, openCosts: [{ date: '2026-08-01', openEur: 5 }] })[0].title, '1 open kost ouder dan 30 dagen');
});

test('a reading goes stale after 14 days; accounts without one ask for a balance', () => {
  assert.deepEqual(kinds({ accounts: [{ key: 'KBC', label: 'KBC', hasReading: true, ageDays: 14 }] }), []);
  const items = financeAttention({ ...clear, accounts: [
    { key: 'KBC', label: 'KBC Zakelijk', hasReading: true, ageDays: 15 }, { key: 'ING', label: 'ING Zicht', hasReading: false, ageDays: null },
  ] });
  assert.deepEqual(items.map((item) => [item.kind, item.accountKey, item.action, item.title]), [
    ['account-without-reading', 'ING', 'fill', 'ING Zicht: nog geen saldo'],
    ['stale-reading', 'KBC', 'check', 'KBC Zakelijk: 15 dagen niet gecontroleerd'],
  ]);
});

test('receivables count after 30 days, documents only within 90 days and never for recurring bookings', () => {
  assert.deepEqual(kinds({ receivables: [{ orderDate: '2026-08-25', remainingEur: 100 }] }), []);
  const [old] = financeAttention({ ...clear, receivables: [{ orderDate: '2026-08-24', remainingEur: 100 }, { orderDate: '2026-01-01', remainingEur: 0 }] });
  assert.equal(old.title, '1 factuur staat langer dan 30 dagen open');
  assert.equal(old.amountEur, 100);
  const docs = financeAttention({ ...clear, costs: [
    { date: '2026-09-01', documented: false }, { date: '2026-06-26', documented: false }, { date: '2026-06-25', documented: false },
    { date: '2026-09-02', documented: true }, { date: '2026-09-03', documented: false, recurringCostId: 4 },
  ] });
  assert.equal(docs[0].kind, 'costs-without-document');
  assert.equal(docs[0].title, '2 kosten zonder factuur of bon');
  assert.deepEqual(docs[0].target, { view: 'costs', docs: 'missing', from: '2026-06-26', to: '2026-09-24' });
});

test('"kosten zonder factuur of bon" counts exactly the rows its Bekijken opens', () => {
  const base: CompanyCost = { id: 1, date: '2026-09-01', category: 'HUUR', description: 'Huur', party: null, amountExclEur: 100, vatPct: 21,
    reference: null, paidOn: null, salesChannel: null, notes: null, recurringCostId: null } as CompanyCost;
  const costs: CompanyCost[] = [
    base, { ...base, id: 2, date: '2026-08-15' }, { ...base, id: 3, recurringCostId: 9 }, { ...base, id: 4, recurringCostId: 9, date: '2026-08-01' },
    { ...base, id: 5 }, { ...base, id: 6, date: '2026-05-01' }, { ...base, id: 7, date: '2026-10-01' },
  ];
  const documented = new Set([5]);
  const [item] = financeAttention({ ...clear, costs: costs.map((cost) => ({ date: cost.date, recurringCostId: cost.recurringCostId, documented: documented.has(cost.id!) })) });
  assert.equal(item.kind, 'costs-without-document');
  const target = item.target as { from: string; to: string; docs: 'missing' };
  const listed = filterCostLedger(costLedger(costs, [], (cost) => cost.amountExclEur), { from: target.from, to: target.to, docs: target.docs, documentedIds: documented, source: 'company' });
  assert.equal(item.count, listed.length);
  assert.deepEqual(listed.map((row) => row.key).sort(), ['cost:1', 'cost:2']);
});

test('both signs wait for a saved bank allocation and their absolute amounts do not cancel', () => {
  const items = financeAttention({ ...clear, bankLines: [
    { amountEur: 50, salesPaymentId: null }, { amountEur: 25, salesPaymentId: null }, { amountEur: 10, salesPaymentId: 4 }, { amountEur: -30, salesPaymentId: null }, { amountEur: -500, salesPaymentId: null, allocated: true },
  ] });
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].kind, items[0].count, items[0].amountEur, items[0].action], ['unlinked-incoming', 3, 105, 'link']);
  assert.equal(items[0].title, '3 banktransacties nog te koppelen');
  assert.equal(financeAttention({ ...clear, bankLines: [{ amountEur: 5, salesPaymentId: null }] })[0].title,
    '1 banktransactie nog te koppelen');
});

test('danger first, then warnings, then information; bigger amounts first within a tone', () => {
  const items = financeAttention({ ...clear, dueNowCount: 1, containerNow: { count: 2, eur: 900 },
    openCosts: [{ date: '2026-01-01', openEur: 20 }], unbanked: { count: 1, eur: 40 },
    receiptsWithoutAccount: { count: 3, eur: 60 }, bankLines: [{ amountEur: 1500, salesPaymentId: null }] });
  assert.deepEqual(items.map((item) => item.kind),
    ['overdue-costs', 'unlinked-incoming', 'container-due', 'recurring-due', 'receipts-without-account', 'unbanked-payments']);
  assert.deepEqual(items.map((item) => item.tone), ['danger', 'warn', 'warn', 'warn', 'info', 'info']);
});

test('derived or unknown regimes ask for a confirmation, after the documents, with the filtered list as target', () => {
  const items = financeAttention({ ...clear, unconfirmedRegimes: { count: 3 }, costs: [{ date: '2026-09-01', documented: false }] });
  assert.deepEqual(items.map((item) => item.kind), ['costs-without-document', 'unconfirmed-regimes']);
  const [, item] = items;
  assert.deepEqual([item.tone, item.count, item.amountEur, item.action, item.actionLabel], ['info', 3, null, null, 'Bekijken']);
  assert.equal(item.title, '3 kosten: btw-regeling nog te bevestigen');
  assert.equal(item.detail, 'Afgeleid uit het btw-percentage · bevestig of pas aan');
  assert.deepEqual(item.target, { view: 'costs', tab: 'company', period: 'year', regime: 'unconfirmed' });
  assert.equal(financeAttention({ ...clear, unconfirmedRegimes: { count: 1 } })[0].title, '1 kost: btw-regeling nog te bevestigen');
});

test('singular and plural wording', () => {
  const one = financeAttention({ ...clear, dueNowCount: 1, containerNow: { count: 1, eur: 5 }, unbanked: { count: 1, eur: 1 }, receiptsWithoutAccount: { count: 1, eur: 1 } });
  assert.deepEqual(one.map((item) => item.title), ['1 containertermijn nu te betalen', '1 vaste kost staat klaar om te boeken',
    '1 factuurbetaling zonder rekening', '1 betaling nog niet op de bank']);
  const many = financeAttention({ ...clear, dueNowCount: 2, containerNow: { count: 3, eur: 5 }, unbanked: { count: 2, eur: 1 }, receiptsWithoutAccount: { count: 2, eur: 1 } });
  assert.deepEqual(many.map((item) => item.title), ['3 containertermijnen nu te betalen', '2 vaste kosten staan klaar om te boeken',
    '2 factuurbetalingen zonder rekening', '2 betalingen nog niet op de bank']);
  assert.equal(many.find((item) => item.kind === 'recurring-due')?.action, 'book');
});

test('PO 35: terms the server netted raise no container-due item; a rest it leaves open does', () => {
  // As finance-state builds containerNow: the container payables due now, summed.
  const po35 = (shippedRemaining: number) => ({
    order: { id: 35, number: 'PO-2026-002', alias: null, status: 'ONTVANGEN', archivedAt: null },
    reconciliation: { totals: {}, lines: [], notes: [], streams: [{ payee: 'SUPPLIER', label: 'Leverancier', status: shippedRemaining > 0 ? 'PARTIAL' : 'OVERPAID',
      plannedEur: 31048.04, paidEur: 31048.54, remainingEur: shippedRemaining, forecastEur: 31048.54 + shippedRemaining, varianceEur: 0.5 + shippedRemaining,
      overpaidEur: shippedRemaining > 0 ? 0 : 0.5, settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 2 }],
    supplierInstalments: [
      { due: 'ORDERED', label: '30% bij bestelling', plannedEur: 9314.41, paidEur: 9375.69, remainingEur: 0, settledSavingEur: 0,
        overpaidEur: shippedRemaining > 0 ? 0 : 0.5, explicitlySettled: false, finalized: shippedRemaining > 0, offsetEur: -60.78 },
      { due: 'SHIPPED', label: '70% bij vertrek', plannedEur: 21733.63, paidEur: 21672.85, remainingEur: shippedRemaining, settledSavingEur: 0,
        overpaidEur: 0, explicitlySettled: false, finalized: shippedRemaining === 0, offsetEur: 60.78 },
    ] },
  }) as unknown as PurchaseOrderView;
  const containerNow = (view: PurchaseOrderView) => {
    const rows = containerPayables([view]).filter((row) => row.bucket === 'now');
    return { count: rows.length, eur: Math.round(rows.reduce((sum, row) => sum + row.remainingEur, 0) * 100) / 100 };
  };
  assert.deepEqual(kinds({ containerNow: containerNow(po35(0)) }), []);
  const [rest] = financeAttention({ ...clear, containerNow: containerNow(po35(10)) });
  assert.deepEqual([rest.kind, rest.count, rest.amountEur], ['container-due', 1, 10]);
});
