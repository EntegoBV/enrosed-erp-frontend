import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import { firstValueFrom, of } from 'rxjs';
import { INVOICE_DECLARATION_LABELS, invoiceDeclarationDraft, invoiceDeclarationPreview, invoiceDeclarationRequest } from '../src/app/features/sales/invoice-declaration-state.ts';
import { isAdvanceDocument, isPartnerDocument } from '../src/app/features/sales/sales-payment-state.ts';
import { messageOf } from '../src/app/core/api/errors.ts';
import type { InvoiceDeclaration, InvoiceDeclarationRequest } from '../src/app/core/api/invoice-declaration-api.ts';

const defaultValue = (): InvoiceDeclaration => ({ mode: 'DEFAULT', reference: null, textVersion: 1 });
const customsText = 'Custom cleared in The Netherlands by our Limited Fiscal Representative: 24/7 Customs BV with VAT-no: NL858617262B02';
const reverseText = '“REVERSE CHARGE”: VAT shifted to Dutch customer according to article 12.3 Dutch VAT-Law.';

test('customs and reverse previews preserve the exact fixed English text and newline layout', () => {
  const value = { mode: 'CUSTOMS_REPRESENTATIVE', reference: null } as const;
  assert.equal(invoiceDeclarationPreview(value, 'Oude tekst'), customsText + '\n' + reverseText);
  assert.equal(invoiceDeclarationPreview({ ...value, reference: '<img src=x onerror=alert(1)> & Café' }, null),
    customsText + '\n' + reverseText + '\nFile reference: <img src=x onerror=alert(1)> & Café.');
  assert.equal(invoiceDeclarationPreview({ mode: 'REVERSE_CHARGE', reference: ' dossier ' }, null), reverseText + '\nFile reference: dossier.');
  assert.equal(invoiceDeclarationPreview(defaultValue(), 'Bestaande wettelijke tekst'), 'Bestaande wettelijke tekst');
  assert.equal(invoiceDeclarationPreview(defaultValue(), null), '');
});

test('request guards keep both explicit modes within the current NL fiscal regime and exact metadata contract', () => {
  const customs: InvoiceDeclarationRequest = { mode: 'CUSTOMS_REPRESENTATIVE', reference: ' dossier 45 ' };
  assert.deepEqual(invoiceDeclarationRequest(customs, true, true), { mode: 'CUSTOMS_REPRESENTATIVE', reference: 'dossier 45' });
  assert.throws(() => invoiceDeclarationRequest(customs, false, true), /voorschotfactuur/);
  assert.throws(() => invoiceDeclarationRequest(customs, true, false), /btwbehandeling/);
  const reverse: InvoiceDeclarationRequest = { mode: 'REVERSE_CHARGE', reference: ' dossier ' };
  assert.throws(() => invoiceDeclarationRequest(reverse, false, false), /btwbehandeling/);
  assert.throws(() => invoiceDeclarationRequest(reverse, true, true), /slotfactuur/);
  assert.deepEqual(invoiceDeclarationRequest(reverse, false, true), { mode: 'REVERSE_CHARGE', reference: 'dossier' });
  assert.deepEqual(invoiceDeclarationRequest({ ...reverse, mode: 'DEFAULT' }, false, false), { mode: 'DEFAULT', reference: null });
  assert.throws(() => invoiceDeclarationRequest({ ...reverse, reference: 'x'.repeat(161) }, false, true), /160/);
  assert.throws(() => invoiceDeclarationRequest({ ...customs, reference: 'x'.repeat(161) }, true, true), /160/);
  assert.throws(() => invoiceDeclarationDraft({ ...defaultValue(), textVersion: 2 } as any), /onbekende versie/);
  assert.throws(() => invoiceDeclarationDraft({ ...defaultValue(), mode: 'UNKNOWN' } as any), /onbekende versie/);
});

const source = await readFile(new URL('../src/app/features/sales/sales-invoice-declaration.ts', import.meta.url), 'utf8');
function isolate(source: string, name: string, members: string[], globals: Record<string, any>) {
  const parsed = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(original);
  const selected = original.members.filter(member => member.name && ts.isIdentifier(member.name) && members.includes(member.name.text));
  assert.equal(selected.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, undefined, undefined, selected);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, ...globals });
  return exports[name];
}

