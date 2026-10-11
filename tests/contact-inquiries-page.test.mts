import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';

const source = await readFile(new URL('../src/app/features/contact-inquiries/contact-inquiries-page.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('contact-inquiries-page.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ContactInquiriesPage');
assert.ok(original);
const members = original.members.filter(member => !ts.isConstructorDeclaration(member)
  && !(member.name && ['api', 'route', 'router'].includes(member.name.getText(parsed))));
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, undefined, undefined, members);
const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports: any = {};
vm.runInNewContext(js, { exports, signal, PAGE_SIZE: 50, STATUSES: [], messageOf: (_failure: unknown, fallback: string) => fallback });
const Page = exports.ContactInquiriesPage;
const inquiry = (id: number, status = 'NEW') => ({ id, status, reference: `CONTACT-${id}`, contactName: 'Test', email: 'test@example.com', message: 'Vraag' });

function pageWith(api: any) { const page = new Page(); page.api = api; return page; }

test('push deep links fetch their own inquiry even outside the loaded list', async () => {
  const page = pageWith({ get: async (id: number) => inquiry(id) });
  page.rows.set([inquiry(9)]); page.openId.set(120);
  await page.loadDetail(120);
  assert.equal(page.detail().id, 120);
  assert.equal(page.detailLoading(), false);
});

test('a slow earlier detail request cannot replace a later opened inquiry', async () => {
  let finish: (row: any) => void = () => {};
  const page = pageWith({ get: (id: number) => id === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(inquiry(id)) });
  page.openId.set(1); const first = page.loadDetail(1);
  page.openId.set(2); await page.loadDetail(2);
  finish(inquiry(1)); await first;
  assert.equal(page.detail().id, 2);
});

test('a failed status write preserves the current state and can be retried', async () => {
  let failure = true, reloads = 0;
  const page = pageWith({ setStatus: async (id: number, status: string) => {
    if (failure) throw new Error('offline'); return inquiry(id, status);
  }, list: async () => { reloads++; return []; } });
  page.openId.set(4); page.detail.set(inquiry(4));
  await page.setStatus('READ');
  assert.equal(page.detail().status, 'NEW'); assert.ok(page.saveError());
  assert.equal(page.saving(), false); assert.equal(reloads, 0);
  failure = false; await page.setStatus('READ');
  assert.equal(page.detail().status, 'READ'); assert.equal(page.saveError(), null);
  assert.equal(reloads, 1);
});

test('status changes reset paging so an item removed from a filter cannot skip the next page boundary', async () => {
  const requested: number[] = [];
  const page = pageWith({ setStatus: async (id: number, status: string) => inquiry(id, status),
    list: async (_status: string, page: number) => { requested.push(page); return [inquiry(2)]; } });
  page.rows.set([inquiry(1)]); page.nextPage.set(3); page.hasMore.set(true);
  page.openId.set(1); page.detail.set(inquiry(1));
  await page.setStatus('REPLIED');
  assert.deepEqual(requested, [0]);
  assert.deepEqual(Array.from(page.rows(), (row: any) => row.id), [2]);
  assert.equal(page.nextPage(), 1);
});

test('failed load-more retains the existing rows and retries the same page', async () => {
  let failure = true;
  const requested: number[] = [];
  const page = pageWith({ list: async (_status: string, page: number) => {
    requested.push(page); if (failure) throw new Error('offline'); return [inquiry(2)];
  } });
  page.rows.set([inquiry(1)]); page.nextPage.set(1); page.hasMore.set(true);
  await page.loadPage(false);
  assert.equal(page.rows().length, 1); assert.equal(page.nextPage(), 1);
  failure = false; await page.loadPage(false);
  assert.deepEqual(requested, [1, 1]); assert.equal(page.rows().length, 2);
});
