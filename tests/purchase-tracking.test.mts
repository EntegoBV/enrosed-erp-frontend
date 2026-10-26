import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContainerTracking, ContainerTrackingFeed } from '../src/app/core/api/container-tracking-models.ts';
import { purchaseTrackedOrder, PurchaseTrackingBaseline, purchaseTrackingRow, purchaseTrackingScope } from '../src/app/features/purchasing/purchase-tracking-model.ts';

const row = (changes: Partial<ContainerTracking> = {}): ContainerTracking => ({
  orderId: 38, orderNumber: 'PO-2026-004', containerName: 'Foam Bear',
  trackingReference: 'EGSU0162841 · B/L EGLV143650155115', orderStatus: 'ONDERWEG',
  status: 'SAILING', statusLabel: 'Onderweg', carrier: 'Evergreen', vessel: 'EVERALLY',
  eta: null, location: null, position: null, route: [], events: [], checkedAt: null,
  updatedAt: null, nextCheckAt: null, changedAt: null, error: null, trackingUrl: null,
  source: 'VOYDAR', vesselImo: '9975791', automatic: true, ...changes,
});
const feed = (...containers: ContainerTracking[]): ContainerTrackingFeed => ({
  provider: 'VOYDAR', configured: true, shipsGoConfigured: false, intervalHours: 6, containers,
});

test('purchase tracking selects its own saved order when another order has the same vessel and reference', () => {
  const own = row();
  const other = row({ orderId: 40, orderNumber: 'PO-2026-006', containerName: 'Andere container' });
  assert.equal(purchaseTrackingRow(feed(other, own), 38, own.trackingReference), own);
  assert.equal(purchaseTrackingRow(feed(other), 38, own.trackingReference), null);
});

test('editing a tracking reference cannot expose the old reference snapshot for the same order', () => {
  const before = row();
  const corrected = 'EGHU9194893 · B/L EGLV143668686040';
  assert.equal(purchaseTrackingRow(feed(before), before.orderId, corrected), null);
  assert.notEqual(purchaseTrackingScope(before.orderId, before.trackingReference), purchaseTrackingScope(before.orderId, corrected));
  assert.notEqual(purchaseTrackingScope(before.orderId, before.trackingReference), purchaseTrackingScope(40, before.trackingReference));
});

test('only saved orders with a real reference have a tracking scope', () => {
  const item = row();
  for (const orderId of [0, -1, NaN, Infinity, 1.5]) {
    assert.equal(purchaseTrackingScope(orderId, item.trackingReference), null);
    assert.equal(purchaseTrackingRow(feed(item), orderId, item.trackingReference), null);
  }
  for (const reference of [null, '', '   ', '\n']) {
    assert.equal(purchaseTrackingScope(item.orderId, reference), null);
    assert.equal(purchaseTrackingRow(feed(item), item.orderId, reference), null);
  }
  assert.equal(purchaseTrackingRow(null, item.orderId, item.trackingReference), null);
});

test('canonical dates update the display without mutating the saved order or inferring vessel ETA', () => {
  const item = row({ orderExpectedArrival: '2026-11-04', orderShippedOn: '2026-10-20', eta: '2026-11-01T09:00:00Z' });
  const order = Object.freeze({ id: item.orderId, trackingReference: item.trackingReference,
    expectedArrival: '2026-11-06', shippedOn: '2026-10-21', note: 'Keep the draft intact' });
  const displayed = purchaseTrackedOrder(order, item);
  assert.equal(displayed.expectedArrival, '2026-11-04');
  assert.equal(displayed.shippedOn, '2026-10-20');
  assert.equal(displayed.note, order.note);
  assert.equal(order.expectedArrival, '2026-11-06');
  assert.equal(order.shippedOn, '2026-10-21');
  assert.equal(purchaseTrackedOrder(order, row({ eta: '2026-11-01T09:00:00Z' })), order,
    'an older backend or an arbitrary vessel ETA leaves the order dates alone');
});

test('canonical dates from an old order or tracking reference never change the active order', () => {
  const order = { id: 38, trackingReference: row().trackingReference, expectedArrival: '2026-11-06', shippedOn: null };
  assert.equal(purchaseTrackedOrder(order, row({ orderId: 40, orderExpectedArrival: '2026-11-04' })), order);
  assert.equal(purchaseTrackedOrder(order, row({ trackingReference: 'NEW-REFERENCE', orderExpectedArrival: '2026-11-04' })), order);
});

test('invalid server dates retain the saved date; explicit canonical null remains unknown', () => {
  const order = { id: 38, trackingReference: row().trackingReference, expectedArrival: '2026-11-06', shippedOn: '2026-10-20' };
  for (const date of ['2026-02-30', 'not-a-date', '2026-11-04T10:00:00Z', '04/11/2026']) {
    assert.equal(purchaseTrackedOrder(order, row({ orderExpectedArrival: date })), order);
  }
  const displayed = purchaseTrackedOrder(order, row({ orderExpectedArrival: null, orderShippedOn: null }));
  assert.equal(displayed.expectedArrival, null);
  assert.equal(displayed.shippedOn, null);
});

test('a confirmed tracking date becomes the clean save baseline without replaying over a later manual save', () => {
  const baseline = new PurchaseTrackingBaseline();
  const snapshot = row({ orderExpectedArrival: '2026-11-12', orderShippedOn: '2026-10-05' });
  const original = { id: 38, trackingReference: snapshot.trackingReference, expectedArrival: '2026-11-30', shippedOn: null as string | null, alias: 'Container' };
  const refreshed = baseline.accept(original, snapshot, false);
  assert.equal(refreshed.expectedArrival, '2026-11-12');
  assert.equal(refreshed.shippedOn, '2026-10-05');
  const unrelatedEdit = { ...refreshed, alias: 'Nieuw label' };
  assert.equal(unrelatedEdit.expectedArrival, '2026-11-12', 'a full-order edit save preserves the confirmed arrival');
  const manualSave = { ...unrelatedEdit, expectedArrival: '2026-11-15' };
  assert.equal(baseline.accept(manualSave, snapshot, false), manualSave, 'a cached row cannot undo the newer save');
});

test('a row received during editing or saving is consumed without altering or later replaying onto the draft', () => {
  const baseline = new PurchaseTrackingBaseline();
  const snapshot = row({ orderExpectedArrival: '2026-11-12' });
  const draft = { id: 38, trackingReference: snapshot.trackingReference, expectedArrival: '2026-11-15', shippedOn: null };
  assert.equal(baseline.accept(draft, snapshot, true), draft);
  assert.equal(baseline.accept(draft, snapshot, false), draft);
  const freshResponse = row({ orderExpectedArrival: '2026-11-16' });
  assert.equal(baseline.accept(draft, freshResponse, false).expectedArrival, '2026-11-16', 'a new fetch still updates a clean order');
});
