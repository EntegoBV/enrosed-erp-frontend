import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseOrderView } from '../src/app/core/api/models.ts';
import { containerPayables } from '../src/app/features/finance/payables.ts';
import {
  fillTone, foldText, groupSums, keepEuro, listPayments, matchesQuery, phoneTrail, statusLine,
} from '../src/app/features/purchasing/purchase-list-model.ts';

// The Inkoop list (redesign I1, 2026-10-17): the payment cell, the status line, the search and the fill colour.

function view(id: number, status: string, values: Record<string, unknown> = {}): PurchaseOrderView {
  return {
    order: { id, number: `PO-2026-0${id}`, alias: null, status, supplierId: 8, orderDate: '2026-10-16', expectedArrival: null,
      shippedOn: null, receivedOn: null, stockBooked: null, archivedAt: null, lines: [], ...(values.order as object ?? {}) },
    costing: { lines: [{ productName: 'Rozenbeer 25 cm rood' }, { productName: 'Café glazen stolp' }], totals: { totalEur: 1000 } },
    createdBy: { displayName: 'Berat' },
    reconciliation: values.reconciliation === undefined ? {
      streams: [{ payee: 'SUPPLIER', status: 'PARTIAL', finalized: false, plannedEur: 34264.14, paidEur: 0, remainingEur: 34264.14 }],
      supplierInstalments: [
        { due: 'ORDERED', label: '1/3 bij bestelling', plannedEur: 11421.38, paidEur: 0, remainingEur: 11421.38, finalized: false },
        { due: 'SHIPPED', label: '1/3 bij vertrek', plannedEur: 11421.38, paidEur: 0, remainingEur: 11421.38, finalized: false },
        { due: 'ARRIVED', label: '1/3 bij aankomst', plannedEur: 11421.38, paidEur: 0, remainingEur: 11421.38, finalized: false },
      ],
    } : values.reconciliation,
    invoices: [],
  } as unknown as PurchaseOrderView;
}

test('the payment cell: due now and later, later only, all paid, concept and without a reconciliation', () => {
  const ordered = view(25, 'BESTELD');
  const shipped = view(13, 'ONDERWEG');
  const later = view(7, 'BESTELD', { reconciliation: { streams: [{ payee: 'SUPPLIER', status: 'PARTIAL', finalized: false, remainingEur: 500 }],
    supplierInstalments: [{ due: 'ORDERED', label: '30% bij bestelling', plannedEur: 300, paidEur: 300, remainingEur: 0, finalized: true },
      { due: 'SHIPPED', label: '70% bij vertrek', plannedEur: 700, paidEur: 0, remainingEur: 700, finalized: false }] } });
  const paid = view(2, 'ONTVANGEN', { reconciliation: { streams: [{ payee: 'SUPPLIER', status: 'PAID', finalized: true, remainingEur: 0 }], supplierInstalments: [] } });
  const concept = view(46, 'CONCEPT');
  const legacy = view(3, 'ONTVANGEN', { reconciliation: null });
  const archived = view(4, 'BESTELD', { order: { archivedAt: '2026-10-01T10:00:00Z' } });
  const views = [ordered, shipped, later, paid, concept, legacy, archived];
  const cells = listPayments(views, containerPayables(views));
  assert.deepEqual(cells.get(25), { state: 'due', nowEur: 11421.38, laterEur: 22842.76 });
  assert.deepEqual(cells.get(13), { state: 'due', nowEur: 22842.76, laterEur: 11421.38 }, 'two terms due once it left');
  assert.deepEqual(cells.get(7), { state: 'later', nowEur: 0, laterEur: 700 });
  assert.deepEqual(cells.get(2), { state: 'paid', nowEur: 0, laterEur: 0 });
  assert.deepEqual(cells.get(46), { state: 'concept', nowEur: 0, laterEur: 0 });
  assert.deepEqual(cells.get(3), { state: 'unknown', nowEur: 0, laterEur: 0 });
  assert.deepEqual(cells.get(4), { state: 'due', nowEur: 11421.38, laterEur: 22842.76 }, 'an archived container keeps its open amounts');
  assert.deepEqual(groupSums([cells.get(25), cells.get(13), cells.get(7), undefined]), { nowEur: 34264.14, laterEur: 34964.14 });
});

