import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import * as state from '../src/app/features/products/product-supplier-agreement-state.ts';

const source = await readFile(new URL('../src/app/features/products/product-supplier-agreement-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-supplier-agreement-editor.ts', source, ts.ScriptTarget.Latest, true);
const declaration = parsed.statements.find((n): n is ts.ClassDeclaration => ts.isClassDeclaration(n) && n.name?.text === 'ProductSupplierAgreementEditor');
assert.ok(declaration);
const external = new Set(['catalog', 'agreements', 'ui', 'productId', 'supplierId', 'persistedSupplierId', 'supplierName', 'note', 'disabled', 'productDirty', 'noteChange', 'applicabilitySaved']);
const members = declaration.members.filter(m => !ts.isConstructorDeclaration(m) && !(m.name && ts.isIdentifier(m.name) && external.has(m.name.text)));
const selected = ts.factory.updateClassDeclaration(declaration, declaration.modifiers?.filter(m => !ts.isDecorator(m)), declaration.name, undefined, undefined, members);
const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [selected])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const photo = (id: number, caption: string) => ({ id, productId: 1, supplierId: 9, caption, position: id, originalFilename: `${id}.png`, viewUrl: `/api/products/1/supplier-agreement/photos/${id}` });
function harness(inherited = false) {
  const exports: { ProductSupplierAgreementEditor?: new () => any } = {};
  vm.runInNewContext(code, { exports, signal, computed, ...state, URL, messageOf: (e: Error) => e.message });
  const editor = new exports.ProductSupplierAgreementEditor!();
  let saved: any = { productId: inherited ? 2 : 1, sourceProductId: 1, supplierId: 9, familyId: 10, inherited, available: true, revision: 'revision1', note: 'Source instruction', photos: [photo(4, 'Front'), photo(5, 'Back')], variants: [{ productId: 1, color: 'Red' }, { productId: 2, color: 'Blue' }], eligibleVariants: [{ productId: 1 }, { productId: 2 }, { productId: 3 }] };
  const writes: any[] = [], notes: any[] = [], toasts: any[] = [];
  editor.productId = signal(saved.productId); editor.supplierId = signal(9); editor.persistedSupplierId = signal(9);
  editor.disabled = signal(false); editor.productDirty = signal(false); editor.note = signal(inherited ? 'Local retained instruction' : saved.note);
  editor.applicabilitySaved = { emit: () => {} }; editor.noteChange = { emit: (note: any) => notes.push(note) }; editor.ui = { toast: (...args: any[]) => toasts.push(args) };
  editor.agreement.set(saved); editor.selectedVariantIds.set([1, 2]); editor.replaceSupplierPhotos(saved.photos);
  editor.agreements = {
    get: async () => saved,
    saveApplicability: async (...args: any[]) => { writes.push(args); saved = { ...saved, revision: 'revision2', variants: args[2].map((productId: number) => ({ productId })) }; return saved; },
    unlink: async (...args: any[]) => { writes.push(args); saved = { ...saved, inherited: false, sourceProductId: 2, note: 'Local retained instruction', photos: [], variants: [{ productId: 2 }] }; return saved; },
  };
  editor.catalog = { updateSupplierAgreementPhotoCaption: async (product: number, id: number, caption: string) => {
    writes.push(['caption', product, id, caption]);
    saved = { ...saved, revision: `caption${id}`, photos: saved.photos.map((p: any) => p.id === id ? { ...p, caption } : p) };
    return saved.photos.find((p: any) => p.id === id);
  } };
  return { editor, writes, notes, toasts, saved: () => saved, setSaved: (value: any) => { saved = value; } };
}

test('inherited source is read-only and does not overwrite the retained local note or upload into the target', async () => {
  const { editor, writes, notes } = harness(true);
  assert.equal(editor.displayNote(), 'Source instruction');
  assert.equal(editor.note(), 'Local retained instruction');
  editor.changeNote('Unintended overwrite'); editor.changeCaption(4, 'Unintended caption');
  await editor.saveCaption(photo(4, 'Front')); await editor.uploadPending(); await editor.flush(2);
  assert.deepEqual(writes, []); assert.deepEqual(notes, []);
  assert.equal(editor.captionDraft(photo(4, 'Front')), 'Front');
  await editor.unlinkAgreement();
  assert.equal(writes.length, 1); assert.deepEqual(notes, ['Local retained instruction']);
  assert.equal(editor.agreement().inherited, false);
});

test('only explicit selected colours are written and failed applicability remains pending for retry', async () => {
  const { editor, writes } = harness();
  editor.toggleVariant(3, true);
  assert.equal(writes.length, 0); assert.equal(editor.selectionDirty(), true);
  editor.productDirty.set(true);
  assert.equal(await editor.saveApplicability(), false); assert.equal(writes.length, 0);
  editor.productDirty.set(false);
  const original = editor.agreements.saveApplicability;
  editor.agreements.saveApplicability = async () => { throw new Error('Temporary failure'); };
  assert.equal(await editor.saveApplicability(), false); assert.equal(editor.selectionDirty(), true);
  assert.equal(editor.selectedVariantIds().join(','), '1,2,3');
  editor.agreements.saveApplicability = original;
  assert.equal(await editor.saveApplicability(), true);
  assert.equal(writes[0][2].join(','), '1,2,3'); assert.equal(editor.selectionDirty(), false);
});

test('saving two captions preserves the second draft across reloads and then commits the selected group', async () => {
  const { editor, writes } = harness();
  editor.changeCaption(4, 'New front'); editor.changeCaption(5, 'New back'); editor.toggleVariant(3, true);
  const result = await editor.flush(1);
  assert.equal(result.savedCaptions, 2); assert.equal(result.remaining, 0); assert.equal(result.groupPending, undefined);
  assert.deepEqual(writes.slice(0, 2), [['caption', 1, 4, 'New front'], ['caption', 1, 5, 'New back']]);
  assert.equal(writes[2][1], 'caption5'); assert.equal(writes[2][2].join(','), '1,2,3');
  assert.equal(editor.dirty(), false);
});

test('a concurrent group edit during parent save is reported rather than silently replaced', async () => {
  const { editor, writes, setSaved, saved } = harness();
  editor.toggleVariant(3, true);
  setSaved({ ...saved(), variants: [{ productId: 1 }], revision: 'someone-else' });
  const result = await editor.flush(1);
  assert.equal(result.groupPending, true); assert.equal(result.remaining, 0);
  assert.deepEqual(writes, []);
});


test('a successful group retry only clears its own parent error, preserving unrelated failures', async () => {
  const source = await readFile(new URL('../src/app/features/products/product-editor.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('product-editor.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find((n): n is ts.ClassDeclaration => ts.isClassDeclaration(n) && n.name?.text === 'ProductEditor')!;
  const member = declaration.members.find(m => m.name && ts.isIdentifier(m.name) && m.name.text === 'agreementGroupSaved')!;
  assert.ok(member);
  const selected = ts.factory.updateClassDeclaration(declaration, declaration.modifiers?.filter(m => !ts.isDecorator(m)), declaration.name, undefined, undefined, [member]);
  const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [selected])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, { exports });
  const parent = new exports.ProductEditor();
  parent.agreementGroupError = 'Group save failed'; parent.saveError = signal('Group save failed');
  parent.agreementGroupSaved(); assert.equal(parent.saveError(), null);
  parent.agreementGroupError = 'Group save failed'; parent.saveError.set('Other product validation failed');
  parent.agreementGroupSaved(); assert.equal(parent.saveError(), 'Other product validation failed');
  assert.match(source, /\(applicabilitySaved\)="agreementGroupSaved\(\)"/);
});
