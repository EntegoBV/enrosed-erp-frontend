import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';

// Execute the real component behavior with inert API, DOM and effect boundaries.
// No browser, photo upload or live catalog capability is available here.
async function component(file: string, className: string, names: string[]) {
  const text = await readFile(new URL(`../src/app/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const source = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className)!;
  const picked = source.members.filter(member => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
  assert.equal(picked.length, names.length, 'The tests must run the current production members');
  const constructor = source.members.find(ts.isConstructorDeclaration)!;
  const setup = ts.factory.createMethodDeclaration(undefined, undefined, 'initialize', undefined, undefined, [], undefined, constructor.body);
  const klass = ts.factory.updateClassDeclaration(source, undefined, source.name, undefined, undefined, [...picked, setup]);
  const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [klass])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText + `\nexports.Component = ${className};`;
  return () => {
    const effects: (() => void)[] = [], frames: (() => void)[] = [];
    const exported: any = {};
    vm.runInNewContext(javascript, { exports: exported, signal, computed,
      effect: (fn: () => void) => effects.push(fn), requestAnimationFrame: (fn: () => void) => frames.push(fn),
      messageOf: (_error: unknown, fallback: string) => fallback, URL: { revokeObjectURL: () => {} },
    });
    const instance = new exported.Component();
    const flush = () => { for (const fn of effects) fn(); };
    return { instance, flush, frames };
  };
}

const managerClass = await component('shared/photo-manager.ts', 'PhotoManager', [
  'interactionDisabled', 'ownPhotos', 'inheritedPhotos', 'selectedPhotoId', 'selectedPhoto', 'roleBusy',
  'selectPhoto', 'closePhotoDetails', 'makePrimary', 'reorderSaved', 'announceMoved', 'isOwnPhoto',
  'isCurrentOwnPhoto', 'isEffectivePrimary', 'leads', 'toggleLead', 'remove',
]);
const copy = (value: any) => JSON.parse(JSON.stringify(value));
function photo(id: number, own = true) { return { id, originalFilename: `${id}.jpg`, origin: own ? 'PRODUCT' : 'FAMILY', readOnly: !own, familyPhotoId: own ? null : id + 100, leadFor: [] }; }
function manager() {
  const { instance: page, flush, frames } = managerClass();
  const calls: any[] = [], changes: any[] = [], confirmations: any[] = [], focus: string[] = [];
  Object.assign(page, {
    photos: signal([photo(1), photo(2), photo(3, false)]), productId: signal(45), showInherited: signal(false),
    disabled: signal(false), busy: signal(false), pendingPhotos: signal([]), reorderAnnouncement: signal(''),
    changed: { emit: (value: any) => changes.push(copy(value)) }, destroyRef: { onDestroy: () => {} },
    catalog: { reorderPhotos: async (id: number, ids: number[]) => { calls.push(['reorder', id, copy(ids)]); return { id }; },
      setPhotoLead: async (...args: any[]) => { calls.push(['lead', ...args]); return { id: args[0] }; } },
    ui: { toast: () => {}, confirm: (...args: any[]) => confirmations.push(args) },
    elementRef: { nativeElement: { querySelector: (selector: string) => ({ getClientRects: () => [1], focus: () => focus.push(selector), scrollIntoView: () => focus.push('scroll') }) } },
  });
  page.initialize(); flush();
  return { page, flush, frames, calls, changes, confirmations, focus };
}

test('only explicit product-owned images become editable thumbnails; inherited selection stays hidden', () => {
  const { page } = manager();
  assert.deepEqual(copy(page.ownPhotos()).map((item: any) => item.id), [1, 2]);
  assert.equal(page.isOwnPhoto({ ...photo(4), readOnly: undefined }), false);
  page.selectPhoto(photo(3, false));
  assert.equal(page.selectedPhoto(), null);
  page.showInherited.set(true);
  assert.equal(page.selectedPhoto().id, 3);
  assert.equal(page.isEffectivePrimary(photo(1)), true);
});

test('opening details is read-only, focuses the visible panel and closing returns to its thumbnail', () => {
  const { page, calls, frames, focus } = manager();
  page.selectPhoto(photo(2));
  assert.equal(page.selectedPhoto().id, 2);
  frames.shift()!();
  assert.deepEqual(focus, ['.photo-details', 'scroll']);
  page.closePhotoDetails();
  assert.equal(page.selectedPhoto(), null);
  assert.equal(focus.at(-1), '[data-photo-select="2"]');
  assert.deepEqual(calls, []);
});

test('details reset on another product or removed photo and late focus never targets the next product', () => {
  const { page, flush, frames, focus } = manager();
  page.selectPhoto(photo(2));
  page.productId.set(46); flush(); frames.shift()!();
  assert.equal(page.selectedPhoto(), null);
  assert.deepEqual(focus, []);
  page.selectPhoto(photo(1));
  page.photos.set([photo(2)]); flush();
  assert.equal(page.selectedPhotoId(), null);
});

test('make primary reorders only this product’s own IDs and never inherited photos', async () => {
  const { page, calls } = manager();
  await page.makePrimary(photo(2));
  assert.deepEqual(calls, [['reorder', 45, [2, 1]]]);
  calls.length = 0;
  await page.makePrimary(photo(3, false));
  await page.makePrimary(photo(999));
  page.disabled.set(true); await page.makePrimary(photo(2));
  assert.deepEqual(calls, []);
});

test('family-origin photos cannot enter product deletion confirmation', async () => {
  const { page, confirmations } = manager();
  await page.remove(photo(3, false));
  assert.equal(confirmations.length, 0);
  await page.remove(photo(2));
  assert.equal(confirmations.length, 1);
});

test('channel lead selection is guarded while disabled and during its request', async () => {
  const { page, calls, changes } = manager();
  page.disabled.set(true); await page.toggleLead(photo(2), 'WEBSITE');
  assert.equal(calls.length, 0);
  page.disabled.set(false);
  let finish!: (value: any) => void;
  page.catalog.setPhotoLead = (...args: any[]) => { calls.push(args); return new Promise(resolve => { finish = resolve; }); };
  const request = page.toggleLead(photo(2), 'WEBSITE');
  assert.equal(page.interactionDisabled(), true);
  await page.toggleLead(photo(1), 'CATALOGUE');
  await page.makePrimary(photo(2));
  assert.equal(calls.length, 1);
  finish({ id: 45 }); await request;
  assert.equal(page.interactionDisabled(), false);
  assert.deepEqual(changes, [{ id: 45 }]);
});