test('the status line: calculatie, besteld or verwacht, vertrokken, ontvangen and still to book', () => {
  assert.equal(statusLine({ status: 'CONCEPT', orderDate: '2026-10-16' } as never), 'calculatie');
  assert.equal(statusLine({ status: 'BESTELD', orderDate: '2026-10-16', expectedArrival: null } as never), 'besteld 16/10/2026');
  assert.equal(statusLine({ status: 'BESTELD', orderDate: '2026-10-16', expectedArrival: '2026-12-20' } as never), 'verwacht 20/12/2026');
  assert.equal(statusLine({ status: 'ONDERWEG', orderDate: '2026-10-16', shippedOn: '2026-11-02', expectedArrival: null } as never), 'vertrokken 02/11/2026');
  assert.equal(statusLine({ status: 'ONDERWEG', orderDate: '2026-10-16', shippedOn: '2026-11-02', expectedArrival: '2026-12-20' } as never), 'verwacht 20/12/2026');
  assert.equal(statusLine({ status: 'ONTVANGEN', receivedOn: '2026-08-23', stockBooked: true } as never), 'ontvangen 23/08/2026');
  assert.equal(statusLine({ status: 'ONTVANGEN', receivedOn: '2026-08-23', stockBooked: false } as never), 'ontvangen 23/08/2026 · nog bij te boeken');
  assert.equal(statusLine({ status: 'ONTVANGEN', receivedOn: null, stockBooked: null } as never), 'ontvangen');
});

test('the phone trail: the amount due now, else the status day without the booking note', () => {
  assert.deepEqual(phoneTrail({ status: 'BESTELD', orderDate: '2026-10-16' } as never, { state: 'due', nowEur: 5, laterEur: 0 }), { text: '', due: true });
  assert.deepEqual(phoneTrail({ status: 'ONTVANGEN', receivedOn: '2026-08-23', stockBooked: false } as never, { state: 'paid', nowEur: 0, laterEur: 0 }),
    { text: 'ontvangen 23/08/2026', due: false });
  assert.deepEqual(phoneTrail({ status: 'CONCEPT' } as never, undefined), { text: 'calculatie', due: false });
});

test('the search: name, PO number, supplier, maker and products, any case and accents, every word', () => {
  const row = view(25, 'BESTELD', { order: { alias: '12-Set-Roseamor-Jerry' } });
  assert.ok(matchesQuery(row, 'Yunnan Pubei', 'roseamor'));
  assert.ok(matchesQuery(row, 'Yunnan Pubei', 'PO-2026-025'));
  assert.ok(matchesQuery(row, 'Yunnan Pubei', 'yunnan'));
  assert.ok(matchesQuery(row, 'Yunnan Pubei', 'berat'));
  assert.ok(matchesQuery(row, 'Yunnan Pubei', 'cafe stolp'), 'accents fold, words in any order');
  assert.ok(matchesQuery(row, 'Yunnan Pubei', 'ROZENBEER'));
  assert.ok(matchesQuery(row, 'Yunnan Pubei', '  '));
  assert.ok(!matchesQuery(row, 'Yunnan Pubei', 'roseamor kerst'));
  assert.equal(foldText('  Écoute CAFÉ '), 'ecoute cafe');
});

test('the fill colour follows the desk: ok from 97 %, warn over 100 %, bad over 105 %', () => {
  assert.deepEqual([96, 97, 100, 105, 106].map((pct) => fillTone(pct)), ['', 'ok', 'ok', 'warn', 'bad']);
  assert.equal(fillTone(99, 0.4), '', 'an overflow is never ok');
});

test('an amount in a server text keeps its euro sign (N9)', () => {
  assert.equal(keepEuro('Betaling open: 30% bij bestelling (€ 4500,00)'), 'Betaling open: 30% bij bestelling (€\u00a04500,00)');
  assert.equal(keepEuro('€ − 12 en € x'), '€\u00a0− 12 en € x');
});
