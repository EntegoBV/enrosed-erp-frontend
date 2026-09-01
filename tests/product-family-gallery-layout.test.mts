import assert from 'node:assert/strict';
import test from 'node:test';
import { productImagePublicationMenuPlacement } from '../src/app/features/products/product-family-gallery-layout.ts';

test('publication menu opens below when the viewport has enough room', () => {
  assert.equal(productImagePublicationMenuPlacement(120, 164, 800), 'below');
});

test('publication menu opens above for a gallery row near the viewport bottom', () => {
  assert.equal(productImagePublicationMenuPlacement(620, 664, 720), 'above');
});

test('publication menu uses the roomier side on very short viewports', () => {
  assert.equal(productImagePublicationMenuPlacement(130, 174, 320), 'below');
  assert.equal(productImagePublicationMenuPlacement(170, 214, 320), 'above');
});
