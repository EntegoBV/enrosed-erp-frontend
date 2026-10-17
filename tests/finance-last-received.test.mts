import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';
import { signedEur } from '../src/app/features/finance/finance-format.ts';

/** Compiles the named class members and top-level functions of a finance file, without Angular's decorators or imports. */
async function selected(file: string, cls: string | null, members: string[], functions: string[], context: Record<string, unknown>) {
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const kept: ts.Statement[] = [];
  for (const node of parsed.statements) {
    if (cls && ts.isClassDeclaration(node) && node.name?.text === cls) {
      const picked = node.members.filter((member) => member.name && members.includes(member.name.getText(parsed)));
      assert.equal(picked.length, members.length);
      kept.push(ts.factory.updateClassDeclaration(node, node.modifiers?.filter((m) => !ts.isDecorator(m)), node.name, undefined, undefined, picked));
    } else if (ts.isFunctionDeclaration(node) && node.name && functions.includes(node.name.text)) kept.push(node);
  }
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, kept)), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, ...context });
  return exports;
}

const receipt = (extra: Record<string, unknown> = {}) => ({ id: 5, salesOrderId: 41, orderNumber: 'F-2026-0041', amountEur: 1210, purchaseOrderId: null, docType: 'FACTUUR',
  receivedAt: '2026-10-14T09:12:00Z', timeZone: 'Europe/Brussels', purpose: 'STANDARD', customerId: 3, ...extra });

function stateOf(desk: boolean, openIds: number[]) {
  const calls: any[] = [];
  return { calls, state: {
    desk: signal(desk), receivables: () => openIds.map((id) => ({ id, kind: 'customer' })),
    inspectItem: (target: any) => calls.push(['inspect', target.kind, target.id]),
    openInvoice: (id: number) => calls.push(['invoice', id]),
    openPartnerContainer: (id: number) => calls.push(['container', id]),
    openMenu: (menu: any) => calls.push(['menu', menu]),
  } };
}

const { receiptMenu } = await selected('incoming-payment-list.ts', null, [], ['receiptMenu'], { signedEur });
const { ReceivablesPanel } = await selected('receivables-panel.ts', 'ReceivablesPanel', ['openReceived', 'receivedMenu'], [], { receiptMenu });

test('Laatst ontvangen: a receipt on a still open invoice opens that invoice in the inspector', () => {
  for (const desk of [true, false]) {
    const { state, calls } = stateOf(desk, [41]);
    const panel = new ReceivablesPanel(); panel.state = state;
    panel.openReceived(receipt());
    assert.deepEqual(calls, [['inspect', 'invoice', 41]]);
  }
});

test('Laatst ontvangen: a paid invoice has no inspector, so the desk opens the invoice and the phone the receipt menu (no dead end)', () => {
  const desk = stateOf(true, [7]);
  const panel = new ReceivablesPanel(); panel.state = desk.state;
  panel.openReceived(receipt());
  assert.deepEqual(desk.calls, [['invoice', 41]], 'the desk opens the paid invoice itself');

  const phone = stateOf(false, []);
  panel.state = phone.state;
  panel.openReceived(receipt({ purchaseOrderId: 12, purpose: 'PARTNER_ADVANCE' }));
  const [[kind, menu]] = phone.calls;
  assert.equal(kind, 'menu');
  assert.equal(menu.anchor, null); assert.equal(menu.cancelLabel, 'Annuleren');
  assert.deepEqual(Array.from(menu.items, (item: any) => item.label), ['Factuur openen', 'Container openen'], 'as on Ontvangen: the invoice and the partner container');
  menu.pick('container'); menu.pick('invoice');
  assert.deepEqual(phone.calls.slice(1), [['container', 12], ['invoice', 41]]);
});

test('the receipt menu names a credit note and anchors a desk right-click', () => {
  const { state, calls } = stateOf(true, []);
  const panel = new ReceivablesPanel(); panel.state = state;
  panel.receivedMenu(receipt({ docType: 'CREDITNOTA', amountEur: -200 }), { x: 10, y: 20 });
  const menu = calls[0][1];
  assert.deepEqual(menu.anchor, { x: 10, y: 20 }); assert.equal(menu.cancelLabel, '');
  assert.deepEqual(Array.from(menu.items, (item: any) => item.label), ['Creditnota openen']);
  assert.equal(menu.title, `F-2026-0041 · ${signedEur(-200)}`);
});
