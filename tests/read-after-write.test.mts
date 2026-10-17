import assert from 'node:assert/strict';
import test from 'node:test';
import { ReadAfterWrite } from '../src/app/features/settings/read-after-write.ts';

test('a read with no write around it applies', () => {
  const order = new ReadAfterWrite();
  const ticket = order.readStarted();
  assert.equal(order.readCurrent(ticket), true);
});

test('a read that started before a save and answers after it is dropped', () => {
  const order = new ReadAfterWrite();
  const ticket = order.readStarted();
  order.writeStarted();
  order.writeEnded();
  assert.equal(order.readCurrent(ticket), false);
});

test('a read that started during a save is dropped, whether it answers during or after it', () => {
  const order = new ReadAfterWrite();
  order.writeStarted();
  const ticket = order.readStarted();
  assert.equal(order.readCurrent(ticket), false);
  order.writeEnded();
  assert.equal(order.readCurrent(ticket), false);
});

test('a read that started after the save ended applies; overlapping saves count', () => {
  const order = new ReadAfterWrite();
  order.writeStarted();
  order.writeStarted();
  order.writeEnded();
  const during = order.readStarted();
  order.writeEnded();
  assert.equal(order.readCurrent(during), false);
  const after = order.readStarted();
  assert.equal(order.readCurrent(after), true);
});
