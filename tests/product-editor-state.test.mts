import assert from 'node:assert/strict';
import test from 'node:test';
import { productEditorReady, visibleProductEditorTab } from '../src/app/features/products/product-editor-state.ts';

test('an edit route requires its matching product, not an empty or previously opened draft', () => {
  assert.equal(productEditorReady('45', null, false, null), false);
  assert.equal(productEditorReady('45', 44, false, null), false);
  assert.equal(productEditorReady('45', 45, false, null), true);
});

test('loading and failed edits stay blocked even if an earlier matching draft remains', () => {
  assert.equal(productEditorReady('45', 45, true, null), false);
  assert.equal(productEditorReady('45', 45, false, 'Product laden mislukt'), false);
  assert.equal(productEditorReady('45', null, false, 'Product laden mislukt'), false);
});

test('explicit new-product routes work without an id while invalid edit ids cannot create products', () => {
  assert.equal(productEditorReady('', null, false, null), true);
  assert.equal(productEditorReady('new', null, false, null), true);
  assert.equal(productEditorReady('0', null, false, null), false);
  assert.equal(productEditorReady('invalid', null, false, null), false);
  assert.equal(productEditorReady('-1', null, false, null), false);
});

test('publication deep links and desktop-to-mobile changes fall back to an available section', () => {
  const mobile = ['identity', 'media', 'packaging', 'purchasing', 'sales', 'stock', 'agreements'];
  assert.equal(visibleProductEditorTab('publication', [...mobile, 'publication']), 'publication');
  assert.equal(visibleProductEditorTab('publication', mobile), 'identity');
  assert.equal(visibleProductEditorTab('stock', mobile), 'stock');
  assert.equal(visibleProductEditorTab('unknown', mobile), 'identity');
});
