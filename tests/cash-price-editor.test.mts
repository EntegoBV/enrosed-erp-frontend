import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { cashPercentText, marginFromMarkup, markupFromPriceInput } from '../src/app/features/analyses/cash-price-input.ts';
import type { CashPriceEditor } from '../src/app/features/analyses/cash-price-editor.ts';

const source = await readFile(new URL('../src/app/features/analyses/cash-price-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('cash-price-editor.ts', source, ts.ScriptTarget.Latest, true);
const isolated = ts.factory.updateSourceFile(parsed, parsed.statements.filter((statement) => !ts.isImportDeclaration(statement)));
const code = ts.transpileModule(ts.createPrinter().printFile(isolated), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;

function editor(markup = 50) {
  const writes: number[] = [];
  const exports: { CashPriceEditor?: new () => CashPriceEditor } = {};
  const input = Object.assign((value: unknown) => signal(value), { required: () => signal(markup) });
  vm.runInNewContext(code, { exports, input, computed, signal, effect: () => {},
    output: () => ({ emit: (value: number) => writes.push(value) }),
    Component: () => (value: unknown) => value, ChangeDetectionStrategy: { OnPush: 0 }, Segmented: {},
    cashPercentText, marginFromMarkup, markupFromPriceInput,
  });
  assert.ok(exports.CashPriceEditor);
  return { instance: new exports.CashPriceEditor(), writes };
}

test('typed margin commits on blur and a following blur after Enter cannot duplicate the write', () => {
  const { instance, writes } = editor();
  instance.draft.set('50');
  instance.commitDraft('50');
  assert.deepEqual(writes, [100]);
  assert.equal(instance.draft(), null);
  instance.commitDraft('50');
  assert.deepEqual(writes, [100], 'Enter then blur only commits once, even before the parent refreshes the input');
});

test('focusing the rounded current margin and leaving it unchanged does not alter the stored markup', () => {
  const { instance, writes } = editor(50);
  instance.commitDraft('33,3');
  assert.deepEqual(writes, [], 'focus and blur without typing');
  instance.draft.set('33,3');
  instance.commitDraft('33,3');
  assert.deepEqual(writes, [], 'the visible rounded margin must not turn 50% markup into 49.9%');
  assert.equal(instance.draft(), null);
});

test('invalid blur stays editable with feedback and correction commits once', () => {
  const { instance, writes } = editor();
  instance.draft.set('');
  instance.commitDraft('');
  assert.deepEqual(writes, []);
  assert.equal(instance.error(), 'Vul een percentage in.');
  assert.equal(instance.draft(), '');
  instance.draft.set('40');
  instance.commitDraft('40');
  assert.deepEqual(writes, [66.7]);
  assert.equal(instance.error(), null);
});

test('reselecting the current preset avoids an unnecessary persisted write', () => {
  const { instance, writes } = editor(100);
  instance.choose(50);
  assert.deepEqual(writes, []);
  instance.setBasis('markup');
  instance.draft.set('75');
  instance.commitDraft('75');
  assert.deepEqual(writes, [75]);
});
