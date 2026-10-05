import assert from 'node:assert/strict';
import test from 'node:test';
import {
  containerName, containerNumberHint, containerPhrase, linkedPurchaseOrderId, salesContainerName, salesContainerNumber,
} from '../src/app/features/purchasing/container-name.ts';

test('the alias leads, then the number, then the purchase id', () => {
  assert.equal(containerName({ id: 12, number: 'PO-2026-011', alias: '  container/2026/002 ' }), 'container/2026/002');
  assert.equal(containerName({ id: 12, number: 'PO-2026-011', alias: '   ' }), 'PO-2026-011');
  assert.equal(containerName({ id: 12, number: '', alias: null }), 'Inkoop #12');
  assert.equal(containerName(null, 40), 'Inkoop #40');
  assert.equal(containerName(undefined), 'Inkooporder');
  assert.equal(containerName({ id: 0, number: null, alias: null }, -3), 'Inkooporder', 'Never an invented id');
});

test('the number is small print only when the name does not already say it', () => {
  assert.equal(containerNumberHint('container/2026/002', 'PO-2026-011'), 'PO-2026-011');
  assert.equal(containerNumberHint('PO-2026-011', ' PO-2026-011 '), null);
  assert.equal(containerNumberHint('container/2026/002', null), null);
});

test('the word container is never said twice', () => {
  assert.equal(containerPhrase('PO-2026-011'), 'container PO-2026-011');
  assert.equal(containerPhrase('container/2026/002'), 'container/2026/002');
  assert.equal(containerPhrase('Container Frans'), 'Container Frans');
  assert.equal(containerPhrase('containervoorjaar'), 'container containervoorjaar');
  assert.equal(containerPhrase(''), 'de container');
});

test('a sales document names its own container: regular source first, else the partner container', () => {
  assert.equal(linkedPurchaseOrderId({ sourcePurchaseOrderId: 8, partnerPurchaseOrderId: null }), 8);
  assert.equal(linkedPurchaseOrderId({ sourcePurchaseOrderId: null, partnerPurchaseOrderId: 9 }), 9);
  assert.equal(linkedPurchaseOrderId({}), null);
  const view = (changes: Record<string, unknown> = {}) => ({
    order: { partnerPurchaseOrderId: 45, sourcePurchaseOrderId: 45 },
    advanceContents: { purchaseOrderId: 45, purchaseOrderNumber: 'PO-45' }, ...changes,
  });
  assert.equal(salesContainerName(view({ partnerContainerName: 'container/2026/002', partnerContainerNumber: 'PO-45' })), 'container/2026/002');
  assert.equal(salesContainerNumber(view({ partnerContainerName: 'container/2026/002', partnerContainerNumber: 'PO-45b' })), 'PO-45b');
  assert.equal(salesContainerName(view()), 'PO-45', 'An older backend falls back to the cargo snapshot');
  assert.equal(salesContainerName(view({ advanceContents: { purchaseOrderId: 46, purchaseOrderNumber: 'PO-46' } })), 'Inkoop #45', 'A snapshot of another container never names this one');
  assert.equal(salesContainerName(view(), { id: 45, number: 'PO-45', alias: 'voor Frans' }), 'voor Frans', 'A loaded purchase order is the freshest');
  assert.equal(salesContainerName(view({ partnerContainerName: 'container/2026/002' }), { id: 46, number: 'PO-46', alias: 'other' }), 'container/2026/002');
  assert.equal(salesContainerName({ order: { partnerPurchaseOrderId: null, sourcePurchaseOrderId: null } }), null);
  assert.equal(salesContainerNumber({ order: { sourcePurchaseOrderId: 7 } }), null);
});
