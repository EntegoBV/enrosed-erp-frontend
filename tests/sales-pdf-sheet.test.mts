import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { normalizePackingSlipPdfOptions, normalizeSalesPdfOptions, salesPdfQuery } from '../src/app/core/api/sales-pdf-options.ts';

// Exercise the production settings and download methods without HTTP, files or mail.
const source = await readFile(new URL('../src/app/features/sales/sales-pdf-sheet.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('sales-pdf-sheet.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'SalesPdfSheet');
assert.ok(original);
const names = ['documentOptions', 'packingOptions', 'documentOptionCount', 'ngOnInit', 'patchDocument', 'patchPacking',
  'open', 'back', 'downloadSelected', 'downloadDocument', 'downloadPackingSlip', 'safeFilename'];
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
assert.equal(members.length, names.length);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(invoice = false) {
  const requests: { kind: string; id: number; options: any }[] = [];
  const saved: string[] = [];
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, {
    exports, computed, signal, normalizeSalesPdfOptions, normalizePackingSlipPdfOptions,
    saveBlob: (_blob: unknown, filename: string) => saved.push(filename), messageOf: () => 'Error',
  });
  const sheet = new exports['SalesPdfSheet']();
  Object.assign(sheet, {
    customerLanguage: () => 'NL', orderNumber: () => 'DOC-71', customerName: () => 'Test partner', orderId: () => 71,
    invoice: () => invoice, dirty: signal(false), busy: () => sheet.documentBusy() || sheet.packingBusy(),
    initialChoice: () => 'DOCUMENT', choice: signal(null), filename: signal(''),
    documentBusy: signal(false), packingBusy: signal(false), error: signal(null),
    closed: { emit() {} }, ui: { toast() {} }, sales: {
      quotePdf: async (id: number, options: any) => { requests.push({ kind: 'document', id, options: { ...options } }); return {}; },
      packingSlip: async (id: number, options: any) => { requests.push({ kind: 'packing', id, options: { ...options } }); return {}; },
    },
  });
  sheet.ngOnInit();
  return { sheet, requests, saved };
}

for (const invoice of [false, true]) {
  test(`${invoice ? 'invoice' : 'quote'} retains hidden payment details through language, other options and back navigation`, async () => {
    const { sheet, requests, saved } = harness(invoice);
    assert.equal(sheet.documentOptions().includePaymentDetails, true);
    assert.equal(sheet.documentOptionCount(), 5);
    sheet.patchDocument({ includePaymentDetails: false });
    assert.equal(sheet.documentOptionCount(), 4);
    sheet.patchDocument({ language: 'EN', includeTerms: true, showBarcode: true });
    sheet.back();
    sheet.open('PACKING_SLIP');
    sheet.back();
    sheet.open('DOCUMENT');
    assert.equal(sheet.documentOptions().includePaymentDetails, false);
    assert.equal(sheet.documentOptions().includeTerms, true);
    await sheet.downloadSelected();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, 'document');
    assert.equal(requests[0].id, 71);
    const query = new URLSearchParams(salesPdfQuery(requests[0].options));
    assert.equal(query.get('language'), 'EN');
    assert.equal(query.get('includePaymentDetails'), 'false');
    assert.equal(query.get('includeTerms'), 'true');
    assert.equal(saved.length, 1);
  });
}

test('payment detail settings never enter a price-free packing slip request', async () => {
  const { sheet, requests } = harness(true);
  sheet.patchDocument({ includePaymentDetails: false });
  sheet.open('PACKING_SLIP');
  sheet.patchPacking({ showOuterCarton: true });
  await sheet.downloadSelected();
  assert.deepEqual(requests, [{ kind: 'packing', id: 71, options: { showOuterCarton: true, showBarcode: false } }]);
});

test('re-enabling details is explicit and a new export starts with the existing full-document default', () => {
  const { sheet } = harness();
  sheet.patchDocument({ includePaymentDetails: false });
  sheet.patchDocument({ includePaymentDetails: true });
  assert.equal(new URLSearchParams(salesPdfQuery(sheet.documentOptions())).get('includePaymentDetails'), 'true');
  sheet.patchDocument({ includePaymentDetails: false });
  assert.equal(harness().sheet.documentOptions().includePaymentDetails, true);
});
