import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type { BankBalance, IncomingPaymentRow } from '../src/app/core/api/models.ts';
import type { BankStatementLine } from '../src/app/core/api/banking-api.ts';

const source = (await readFile(new URL('../src/app/features/finance/bank-reconciliation.ts', import.meta.url), 'utf8'))
  .replace("'../../shared/received-at'", JSON.stringify(new URL('../src/app/shared/received-at.ts', import.meta.url).href));
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { reconciledBank, bankCheckpoint } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const balance = (account: string, value: number, at: string): BankBalance => ({ id: 1, account, balanceEur: value, date: '2026-09-08', asOfAt: at, timeZone: 'Europe/Brussels', notes: null });
const line = (id: number, account: string, amountEur: number, at: string, salesPaymentId: number | null = null): BankStatementLine => ({ id, account, amountEur, bookedAt: at, salesPaymentId } as BankStatementLine);
const payment = (id: number, bankAccount: string | null, amountEur: number, at = '2026-09-08T13:00:00Z'): IncomingPaymentRow => ({ id, bankAccount, amountEur, receivedAt: at } as IncomingPaymentRow);

test('accounts use their own timestamps and recorded bank cash never adds a matched receipt twice', () => {
  const result = reconciledBank([balance('KBC', 900, '2026-09-08T10:00:00Z'), balance('ING', 200, '2026-09-08T12:00:00Z')],
    [line(1, 'KBC', 100, '2026-09-08T11:00:00Z', 1), line(2, 'KBC', -20, '2026-09-08T13:00:00Z'), line(3, 'ING', 50, '2026-09-08T11:00:00Z'), line(4, 'ING', 30, '2026-09-08T13:00:00Z')],
    [payment(1, 'KBC', 100), payment(2, 'KBC', 999), payment(3, null, 5000)]);
  assert.equal(result.accounts.find((r: any) => r.account === 'KBC').currentEur, 1979);
  assert.equal(result.accounts.find((r: any) => r.account === 'ING').currentEur, 230);
  assert.equal(result.totalEur, 2209);
  assert.equal(result.accounts.find((r: any) => r.account === 'KBC').unlinkedBookings, 1);
  assert.equal(result.unassignedPayments, 1);
});
test('manual receipts and refunds belong only to explicitly named accounts', () => {
  const result = reconciledBank([balance(' Kbc  zicht ', 100, '2026-09-08T10:00:00Z')], [], [payment(1, 'KBC ZICHT', 50), payment(2, 'KBC ZICHT', -20), payment(3, null, 1000), payment(4, 'No reading', 40)]);
  assert.equal(result.totalEur, 130);
  assert.equal(result.missingReadings, 1);
  assert.equal(result.unassignedPayments, 1);
});
test('date-only checkpoint is the end of the selected bank timezone day', () => {
  const reading = { ...balance('KBC', 100, ''), asOfAt: null };
  assert.equal(new Date(bankCheckpoint(reading)).toISOString(), '2026-09-08T21:59:59.999Z');
  const result = reconciledBank([reading], [line(1, 'KBC', 50, '2026-09-08T21:30:00Z'), line(2, 'KBC', 10, '2026-09-08T22:00:00Z')], []);
  assert.equal(result.totalEur, 110);
});


test('adding a standalone bank cost retains independent incoming receipts and refunds', () => {
  const readings = [balance('KBC', 100, '2026-09-08T10:00:00Z')];
  const receipts = [payment(1, 'KBC', 50), payment(2, 'KBC', -10)];
  assert.equal(reconciledBank(readings, [], receipts).totalEur, 140);
  const result = reconciledBank(readings, [line(1, 'KBC', -20, '2026-09-08T14:00:00Z')], receipts);
  assert.equal(result.totalEur, 120);
  assert.equal(result.accounts[0].movements.length, 3);
});

test('a link makes the raw bank account and timestamp authoritative even with stale receipt attribution', () => {
  const readings = [balance('KBC', 100, '2026-09-08T10:00:00Z'), balance('ING', 200, '2026-09-08T12:00:00Z')];
  const linked = line(1, 'ING', 50, '2026-09-08T11:00:00Z', 1);
  const staleReceipt = payment(1, 'KBC', 50, '2026-09-08T13:00:00Z');
  const result = reconciledBank(readings, [linked, linked], [staleReceipt, staleReceipt]);
  assert.equal(result.totalEur, 300, 'bank movement happened before the ING checkpoint; neither copy is added to KBC');
  assert.equal(result.accounts.reduce((n: number, row: any) => n + row.movements.length, 0), 0);
});

test('duplicate fetched IDs count once while genuinely separate unlinked receipts both remain', () => {
  const reading = balance('KBC', 100, '2026-09-08T10:00:00Z');
  const cash = line(1, 'KBC', -20, '2026-09-08T14:00:00Z');
  const receipt = payment(1, 'KBC', 50);
  const result = reconciledBank([reading], [cash, cash], [receipt, receipt, payment(2, 'KBC', 50)]);
  assert.equal(result.totalEur, 180);
  assert.equal(result.accounts[0].movements.length, 3);
});
