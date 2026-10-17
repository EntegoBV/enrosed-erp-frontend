import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../src/app/features/products/${path}`, import.meta.url), 'utf8');

test('Voorraad boeken is the one booking UI: one sheet host per screen', async () => {
  for (const file of ['product-view.ts', 'product-desk.ts', 'stock-page.ts', 'product-editor.ts']) {
    const source = await read(file);
    assert.equal(source.match(/<app-stock-booking-sheet /g)?.length, 1, file);
    /* The old per-screen forms are gone. */
    assert.doesNotMatch(source, /takeOutDraft|transferDraft|confirmTakeout|confirmTakeOut|bookCorrection|correctOpen|confirmBooking/, file);
  }
});

test('only the sheet takes stock out, moves it or reports it on a container', async () => {
  const sheet = await read('stock-booking-sheet.ts');
  assert.match(sheet, /catalog\.takeOutStock\(/);
  assert.match(sheet, /catalog\.transferStock\(/);
  assert.match(sheet, /sourcing\.reportAfterReceipt\(/);
  for (const file of ['product-view.ts', 'product-desk.ts', 'stock-page.ts', 'product-editor.ts']) {
    const source = await read(file);
    assert.doesNotMatch(source, /takeOutStock\(|transferStock\(|reportAfterReceipt\(/, file);
  }
});

test('the sheet books on its button, never on blur, and names containers by containerName', async () => {
  const sheet = await read('stock-booking-sheet.ts');
  assert.doesNotMatch(sheet, /\(blur\)|\(change\)="submit/);
  assert.match(sheet, /\(click\)="submit\(\)"/);
  const containers = await read('received-containers.ts');
  assert.match(containers, /name: containerName\(row\.order\)/);
});
