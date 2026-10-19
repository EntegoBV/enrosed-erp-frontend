import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import type { PurchaseInvoice, PurchaseInvoiceFile, PurchaseOrderView, PurchasePaymentRow } from '../src/app/core/api/models.ts';
import { invoiceCoverage, invoiceDocumentKind, invoiceFileText, invoiceLine, payeeInvoices, viaSupplier } from '../src/app/features/purchasing/purchase-invoices.ts';
import { containerName } from '../src/app/features/purchasing/container-name.ts';

/*
 * The transaction detail's "Factuur" (Emre, 2026-10-19): every linked part with its invoice, the PI and the CI without
 * data shown, no "Nog geen factuur" for Bijkomende kosten, the inspection via the supplier under the supplier's invoice,
 * and Inkoop's invoice sheet hosted on the transaction. The members run isolated from the real class (its base and
 * imports stripped); the module's word constants stay, the invoice words are the real purchase-invoices.ts.
 */
const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const source = await read('../src/app/features/finance/transaction-detail.ts');
const MEMBERS = ['invoiceBlocks', 'invoicing', 'invoiceBusy', 'invoicingView', 'invoicingAgreed', 'addInvoice', 'fillInvoice', 'editInvoice', 'openInvoiceFile', 'closeInvoice', 'submitInvoice'];
const Detail = (() => {
  const parsed = ts.createSourceFile('transaction-detail.ts', source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'TransactionDetail')!;
  const kept = cls.members.filter((member) => member.name && MEMBERS.includes(member.name.getText(parsed)));
  assert.equal(kept.length, MEMBERS.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter((m) => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const words = parsed.statements.filter((node) => ts.isVariableStatement(node));
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [...words, isolated])),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, computed, signal, Intl, invoiceCoverage, invoiceDocumentKind, invoiceFileText, invoiceLine, payeeInvoices, viaSupplier, containerName,
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback });
  return exports.TransactionDetail;
})();

/** The members' objects come from the vm's realm: compared by value. */
const same = (actual: unknown, expected: unknown, message?: string) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const plain = (text: string | null | undefined) => text == null ? text : text.replace(/[\u00a0\u202f]/g, ' ');
const LINE = { id: 2, amountEur: -20289.56, salesOrderId: null };
const piFile: PurchaseInvoiceFile = { documentId: 1, kind: 'PROFORMA_INVOICE', label: 'PI', originalFilename: 'PI CULINAN.xlsx', paymentId: null, payee: 'SUPPLIER' };
const ciFile: PurchaseInvoiceFile = { documentId: 4, kind: 'COMMERCIAL_INVOICE', label: null, originalFilename: 'COMMERCILA INVOICE.pdf', paymentId: null, payee: 'SUPPLIER' };
function invoice(id: number, values: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return { id, orderId: 39, payee: 'SUPPLIER', payeeLabel: 'Leverancier', number: 'CI-2026-118', invoiceDate: '2026-08-20', amount: 31048.04, currency: 'EUR',
    amountEur: 31048.04, documentId: 88, documentName: 'CI-2026-118.pdf', notes: null, actor: 'Emre', recordedAt: '2026-08-21T08:10:00Z', primary: true,
    coversInspection: false, paymentIds: [3], paidEur: 0, ...values };
}
function view(values: Partial<PurchaseOrderView> & { flag?: boolean } = {}): PurchaseOrderView {
  const { flag, ...rest } = values;
  return { order: { id: 39, number: 'PO-2026-005', alias: null, inspectionViaSupplier: !!flag, inspectionCostEur: 300, usdToEurGoods: 0.9, usdToEurTransport: 0.9, cnyToUsd: 0.14 },
    reconciliation: { streams: [{ payee: 'SUPPLIER', plannedEur: 50723.9 }, { payee: 'SEPARATE', plannedEur: 300 }, { payee: 'OTHER', plannedEur: 0 }] },
    invoices: [], invoiceFiles: [], ...rest } as unknown as PurchaseOrderView;
}
const pay = (id: number, payee: PurchasePaymentRow['payee'], line: number | null = LINE.id) =>
  ({ id, orderId: 39, orderNumber: 'PO-2026-005', payee, amountEur: 100, bankStatementLineId: line }) as unknown as PurchasePaymentRow;

