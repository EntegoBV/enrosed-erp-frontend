import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContainerTracking, ContainerTrackingFeed } from '../src/app/core/api/container-tracking-models.ts';
import { purchaseTrackingRow, purchaseTrackingScope } from '../src/app/features/purchasing/purchase-tracking-model.ts';

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
