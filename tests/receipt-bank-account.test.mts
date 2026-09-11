import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import { companyReceiptAccount, receiptAccountChoices, receiptAccountValue } from '../src/app/features/sales/receipt-bank-account.ts';
import { receiptLocalParts, receiptRequest } from '../src/app/shared/received-at.ts';
import { salesAllProductsUnavailable } from '../src/app/features/sales/sales-line-availability.ts';
import { messageOf } from '../src/app/core/api/errors.ts';

const profile = { name: 'Enrosed', legalName: 'Enrosed BV', iban: 'BE94\u00a07310\u00a07408\u00a02814', bic: 'KREDBEBB' };
const account = companyReceiptAccount(profile)!;
const source = await readFile(new URL('../src/app/features/sales/sales-receipts.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('sales-receipts.ts', source, ts.ScriptTarget.Latest, true);
const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'SalesReceipts'); assert.ok(cls);
const names = ['configuredAccount', 'originalAccount', 'accountLoading', 'accountError', 'accountChoices', 'selectedAccount', 'accountReady', 'draftVersion', 'accountRequestVersion', 'draftOrderId', 'accountTouched', 'destroyed', 'beginDraft', 'clearDraft', 'loadBankAccount', 'selectAccount', 'add', 'refund', 'edit', 'patch', 'close', 'issue', 'save', 'ngOnDestroy'];
const members = cls.members.filter(m => m.name && names.includes(m.name.getText(parsed))); assert.equal(members.length, names.length);
const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports: any = {}; vm.runInNewContext(js, { exports, computed, signal, companyReceiptAccount, receiptAccountChoices, receiptAccountValue, receiptLocalParts, receiptRequest, messageOf, salesAllProductsUnavailable, Date });
const Component = exports.SalesReceipts;
const payment = (bankAccount: string | null) => ({ id: 7, bankAccount, amountEur: 333.33, receivedAt: '2026-09-08T08:30:00Z', timeZone: 'Europe/Brussels', reference: 'Betaling 1' });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('all-unavailable concepts cannot be issued or open a new receipt, even when freight creates a total', async () => {
  const { component, calls, emitted } = harness();
  component.view.set({ ...component.view(), order: { ...component.view().order, status: 'CONCEPT', lines: [
    { id: 1, productId: 7, quantity: 0, unavailable: true, requestedQuantity: 48 },
  ] } });
  await component.issue();
  assert.equal(calls.length, 0); assert.equal(emitted.length, 0); assert.equal(component.draft(), null);
});
function harness(company: () => Promise<any> = async () => profile) {
  const component = new Component(), calls: any[] = [], emitted: any[] = [];
  const view = { order: { id: 65, status: 'UITGEREIKT' }, paymentSummary: { invoiceTotalEur: 500, remainingEur: 333.33, refundableEur: 100 } };
  Object.assign(component, { view: signal(view), summary: () => component.view().paymentSummary, canRecord: () => true, canRefund: () => true,
    dirty: signal(false), busy: signal(false), draft: signal(null), error: signal(''),
    changed: { emit: (fresh: any) => { emitted.push(fresh); component.view.set(fresh); } }, ui: { toast() {} },
    sales: { company: async () => { calls.push({ method: 'GET company' }); return company(); },
      addPayment: async (id: number, body: any) => { calls.push({ method: 'POST payment', id, body }); return component.view(); },
      updatePayment: async (id: number, paymentId: number, body: any) => { calls.push({ method: 'PUT payment', id, paymentId, body }); return component.view(); },
      issueInvoice: async (id: number) => { calls.push({ method: 'POST issue', id }); return view; },
    },
  });
  return { component, calls, emitted };
}

test('configured company IBAN normalizes spaces including NBSP, while its display retains owner and confirmed bank', () => {
  assert.deepEqual(account, { value: 'BE94731074082814', label: 'Enrosed BV · KBC · BE94 7310 7408 2814' });
  assert.equal(companyReceiptAccount({ ...profile, legalName: '', bic: 'OTHERBIC', iban: 'be94 7310 7408 2814' })?.label, 'Enrosed · OTHERBIC · BE94 7310 7408 2814');
  assert.equal(companyReceiptAccount({ ...profile, iban: '' }), null);
  assert.equal(companyReceiptAccount({ ...profile, iban: 'KBC ZICHTREKENING' }), null);
  assert.equal(companyReceiptAccount({ ...profile, iban: 'NL91 ABNA 0417 1643 00', bic: 'ABNANL2A' })?.value, 'NL91ABNA0417164300', 'Configured values are used without a hardcoded ENROSED IBAN');
});

test('a new receipt waits for configuration and saves only canonical IBAN with original amount and timestamp validation', async () => {
  let finish!: (value: any) => void;
  const { component, calls } = harness(() => new Promise(resolve => { finish = resolve; })); component.add(333.33);
  assert.equal(component.accountLoading(), true); assert.equal(component.accountReady(), false);
  await component.save(); assert.deepEqual(calls.map(c => c.method), ['GET company']);
  assert.match(component.error(), /Kies een beschikbare bankrekening/);
  component.patch({ amount: 333.33, reference: 'Getypt tijdens laden' });
  finish(profile); await tick();
  assert.equal(component.draft().reference, 'Getypt tijdens laden'); assert.equal(component.draft().amount, 333.33);
  assert.equal(component.draft().bankAccount, account.value); assert.equal(component.accountReady(), true);
  component.patch({ day: '2026-09-08', time: '10:30', reference: '  Voorschot  ' }); await component.save();
  const body = calls.find(c => c.method === 'POST payment').body;
  assert.equal(body.bankAccount, account.value); assert.equal(body.amountEur, 333.33); assert.equal(body.receivedAt, '2026-09-08T08:30:00.000Z');
  assert.equal(body.reference, 'Voorschot'); assert.equal(body.direction, 'RECEIPT');
});

test('refunds and issue-and-record use the same configured default without adding an automatic receipt', async () => {
  const refund = harness(); refund.component.refund(); await tick();
  assert.equal(refund.component.draft().direction, 'REFUND'); assert.equal(refund.component.draft().amount, 100);
  assert.equal(refund.component.draft().bankAccount, account.value); await refund.component.save();
  assert.equal(refund.calls.find(c => c.method === 'POST payment').body.direction, 'REFUND');
  const issued = harness(); await issued.component.issue(); await tick();
  assert.equal(issued.component.draft().bankAccount, account.value); assert.equal(issued.component.draft().amount, 333.33);
  assert.deepEqual(issued.calls.map(c => c.method), ['POST issue', 'GET company']);
  assert.equal(issued.emitted.length, 1);
});

test('editing preserves historical names, old IBAN formatting and null until explicitly selecting the configured account', async () => {
  for (const historical of ['KBC ZICHTREKENING', 'BE94 7310 7408 2814', 'OUDE REKENING', null]) {
    const { component, calls } = harness(); component.edit(payment(historical)); await tick();
    assert.equal(component.draft().bankAccount, historical ?? ''); assert.equal(component.accountReady(), true);
    assert.ok(component.accountChoices().some((choice: any) => choice.value === (historical ?? '')));
    component.patch({ reference: 'Gecorrigeerde mededeling' }); await component.save();
    assert.equal(calls.find(c => c.method === 'PUT payment').body.bankAccount, historical);
  }
  const { component, calls } = harness(); component.edit(payment('KBC ZICHTREKENING')); await tick();
  component.selectAccount(account.value); await component.save();
  assert.equal(calls.find(c => c.method === 'PUT payment').body.bankAccount, account.value);
});

test('failed or missing configuration blocks new receipts, supports retry and leaves historical corrections available', async () => {
  const { component, calls } = harness(async () => { throw { status: 503, error: { message: 'Bedrijfsgegevens tijdelijk niet beschikbaar' } }; });
  component.add(); await tick(); assert.equal(component.accountReady(), false); assert.match(component.accountError(), /tijdelijk niet beschikbaar/);
  await component.save(); assert.equal(calls.some(c => c.method.startsWith('POST')), false);
  component.sales.company = async () => ({ ...profile, iban: '' }); await component.loadBankAccount();
  assert.match(component.accountError(), /geen bruikbare IBAN/); assert.equal(component.accountReady(), false);
  component.sales.company = async () => profile; await component.loadBankAccount(); assert.equal(component.accountReady(), true);
  for (const historical of [null, 'KBC ZICHTREKENING']) {
    const old = harness(async () => { throw { status: 0 }; }); old.component.edit(payment(historical)); await tick();
    assert.equal(old.component.accountReady(), true); await old.component.save();
    assert.equal(old.calls.find(c => c.method === 'PUT payment').body.bankAccount, historical);
  }
});

test('an explicit existing selection is not overwritten by an asynchronous company reload', async () => {
  const { component } = harness(); component.edit(payment('KBC ZICHTREKENING')); await tick();
  component.selectAccount(account.value);
  let finish!: (value: any) => void; component.sales.company = () => new Promise(resolve => { finish = resolve; });
  const pending = component.loadBankAccount(); component.selectAccount('KBC ZICHTREKENING'); finish(profile); await pending;
  assert.equal(component.draft().bankAccount, 'KBC ZICHTREKENING');
  component.close(); component.add(); finish(profile); await tick();
  component.selectAccount(account.value); const next = component.loadBankAccount(); finish(profile); await next;
  assert.equal(component.draft().bankAccount, account.value);
});

test('stale company responses never overwrite a different draft or reopen a closed one', async () => {
  const finishes: ((value: any) => void)[] = [];
  const { component } = harness(() => new Promise(resolve => { finishes.push(resolve); }));
  component.add(10); component.edit(payment('KBC ZICHTREKENING'));
  finishes[0](profile); await tick(); assert.equal(component.draft().id, 7); assert.equal(component.draft().bankAccount, 'KBC ZICHTREKENING');
  assert.equal(component.accountLoading(), true, 'An old response cannot finish the newer loading state');
  finishes[1](profile); await tick(); assert.equal(component.draft().bankAccount, 'KBC ZICHTREKENING');
  component.close(); component.add(50); component.close(); finishes[2](profile); await tick(); assert.equal(component.draft(), null);
});

test('route changes and destruction prevent pending configuration from attaching to another invoice', async () => {
  for (const destroy of [false, true]) {
    let finish!: (value: any) => void;
    const { component } = harness(() => new Promise(resolve => { finish = resolve; })); component.add(20);
    if (destroy) component.ngOnDestroy(); else component.view.set({ ...component.view(), order: { id: 99 } });
    finish(profile); await tick(); assert.equal(component.configuredAccount(), null);
    assert.equal(component.draft()?.bankAccount ?? '', '');
    if (destroy) assert.equal(component.draft(), null);
  }
});

test('selection accepts only configured or retained historical options and never free text', async () => {
  const { component } = harness(); component.add(); await tick(); component.selectAccount('arbitrary new bank');
  assert.equal(component.draft().bankAccount, account.value);
  assert.throws(() => receiptAccountValue('arbitrary new bank', account, null), /Kies een beschikbare/);
  assert.throws(() => receiptAccountValue('', account, null), /Kies een beschikbare/);
  assert.deepEqual(receiptAccountChoices(account, account.value), [account]);
  assert.equal(receiptAccountValue('', account, ''), null);
});

test('receipt validation still rejects future timestamps and sub-cent amounts before writing', async () => {
  const { component, calls } = harness(); component.add(); await tick();
  component.patch({ amount: 0.001 }); await component.save(); assert.match(component.error(), /maximaal twee decimalen/);
  component.patch({ amount: 10, day: '2099-01-01', time: '12:00' }); await component.save(); assert.match(component.error(), /toekomst/);
  assert.equal(calls.some(c => c.method === 'POST payment'), false);
});

test('template provides labelled select, loading/error/retry, wrapped mobile account and no manual account input', () => {
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1]; assert.ok(template);
  assert.equal(parseTemplate(template, 'sales-receipts.html').errors, null);
  assert.match(template, /label for="receipt-bank-account"/); assert.match(template, /select[^>]*id="receipt-bank-account"/);
  assert.match(template, /Opnieuw laden/); assert.match(template, /receipts__account-selected/);
  assert.doesNotMatch(template, /<input[^>]*draft.bankAccount/);
  assert.match(template, /disabled\]="busy\(\) \|\| !accountReady\(\)"/);
});
