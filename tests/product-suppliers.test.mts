import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductSupplierRow } from '../src/app/core/api/product-supplier-models.ts';
import {
  agreementSupplierChoices, blankRowForm, canDeactivate, canDeleteRow, canMakePreferred, issueSupplierName,
  mirrorPatch, noteWrite, otherActiveCount, purchaseFieldsForPut, purchaseMode, rowFormError, rowFormOf, rowWrite,
  sortSupplierRows, supplierMissing, supplierRowHistory, supplierRowMeta, type SupplierRowForm,
} from '../src/app/features/products/product-suppliers.ts';

function row(patch: Partial<ProductSupplierRow> = {}): ProductSupplierRow {
  return {
    id: 12, productId: 94, supplierId: 3, supplierName: 'Yunnan Pubei', supplierCity: 'Kunming',
    supplierCurrency: 'USD', supplierIncoterm: 'FOB', supplierLeadTimeDays: 40,
    preferred: true, active: true, versionLabel: 'A · stolp 2 mm', supplierReference: 'PB-1530-BL',
    exwPrice: 2.35, exwCurrency: 'USD', extraUnitCost: 0.10, moq: 600, leadTimeDays: null,
    supplierNote: '- Dome 2 mm…', photoCount: 3,
    lastOrder: { orderId: 39, number: 'PO-2026-005', name: 'PO-2026-005', orderDate: '2026-07-28',
      status: 'ONTVANGEN', exwPrice: 2.30, exwCurrency: 'USD' },
    lastCost: { unitEur: 8.318, appliedAt: '2026-08-23', orderNumber: 'PO-2026-005' },
    purchaseLineCount: 4, updatedAt: '2026-10-25T19:02:11.123456Z',
    ...patch,
  };
}

