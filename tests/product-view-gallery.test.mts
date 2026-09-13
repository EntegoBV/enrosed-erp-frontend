import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseSupplierNote } from '../src/app/features/products/supplier-note.ts';
import { orderedSupplierAgreementPhotos } from '../src/app/features/products/product-supplier-agreement-state.ts';

const source = await readFile(new URL('../src/app/features/products/product-view.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-view.ts', source, ts.ScriptTarget.Latest, true);
const viewClass = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductView');
assert.ok(viewClass);
const names = new Set(['lightbox', 'galleryIndex', 'galleryPointer', 'gallerySuppressClickUntil', 'selectGalleryPhoto', 'stepGallery', 'openCurrentGalleryPhoto', 'startGallerySwipe', 'finishGallerySwipe', 'cancelGallerySwipe', 'scrollToDetailSection', 'revealSelectedVariant', 'supplierAgreement', 'agreementPhotos', 'agreementLoading', 'agreementLoadError', 'supplierNoteBlocks', 'loadSupplierAgreement']);
const members = viewClass.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const selectedClass = ts.factory.updateClassDeclaration(viewClass, viewClass.modifiers?.filter(modifier => !ts.isDecorator(modifier)), viewClass.name, viewClass.typeParameters, undefined, members);
const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [selectedClass])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function harness() {
  const exports: { ProductView?: new () => any } = {};
  let now = 1000;
  const scrolls: unknown[] = [];
  const hashes: string[] = [];
  const target = { scrollIntoView: (value: unknown) => scrolls.push(value) };
  const window = { matchMedia: () => ({ matches: true }), location: { href: 'http://fixture/products/45' }, history: { state: {}, replaceState: (_state: unknown, _title: string, url: URL) => hashes.push(url.hash) } };
  vm.runInNewContext(code, { exports, signal, computed, parseSupplierNote, orderedSupplierAgreementPhotos, messageOf: (failure: Error) => failure.message, performance: { now: () => now }, window, URL, HTMLDetailsElement: class {}, document: { getElementById: (id: string) => id === 'stock-card' ? target : null } });
  const view = new exports.ProductView!();
  view.loadVersion = 1;
  view.product = signal({ id: 45, supplierNote: 'Old local instruction must not leak', photos: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  const events: string[] = [];
  const element = { setPointerCapture: () => events.push('capture'), hasPointerCapture: () => true, releasePointerCapture: () => events.push('release') };
  const pointer = (x: number, y: number, extra = {}) => ({ pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y, currentTarget: element, preventDefault: () => events.push('prevent'), ...extra });
  return { view, pointer, events, scrolls, hashes, advance: () => { now += 400; } };
}

test('photo controls stay inside the selected product and magnify the displayed photo', () => {
  const { view } = harness();
  view.selectGalleryPhoto(99);
  assert.equal(view.galleryIndex(), 2);
  view.openCurrentGalleryPhoto();
  assert.equal(view.lightbox(), 2);
  view.stepGallery(1, 3);
  assert.equal(view.galleryIndex(), 0);
  view.selectGalleryPhoto(-1);
  assert.equal(view.galleryIndex(), 0);
  view.product.set({ id: 46, photos: [] });
  view.selectGalleryPhoto(1);
  view.stepGallery(1, 0);
  assert.equal(view.galleryIndex(), 0);
});

test('a horizontal swipe changes the photo and suppresses its generated zoom click', () => {
  const { view, pointer, events, advance } = harness();
  view.startGallerySwipe(pointer(160, 30), 3);
  view.finishGallerySwipe(pointer(55, 35), 3);
  assert.equal(view.galleryIndex(), 1);
  assert.ok(events.includes('prevent'));
  view.openCurrentGalleryPhoto();
  assert.equal(view.lightbox(), -1);
  advance();
  view.openCurrentGalleryPhoto();
  assert.equal(view.lightbox(), 1);
});

test('vertical scrolling, pointer cancellation and multiple touches do not select another photo', () => {
  const { view, pointer, events } = harness();
  view.startGallerySwipe(pointer(150, 30), 3);
  view.finishGallerySwipe(pointer(120, 140), 3);
  assert.equal(view.galleryIndex(), 0);
  assert.ok(!events.includes('prevent'));
  view.startGallerySwipe(pointer(160, 30), 3);
  view.cancelGallerySwipe();
  view.finishGallerySwipe(pointer(20, 30), 3);
  assert.equal(view.galleryIndex(), 0);
  view.startGallerySwipe(pointer(160, 30), 3);
  view.startGallerySwipe(pointer(170, 30, { isPrimary: false, pointerId: 2 }), 3);
  view.finishGallerySwipe(pointer(20, 30), 3);
  assert.equal(view.galleryIndex(), 0);
});

test('stock information remains reachable without shortcut rails and respects reduced motion', () => {
  const { view, scrolls, hashes } = harness();
  view.scrollToDetailSection('stock-card');
  assert.deepEqual(JSON.parse(JSON.stringify(scrolls)), [{ behavior: 'auto', block: 'start' }]);
  assert.deepEqual(hashes, ['#stock-card']);
  view.scrollToDetailSection('missing');
  assert.equal(scrolls.length, 1);
});


test('selected variants are revealed horizontally while already visible choices stay put', () => {
  const { view } = harness();
  const item = { left: 320, right: 430 };
  const rail = { scrollLeft: 0, getBoundingClientRect: () => ({ left: 10, right: 300 }), querySelector: () => ({ getBoundingClientRect: () => item }) };
  view.revealSelectedVariant(rail);
  assert.equal(rail.scrollLeft, 131);
  item.left = 40; item.right = 150;
  view.revealSelectedVariant(rail);
  assert.equal(rail.scrollLeft, 131, 'No scroll reset on a stable selection');
  item.left = -60; item.right = 50;
  view.revealSelectedVariant(rail);
  assert.equal(rail.scrollLeft, 60);
});

test('effective shared supplier instructions use source photos and never fall back to stale own notes', async () => {
  const { view } = harness();
  const agreement = { productId: 45, sourceProductId: 44, inherited: true, available: true, note: 'Approved shared instructions.', photos: [{ id: 2, position: 1, viewUrl: '/api/products/44/supplier-agreement/photos/2/view' }, { id: 1, position: 0, viewUrl: '/api/products/44/supplier-agreement/photos/1/view' }] };
  view.supplierAgreementApi = { get: async () => agreement };
  await view.loadSupplierAgreement(45, 1);
  assert.equal(view.supplierAgreement().sourceProductId, 44);
  assert.deepEqual(view.agreementPhotos().map((photo: any) => photo.id), [1, 2]);
  assert.match(view.agreementPhotos()[0].viewUrl, /products\/44/);
  assert.equal(view.supplierNoteBlocks()[0].text, 'Approved shared instructions.');
  view.supplierAgreementApi.get = async () => ({ ...agreement, available: false });
  await view.loadSupplierAgreement(45, 1);
  assert.equal(view.agreementPhotos().length, 0);
  assert.equal(view.supplierNoteBlocks().length, 0);
});

test('supplier read failure is explicit; a late previous-product response cannot replace current details', async () => {
  const { view } = harness();
  view.supplierAgreementApi = { get: async () => { throw new Error('Temporary failure'); } };
  await view.loadSupplierAgreement(45, 1);
  assert.equal(view.agreementLoadError(), 'Temporary failure');
  assert.equal(view.supplierNoteBlocks().length, 0);
  let finish!: (value: unknown) => void;
  view.supplierAgreementApi.get = () => new Promise(resolve => { finish = resolve; });
  const pending = view.loadSupplierAgreement(45, 1);
  view.loadVersion = 2;
  view.supplierAgreement.set({ productId: 46, available: true, note: 'Current variant', photos: [] });
  finish({ productId: 45, available: true, note: 'Old variant', photos: [] });
  await pending;
  assert.equal(view.supplierAgreement().productId, 46);
  assert.equal(view.supplierNoteBlocks()[0].text, 'Current variant');
});
