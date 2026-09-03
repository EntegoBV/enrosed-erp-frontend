import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCurrentMediaDetailAction,
  type MediaDetailActionIdentity,
} from '../src/app/features/settings/media-action-identity.ts';

const started: MediaDetailActionIdentity = {
  assetId: 17,
  detailRequestId: 4,
  actionId: 9,
};

test('accepts a detail response only for the unchanged active action', () => {
  assert.equal(isCurrentMediaDetailAction(started, { ...started }), true);
});

test('rejects a late detail response after closing the sheet', () => {
  assert.equal(isCurrentMediaDetailAction(started, null), false);
});

test('rejects a late detail response after selecting another asset', () => {
  assert.equal(isCurrentMediaDetailAction(started, { ...started, assetId: 18 }), false);
});

test('rejects a late detail response after reloading the same asset', () => {
  assert.equal(isCurrentMediaDetailAction(started, { ...started, detailRequestId: 5 }), false);
});

test('rejects a late detail response when a newer mutation is running', () => {
  assert.equal(isCurrentMediaDetailAction(started, { ...started, actionId: 10 }), false);
});