const Component = isolate(source, 'SalesInvoiceDeclaration', ['documentId', 'documentStatus', 'advance', 'fiscalTreatmentAllowed', 'editable', 'displayed', 'preview', 'changed', 'reload', 'load', 'choose', 'patch', 'save', 'ngOnDestroy'], {
  computed, signal, isAdvanceDocument, isPartnerDocument, invoiceDeclarationDraft, invoiceDeclarationPreview, invoiceDeclarationRequest, messageOf, Error,
});
function harness() {
  const screen = new Component(), requests: Array<{ id: number; request: InvoiceDeclarationRequest }> = [], reads: number[] = [], toasts: string[] = [];
  Object.assign(screen, {
    version: 0, view: signal({ order: { id: 60, purpose: 'PARTNER_ADVANCE', docType: 'FACTUUR', status: 'CONCEPT', partnerPurchaseOrderId: 45, countryCode: 'NL' }, priced: { totals: { vatTreatment: 'VERLEGD_FISCAAL_VERTEGENWOORDIGER', vatLegalMention: null, total: 18145.27, vatAmount: 0 } } }),
    dirty: signal(false), saved: signal(null), draft: signal(invoiceDeclarationDraft(defaultValue())), loading: signal(false), saving: signal(false), error: signal(''),
    api: { get: async (id: number) => { reads.push(id); return defaultValue(); },
      save: async (id: number, request: InvoiceDeclarationRequest) => { requests.push({ id, request }); return { ...request, textVersion: 1 }; } },
    ui: { toast: (message: string) => toasts.push(message) },
  });
  return { screen, requests, reads, toasts };
}

test('GET and local choice never save; explicit save persists once and keeps pricing untouched', async () => {
  const { screen, requests, reads, toasts } = harness();
  const before = JSON.stringify(screen.view());
  await screen.load(60);
  assert.deepEqual(reads, [60]); assert.equal(requests.length, 0);
  assert.equal(screen.changed(), false);
  screen.choose('CUSTOMS_REPRESENTATIVE');
  assert.equal(screen.draft().mode, 'CUSTOMS_REPRESENTATIVE');
  assert.equal(requests.length, 0, 'Mode selection is only a local draft');
  screen.patch({ reference: ' PO-45 ' });
  await screen.save();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { id: 60, request: { mode: 'CUSTOMS_REPRESENTATIVE', reference: 'PO-45' } });
  assert.equal(screen.changed(), false); assert.equal(toasts.length, 1);
  assert.equal(JSON.stringify(screen.view()), before, 'The declaration endpoint never mutates invoice, prices, VAT or send status');
  await screen.save(); assert.equal(requests.length, 1, 'An unchanged saved choice is not sent again');
});

test('ordinary documents, issued invoices, unsaved order edits and incompatible reverse charge cannot save', async () => {
  for (const orderChange of [{ purpose: 'STANDARD' }, { docType: 'OFFERTE' }, { status: 'UITGEREIKT' }, { status: 'BETAALD' }, { archivedAt: '2026-09-10T13:00:00Z' }]) {
    const { screen, requests } = harness();
    await screen.load(60); screen.choose('CUSTOMS_REPRESENTATIVE');
    screen.view.update((view: any) => ({ ...view, order: { ...view.order, ...orderChange } }));
    await screen.save(); assert.equal(requests.length, 0);
  }
  const { screen, requests } = harness();
  await screen.load(60); screen.choose('CUSTOMS_REPRESENTATIVE'); screen.dirty.set(true);
  await screen.save(); assert.equal(requests.length, 0);
  screen.dirty.set(false);
  screen.view.update((view: any) => ({ ...view, order: { ...view.order, purpose: 'PARTNER_SETTLEMENT' }, priced: { totals: { ...view.priced.totals, vatTreatment: 'NORMAAL' } } }));
  screen.choose('REVERSE_CHARGE'); assert.notEqual(screen.draft().mode, 'REVERSE_CHARGE');
  screen.view.update((view: any) => ({ ...view, priced: { totals: { ...view.priced.totals, vatTreatment: 'VERLEGD_FISCAAL_VERTEGENWOORDIGER' } } }));
  screen.view.update((view: any) => ({ ...view, order: { ...view.order, countryCode: 'BE' } }));
  screen.choose('REVERSE_CHARGE'); assert.notEqual(screen.draft().mode, 'REVERSE_CHARGE');
  screen.view.update((view: any) => ({ ...view, order: { ...view.order, countryCode: 'NL' } }));
  screen.choose('REVERSE_CHARGE'); await screen.save();
  assert.equal(requests[0].request.mode, 'REVERSE_CHARGE');
  assert.deepEqual(Object.keys(requests[0].request).sort(), ['mode', 'reference']);
});

