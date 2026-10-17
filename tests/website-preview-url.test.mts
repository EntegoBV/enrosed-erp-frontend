import assert from 'node:assert/strict';
import test from 'node:test';
import { websitePreviewUrl } from '../src/app/features/website-builder/website-preview-url.ts';

test('the preview names a language root, English lives at the root', () => {
  assert.equal(websitePreviewUrl('https://enrosed.com', 'nl', 3, 'flowerboxes'), 'https://enrosed.com/nl/?builderPreview=3#flowerboxes');
  assert.equal(websitePreviewUrl('https://enrosed.com', 'NL', 0, ''), 'https://enrosed.com/nl/?builderPreview=0');
  assert.equal(websitePreviewUrl('https://enrosed.com', 'en', 3, 'hero'), 'https://enrosed.com/?builderPreview=3#hero');
  assert.equal(websitePreviewUrl('https://enrosed.com', 'fr', 1, ''), 'https://enrosed.com/fr/?builderPreview=1');
});

test('a trailing slash, an existing query and odd anchors are handled', () => {
  assert.equal(websitePreviewUrl('http://127.0.0.1:4321/', 'nl', 2, 'soap-roses'), 'http://127.0.0.1:4321/nl/?builderPreview=2#soap-roses');
  assert.equal(websitePreviewUrl('https://test.example/?x=1', 'nl', 2, ''), 'https://test.example/nl/?x=1&builderPreview=2');
  assert.equal(websitePreviewUrl('https://enrosed.com', 'nl', 2, 'a b'), 'https://enrosed.com/nl/?builderPreview=2#a%20b');
  assert.equal(websitePreviewUrl('https://enrosed.com', 'nl', 2, '  '), 'https://enrosed.com/nl/?builderPreview=2');
});
