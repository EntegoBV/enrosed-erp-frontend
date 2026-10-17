import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityEvent } from '../src/app/core/api/models.ts';
import {
  activityDays, activityEntitySub, activityEntityText, activityFiltersFromQuery, activityOverview, activityQueryFromFilters, activityRows,
  activitySummaryText, activityValue, categoryRequest, changePreview, changesOf, dayLabel, keepForChip, nlNumber, rowTime, todayEvents,
} from '../src/app/features/activity/activity-format.ts';

const at = (h: number, m: number, day = 16) => new Date(2026, 9, day, h, m).toISOString();
const BERAT = { username: 'berat', displayName: 'Berat' };
const ev = (id: number, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id, at: at(10, 0), actor: BERAT, action: 'UPDATED', entityType: 'PURCHASE_ORDER', entityId: '62', entityLabel: 'PO-2026-025',
  summary: 'Inkooporder bijgewerkt', changes: [], category: 'PURCHASING', ...extra,
});
const ctx = { poName: (id: string) => id === '62' ? '12-Set-Roseamor-Jerry' : null, supplierName: (id: string) => ({ '7': 'Yunnan Pubei', '5': 'Shenzhen Blossoming' })[id] ?? null };

test('production values read as elsewhere in the ERP', () => {
  const extra = { field: 'extraRevenue', label: 'Extra opbrengst', beforeValue: '2000.00', afterValue: '3000.00' };
  assert.equal(activityValue(extra, extra.beforeValue, ev(1)), '2.000');
  assert.equal(activityValue(extra, extra.afterValue, ev(1)), '3.000');
  assert.equal(activityValue({ field: 'seaFreight', label: 'Zeevracht' }, '1407.53', ev(1)), '1.407,53');
  assert.equal(activityValue({ field: 'line.1.exw', label: 'EXW-prijs · rozen' }, '18.90', ev(1)), '18,90');
  assert.equal(activityValue({ field: 'paidOn', label: 'Betaald op' }, '2026-10-16', ev(1)), '16/10/2026');
  assert.equal(activityValue({ field: 'status', label: 'Status' }, 'CONCEPT', ev(1)), 'Concept');
  assert.equal(activityValue({ field: 'status', label: 'Status' }, 'ONDERWEG', ev(1)), 'Vertrokken');
  assert.equal(activityValue({ field: 'kind', label: 'Soort' }, 'PAYMENT_PROOF', ev(1)), 'Betaalbewijs');
  assert.equal(activityValue({ field: 'supplierId', label: 'Leverancier' }, '7', ev(1), ctx), 'Yunnan Pubei');
  assert.equal(activityValue({ field: 'supplierId', label: 'Leverancier' }, '5', ev(1)), '5');
  assert.equal(activityValue({ field: 'x', label: 'Gearchiveerd' }, 'ja', ev(1)), 'Ja');
  assert.equal(activityValue({ field: 'ean', label: 'EAN' }, '5400000000017', ev(1)), '5400000000017');
  assert.equal(activityValue({ field: 'price', label: 'Verkoopprijs (EUR)' }, '24.50', ev(1)), '€ 24,50');
  const usd = ev(2, { changes: [{ field: 'currency', label: 'Valuta', beforeValue: null, afterValue: 'USD' }] });
  assert.equal(activityValue({ field: 'goods', label: 'Goederen' }, '1200.00', usd), '$ 1.200,00');
  assert.equal(activityValue({ field: 'x', label: 'Notities' }, null, ev(1)), 'Niet ingevuld');
  assert.equal(nlNumber('-18415.00'), '−18.415');
});

test('bank summaries and labels in euro, purchase orders by container name', () => {
  assert.equal(activitySummaryText('Bankbeweging toegewezen: toegewezen -18415.00 · verschil 0.00'), 'Bankbeweging toegewezen: toegewezen € −18.415,00 · verschil € 0,00');
  assert.equal(activityEntityText({ entityType: 'BANK_STATEMENT', entityId: '880', entityLabel: 'BE94731074082814 · -18415.00' }), 'BE94 7310 7408 2814 · € −18.415,00');
  assert.equal(activityEntityText(ev(1), ctx), '12-Set-Roseamor-Jerry');
  assert.equal(activityEntitySub(ev(1), ctx), 'PO-2026-025');
  assert.equal(activityEntityText(ev(1)), 'PO-2026-025');
  assert.equal(activityEntitySub(ev(1)), null);
});

test('change preview, private changes and identical pairs (N11)', () => {
  const status = ev(3, { action: 'STATUS_CHANGED', changes: [
    { field: 'status', label: 'Status', beforeValue: 'CONCEPT', afterValue: 'BESTELD' },
    { field: 'l1', label: 'EXW-prijs · rozen (rood)', beforeValue: null, afterValue: '18.90' },
    { field: 'l2', label: 'EXW-prijs · rozen (roze)', beforeValue: null, afterValue: '18.90' },
    { field: 'l3', label: 'EXW-prijs · rozen (wit)', beforeValue: null, afterValue: '18.90' },
    { field: 'same', label: 'Notities', beforeValue: 'x', afterValue: 'x' },
    { field: 'secret', label: 'E-mail', beforeValue: null, afterValue: null },
  ] });
  assert.equal(changesOf(status).length, 5);
  assert.equal(changePreview(status, ctx), 'Status Concept → Besteld · EXW-prijs → 18,90 · +3');
  assert.equal(changePreview(ev(4, { changes: [{ field: 'secret', label: 'E-mail', beforeValue: null, afterValue: null }] })), 'E-mail aangepast');
});

