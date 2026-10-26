import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import type { CashData } from '../src/app/features/analyses/cash-sources.ts';

/*
 * The production CashData (analyses/cash-sources.ts) with real Angular signals and stub APIs: the AST transform
 * removes only the imports (the bank-movement-panel harness). Two rules of the shared root copy:
 * - a round in which the bank comes back wakes what reads sourcesWith() (the home's forecast), although
 *   `state` stays 'ready' and the statements arrive after the other calls;
 * - ensure() never takes a failed round for a fresh one, so Analyses asks again after the home's bank failed.
 */
async function compile(relativePath: string): Promise<string> {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const isolated = ts.factory.updateSourceFile(parsed, parsed.statements.filter((statement) => !ts.isImportDeclaration(statement)));
  return ts.transpileModule(ts.createPrinter().printFile(isolated), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText;
}

const code = await compile('../src/app/features/analyses/cash-sources.ts');
const TODAY = '2026-10-15';

function harness(overrides: { schedule?: (id: number) => Promise<unknown>; withSchedule?: () => number[] } = {}) {
  const failing = new Set<string>();
  const calls: string[] = [];
  const answer = <T>(name: string, value: T) => async (): Promise<T> => {
    calls.push(name);
    if (failing.has(name)) throw new Error(`${name} failed`);
    return value;
  };
  const tokens = { banking: Symbol('BankingApi'), finance: Symbol('FinanceApi'), sourcing: Symbol('SourcingApi'), sales: Symbol('SalesApi'), cash: Symbol('CashForecastApi'), tica: Symbol('TicaApi') };
  const services = new Map<symbol, object>([
    [tokens.banking, { accounts: answer('accounts', []), list: answer('statements', [{ id: 1 }]) }],
    [tokens.finance, { bankBalances: answer('balances', []), recurringCosts: answer('recurring', []) }],
    [tokens.sourcing, { purchasePayments: answer('payments', []), partnerAdvanceSchedule: overrides.schedule ?? answer('schedule', null) }],
    [tokens.sales, { company: answer('company', null) }],
    [tokens.cash, { forecasts: answer('forecasts', []), settings: answer('settings', null) }],
    [tokens.tica, { settlements: answer('ticaSettlements', []), analytics: answer('ticaSales', []) }],
  ]);
  const exports: { CashData?: new () => CashData; cashDataStale?: typeof import('../src/app/features/analyses/cash-sources.ts').cashDataStale } = {};
  vm.runInNewContext(code, {
    exports, signal, computed, Injectable: () => (value: unknown) => value, Date,
    inject: (token: symbol) => {
      const service = services.get(token);
      if (!service) throw new Error(`Unexpected injection: ${String(token)}`);
      return service;
    },
    BankingApi: tokens.banking, FinanceApi: tokens.finance, SourcingApi: tokens.sourcing, SalesApi: tokens.sales, CashForecastApi: tokens.cash, TicaApi: tokens.tica,
    threeMonthsBack: () => '2026-07-01', bankAccountKey: (key: string) => key, canonicalBankAccount: (key: string) => key,
    bankCheckpoint: () => Number.NaN, paymentLocalDay: () => null, financingsWithSchedule: overrides.withSchedule ?? (() => []),
  });
  assert.ok(exports.CashData && exports.cashDataStale, 'production CashData compiled');
  return { data: new exports.CashData(), failing, calls, cashDataStale: exports.cashDataStale };
}

const page = { purchases: [], suppliers: [], products: [], salesOrders: [], customers: [], costs: [], incomingPayments: [] };

test('a round in which the bank comes back wakes sourcesWith(): the home\'s forecast follows Opnieuw', async () => {
  const { data, failing } = harness();
  failing.add('balances');
  await data.reload(TODAY);
  /* What HomeData.forecastSources does: a computed over sourcesWith(). */
  const sources = computed(() => data.sourcesWith(page, TODAY));
  assert.equal(sources(), null);
  assert.deepEqual([data.state(), data.bankMissing(), [...data.warnings()]], ['ready', true, ['bank']]);

  failing.clear();
  await data.reload(TODAY);
  assert.equal(data.state(), 'ready');
  assert.equal(data.bankMissing(), false);
  const ready = sources();
  assert.ok(ready, 'the computed recomputes once the bank is in');
  assert.equal(JSON.stringify(ready.statements), '[{"id":1}]');
  assert.equal(ready.statementsFrom, '2026-07-01');
});

test('the statements failing alone also recovers on the next round', async () => {
  const { data, failing } = harness();
  failing.add('statements');
  await data.reload(TODAY);
  const sources = computed(() => data.sourcesWith(page, TODAY));
  assert.equal(sources(), null);
  failing.clear();
  await data.reload(TODAY);
  assert.ok(sources());
});

test('ensure() fetches again after a failed round, never within two minutes after a clean one', async () => {
  const { data, failing, calls } = harness();
  failing.add('balances');
  data.ensure(TODAY);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const first = calls.filter((name) => name === 'accounts').length;
  assert.equal(first, 1);
  /* Analyses entered right after the home's failed round: a new round, not the failure for two minutes. */
  failing.clear();
  data.ensure(TODAY);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.filter((name) => name === 'accounts').length, 2);
  assert.deepEqual([data.bankMissing(), [...data.warnings()]], [false, []]);
  /* A clean round is fresh: nothing again. */
  data.ensure(TODAY);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.filter((name) => name === 'accounts').length, 2);
});

test('cashDataStale: idle, another day, too old, or anything left out', () => {
  const { cashDataStale } = harness();
  const now = Date.parse('2026-10-15T08:40:00Z');
  const clean = { state: 'ready' as const, loadedAt: now - 60_000, loadedFor: TODAY, warnings: [] as string[], bankMissing: false };
  assert.equal(cashDataStale(clean, TODAY, now), false);
  assert.equal(cashDataStale({ ...clean, state: 'idle' }, TODAY, now), true);
  assert.equal(cashDataStale(clean, '2026-10-16', now), true);
  assert.equal(cashDataStale({ ...clean, loadedAt: now - 120_001 }, TODAY, now), true);
  assert.equal(cashDataStale({ ...clean, loadedAt: null }, TODAY, now), true);
  assert.equal(cashDataStale({ ...clean, warnings: ['vaste kosten'] }, TODAY, now), true);
  assert.equal(cashDataStale({ ...clean, bankMissing: true }, TODAY, now), true);
});

test('an older schedule round answering last never pulls schedulesFor back (N13)', async () => {
  const pending: { round: number; resolve: (value: unknown) => void }[] = [];
  let round = 0;
  const { data } = harness({
    withSchedule: () => [44],
    schedule: (id: number) => {
      const asked = round;
      return new Promise((resolve) => pending.push({ round: asked, resolve: () => resolve({ purchaseOrderId: id, round: asked, rows: [] }) }));
    },
  });
  round = 1;
  const first = data.loadSchedules([], 1);
  round = 2;
  const second = data.loadSchedules([], 2);
  pending.find((call) => call.round === 2)!.resolve(null);
  await second;
  assert.equal(data.schedulesFor(), 2);
  pending.find((call) => call.round === 1)!.resolve(null);
  await first;
  assert.equal(data.schedulesFor(), 2, 'round 1 answered last: still round 2');
  assert.equal(JSON.stringify(data.advanceSchedules().map((row) => (row as unknown as { round: number }).round)), '[2]', 'the stale round\'s schedules are dropped');
});
