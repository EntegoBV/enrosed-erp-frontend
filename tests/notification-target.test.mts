import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationTarget } from '../src/app/shared/notification-target.ts';

test('an arrival opens purchase tracking even when a sales order has the same ID', () => {
  assert.deepEqual(notificationTarget({ kind: 'CONTAINER_AANKOMST', orderId: 38 }), {
    commands: ['/purchasing', 38], queryParams: { tracking: '1' },
  });
  assert.deepEqual(notificationTarget({ kind: 'GETEKEND', orderId: 38 }), {
    commands: ['/sales', 38], queryParams: {},
  });
});

test('missing and invalid IDs cannot open a different order', () => {
  for (const orderId of [null, 0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(notificationTarget({ kind: 'CONTAINER_AANKOMST', orderId }), null);
  }
});
