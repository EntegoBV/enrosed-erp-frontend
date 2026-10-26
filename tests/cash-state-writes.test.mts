import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { CashWriteQueue } from '../src/app/features/analyses/cash-write-queue.ts';
import type { PurchaseOrderForecast, PurchaseOrderForecastWrite } from '../src/app/core/api/models.ts';
import type { CashState } from '../src/app/features/analyses/cash-state.ts';

/* Run the production state with real signals and controlled network promises. */
const source = await readFile(new URL('../src/app/features/analyses/cash-state.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('cash-state.ts', source, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed,
  parsed.statements.filter((statement) => !ts.isImportDeclaration(statement)))), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
const viewSource = await readFile(new URL('../src/app/features/analyses/cash-view.ts', import.meta.url), 'utf8');
const viewParsed = ts.createSourceFile('cash-view.ts', viewSource, ts.ScriptTarget.Latest, true);
const viewCode = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(viewParsed,
  viewParsed.statements.filter((statement) => ts.isFunctionDeclaration(statement)
    ? ['forecastWrite', 'adjusted'].includes(statement.name?.text ?? '')
    : ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declaration.name.getText(viewParsed) === 'CHOICE_FIELDS')))), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const view: Record<string, unknown> = {};
vm.runInNewContext(viewCode, { exports: view });

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(firstRequest?: ReturnType<typeof deferred>) {
  const rows = signal<PurchaseOrderForecast[]>([]);
  const calls: string[] = [];
  const tokens = Object.fromEntries(['route', 'router', 'api', 'ui', 'sources', 'destroy'].map((key) => [key, Symbol(key)]));
  const services = new Map([
    [tokens.route, { queryParamMap: { pipe: () => null } }],
    [tokens.router, {}], [tokens.ui, {}], [tokens.destroy, { onDestroy: () => undefined }],
    [tokens.sources, { forecasts: rows, cashRound: () => true, choicesKnown: () => true,
      acceptForecast: (id: number, row: PurchaseOrderForecast | null) => rows.update((current) => [...current.filter((item) => item.orderId !== id), ...(row ? [row] : [])]) }],
    [tokens.api, {
      saveForecast: async (orderId: number, write: PurchaseOrderForecastWrite) => {
        calls.push(`save ${write.markupPct}`);
        if (calls.length === 1 && firstRequest) await firstRequest.promise;
        return { orderId, ...write, updatedAt: '2026-10-26T12:00:00Z', actor: 'test' };
      },
      deleteForecast: async () => { calls.push('reset'); },
    }],
  ]);
  const exports: { CashState?: new () => CashState } = {};
  vm.runInNewContext(code, {
    exports, ...view, signal, computed, CashWriteQueue, Injectable: () => (value: unknown) => value,
    inject: (token: symbol) => services.get(token), ActivatedRoute: tokens.route, Router: tokens.router,
    CashForecastApi: tokens.api, Ui: tokens.ui, CashSources: tokens.sources, DestroyRef: tokens.destroy,
    toSignal: () => signal({}), map: () => undefined, readDismissed: () => [], parseCashLocation: () => ({}),
    setTimeout: () => 1, clearTimeout: () => undefined,
    messageOf: (failure: Error) => failure.message,
  });
  assert.ok(exports.CashState);
  const state = new exports.CashState();
  return { state, calls, rows, flush: () => (state as unknown as { flush(id: number): Promise<void> }).flush(11) };
}

test('reset during a save cannot restore the previous value, and new edits start from defaults', async () => {
  const first = deferred();
  const { state, calls, rows, flush } = harness(first);
  state.changeChoice(11, { markupPct: 50, sellWeeks: 12 });
  const save = flush();
  await Promise.resolve();
  const reset = state.resetChoice(11);
  assert.equal(state.storedFor(11), null, 'default draft hides previous choices while reset is pending');
  state.changeChoice(11, { markupPct: 75 });
  const latest = flush();
  first.resolve();
  await Promise.all([save, reset, latest]);
  assert.equal(rows()[0].markupPct, 75);
  assert.equal(rows()[0].sellWeeks, null, 'new edit must not resurrect pre-reset sell weeks');
  assert.equal(state.choiceStatus(11), 'saved');
  assert.deepEqual(calls, ['save 50', 'save 75'], 'superseded reset is safely folded into the full latest write');
});

test('an in-flight save finishes before reset reaches the server', async () => {
  const first = deferred();
  const { state, calls, rows, flush } = harness(first);
  state.changeChoice(11, { markupPct: 50 });
  const save = flush();
  await Promise.resolve();
  const reset = state.resetChoice(11);
  assert.deepEqual(calls, ['save 50']);
  assert.equal(state.choiceStatus(11), 'saving');
  first.resolve();
  await Promise.all([save, reset]);
  assert.deepEqual(calls, ['save 50', 'reset']);
  assert.equal(rows().length, 0);
  assert.equal(state.choiceStatus(11), 'saved');
});

test('failed saving retains the displayed draft and retry saves that exact value', async () => {
  const first = deferred();
  const { state, rows, flush } = harness(first);
  state.changeChoice(11, { markupPct: 62.5 });
  assert.equal(state.choiceStatus(11), 'saving', 'debounced input is not yet saved');
  const save = flush();
  first.reject(new Error('offline'));
  await save;
  assert.equal(state.storedFor(11)?.markupPct, 62.5);
  assert.equal(state.choiceStatus(11), 'error');
  await state.retryChoice(11);
  assert.equal(rows()[0].markupPct, 62.5);
  assert.equal(state.choiceStatus(11), 'saved');
});

test('failure of an earlier request does not label a newer draft as failed', async () => {
  const first = deferred();
  const { state, rows, flush } = harness(first);
  state.changeChoice(11, { markupPct: 50 });
  const old = flush();
  await Promise.resolve();
  state.changeChoice(11, { markupPct: 75 });
  const latest = flush();
  first.reject(new Error('old request failed'));
  await Promise.all([old, latest]);
  assert.equal(rows()[0].markupPct, 75);
  assert.equal(state.choiceErrors()[11], undefined);
  assert.equal(state.choiceStatus(11), 'saved');
});