function detail(options: { payments?: PurchasePaymentRow[]; views?: PurchaseOrderView[]; costs?: unknown[]; attachments?: Record<number, unknown[]>; picked?: unknown[] } = {}) {
  const calls: unknown[][] = [], toasts: string[] = [];
  let failInvoice = false;
  const instance = new Detail();
  Object.assign(instance, {
    line: () => LINE,
    linkedPurchases: () => (options.payments ?? []).filter((payment) => payment.bankStatementLineId === LINE.id),
    state: {
      salesOrders: () => [], purchaseViews: () => options.views ?? [view()], costs: () => options.costs ?? [], containerTree: () => [],
      attachmentsFor: (id: number) => options.attachments?.[id] ?? [],
      pickFiles: async () => options.picked ?? [], attach: async (id: number, files: unknown[]) => { calls.push(['attach', id, files]); },
      openAttachment: async (asset: unknown) => { calls.push(['openAttachment', asset]); },
      openPurchaseFile: async (...args: unknown[]) => { calls.push(['openPurchaseFile', ...args]); },
      reload: async (sources: string[]) => { calls.push(['reload', sources]); },
    },
    purchases: {
      addDocument: async (...args: unknown[]) => { calls.push(['addDocument', ...args]); return { id: 501, originalFilename: 'CI-2026-118.pdf' }; },
      addInvoice: async (...args: unknown[]) => { calls.push(['addInvoice', ...args]); if (failInvoice) throw new Error('Factuurnummer bestaat al'); return {}; },
      updateInvoice: async (...args: unknown[]) => { calls.push(['updateInvoice', ...args]); return {}; },
    },
    ui: { toast: (message: string, tone?: string) => toasts.push(tone === 'err' ? `err: ${message}` : message) },
  });
  return { instance, calls, toasts, failNext: (fail: boolean) => { failInvoice = fail; } };
}
const shape = (blocks: any[]) => blocks.map((block) => ({ title: block.title, rows: block.rows.map((row: any) => [plain(row.text), plain(row.coverage), !!row.file, !!row.fill]),
  missing: block.missing, add: block.add }));

test("PO-2026-005: the PI and the CI without data show under Factuur with 'Bestand ↗' and 'Gegevens invullen', not 'Nog geen factuur'", () => {
  const { instance } = detail({ payments: [pay(3, 'SUPPLIER')], views: [view({ invoiceFiles: [piFile, ciFile] })] });
  same(shape(instance.invoiceBlocks()), [{ title: null, missing: null, add: { orderId: 39, payee: 'SUPPLIER' }, rows: [
    ['Proforma (PI) · PI CULINAN.xlsx', null, true, true], ['COMMERCILA INVOICE.pdf · zonder gegevens', null, true, true]] }]);
  const none = detail({ payments: [pay(3, 'SUPPLIER')] }).instance;
  same(shape(none.invoiceBlocks()).map((block) => [block.rows, block.missing]), [[[], 'Nog geen factuur']]);
  const invoiced = detail({ payments: [pay(3, 'SUPPLIER')], views: [view({ invoices: [invoice(7), invoice(9, { number: 'CI-2026-131', documentId: null })] })] }).instance;
  same(shape(invoiced.invoiceBlocks())[0].rows, [
    ['Factuur CI-2026-118 · 20/08/2026 · € 31.048,04', 'Geldt voor alle betalingen van Leverancier', true, false],
    ['Factuur CI-2026-131 · 20/08/2026 · € 31.048,04', 'extra factuur', false, false]]);
});

test("Transactiekosten (Bijkomende kosten) never read 'Nog geen factuur'; an invoice can still be added", () => {
  const { instance } = detail({ payments: [pay(5, 'OTHER')] });
  same(shape(instance.invoiceBlocks()), [{ title: null, rows: [], missing: null, add: { orderId: 39, payee: 'OTHER' } }]);
});

