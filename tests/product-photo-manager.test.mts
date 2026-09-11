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
  const constants = parsed.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === 'PUBLICATION_CHANNELS'));
  const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [...constants, klass])), {
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
const familyClass = await component('features/products/product-family-gallery.ts', 'ProductFamilyGallery', [
  'selectedImageId', 'orderedImages', 'members', 'toggleImage', 'scopeLabel', 'publicationSummary',
  'makeFirst', 'reorderTo', 'publishedChannels', 'isPublishedTo', 'hasAltText', 'publicationControlDisabled',
  'togglePublicationChannel', 'assignVariant',
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
function image(id: number, variantProductId: number | null = null, publishedChannels: string[] = []) {
  return { id, position: id - 1, originalFilename: `${id}.jpg`, variantProductId, publishedChannels, altTexts: [{ language: 'NL', alt: 'Rode roos' }] };
}
function gallery() {
  const { instance: page, flush, frames } = familyClass();
  const changes: any[] = [], publications: any[] = [];
  Object.assign(page, {
    family: signal({ id: 9, images: [image(1), image(2, 45)], members: [{ productId: 45, colour: 'Rood', size: 'XL', name: 'Roos' }] }),
    currentProductId: signal(45), busy: signal(false), reorderAnnouncement: signal(''),
    familyChange: { emit: (value: any) => changes.push(copy(value)) },
    imagePublicationChangeRequested: { emit: (value: any) => publications.push(copy(value)) },
    imageVariantChangeRequested: { emit: () => {} },
    elementRef: { nativeElement: { querySelector: () => null } },
  });
  page.initialize(); flush();
  return { page, flush, frames, changes, publications };
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

test('reeks rows describe actual variant ownership and publication independently', () => {
  const { page } = gallery();
  assert.equal(page.scopeLabel(image(1)), 'Alle varianten');
  assert.equal(page.scopeLabel(image(2, 45)), 'Deze variant · Rood · XL');
  assert.equal(page.scopeLabel(image(3, 999)), 'Variant #999');
  assert.equal(page.publicationSummary(image(1)), 'Alleen intern');
  assert.equal(page.publicationSummary(image(1, null, ['CATALOGUE', 'WEBSITE'])), 'Website · Catalogus');
});

test('reeks selection does not mutate family and clears after switching family/product', () => {
  const { page, changes, flush } = gallery();
  page.toggleImage(1);
  assert.equal(page.selectedImageId(), 1);
  assert.equal(changes.length, 0);
  page.currentProductId.set(46); flush();
  assert.equal(page.selectedImageId(), null);
  page.toggleImage(1);
  page.family.set({ ...page.family(), id: 10 }); flush();
  assert.equal(page.selectedImageId(), null);
});

test('set first keeps image identity, assignment, publication and payload values unchanged', () => {
  const { page, changes } = gallery();
  const original = copy(page.family());
  page.makeFirst(page.family().images[1]);
  assert.deepEqual(copy(page.family()), original, 'The parent still owns persistence');
  assert.deepEqual(changes[0].images, [{ ...original.images[1], position: 0 }, { ...original.images[0], position: 1 }]);
  page.busy.set(true); page.makeFirst(page.family().images[1]);
  assert.equal(changes.length, 1);
});

test('missing alt text blocks enabling a channel, but disabling an existing publication remains available', () => {
  const { page, publications } = gallery();
  const unpublished = { ...image(1), altTexts: [] };
  page.family.set({ ...page.family(), images: [unpublished] });
  assert.equal(page.publicationControlDisabled(unpublished, 'WEBSITE'), true);
  page.togglePublicationChannel(unpublished, 'WEBSITE');
  assert.equal(publications.length, 0);
  const published = { ...unpublished, publishedChannels: ['WEBSITE'] };
  page.family.set({ ...page.family(), images: [published] });
  page.togglePublicationChannel(published, 'WEBSITE');
  assert.deepEqual(publications, [{ imageId: 1, channels: [] }]);
  page.busy.set(true); page.togglePublicationChannel(published, 'WEBSITE');
  assert.equal(publications.length, 1);
});

test('reeks publication changes only the requested channel and cannot act on a removed image', () => {
  const { page, publications } = gallery();
  const current = image(1, 45, ['CATALOGUE']);
  page.family.set({ ...page.family(), images: [current] });
  page.togglePublicationChannel(current, 'WEBSITE');
  assert.deepEqual(publications, [{ imageId: 1, channels: ['WEBSITE', 'CATALOGUE'] }]);
  page.family.set({ ...page.family(), images: [] });
  page.togglePublicationChannel(current, 'WEBSITE');
  assert.equal(publications.length, 1);
});
