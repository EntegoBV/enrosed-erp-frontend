import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  ARCHIVED_WEBSHOP_RECORD_LABEL,
  sourceLabel,
  sourceRecordLabel,
} from '../src/app/features/products/product-family-source-labels.ts';

test('known source codes read as Dutch display labels', () => {
  assert.equal(sourceLabel('SHOPIFY'), 'Oude webshop');
  assert.equal(sourceLabel('ODOO'), 'Odoo');
  assert.equal(sourceLabel('WEBSITE_GENERATED'), 'Website');
  assert.equal(sourceLabel('DASHBOARD'), 'ERP');
});

test('source codes match regardless of case and surrounding spaces', () => {
  assert.equal(sourceLabel(' shopify '), 'Oude webshop');
  assert.equal(sourceLabel('Odoo'), 'Odoo');
});

test('unknown source codes fall back to the stored value', () => {
  assert.equal(sourceLabel('ODOO_XLSX'), 'ODOO_XLSX');
  assert.equal(sourceLabel('WEBSITE_FRONTEND'), 'WEBSITE_FRONTEND');
  assert.equal(sourceLabel('PDF'), 'PDF');
  assert.equal(sourceLabel('constructor'), 'constructor');
});

test('missing source codes stay empty so the template fallback applies', () => {
  assert.equal(sourceLabel(null), '');
  assert.equal(sourceLabel(undefined), '');
  assert.equal(sourceLabel(''), '');
  assert.equal(sourceLabel(null) || 'bron', 'bron');
});

test('archived CDN URLs of the former webshop are masked', () => {
  const url = 'https://cdn.shopify.com/s/files/1/0510/6329/2073/files/01.jpg?v=1764790591';
  assert.equal(sourceRecordLabel(url), ARCHIVED_WEBSHOP_RECORD_LABEL);
  assert.equal(
    sourceRecordLabel('HTTPS://CDN.SHOPIFY.COM/s/files/x.jpg'),
    'Oude webshop (archiefbron)',
  );
  assert.equal(sourceRecordLabel('//cdn.shopify.com/s/files/x.jpg'), 'Oude webshop (archiefbron)');
});

test('other record keys and locations show as stored', () => {
  assert.equal(sourceRecordLabel('Sheet1!A16:K16 Omschrijving'), 'Sheet1!A16:K16 Omschrijving');
  assert.equal(
    sourceRecordLabel('enrosed.com/products/rose-in-dome-xl.js variant 44887957307561'),
    'enrosed.com/products/rose-in-dome-xl.js variant 44887957307561',
  );
  assert.equal(
    sourceRecordLabel('https://notcdn.shopify.company/x'),
    'https://notcdn.shopify.company/x',
  );
  assert.equal(sourceRecordLabel(null), '');
});

test('the source details view renders every source through the display labels and keeps the stored price keys', async () => {
  const source = await readFile(
    new URL('../src/app/features/products/product-family-source-details.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /sourceLabel\(item\.sourceType\) \|\| 'bron'/);
  assert.match(source, /sourceLabel\(identifier\.source\)/);
  assert.match(source, /sourceLabel\(item\.source\)/);
  assert.match(source, /sourceRecordLabel\(item\.sourceRecordKey\)/);
  assert.match(source, /sourceRecordLabel\(item\.sourceLocation\)/);
  assert.doesNotMatch(
    source,
    /\{\{ item\.source \}\}|\{\{ identifier\.source \}\}|\{\{ item\.sourceRecordKey \}\}/,
  );
  assert.match(source, /SHOPIFY_RETAIL: 'Historische retail'/);
  assert.match(source, /SHOPIFY_COMPARE_AT: 'Historische vergelijkprijs'/);
});