test("an inspection is via the supplier only beside the goods on the same line, and then not shown twice; in its own transfer it keeps its own invoice", () => {
  const supplierInvoice = invoice(7);
  // Review 2026-10-20: with the flag on, a lab fee on its own line showed the supplier's invoice and added the lab's as a second CI.
  const alone = detail({ payments: [pay(6, 'SEPARATE')], views: [view({ flag: true, invoices: [supplierInvoice] })] }).instance;
  same(shape(alone.invoiceBlocks()), [{ title: null, rows: [], missing: 'Nog geen factuur', add: { orderId: 39, payee: 'SEPARATE' } }]);
  const covers = detail({ payments: [pay(6, 'SEPARATE')], views: [view({ invoices: [invoice(7, { coversInspection: true })] })] }).instance;
  same(shape(covers.invoiceBlocks()).map((block) => [block.missing, block.add]), [['Nog geen factuur', { orderId: 39, payee: 'SEPARATE' }]], 'as the server resolves it: no invoice');
  const ownFile = detail({ payments: [pay(6, 'SEPARATE')], views: [view({ flag: true, invoices: [supplierInvoice],
    invoiceFiles: [{ ...piFile, documentId: 9, kind: 'INVOICE', originalFilename: 'lab.pdf', payee: 'SEPARATE' }] })] }).instance;
  same(shape(ownFile.invoiceBlocks())[0].rows, [['lab.pdf · zonder gegevens', null, true, true]], 'its own file, never the supplier\'s');
  const both = detail({ payments: [pay(3, 'SUPPLIER'), pay(6, 'SEPARATE')], views: [view({ flag: true, invoices: [supplierInvoice] })] }).instance;
  same(both.invoiceBlocks().map((block: any) => block.key), ['p39:SUPPLIER']);
  const lab = detail({ payments: [pay(6, 'SEPARATE')], views: [view({ invoices: [supplierInvoice] })] }).instance;
  same(shape(lab.invoiceBlocks()).map((block) => [block.rows, block.missing, block.add]), [[[], 'Nog geen factuur', { orderId: 39, payee: 'SEPARATE' }]],
    'a lab fee paid apart has its own invoice');
});

test('several parts each get their own block with a name; a cost lists its documents or says it has none', () => {
  const asset = { id: 61, name: 'factuur-proximus.pdf', originalFilename: 'scan_0001.pdf' };
  const costs = [{ id: 5, description: 'Telefoon', payments: [{ id: 80, bankStatementLineId: LINE.id }] }, { id: 6, description: 'Ander', bankStatementLineId: 99, payments: [] },
    { id: 7, description: 'Bankkosten', bankStatementLineId: LINE.id, payments: [] }];
  const { instance } = detail({ payments: [pay(3, 'SUPPLIER'), pay(5, 'OTHER')], views: [view({ invoiceFiles: [piFile] })], costs, attachments: { 5: [asset] } });
  same(shape(instance.invoiceBlocks()).map((block) => [block.title, block.rows.map((row: any) => row[0]), block.missing]), [
    ['PO-2026-005 · Leverancier', ['Proforma (PI) · PI CULINAN.xlsx'], null],
    ['PO-2026-005 · Bijkomende kosten', [], null],
    ['Kost · Telefoon', ['factuur-proximus.pdf'], null],
    ['Kost · Bankkosten', [], 'Nog geen factuur of bon'],
  ]);
});

test("'Factuur toevoegen…' opens the invoice sheet for a container payee, the file dialog for a cost; 'Bestand ↗' opens the right file", async () => {
  const picked = [{ name: 'bon.jpg' }];
  const { instance, calls } = detail({ payments: [pay(3, 'SUPPLIER')], views: [view({ invoiceFiles: [piFile] })], costs: [{ id: 7, description: 'Bankkosten', bankStatementLineId: LINE.id }], picked });
  const [container, cost] = instance.invoiceBlocks();
  instance.addInvoice(container);
  same(instance.invoicing(), { orderId: 39, action: { payee: 'SUPPLIER' } });
  instance.closeInvoice(); assert.equal(instance.invoicing(), null);
  instance.addInvoice(cost); await new Promise((resolve) => setImmediate(resolve));
  same(calls.at(-1), ['attach', 7, picked]);
  instance.openInvoiceFile(container.rows[0]);
  same(calls.at(-1), ['openPurchaseFile', 39, 1, 'PI CULINAN.xlsx']);
  instance.openInvoiceFile({ file: { asset: { id: 61 } } });
  same(calls.at(-1), ['openAttachment', { id: 61 }]);
  same(instance.invoicingAgreed(), {}, 'nothing open');
  instance.fillInvoice(container.rows[0].fill);
  same(instance.invoicing(), { orderId: 39, action: { payee: 'SUPPLIER', file: piFile } });
  same(instance.invoicingAgreed(), { SUPPLIER: 50723.9, SEPARATE: 300, OTHER: null }, 'Bijkomende kosten have no Afspraak');
});

