import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { parseTemplate } from '@angular/compiler';
import { advanceInvoiceJourney, invoiceJourney } from '../src/app/features/sales/sales-invoice-journey.ts';
import { isAdvanceDocument } from '../src/app/features/sales/sales-payment-state.ts';
import type { SalesOrder } from '../src/app/core/api/models.ts';

const order = (status: SalesOrder['status'], sentAt: string | null = null): SalesOrder => ({
  id: 60, docType: 'FACTUUR', purpose: 'PARTNER_ADVANCE', status, sentAt, partnerPurchaseOrderId: 45,
} as SalesOrder);

test('a fresh advance keeps Concept current and neither future step completed or active', () => {
  const draft = order('CONCEPT'), before = JSON.stringify(draft);
  const steps = advanceInvoiceJourney(draft);
  assert.deepEqual(steps.map(step => [step.label, step.state, step.mark]), [
    ['Concept', 'now', '1'], ['Uitgereikt', 'todo', '2'], ['Voorschot ontvangen', 'todo', '3'],
  ]);
  assert.equal(JSON.stringify(draft), before);
});

test('issuance, sending and full receipt only advance the recorded current lifecycle', () => {
  const issued = advanceInvoiceJourney(order('UITGEREIKT'));
  assert.deepEqual(issued.map(step => step.state), ['done', 'now', 'todo']);
  assert.equal(issued[1].label, 'Uitgereikt', 'Issuing without email never claims it was sent');
  const sent = advanceInvoiceJourney(order('VERZONDEN', '2026-09-10T12:00:00Z'));
  assert.equal(sent[1].label, 'Uitgereikt · verstuurd');
  assert.equal(sent[1].state, 'now');
  const paid = advanceInvoiceJourney(order('BETAALD'));
  assert.deepEqual(paid.map(step => step.state), ['done', 'done', 'now']);
  assert.equal(paid[2].label, 'Voorschot ontvangen');
});

test('cancelled or expired drafts never invent issuance and reopen as Concept', () => {
  for (const status of ['GEANNULEERD', 'VERLOPEN', 'AFGEWEZEN'] as const) {
    const steps = advanceInvoiceJourney(order(status));
    assert.equal(steps.some(step => step.label === 'Uitgereikt'), false);
    assert.equal(steps.at(-1)?.state, 'stop');
  }
  const historical = advanceInvoiceJourney(order('GEANNULEERD', '2026-09-01T12:00:00Z'));
  assert.equal(historical[1].label, 'Uitgereikt');
  assert.equal(historical[1].state, 'done');
  const reopened = advanceInvoiceJourney(order('CONCEPT', '2026-09-01T12:00:00Z'));
  assert.deepEqual(reopened.map(step => step.state), ['now', 'todo', 'todo'], 'The current status wins over old send history');
});

test('issued payment summaries match the badges without promoting concepts or inactive invoices', () => {
  for (const status of ['PARTIAL', 'PAID', 'OVERPAID'] as const) {
    const received = advanceInvoiceJourney(order('UITGEREIKT'), status);
    assert.equal(received[2].state, 'now');
    assert.equal(received[2].label, status === 'PARTIAL' ? 'Voorschot deels ontvangen' : 'Voorschot ontvangen');
    assert.deepEqual(advanceInvoiceJourney(order('CONCEPT'), status).map(step => step.state), ['now', 'todo', 'todo']);
    assert.equal(advanceInvoiceJourney(order('GEANNULEERD'), status).at(-1)?.state, 'stop');
  }
});

for (const [file, className] of [['sales-view', 'SalesView'], ['sales-desk', 'SalesDesk']] as const) {
  const source = await readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className);
  assert.ok(original);
  const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && member.name.text === 'journey');
  assert.equal(members.length, 1);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
    original.name, undefined, undefined, members);
  const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  test(`${className} uses the same real-state journey for a never-issued partner invoice`, () => {
    const exports: any = {};
    vm.runInNewContext(javascript, { exports, isAdvanceDocument, advanceInvoiceJourney, invoiceJourney });
    const screen = new exports[className]();
    for (const status of ['CONCEPT', 'UITGEREIKT', 'BETAALD', 'GEANNULEERD'] as const) {
      const draft = order(status);
      Object.assign(screen, { view: () => ({ order: draft }), isInvoiceDoc: () => true });
      const result = className === 'SalesView' ? screen.journey(draft) : screen.journey();
      assert.deepEqual(result, advanceInvoiceJourney(draft));
    }
    const issued = order('UITGEREIKT');
    screen.view = () => ({ order: issued, paymentSummary: { status: 'PARTIAL' } });
    const partial = className === 'SalesView' ? screen.journey(issued) : screen.journey();
    assert.equal(partial[2].label, 'Voorschot deels ontvangen');
    assert.equal(partial[2].state, 'now');
  });

  test(`${className} lifecycle template parses with accessible current-step indication`, () => {
    const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1];
    assert.ok(template);
    assert.equal(parseTemplate(template, `${file}.html`).errors, null);
  });
}


test('ordinary invoices keep Concept current and distinguish issuance from sending', () => {
  const draft = { ...order('CONCEPT'), purpose: 'STANDARD' as const, goodsShippedAt: null };
  assert.deepEqual(invoiceJourney(draft).map(step => step.state), ['now', 'todo', 'todo', 'todo']);
  const issued = invoiceJourney({ ...draft, status: 'UITGEREIKT' });
  assert.equal(issued[1].state, 'now'); assert.equal(issued[1].label, 'Uitgereikt');
  const sent = invoiceJourney({ ...draft, status: 'VERZONDEN' });
  assert.equal(sent[1].state, 'now'); assert.equal(sent[1].label, 'Uitgereikt · verstuurd');
  const reopened = invoiceJourney({ ...draft, sentAt: '2026-09-13T10:00:00Z' }, 'PAID');
  assert.deepEqual(reopened.map(step => step.state), ['now', 'todo', 'todo', 'todo']);
});

test('receipts before delivery never mark goods shipped', () => {
  const invoice = { ...order('VERZONDEN'), goodsShippedAt: null };
  for (const status of ['PARTIAL', 'PAID', 'OVERPAID'] as const) {
    const steps = invoiceJourney(invoice, status);
    assert.equal(steps[3].state, 'now'); assert.equal(steps[2].state, 'todo');
  }
  const shipped = invoiceJourney({ ...invoice, goodsShippedAt: '2026-09-13T10:00:00Z' }, 'UNPAID');
  assert.equal(shipped[2].state, 'now'); assert.equal(shipped[3].state, 'todo');
});
