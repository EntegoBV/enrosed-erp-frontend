import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { PurchaseOrderView } from '../src/app/core/api/models.ts';
import { financeAttention } from '../src/app/features/finance/finance-attention.ts';
import { containerPayables } from '../src/app/features/finance/payables.ts';
import { homeTasks } from '../src/app/features/dashboard/home-priority.ts';
import type { HomeTaskInput } from '../src/app/features/dashboard/home-priority.ts';

/*
 * The home's container row and Kosten & bank's "Vraagt aandacht" count the same terms (home-sources containerDueOf
 * against finance-attention). home-sources.ts imports its neighbours without an extension (Angular side): a resolve
 * hook adds '.ts' for this test process only.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      try { return next(`${specifier}.ts`, context); } catch { /* not a .ts file: resolve as written */ }
    }
    return next(specifier, context);
  },
});
const { containerDueOf } = await import('../src/app/features/dashboard/home-sources.ts');

const stream = (payee: string, remainingEur: number) => ({ payee, label: payee, status: 'OPEN', plannedEur: remainingEur, paidEur: 0, remainingEur,
  forecastEur: remainingEur, varianceEur: 0, overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 0 });
const term = (due: string, label: string, remainingEur: number) => ({ due, label, plannedEur: remainingEur, paidEur: 0, remainingEur, settledSavingEur: 0,
  overpaidEur: 0, explicitlySettled: false, finalized: false, offsetEur: 0 });
const view = (id: number, number: string, status: string, streams: object[], terms: object[], alias: string | null = null) => ({
  order: { id, number, alias, status, archivedAt: null }, invoices: [],
  reconciliation: { totals: {}, lines: [], notes: [], streams, supplierInstalments: terms },
}) as unknown as PurchaseOrderView;

test('the home row counts the container terms Kosten & bank counts, for the same amount', () => {
  const purchases = [
    /* on its way: the deposit and the balance due, and the transport */
    view(21, 'PO-2026-021', 'ONDERWEG', [stream('SUPPLIER', 2400), stream('LOGISTICS', 600)],
      [term('ORDERED', '30% bij bestelling', 1000), term('SHIPPED', '70% bij vertrek', 1400)], 'Moederdag'),
    /* ordered: only the deposit is due; the balance waits for the departure */
    view(43, 'PO-2026-043', 'BESTELD', [stream('SUPPLIER', 5000)], [term('ORDERED', '30% bij bestelling', 1500), term('SHIPPED', '70% bij vertrek', 3500)]),
  ];
  const due = containerDueOf(purchases);
  assert.deepEqual(due.map((row: HomeTaskInput['containerDue'][number]) => [row.label, row.eur, row.terms]), [['Moederdag', 3000, 3], ['PO-2026-043', 1500, 1]]);

  const now = containerPayables(purchases).filter((row) => row.bucket === 'now');
  const attention = financeAttention({ today: '2026-10-15', openCosts: [], dueNowCount: 0, bankLines: [], accounts: [],
    containerNow: { count: now.length, eur: Math.round(now.reduce((sum, row) => sum + row.remainingEur, 0) * 100) / 100 },
    receiptsWithoutAccount: { count: 0, eur: 0 }, unbanked: { count: 0, eur: 0 }, unconfirmedRegimes: { count: 0 }, costs: [], receivables: [] })
    .find((item) => item.kind === 'container-due')!;
  const row = homeTasks({
    today: '2026-10-15', nowMs: Date.parse('2026-10-15T06:40:00Z'), planner: [], customers: [], loginRequests: 0, containerDue: due,
    advances: { count: 0, eur: 0, overdueEur: 0, first: null }, settlements: 0, invoicesOverdue: [], overdueCosts: null,
    vat: { paidPeriods: ['2026-Q3'], eurByDeadline: {} }, tight: null, arrivals: [], purchaseCheck: 0, catalog: 0, housekeeping: [], later: {},
    taskKeys: [], sources: {} as HomeTaskInput['sources'],
  }).top.find((task) => task.source === 'container-due')!;
  assert.equal(attention.title, '4 containertermijnen nu te betalen');
  assert.deepEqual([row.title, row.count, row.eur], ['4 containertermijnen betalen', attention.count, attention.amountEur]);
});
