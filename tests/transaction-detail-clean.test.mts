import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { bankTextOf } from '../src/app/features/finance/bank-text.ts';

/* The transaction detail's hero (review 2026-10-17): the cleaned reference shows above the raw one only when cleaning changed it. */
async function detailClass() {
  const file = 'transaction-detail.ts';
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'TransactionDetail')!;
  const kept = cls.members.filter((member) => member.name && member.name.getText(parsed) === 'cleanSub');
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter((m) => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports });
  const Detail = exports.TransactionDetail;
  Detail.prototype.textOf = (row: any) => bankTextOf(row);
  return Detail;
}

test('a reference with nothing to clean is not read twice in the detail; a cleaned one keeps its clean line', async () => {
  const detail = new (await detailClass())();
  const plain = { counterparty: 'Yunnan Pubei Flowers Co., Ltd', reference: 'PO43 PO44 PO45  DEPOSIT 30PCT', amountEur: -16500 };
  assert.equal(bankTextOf(plain as any).sub, 'PO43 PO44 PO45 DEPOSIT 30PCT');
  assert.equal(detail.cleanSub(plain), '', 'the raw <code> below already says it');
  const card = { counterparty: '', reference: 'CCV*Koka House BE3500 HASSELT Betaling met Apple Pay via Debit Mastercard 06-10-2026 om 15.43 uur 5169 21XX XXXX 4402 VAN DEN BERG E', amountEur: -18.5 };
  assert.notEqual(detail.cleanSub(card), '');
  assert.equal(detail.cleanSub(card), bankTextOf(card as any).sub);
  assert.equal(detail.cleanSub({ counterparty: 'Proximus', reference: null, amountEur: -86.73 }), '');
});