const eur = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`;

const form = (patch: Partial<SupplierRowForm> = {}): SupplierRowForm => ({
  supplierId: 5, versionLabel: 'B', supplierReference: 'CUL-GD-10', exwPrice: 2.1, exwCurrency: 'USD',
  extraUnitCost: 0.15, moq: 600, leadTimeDays: 45, ...patch,
});

test('purchaseMode for every input', () => {
  assert.equal(purchaseMode(null, 'ready', 0, null), 'new');
  assert.equal(purchaseMode(null, 'loading', 2, 3), 'new', 'a product without id is always new');
  assert.equal(purchaseMode(94, 'loading', 0, 3), 'loading');
  assert.equal(purchaseMode(94, 'error', 2, 3), 'legacy');
  assert.equal(purchaseMode(94, 'ready', 0, 3), 'legacy', 'a supplier but no row yet');
  assert.equal(purchaseMode(94, 'ready', 0, null), 'rows', 'no supplier and no rows: the empty list');
  assert.equal(purchaseMode(94, 'ready', 2, 3), 'rows');
});

test('purchaseFieldsForPut: four nulls only for rows, the own values otherwise', () => {
  const product = { supplierId: 3, exwPrice: 2.35, exwCurrency: 'USD' as const, extraUnitCost: 0.1 };
  assert.deepEqual(purchaseFieldsForPut('rows', product),
    { supplierId: null, exwPrice: null, exwCurrency: null, extraUnitCost: null });
  for (const mode of ['new', 'loading', 'legacy'] as const) {
    assert.deepEqual(purchaseFieldsForPut(mode, product), product, mode);
  }
  assert.deepEqual(purchaseFieldsForPut('legacy', { ...product, exwPrice: null, extraUnitCost: null }),
    { supplierId: 3, exwPrice: null, exwCurrency: 'USD', extraUnitCost: null });
});

test('supplierMissing: rows without rows -> ps-add; no supplier -> p-supplier; else null', () => {
  assert.deepEqual(supplierMissing('rows', 0, null),
    { tab: 'purchasing', field: 'ps-add', label: 'minstens één leverancier' });
  assert.deepEqual(supplierMissing('rows', 0, 3),
    { tab: 'purchasing', field: 'ps-add', label: 'minstens één leverancier' });
  assert.deepEqual(supplierMissing('legacy', 0, null), { tab: 'identity', field: 'p-supplier', label: 'leverancier' });
  assert.deepEqual(supplierMissing('new', 0, null), { tab: 'identity', field: 'p-supplier', label: 'leverancier' });
  assert.equal(supplierMissing('legacy', 0, 3), null);
  assert.equal(supplierMissing('new', 0, 3), null);
  assert.equal(supplierMissing('rows', 2, 3), null);
  assert.equal(supplierMissing('loading', 0, 3), null);
});

test('sortSupplierRows: preferred, then active, then the name in Dutch order; the input stays', () => {
  const rows = [
    row({ id: 1, supplierName: 'Zhejiang', preferred: false, active: true }),
    row({ id: 2, supplierName: 'Ärmel Trading', preferred: false, active: true }),
    row({ id: 3, supplierName: 'Aardig', preferred: false, active: false }),
    row({ id: 4, supplierName: 'Yiwu', preferred: true, active: true }),
    row({ id: 5, supplierName: 'Beta', preferred: false, active: true }),
  ];
  const sorted = sortSupplierRows(rows);
  assert.deepEqual(sorted.map((r) => r.id), [4, 2, 5, 1, 3]);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4, 5], 'a new array');
  assert.ok('Ä'.localeCompare('Z', 'nl') < 0, '"Ä" sorts before "Z"');
});

test('supplierRowMeta: only the parts present, "" without any', () => {
  assert.equal(supplierRowMeta(row({ versionLabel: 'B', supplierReference: 'PB-1530', moq: 600, leadTimeDays: 45 })),
    'Versie B · ref PB-1530 · MOQ 600 · 45 dagen');
  assert.equal(supplierRowMeta(row({ versionLabel: null, supplierReference: null, moq: null, leadTimeDays: null })), '');
  assert.equal(supplierRowMeta(row({ versionLabel: '  ', supplierReference: 'PB-1530', moq: null, leadTimeDays: null })),
    'ref PB-1530');
  assert.equal(supplierRowMeta(row({ versionLabel: 'B', supplierReference: null, moq: 1200, leadTimeDays: 1 })),
    'Versie B · MOQ 1.200 · 1 dag');
  assert.equal(supplierRowMeta(row({ versionLabel: null, supplierReference: null, moq: null, leadTimeDays: 0 })),
    '0 dagen');
});

test('supplierRowHistory with and without last order and last cost', () => {
  assert.equal(supplierRowHistory(row(), eur), 'laatst PO-2026-005 · kostprijs € 8,32');
  assert.equal(supplierRowHistory(row({ lastCost: null }), eur), 'laatst PO-2026-005');
  assert.equal(supplierRowHistory(row({ lastOrder: null, lastCost: null }), eur), 'nog niet besteld');
  assert.equal(supplierRowHistory(row({ lastOrder: null }), eur), 'kostprijs € 8,32');
});

test('otherActiveCount ignores inactive rows and the Voorkeur', () => {
  assert.equal(otherActiveCount([]), 0);
  assert.equal(otherActiveCount([row({ preferred: true })]), 0);
  assert.equal(otherActiveCount([
    row({ id: 1, preferred: true }),
    row({ id: 2, preferred: false, active: true }),
    row({ id: 3, preferred: false, active: false }),
    row({ id: 4, preferred: false, active: true }),
  ]), 2);
});

test('can* rules: the Voorkeur stays; a used row is never deleted', () => {
  const preferred = row({ preferred: true, active: true, purchaseLineCount: 0 });
  const other = row({ preferred: false, active: true, purchaseLineCount: 0 });
  const used = row({ preferred: false, active: true, purchaseLineCount: 2 });
  const inactive = row({ preferred: false, active: false, purchaseLineCount: 0 });
  assert.equal(canDeleteRow(preferred), false);
  assert.equal(canDeleteRow(other), true);
  assert.equal(canDeleteRow(used), false);
  assert.equal(canDeleteRow(inactive), true);
  assert.equal(canDeactivate(preferred), false);
  assert.equal(canDeactivate(other), true);
  assert.equal(canDeactivate(inactive), false);
  assert.equal(canMakePreferred(preferred), false);
  assert.equal(canMakePreferred(other), true);
  assert.equal(canMakePreferred(inactive), false);
});

test('blankRowForm takes the supplier and its currency; rowFormOf reads a row', () => {
  assert.deepEqual(blankRowForm({ id: 5, currency: 'CNY' }), {
    supplierId: 5, versionLabel: '', supplierReference: '', exwPrice: null, exwCurrency: 'CNY',
    extraUnitCost: null, moq: null, leadTimeDays: null,
  });
  assert.deepEqual(blankRowForm(null), {
    supplierId: null, versionLabel: '', supplierReference: '', exwPrice: null, exwCurrency: null,
    extraUnitCost: null, moq: null, leadTimeDays: null,
  });
  assert.deepEqual(rowFormOf(row({ versionLabel: null, supplierReference: null, leadTimeDays: 45 })), {
    supplierId: 3, versionLabel: '', supplierReference: '', exwPrice: 2.35, exwCurrency: 'USD',
    extraUnitCost: 0.10, moq: 600, leadTimeDays: 45,
  });
});

test('rowFormError: every message of the server, add without supplier first', () => {
  assert.equal(rowFormError(form(), true), null);
  assert.equal(rowFormError(form({ supplierId: null }), false), null, 'editing needs no supplier choice');
  assert.equal(rowFormError(form({ supplierId: null }), true), 'Kies een leverancier');
  assert.equal(rowFormError(form({ supplierId: null, exwPrice: null }), true), 'Kies een leverancier');
  assert.equal(rowFormError(form({ exwPrice: null }), false), 'Vul de EXW-prijs in');
  assert.equal(rowFormError(form({ exwPrice: Number.NaN }), false), 'Vul de EXW-prijs in');
  assert.equal(rowFormError(form({ exwPrice: -0.01 }), false), 'EXW-prijs kan niet negatief zijn');
  assert.equal(rowFormError(form({ exwPrice: 0 }), false), null, 'a price of 0 is a price');
  assert.equal(rowFormError(form({ exwCurrency: null }), false), 'Kies de munt');
  assert.equal(rowFormError(form({ extraUnitCost: -1 }), false), 'Extra kost kan niet negatief zijn');
  assert.equal(rowFormError(form({ extraUnitCost: null }), false), null);
  assert.equal(rowFormError(form({ moq: 0 }), false), 'MOQ moet minstens 1 stuk zijn');
  assert.equal(rowFormError(form({ moq: null }), false), null);
  assert.equal(rowFormError(form({ leadTimeDays: -1 }), false), 'Levertijd kan niet negatief zijn');
  assert.equal(rowFormError(form({ leadTimeDays: 0 }), false), null);
  assert.equal(rowFormError(form({ versionLabel: 'x'.repeat(61) }), false), 'Versie mag maximaal 60 tekens hebben');
  assert.equal(rowFormError(form({ versionLabel: ` ${'x'.repeat(60)} ` }), false), null, 'counted after trimming');
  assert.equal(rowFormError(form({ supplierReference: 'r'.repeat(121) }), false),
    'Referentie mag maximaal 120 tekens hebben');
  assert.equal(rowFormError(form({ supplierReference: 'r'.repeat(120) }), false), null);
});

test('rowWrite trims, sends blanks as null, supplierId on add and updatedAt on edit', () => {
  const added = rowWrite(form({ versionLabel: '  B · dikker glas ', supplierReference: '   ', moq: Number.NaN }), null);
  assert.deepEqual(added, {
    supplierId: 5, versionLabel: 'B · dikker glas', supplierReference: null, exwPrice: 2.1, exwCurrency: 'USD',
    extraUnitCost: 0.15, moq: null, leadTimeDays: 45,
  });
  assert.equal('updatedAt' in added, false);
  assert.equal('supplierNote' in added, false, 'the note stays as it is');

  const edited = rowWrite(form({ supplierId: 3, exwPrice: 2.5 }), row());
  assert.deepEqual(edited, {
    versionLabel: 'B', supplierReference: 'CUL-GD-10', exwPrice: 2.5, exwCurrency: 'USD',
    extraUnitCost: 0.15, moq: 600, leadTimeDays: 45, updatedAt: '2026-10-25T19:02:11.123456Z',
  });
  assert.equal('supplierId' in edited, false, 'a PUT never moves the row to another supplier');
});

test('noteWrite: null clears with the row\'s updatedAt; the text goes as typed', () => {
  assert.deepEqual(noteWrite(null, row()), { supplierNote: '', updatedAt: '2026-10-25T19:02:11.123456Z' });
  assert.deepEqual(noteWrite('   ', row()), { supplierNote: '', updatedAt: '2026-10-25T19:02:11.123456Z' });
  assert.deepEqual(noteWrite('- Glass 3 mm\n- gold rim', row({ updatedAt: '2026-10-25T20:00:00Z' })),
    { supplierNote: '- Glass 3 mm\n- gold rim', updatedAt: '2026-10-25T20:00:00Z' });
});

test('mirrorPatch: the five product fields; a null currency reads USD', () => {
  assert.deepEqual(mirrorPatch({ supplierId: 5, supplierNote: 'Glass 3 mm', exwPrice: 2.1, exwCurrency: 'CNY', extraUnitCost: 0.15 }),
    { supplierId: 5, supplierNote: 'Glass 3 mm', exwPrice: 2.1, exwCurrency: 'CNY', extraUnitCost: 0.15 });
  assert.deepEqual(mirrorPatch({ supplierId: 5, supplierNote: null, exwPrice: null, exwCurrency: null, extraUnitCost: null }),
    { supplierId: 5, supplierNote: null, exwPrice: null, exwCurrency: 'USD', extraUnitCost: null });
});

test('agreementSupplierChoices: preferred first, keyed by supplier id, inactive named', () => {
  const choices = agreementSupplierChoices([
    row({ id: 1, supplierId: 7, supplierName: 'Culinan', preferred: false, active: true }),
    row({ id: 2, supplierId: 9, supplierName: 'Aardig', preferred: false, active: false }),
    row({ id: 3, supplierId: 3, supplierName: 'Yiwu Rosegift Trading Co., Ltd', preferred: true, active: true }),
  ]);
  assert.deepEqual(choices, [
    { id: 3, label: 'Yiwu Rosegift Trading Co., Ltd' },
    { id: 7, label: 'Culinan' },
    { id: 9, label: 'Aardig · inactief' },
  ]);
});

test('issueSupplierName: only with two or more suppliers', () => {
  const one = [row({ supplierId: 3, supplierName: 'Yunnan Pubei' })];
  const two = [...one, row({ id: 13, supplierId: 7, supplierName: 'Culinan', preferred: false })];
  assert.equal(issueSupplierName({ supplierId: 3 }, one), null);
  assert.equal(issueSupplierName({ supplierId: 7 }, two), 'Culinan');
  assert.equal(issueSupplierName({ supplierId: 3 }, two), 'Yunnan Pubei');
  assert.equal(issueSupplierName({ supplierId: 99 }, two), null, 'a supplier without a row here');
  assert.equal(issueSupplierName({ supplierId: null }, two), null);
  assert.equal(issueSupplierName({}, two), null, 'an older backend sends no supplier');
});