test('customs selection also requires the current NL fiscal treatment and DEFAULT remains available', async () => {
  for (const countryCode of ['BE', null, 'NL']) {
    const { screen, requests } = harness();
    await screen.load(60);
    screen.view.update((view: any) => ({ ...view, order: { ...view.order, countryCode }, priced: { totals: { ...view.priced.totals, vatTreatment: countryCode === 'NL' ? 'NORMAAL' : 'VERLEGD_FISCAAL_VERTEGENWOORDIGER' } } }));
    screen.choose('CUSTOMS_REPRESENTATIVE');
    assert.equal(screen.draft().mode, 'DEFAULT');
    await screen.save(); assert.equal(requests.length, 0);
  }
});

test('failed load retries, failed save keeps the draft and stale replies never overwrite another invoice', async () => {
  const { screen, requests } = harness();
  screen.api.get = async () => { throw { error: { message: 'Nog niet beschikbaar' } }; };
  await screen.load(60); assert.equal(screen.error(), 'Nog niet beschikbaar');
  screen.api.get = async () => defaultValue();
  await screen.load(60); assert.equal(screen.error(), '');
  screen.choose('CUSTOMS_REPRESENTATIVE');
  screen.api.save = async () => { throw { error: { message: 'Factuur is inmiddels uitgegeven' } }; };
  await screen.save(); assert.equal(screen.error(), 'Factuur is inmiddels uitgegeven');
  assert.equal(screen.draft().mode, 'CUSTOMS_REPRESENTATIVE'); assert.equal(screen.saving(), false);
  let finish!: (value: InvoiceDeclaration) => void;
  screen.api.get = () => new Promise(resolve => { finish = resolve; });
  const pending = screen.load(60);
  screen.view.update((view: any) => ({ ...view, order: { ...view.order, id: 61 } }));
  finish({ mode: 'CUSTOMS_REPRESENTATIVE', reference: null, textVersion: 1 });
  await pending; assert.equal(screen.saved(), null);
  assert.equal(requests.length, 0);
});

test('double clicks and destroyed contexts cannot publish late save results', async () => {
  const { screen, toasts } = harness();
  await screen.load(60); screen.choose('CUSTOMS_REPRESENTATIVE');
  let finish!: (value: InvoiceDeclaration) => void, writes = 0;
  screen.api.save = () => { writes++; return new Promise(resolve => { finish = resolve; }); };
  const first = screen.save(); await screen.save(); assert.equal(writes, 1);
  screen.ngOnDestroy(); finish({ mode: 'CUSTOMS_REPRESENTATIVE', reference: null, textVersion: 1 });
  await first; assert.equal(toasts.length, 0);
  assert.equal(screen.saved().mode, 'DEFAULT');
});

test('declaration API uses only its dedicated GET/PUT endpoints and exact metadata payload', async () => {
  const apiSource = await readFile(new URL('../src/app/core/api/invoice-declaration-api.ts', import.meta.url), 'utf8');
  const Api = isolate(apiSource, 'InvoiceDeclarationApi', ['get', 'save'], { firstValueFrom, api: (path: string) => path });
  const api = new Api(), calls: unknown[] = [];
  api.http = { get: (...args: unknown[]) => { calls.push(['GET', ...args]); return of(defaultValue()); },
    put: (...args: unknown[]) => { calls.push(['PUT', ...args]); return of(defaultValue()); } };
  await api.get(60); await api.save(60, invoiceDeclarationDraft(defaultValue()));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['GET', '/api/sales-orders/60/invoice-declaration'], ['PUT', '/api/sales-orders/60/invoice-declaration', { mode: 'DEFAULT', reference: null, textVersion: 1 }]]);
});

test('declaration template parses and renders preview with text interpolation', () => {
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1];
  assert.ok(template); assert.equal(parseTemplate(template, 'invoice-declaration.html').errors, null);
  assert.match(template, /<p>\{\{ preview\(\) \}\}<\/p>/);
  assert.doesNotMatch(template, /innerHTML|logisticsProvider|IMPORT_ARTICLE_23|ESTA|Artikel 23/);
  assert.match(template, /Inklaring via 24\/7 Customs \(Engels\)/);
  assert.match(template, /Reverse charge \(Engels\)/);
});