test("'Gegevens invullen' on the PI makes it the invoice with its own file; a new file goes up once as the payee's kind, also on a retry", async () => {
  const body = { payee: 'SUPPLIER', number: 'PI-0513', invoiceDate: '2026-05-13', amount: 56360, currency: 'USD', amountEur: null, documentId: 1, notes: null };
  const fill = detail({ views: [view({ invoiceFiles: [piFile] })] });
  fill.instance.fillInvoice({ orderId: 39, file: piFile });
  await fill.instance.submitInvoice({ invoiceId: null, body, file: null });
  same(fill.calls, [['addInvoice', 39, body], ['reload', ['containers']]], 'no upload: the PI is its file');
  same([fill.instance.invoicing(), fill.toasts], [null, ['Factuur bewaard']]);

  const fresh = detail();
  const file = { name: 'CI-2026-118.pdf' };
  fresh.instance.addInvoice({ add: { orderId: 39, payee: 'SUPPLIER' } });
  fresh.failNext(true);
  await fresh.instance.submitInvoice({ invoiceId: null, body: { ...body, documentId: null }, file });
  same(fresh.calls.slice(0, 2), [['addDocument', 39, file, 'COMMERCIAL_INVOICE', null, null], ['addInvoice', 39, { ...body, documentId: 501 }]]);
  same([fresh.toasts, fresh.instance.invoicing()?.action.documentId], [['err: Factuurnummer bestaat al'], 501], 'the sheet stays, the uploaded file is kept');
  fresh.failNext(false);
  await fresh.instance.submitInvoice({ invoiceId: null, body: { ...body, documentId: 501 }, file: null });
  assert.equal(fresh.calls.filter((call) => call[0] === 'addDocument').length, 1, 'never uploaded twice');
  assert.equal(fresh.instance.invoicing(), null);
});

test("'Aanpassen' on an invoice with data opens the sheet on that invoice and saves it in place (the CI corrects the PI)", async () => {
  // Review 2026-10-20: 'Factuur toevoegen…' was the only way and added the CI as a second supplier invoice.
  const pi = invoice(7, { number: 'PI-0513', amount: 56360, currency: 'USD', amountEur: 50723.9, documentId: 1, documentName: 'PI CULINAN.xlsx' });
  const { instance, calls } = detail({ payments: [pay(3, 'SUPPLIER')], views: [view({ invoices: [pi] })] });
  const [block] = instance.invoiceBlocks();
  same(block.rows[0].edit, { orderId: 39, invoice: JSON.parse(JSON.stringify(pi)) });
  instance.editInvoice(block.rows[0].edit);
  same(instance.invoicing(), { orderId: 39, action: { payee: 'SUPPLIER', invoice: JSON.parse(JSON.stringify(pi)) } });
  const body = { payee: 'SUPPLIER', number: 'CI-2026-118', invoiceDate: '2026-08-20', amount: 56360, currency: 'USD', amountEur: null, documentId: 1, notes: null };
  await instance.submitInvoice({ invoiceId: 7, body, file: null });
  same(calls, [['updateInvoice', 39, 7, body], ['reload', ['containers']]], 'PUT on the PI, never a second invoice');
  const template = source.slice(source.indexOf('@if (invoiceBlocks().length) {'), source.indexOf("@if (linkedOrder(); as view) {"));
  assert.match(template, /@if \(invoice\.edit; as edit\) \{ <button class="wk-link" type="button" \[disabled\]="invoiceBusy\(\)" \(click\)="editInvoice\(edit\)">Aanpassen<\/button> \}/);
});

