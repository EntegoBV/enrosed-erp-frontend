import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PHOTO_EXPORT_REQUEST,
  PHOTO_EXPORT_PHOTO_SETS,
  PHOTO_EXPORT_SCOPES,
  approximateExportSize,
  photoExportDownloadHref,
  photoExportExpired,
  photoExportRequest,
  photoExportSummary,
} from '../src/app/features/products/photo-export.ts';

const MB = 1024 * 1024;

test('the sheet starts on active products, every photo and a Dutch LEESMIJ', () => {
  assert.deepEqual(DEFAULT_PHOTO_EXPORT_REQUEST, { scope: 'ACTIVE', photos: 'ALL', language: 'NL' });
  assert.deepEqual(photoExportRequest(), { scope: 'ACTIVE', photos: 'ALL', language: 'NL' });
  assert.deepEqual(PHOTO_EXPORT_SCOPES.map((choice) => [choice.value, choice.label]), [
    ['ACTIVE', 'Actieve producten'],
    ['WEBSITE', 'Op de website'],
    ['ALL', 'Alle producten'],
  ]);
  assert.deepEqual(PHOTO_EXPORT_PHOTO_SETS.map((choice) => [choice.value, choice.label]), [
    ['ALL', 'Alle foto’s'],
    ['WEBSITE', 'Alleen websitefoto’s'],
  ]);
});

test('every chosen option reaches the request unchanged', () => {
  assert.deepEqual(photoExportRequest({ scope: 'WEBSITE', photos: 'WEBSITE', language: 'EL' }),
    { scope: 'WEBSITE', photos: 'WEBSITE', language: 'EL' });
  assert.deepEqual(photoExportRequest({ scope: 'ALL', photos: 'ALL', language: 'TR' }),
    { scope: 'ALL', photos: 'ALL', language: 'TR' });
});

test('unknown or empty values fall back to the defaults instead of reaching the backend', () => {
  assert.deepEqual(photoExportRequest({ scope: 'DEMO', photos: 'SMALL', language: 'IT' }),
    { scope: 'ACTIVE', photos: 'ALL', language: 'NL' });
  assert.deepEqual(photoExportRequest({ scope: null, photos: '', language: 'nl' }),
    { scope: 'ACTIVE', photos: 'ALL', language: 'NL' });
});

test('the size reads as an estimate: whole megabytes when large, one decimal otherwise', () => {
  assert.equal(approximateExportSize(780 * MB + 123_456), '± 780 MB');
  assert.equal(approximateExportSize(10 * MB), '± 10 MB');
  assert.equal(approximateExportSize(4.5 * MB), '± 4,5 MB');
  assert.equal(approximateExportSize(1.45 * 1024 * MB), '± 1,5 GB');
  assert.equal(approximateExportSize(340 * 1024), '± 340 kB');
  assert.equal(approximateExportSize(12), '± 1 kB');
  assert.equal(approximateExportSize(0), '');
  assert.equal(approximateExportSize(Number.NaN), '');
  assert.equal(approximateExportSize(null), '');
});

test('the summary line counts products, photos and the size', () => {
  assert.equal(photoExportSummary({ productCount: 63, photoCount: 412, totalBytes: 780 * MB }),
    '63 producten · 412 foto’s · ± 780 MB');
  assert.equal(photoExportSummary({ productCount: 1, photoCount: 1, totalBytes: 2 * MB }),
    '1 product · 1 foto · ± 2 MB');
  assert.equal(photoExportSummary({ productCount: 1250, photoCount: 0, totalBytes: 0 }),
    '1.250 producten · 0 foto’s');
});

test('the relative token link is resolved against the API host', () => {
  const base = 'https://enrosed-erp-backend-production.up.railway.app';
  assert.equal(photoExportDownloadHref(base, '/api/products/photo-export/abc_-123'),
    `${base}/api/products/photo-export/abc_-123`);
  assert.equal(photoExportDownloadHref(`${base}/`, 'api/products/photo-export/abc'),
    `${base}/api/products/photo-export/abc`);
  assert.equal(photoExportDownloadHref(base, 'https://cdn.example/zip/abc'), 'https://cdn.example/zip/abc');
});

test('a link counts as expired a few seconds before the backend drops it', () => {
  const expiresAt = '2026-09-22T12:15:00Z';
  const expires = Date.parse(expiresAt);
  assert.equal(photoExportExpired(expiresAt, expires - 60_000), false);
  assert.equal(photoExportExpired(expiresAt, expires - 4_000), true);
  assert.equal(photoExportExpired(expiresAt, expires + 1), true);
  assert.equal(photoExportExpired(null, expires), false);
  assert.equal(photoExportExpired('not a date', expires), false);
});
