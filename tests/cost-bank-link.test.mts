import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { signal } from '@angular/core';
import { bankTransactionDay } from '../src/app/shared/bank-transaction-options.ts';
const source = await readFile(new URL('../src/app/features/finance/finance-state.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('finance-state.ts', source, ts.ScriptTarget.Latest, true);
const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'FinanceState')!;
const names = ['bankCostLinkPending', 'bankCostLinkError', 'addPaymentFromBank', 'deferBankCostLink', 'swipePay'];
const members = cls.members.filter(member => member.name && names.includes(member.name.getText(parsed))); assert.equal(members.length, names.length);
const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports: any = {}; vm.runInNewContext(js, { exports, signal, bankTransactionDay, messageOf: (e: any, fallback: string) => e.message || fallback });
const line = { id: 70, amountEur: -42, account: 'BE123456', bookedAt: '2026-10-01T22:15:00Z', timeZone: 'Europe/Brussels', source: 'ODOO', reference: 'Kost 1' };
const cost = { id: 20, description: 'Kost 1', payments: [] };
function setup() {
  const state = new exports.FinanceState(); const creates: any[] = []; const links: any[] = []; let fails = true;
  Object.assign(state, { saving: signal(false), bankStatements: signal([]), paySheet: signal({ costs: [cost] }), refreshCosts: async () => {}, refreshBank: async () => {}, ui: { toast() {} },
    banking: {
      addCostPayment: async (id: number, costId: number) => { creates.push({ id, costId }); if (fails) throw new Error('Bank tijdelijk offline'); return { ...line, allocated: true }; },
      linkPayments: async (id: number, body: any) => { links.push({ id, ...body }); if (fails) throw new Error('Bank tijdelijk offline'); return { ...line, allocated: true }; },
    },
  });
  return { state, creates, links, succeed: () => { fails = false; } };
}
test('new cost payments retry the same atomic bank and cost pair without guessing a payment id', async () => {
  const { state, creates, links, succeed } = setup();
  assert.equal(await state.addPaymentFromBank(cost, line), false);
  assert.equal(state.bankCostLinkPending().costId, 20); assert.equal(state.bankCostLinkPending().paymentId, undefined);
  assert.match(state.bankCostLinkError(), /geen extra betaling/);
  succeed(); assert.equal(await state.addPaymentFromBank(cost, line), true);
  assert.deepEqual(creates, [{ id: 70, costId: 20 }, { id: 70, costId: 20 }]); assert.deepEqual(links, []);
  assert.equal(state.bankCostLinkPending(), null); assert.equal(state.bankStatements()[0].source, 'ODOO');
});
test('existing cost payments link without a new payment and a mismatched amount is rejected before writing', async () => {
  const { state, creates, links, succeed } = setup(); succeed();
  assert.equal(await state.addPaymentFromBank(cost, line, { id: 10, amountEur: 41 }), false);
  assert.equal(links.length, 0); assert.match(state.bankCostLinkError(), /gelijk/);
  assert.equal(await state.addPaymentFromBank(cost, line, { id: 10, amountEur: 42 }), true);
  assert.equal(creates.length, 0); assert.deepEqual(links, [{ id: 70, costPaymentId: 10 }]);
});
test('switching a pending transaction cannot submit another pair; defer clears only local selection', async () => {
  const { state, creates } = setup(); await state.addPaymentFromBank(cost, line);
  assert.equal(await state.addPaymentFromBank(cost, { ...line, id: 71 }), false); assert.equal(creates.length, 1);
  state.deferBankCostLink(); assert.equal(state.bankCostLinkPending(), null); assert.equal(state.paySheet(), null);
  assert.equal(creates.length, 1);
});


test('the mobile quick-payment gesture opens transaction selection without recording money immediately', () => {
  const { state, creates } = setup(); const opened: any[] = [];
  state.busy = signal(false); state.openPay = (costs: any[]) => opened.push(costs);
  state.swipePay(cost); assert.equal(opened[0][0].id, 20); assert.equal(creates.length, 0);
  state.saving.set(true); state.swipePay(cost); assert.equal(opened.length, 1);
});
