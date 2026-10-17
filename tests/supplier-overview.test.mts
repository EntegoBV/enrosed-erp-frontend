import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseOrderView } from '../src/app/core/api/models.ts';
import { containerPayables } from '../src/app/features/finance/payables.ts';
import { containerCounts, supplierOverview } from '../src/app/features/suppliers/supplier-overview.ts';

// Leveranciers (Inkoop redesign I7, F20): per supplier its containers, what they ask now and later, open credits, counts, last order.

function view(id: number, supplierId: number, status: string, orderDate: string, values: Record<string, unknown> = {}): PurchaseOrderView {
  const due = (values.due as number | undefined) ?? 0;
  const later = (values.later as number | undefined) ?? 0;
  return {
    order: { id, number: `PO-2026-0${id}`, alias: values.alias ?? null, status, supplierId, orderDate, receivedOn: values.receivedOn ?? null,
      partnerCustomerId: values.partner ? 5 : null, archivedAt: values.archived ? '2026-10-01T10:00:00Z' : null, lines: [] },
    costing: { totals: { totalEur: (values.total as number | undefined) ?? 1000 } },
    reconciliation: status === 'CONCEPT' ? { streams: [], supplierInstalments: [], totals: {} } : {
      totals: values.creditOpen != null ? { supplierCreditOpenEur: values.creditOpen } : {},
      streams: [{ payee: 'SUPPLIER', status: due + later ? 'PARTIAL' : 'PAID', finalized: !(due + later), remainingEur: due + later }],
      supplierInstalments: [
        { due: 'ORDERED', label: '30%', plannedEur: due, paidEur: 0, remainingEur: due, finalized: !due },
        { due: 'ARRIVED', label: '70%', plannedEur: later, paidEur: 0, remainingEur: later, finalized: !later },
      ],
    },
    supplierCredits: (values.credits as unknown[]) ?? [],
    invoices: [],
  } as unknown as PurchaseOrderView;
}

test('per supplier: containers newest first, now and later summed, credits, lopend and ontvangen, the last order', () => {
  const views = [
    view(25, 8, 'BESTELD', '2026-10-16', { alias: '12-Set-Roseamor-Jerry', due: 11421.38, later: 22842.76, total: 47731 }),
    view(11, 8, 'BESTELD', '2026-09-02', { due: 509, partner: true, credits: [{ status: 'OPEN', amountEur: 120 }, { status: 'OFFSET', amountEur: 80 }] }),
    view(5, 8, 'ONTVANGEN', '2026-06-01', { receivedOn: '2026-08-23' }),
    view(3, 8, 'ONTVANGEN', '2026-04-01', { archived: true, creditOpen: 45.5 }),
    view(46, 7, 'CONCEPT', '2026-10-15'),
  ];
  const overview = supplierOverview(views, containerPayables(views));
  const yunnan = overview.get(8)!;
  assert.deepEqual(yunnan.containers.map((row) => row.name), ['12-Set-Roseamor-Jerry', 'PO-2026-011', 'PO-2026-05', 'PO-2026-03']);
  assert.deepEqual([yunnan.nowEur, yunnan.laterEur, yunnan.creditOpenEur], [11930.38, 22842.76, 165.5]);
  assert.deepEqual([yunnan.running, yunnan.received, yunnan.lastOrderDate], [2, 1, '2026-10-16'], 'the archived one counts in money, not in lopend/ontvangen');
  assert.equal(containerCounts(yunnan), '2 lopend · 1 ontvangen');
  assert.deepEqual(yunnan.containers[1].payment, { state: 'due', nowEur: 509, laterEur: 0 });
  assert.equal(yunnan.containers[1].partner, true);
  const mock = overview.get(7)!;
  assert.deepEqual([mock.running, mock.received, mock.nowEur, mock.containers[0].payment?.state], [1, 0, 0, 'concept']);
  assert.equal(containerCounts(undefined), 'nog geen containers');
  assert.equal(containerCounts({ running: 0, received: 0 }), 'gearchiveerd');
});

test('Nieuwe calculatie opens the Inkoop list\'s sheet with the supplier chosen, then leaves the address (F19)', async () => {
  const { readFile } = await import('node:fs/promises');
  const suppliers = await readFile(new URL('../src/app/features/suppliers/supplier-list.ts', import.meta.url), 'utf8');
  const list = await readFile(new URL('../src/app/features/purchasing/purchase-list.ts', import.meta.url), 'utf8');
  assert.match(suppliers, /this\.router\.navigate\(\['\/purchasing'\], \{ queryParams: \{ nieuw: 1, leverancier: supplier\.id \} \}\)/);
  assert.match(list, /if \(params\.get\('nieuw'\) !== '1'\) return;[\s\S]*?replaceUrl: true[\s\S]*?if \(this\.supplierById\(\)\.has\(id\)\) this\.chosen\.set\(id\);\s*this\.startNew\(\);/);
  assert.match(suppliers, /message: `<b>\$\{escapeHtml\(supplier\.name\)\}<\/b> verwijderen\?`/, 'the name is escaped in both confirms (F6)');
  assert.doesNotMatch(suppliers, /function message\(/, 'messageOf, not a local copy');
});
