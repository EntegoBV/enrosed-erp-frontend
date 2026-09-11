import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';

async function isolate(file: string, name: string, names: string[]) {
  const text = await readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name); assert.ok(original);
  const members = original.members.filter(member => member.name && names.includes(member.name.getText(parsed))); assert.equal(members.length, names.length);
  const cls = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [cls])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {}; vm.runInNewContext(js, { exports, HostListener: () => () => undefined }); return { Constructor: exports[name], text };
}
const { Constructor: Editor, text: editorSource } = await isolate('sales-editor', 'SalesEditor', ['canDeactivate', 'warnBeforeUnload']);
const { Constructor: Desk, text: deskSource } = await isolate('sales-desk', 'SalesDesk', ['canDeactivate', 'warnBeforeUnload']);
Object.setPrototypeOf(Desk.prototype, Editor.prototype);
const { Constructor: View, text: viewSource } = await isolate('sales-view', 'SalesView', ['canDeactivate', 'warnBeforeUnload', 'closeSplit']);
const { Constructor: Screen, text: screenSource } = await isolate('sales-screen', 'SalesScreen', ['canDeactivate']);
function event() { return { prevented: false, returnValue: null as string | null, preventDefault() { this.prevented = true; } }; }

test('desktop beforeunload and routing respect active splitting plus the inherited dirty/mobile rules', () => {
  const desk = new Desk(); Object.assign(desk, { splitBusy: signal(true), mobileSplitBusy: signal(false), dirty: signal(false), saving: signal(false) });
  let unload = event(); desk.warnBeforeUnload(unload); assert.equal(unload.prevented, true); assert.equal(unload.returnValue, ''); assert.equal(desk.canDeactivate(), false);
  desk.splitBusy.set(false); unload = event(); desk.warnBeforeUnload(unload); assert.equal(unload.prevented, false); assert.equal(desk.canDeactivate(), true);
  desk.dirty.set(true); unload = event(); desk.warnBeforeUnload(unload); assert.equal(unload.prevented, true);
  desk.dirty.set(false); desk.mobileSplitBusy.set(true); unload = event(); desk.warnBeforeUnload(unload); assert.equal(unload.prevented, true); assert.equal(desk.canDeactivate(), false);
  assert.match(editorSource, /@HostListener\('window:beforeunload'/); assert.match(deskSource, /override warnBeforeUnload/);
});

test('read-view split blocks route and tab navigation and cannot close during its pending mutation', () => {
  const view = new View(), loads: number[] = []; Object.assign(view, { splitBusy: signal(true), splitOpen: signal(true), view: () => ({ order: { id: 72 } }), load: (id: number) => loads.push(id) });
  const unload = event(); view.warnBeforeUnload(unload); assert.equal(unload.prevented, true); assert.equal(view.canDeactivate(), false);
  view.closeSplit(); assert.equal(view.splitOpen(), true); assert.deepEqual(loads, []);
  view.splitBusy.set(false); assert.equal(view.canDeactivate(), true); view.closeSplit(); assert.equal(view.splitOpen(), false); assert.deepEqual(loads, [72]);
  assert.match(viewSource, /\(busyChange\)="splitBusy.set\(\$event\)"/);
});

test('SalesScreen forwards the guard to every active screen including the mobile read view', async () => {
  const screen = new Screen(); Object.assign(screen, { desk: () => undefined, editor: () => undefined, readView: () => undefined });
  assert.equal(screen.canDeactivate(), true);
  for (const key of ['desk', 'editor', 'readView']) {
    screen[key] = () => ({ canDeactivate: () => false }); assert.equal(screen.canDeactivate(), false);
    screen[key] = () => ({ canDeactivate: () => Promise.resolve(true) }); assert.equal(await screen.canDeactivate(), true);
    screen[key] = () => undefined;
  }
  assert.match(screenSource, /readView = viewChild\(SalesView\)/);
});