test('bursts: five updates by Berat on PO-2026-025 10:42–10:47 stay apart from the 10:48 status change and the 12:18 update', () => {
  const events = [
    ev(10, { at: at(12, 18) }),
    ev(9, { at: at(10, 48), action: 'STATUS_CHANGED' }),
    ...[47, 46, 45, 44, 42].map((m, i) => ev(8 - i, { at: at(10, m) })),
    ev(2, { at: at(10, 41), entityType: 'PRODUCT', entityId: '301' }),
  ];
  const rows = activityRows(events);
  assert.deepEqual(rows.map((row) => row.events.length), [1, 1, 5, 1]);
  assert.equal(rows[2].key, 8);
  assert.equal(rowTime(rows[2]), '10:42–10:47');
  assert.equal(rowTime(rows[0]), '12:18');
  /* milestones never merge, other actors break a burst, and so does a gap over 15 minutes */
  assert.equal(activityRows([ev(2, { action: 'CREATED' }), ev(1, { action: 'CREATED' })]).length, 2);
  assert.equal(activityRows([ev(2), ev(1, { actor: { username: 'emre', displayName: 'Emre' } })]).length, 2);
  assert.equal(activityRows([ev(2, { at: at(11, 0) }), ev(1, { at: at(10, 40) })]).length, 2);
  /* day counts count events, not rows */
  const days = activityDays(rows, new Date(2026, 9, 16, 13, 0));
  assert.equal(days[0].label, 'Vandaag');
  assert.equal(days[0].count, 8);
  assert.equal(todayEvents(events, new Date(2026, 9, 16, 13, 0)), 8);
  assert.equal(dayLabel(at(9, 0, 14), new Date(2026, 9, 16)), 'Woensdag 14 oktober 2026');
});

test('B4: Kosten & bank on a backend without FINANCE, and Overig without them', () => {
  assert.deepEqual(categoryRequest('ALL', null), { category: undefined, keep: 'all' });
  assert.deepEqual(categoryRequest('FINANCE', null), { category: 'FINANCE', keep: 'all' });
  assert.deepEqual(categoryRequest('FINANCE', false), { category: 'OTHER', keep: 'finance' });
  assert.deepEqual(categoryRequest('OTHER', true), { category: 'OTHER', keep: 'not-finance' });
  assert.equal(keepForChip({ entityType: 'BANK_STATEMENT' }, 'finance'), true);
  assert.equal(keepForChip({ entityType: 'PRODUCT' }, 'finance'), false);
  assert.equal(keepForChip({ entityType: 'COMPANY_COST' }, 'not-finance'), false);
});

test('filters live in the URL', () => {
  const filters = activityFiltersFromQuery({ soort: 'PURCHASING', wie: 'berat', type: 'PURCHASE_ORDER', id: '62' });
  assert.deepEqual(filters, { category: 'PURCHASING', actor: 'berat', entityType: 'PURCHASE_ORDER', entityId: '62' });
  assert.deepEqual(activityQueryFromFilters(filters), { soort: 'PURCHASING', wie: 'berat', type: 'PURCHASE_ORDER', id: '62' });
  assert.deepEqual(activityFiltersFromQuery({ soort: 'nonsense', wie: '<x>' }), { category: 'ALL', actor: null, entityType: null, entityId: null });
  assert.deepEqual(activityQueryFromFilters({ category: 'ALL', actor: null, entityType: null, entityId: null }), {});
});

test('overview of the loaded events', () => {
  const events = [ev(3), ev(2), ev(1, { actor: { username: 'emre', displayName: 'Emre' }, entityType: 'PRODUCT', entityId: '9', category: 'CATALOGUE' })];
  const overview = activityOverview(events, (event) => event.category ?? 'OTHER');
  assert.equal(overview.total, 3);
  assert.deepEqual(overview.people, [{ name: 'Berat', count: 2 }, { name: 'Emre', count: 1 }]);
  assert.deepEqual(overview.categories.map((c) => [c.category, c.count]), [['PURCHASING', 2], ['CATALOGUE', 1]]);
  assert.equal(overview.records[0].entityId, '62');
});

test('names behind the ids: read again after a failure, when old, or when a named purchase order is missing', async () => {
  const { namesReloadDue, purchaseOrderIds, NAMES_MAX_AGE_MS, NAMES_MISSING_RETRY_MS } = await import('../src/app/features/activity/activity-format.ts');
  const now = 1_000_000_000;
  const state = (extra: Partial<{ inFlight: boolean; failed: boolean; loadedAt: number | null; missing: boolean }> = {}) =>
    ({ inFlight: false, failed: false, loadedAt: now - 5_000, missing: false, ...extra });
  assert.equal(namesReloadDue(state({ loadedAt: null }), now), true, 'first time');
  assert.equal(namesReloadDue(state(), now), false, 'fresh and complete');
  assert.equal(namesReloadDue(state({ failed: true }), now), true, 'one failed lookup never sticks for the visit');
  assert.equal(namesReloadDue(state({ failed: true, inFlight: true }), now), false, 'never twice at once');
  assert.equal(namesReloadDue(state({ loadedAt: now - NAMES_MAX_AGE_MS - 1 }), now), true, 'old');
  assert.equal(namesReloadDue(state({ missing: true }), now), false, 'a missing order waits a minute');
  assert.equal(namesReloadDue(state({ missing: true, loadedAt: now - NAMES_MISSING_RETRY_MS - 1 }), now), true, 'a new order gets its name');
  assert.deepEqual(purchaseOrderIds([ev(1), ev(2), ev(3, { entityType: 'PRODUCT', entityId: '9' }), ev(4, { entityId: null })]), ['62']);
});