test('templates: the Factuur blocks with their actions and the hosted sheet; "Zelf opladen…" on the first tab, the third tab Peppol / Odoo only', async () => {
  const factuur = source.slice(source.indexOf('@if (invoiceBlocks().length) {'), source.indexOf("@if (linkedOrder(); as view) {"));
  assert.match(factuur, /@for \(block of invoiceBlocks\(\); track block\.key\)/);
  assert.match(factuur, /\(click\)="openInvoiceFile\(invoice\)">Bestand ↗<\/button>/);
  assert.match(factuur, /\(click\)="fillInvoice\(fill\)">Gegevens invullen<\/button>/);
  assert.match(factuur, /\(click\)="addInvoice\(block\)">Factuur toevoegen…<\/button>/);
  assert.equal(source.includes('Nog geen factuur bij deze container'), false, "per payee: 'Nog geen factuur' only where one is expected");
  assert.match(source, /<app-purchase-invoice-sheet \[action\]="open\.action"[^>]*\(submit\)="submitInvoice\(\$event\)"/);

  const steps = await read('../src/app/features/finance/bank-allocation-steps.ts');
  const documents = steps.slice(steps.indexOf("@if (p.allocationStep() === 'documents' || only() === 'preview') {"), steps.indexOf('<label class="bank-alloc-search"><span>Zoek in ENROSED</span>'));
  assert.match(documents, /@if \(row\.amountEur < 0\) \{/, 'outgoing lines only');
  assert.match(documents, /<b>Zelf opladen<\/b><p>Factuur of bon, buiten Peppol<\/p><\/div><button [^>]*\(click\)="p\.uploadOwnInvoice\(\)">Zelf opladen…<\/button>/);
  assert.match(steps, /\(click\)="p\.setAllocationStep\('new'\)">Peppol \/ Odoo<\/button>\n\s*<\/div>/);
  for (const gone of ['Nog te registreren', 'Uitgave registreren', 'Factuur of bon zelf registreren', 'newCostFromBank']) assert.equal(steps.includes(gone), false, gone);
});

test("the PI is an upload choice wherever a container document goes up; the desk drops 'Nog geen factuur' when a file is there", async () => {
  assert.match(await read('../src/app/features/purchasing/purchase-editor.ts'), /\{ value: 'PROFORMA_INVOICE', label: 'Proforma \(PI\)' \}/);
  assert.match(await read('../src/app/features/files/files-upload-tray.ts'), /<option value="PROFORMA_INVOICE">Proforma \(PI\)<\/option>/);
  assert.match(await read('../src/app/features/files/files-link-picker.ts'), /\{ value: 'PROFORMA_INVOICE', label: 'Proforma \(PI\)' \}/);
  const workbench = await read('../src/app/features/purchasing/purchase-payment-workbench.ts');
  assert.match(workbench, /@if \(item\.payee === 'SUPPLIER' && roundOnServer\(\) && !item\.invoiceFiles\.length\) \{/);
  assert.match(workbench, /<span class="pw-invoice__text">\{\{ fileText\(file\) \}\}<\/span>/);
  assert.match(await read('../src/app/features/purchasing/purchase-payee-sheet.ts'), /<span class="ios-cell__sub">\{\{ fileKind\(file\) \}\}<\/span>/);
  // Review 2026-10-20: the phone's payment overview agrees with the desk.
  const phone = await read('../src/app/features/purchasing/purchase-payment-overview.ts');
  const supplier = phone.slice(phone.indexOf('@if (supplierInvoice(item); as invoice) {'), phone.indexOf('<span class="ios-cell__title">Nog geen factuur</span>'));
  assert.match(supplier, /\} @else if \(item\.invoiceFiles\[0\]; as file\) \{/, "a file on hand comes before 'Nog geen factuur'");
  assert.match(supplier, /<span class="ios-cell__title">\{\{ fileKind\(file\) \}\}<\/span>/);
  assert.match(phone, /<span class="ios-cell__title">\{\{ fileText\(document\) \}\}<\/span>/);
  assert.equal(phone.includes('}} · zonder gegevens'), false);
});
