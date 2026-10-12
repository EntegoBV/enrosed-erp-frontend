import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
const source = await readFile(new URL('../src/app/features/sales/sales-peppol-panel.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('sales-peppol-panel.ts', source, ts.ScriptTarget.Latest, true);
const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'SalesPeppolPanel')!;
const members = cls.members.filter(member => member.name && !['orderId', 'dirty', 'api'].includes(member.name.getText(parsed)));
const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports: any = {}; vm.runInNewContext(js, { exports, signal, computed, messageOf: (e: any, fallback: string) => e.message || fallback });
const view = (state: string | null = null, extra = {}) => ({ enabled: true, sendEnabled: true, configured: true, code: state ? 'READY' : 'OUTBOX_PREVIEW_REQUIRED', localPreview: { number: 'INV-65', lines: [] }, entry: state ? { state, snapshotHash: 'immutable-hash', odooMoveId: state === 'PREVIEW' ? null : 18 } : null, ...extra });
function setup(data = view()) {
  const panel = new exports.SalesPeppolPanel(); const calls: any[] = [];
  Object.assign(panel, { orderId: signal(65), dirty: signal(false), api: {
    view: async (id: number) => { calls.push(['view', id]); return data; },
    partners: async (id: number) => { calls.push(['partners', id]); return { partners: [{ id: 7, name: 'Klant BV', vat: 'BE0123456789' }] }; },
    preview: async (...args: any[]) => { calls.push(['preview', ...args]); return view('PREVIEW'); },
    draft: async (...args: any[]) => { calls.push(['draft', ...args]); return view('DRAFT'); },
    send: async (...args: any[]) => { calls.push(['send', ...args]); return view('QUEUED'); },
    refresh: async (...args: any[]) => { calls.push(['refresh', ...args]); return data; },
  } }); panel.ngOnChanges(); panel.data.set(data);
  return { panel, calls };
}
test('unconfigured local previews remain inspectable without fetching remote customers or allowing remote mutations', async () => {
  const { panel, calls } = setup(view(null, { enabled: false, configured: false, sendEnabled: false }));
  await panel.refresh(); await panel.preparePreview(); await panel.createDraft(); panel.sendConfirmed.set(true); await panel.send();
  assert.deepEqual(calls, [['view', 65]]); assert.equal(panel.canPreview(), false); assert.equal(panel.canSend(), false);
  assert.equal(panel.data().localPreview.number, 'INV-65');
});
test('Peppol send requires immutable draft, enabled sending, clean invoice and explicit confirmation', async () => {
  const { panel, calls } = setup(view('DRAFT'));
  await panel.send(); assert.equal(calls.length, 0);
  panel.sendConfirmed.set(true); panel.dirty.set(true); await panel.send(); assert.equal(calls.length, 0);
  panel.dirty.set(false); panel.data.set(view('DRAFT', { sendEnabled: false })); await panel.send(); assert.equal(calls.length, 0);
  panel.data.set(view('DRAFT')); await panel.send();
  assert.deepEqual(calls, [['send', 65, 'immutable-hash']]); assert.equal(panel.sendConfirmed(), false); assert.equal(panel.canSend(), false);
});
test('unknown and blocked outcomes only refresh and never recreate or resend', async () => {
  for (const state of ['UNKNOWN_CREATE', 'UNKNOWN_SEND', 'BLOCKED', 'QUEUED', 'DONE']) {
    const { panel, calls } = setup(view(state)); panel.partnerId.set(7); panel.partners.set([{ id: 7 }]); panel.sendConfirmed.set(true);
    await panel.preparePreview(); await panel.createDraft(); await panel.send(); assert.equal(calls.length, 0, state);
    await panel.refresh(); assert.deepEqual(calls, [['refresh', 65]], state);
  }
});
test('preview accepts only returned named customers and locks the resulting snapshot for draft creation', async () => {
  const { panel, calls } = setup(); await panel.refresh(); assert.equal(panel.partnerId(), 7);
  panel.partnerId.set(999); await panel.preparePreview(); assert.equal(calls.some(c => c[0] === 'preview'), false);
  panel.partnerId.set(7); await panel.preparePreview(); await panel.createDraft();
  assert.deepEqual(calls.slice(-2), [['preview', 65, 7], ['draft', 65, 'immutable-hash']]);
});
test('a late outbox response cannot display another invoice or preserve a prior send confirmation', async () => {
  const { panel } = setup(); let resolve!: (data: any) => void;
  panel.api.view = () => new Promise((yes: any) => { resolve = yes; });
  panel.sendConfirmed.set(true); const request = panel.refresh(); panel.orderId.set(66); panel.ngOnChanges(); resolve(view('DRAFT')); await request;
  assert.equal(panel.data(), null); assert.equal(panel.sendConfirmed(), false); assert.equal(panel.busy(), false);
});
test('outbox template parses and uses named customer selection and a distinct final-send confirmation', () => {
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1]; assert.ok(template);
  assert.equal(parseTemplate(template, 'sales-peppol-panel.html').errors, null);
  assert.match(template, /partner.name/); assert.doesNotMatch(template, /type="number"/); assert.match(template, /Definitief versturen via Peppol/);
});


test('changed snapshots cannot be drafted or sent; only a stale preview may be rebuilt', async () => {
  const { panel, calls } = setup(view('DRAFT', { code: 'OUTBOX_CHANGED' }));
  panel.sendConfirmed.set(true); await panel.send(); await panel.createDraft(); assert.equal(calls.length, 0);
  assert.equal(panel.canPreview(), false);
  panel.data.set(view('PREVIEW', { code: 'OUTBOX_CHANGED' })); assert.equal(panel.canPreview(), true); assert.equal(panel.canDraft(), false);
  panel.data.set(view('PREVIEW', { code: 'OUTBOX_SOURCE_CHANGED' })); assert.equal(panel.canPreview(), false); assert.equal(panel.canDraft(), false);
});
