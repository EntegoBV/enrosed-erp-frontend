import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import type { Category, Product, ProductFamily, ProductFamilyMember } from '../src/app/core/api/models.ts';
import {
  productCatalogNavigation,
  productVariantNavigation,
  productVariantOptionLabel,
} from '../src/app/features/products/product-variant-navigation.ts';

test('arrows stay inside the family and follow canonical variant position', () => {
  const members = [
    member(33, 3, 'White'),
    member(11, 1, 'Red'),
    member(22, 2, 'Pink'),
  ];

  const navigation = productVariantNavigation({ members }, 22);

  assert.equal(navigation?.current.productId, 22);
  assert.equal(navigation?.previous?.productId, 11);
  assert.equal(navigation?.next?.productId, 33);
  assert.equal(navigation?.index, 1);
  assert.equal(navigation?.total, 3);
  assert.deepEqual(members.map((item) => item.productId), [33, 11, 22], 'source order stays untouched');
});

test('inactive siblings remain reachable in the ERP family sequence', () => {
  const members = [
    member(10, 1, 'Red'),
    member(20, 2, 'Old pink', false),
    member(30, 3, 'White'),
  ];

  const fromActive = productVariantNavigation({ members }, 10);
  assert.equal(fromActive?.next?.productId, 20);
  assert.equal(fromActive?.total, 3);

  const fromInactive = productVariantNavigation({ members }, 20);
  assert.equal(fromInactive?.previous?.productId, 10);
  assert.equal(fromInactive?.next?.productId, 30);
  assert.equal(fromInactive?.total, 3);
});

test('no ambiguous global fallback exists without a usable family sequence', () => {
  assert.equal(productVariantNavigation(null, 10), null);
  assert.equal(productVariantNavigation({ members: [member(10, 1, 'Red')] }, 10), null);
  assert.equal(productVariantNavigation({ members: [member(10, 1, 'Red'), member(20, 2, 'White')] }, 99), null);
});

test('first and last colour expose only the available direction', () => {
  const members = [member(10, 1, 'Red'), member(20, 2, 'White')];

  const first = productVariantNavigation({ members }, 10);
  assert.equal(first?.previous, null);
  assert.equal(first?.next?.productId, 20);

  const last = productVariantNavigation({ members }, 20);
  assert.equal(last?.previous?.productId, 10);
  assert.equal(last?.next, null);
});

test('variant labels say colour and size, then fall back safely', () => {
  assert.equal(productVariantOptionLabel({ ...member(10, 1, 'Red'), size: 'XL' }), 'Red · XL');
  assert.equal(productVariantOptionLabel({ ...member(20, 2, ''), name: 'Naamvariant' }), 'Naamvariant');
  assert.equal(productVariantOptionLabel(member(30, 3, 'Old pink', false)), 'Old pink (inactief)');
});

test('last colour continues to the next product model and then through its colours', () => {
  const categories = [{ id: 1, name: 'Rozen', position: 1 } as Category];
  const products = [
    product(11, 10, 'Model A rood', 'Red', 1),
    product(12, 10, 'Model A wit', 'White', 2),
    product(21, 20, 'Model B blauw', 'Blue', 1),
    product(22, 20, 'Model B roze', 'Pink', 2),
  ];
  const families = [
    family(20, 'Model B', 2, [member(21, 1, 'Blue'), member(22, 2, 'Pink')]),
    family(10, 'Model A', 1, [member(11, 1, 'Red'), member(12, 2, 'White')]),
  ];

  const lastColour = productCatalogNavigation(products, families, categories, 12);
  assert.equal(lastColour?.index, 1);
  assert.equal(lastColour?.total, 2);
  assert.equal(lastColour?.previous?.productId, 11);
  assert.equal(lastColour?.previousChangesProduct, false);
  assert.equal(lastColour?.next?.productId, 21);
  assert.equal(lastColour?.next?.groupName, 'Model B');
  assert.equal(lastColour?.nextChangesProduct, true);

  const firstNextProductColour = productCatalogNavigation(products, families, categories, 21);
  assert.equal(firstNextProductColour?.index, 0);
  assert.equal(firstNextProductColour?.total, 2);
  assert.equal(firstNextProductColour?.previous?.productId, 12);
  assert.equal(firstNextProductColour?.previousChangesProduct, true);
  assert.equal(firstNextProductColour?.next?.productId, 22);
  assert.equal(firstNextProductColour?.nextChangesProduct, false);
});

// Exercise the actual editor's toolbar methods with signals and controlled I/O.
const editorSource = await readFile(new URL('../src/app/features/products/product-editor.ts', import.meta.url), 'utf8');
const parsedEditor = ts.createSourceFile('product-editor.ts', editorSource, ts.ScriptTarget.Latest, true);
const editorClass = parsedEditor.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductEditor');
assert.ok(editorClass);
const toolbarMembers = new Set(['formWriteBusy', 'toolbarBusy', 'navFamiliesReady', 'catalogueNeighbours', 'catalogueStepLabel',
  'toolbarMenu', 'toolbarMenuTrigger', 'toolbarMenuDesktop', 'toolbarMenuItems', 'openToolbarMenu', 'closeToolbarMenu', 'pickToolbarAction',
  'syncToolbarViewport', 'toolbarMenuKeydown', 'loadFamilies']);
const selectedMembers = editorClass.members.filter(member => member.name && ts.isIdentifier(member.name) && toolbarMembers.has(member.name.text));
assert.equal(selectedMembers.length, toolbarMembers.size);
const selectedClass = ts.factory.updateClassDeclaration(editorClass, editorClass.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  editorClass.name, editorClass.typeParameters, undefined, selectedMembers);
const toolbarCode = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsedEditor, [selectedClass])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;

class ToolbarTrigger {
  focusCalls = 0;
  getBoundingClientRect() { return { right: 600, bottom: 40 }; }
  focus() { this.focusCalls++; }
}

function toolbarHarness() {
  const exports: { ProductEditor?: new () => any } = {};
  vm.runInNewContext(toolbarCode, { exports, computed, signal, productCatalogNavigation, HTMLElement: ToolbarTrigger, HostListener: () => () => {} });
  const editor = new exports.ProductEditor!();
  const actions: string[] = [];
  const families = [family(10, 'Model A', 1, [member(11, 1, 'Red'), member(12, 2, 'White')]),
    family(20, 'Model B', 2, [member(21, 1, 'Blue')])];
  Object.assign(editor, {
    saving: signal(false), photoUploading: signal(false), agreementBusy: signal(false), translationSaving: signal(false),
    sharedFieldsBusy: signal(false), stockSaving: signal(false), takingCode: signal(false), translationDirty: signal(false),
    desktop: { active: signal(true) }, editorReady: signal(true), isNew: signal(false),
    draft: signal(product(12, 10, 'Model A wit', 'White', 2)), family: signal(families[0]), families: signal([]),
    categories: signal([{ id: 1, name: 'Rozen', position: 1 }]),
    catalogueProducts: signal([product(11, 10, 'Model A rood', 'Red', 1), product(12, 10, 'Model A wit', 'White', 2),
      product(21, 20, 'Model B blauw', 'Blue', 1)]),
    catalog: { productFamilies: async () => families }, loadFamilyForProduct: async () => {},
    openSharedFields: () => actions.push('shared'), startCopy: () => actions.push('variant'), remove: () => actions.push('delete'),
    router: { navigate: async () => { actions.push('translations'); return true; } },
  });
  return { editor, actions, families, trigger: new ToolbarTrigger() };
}

test('catalogue arrows wait for complete family ordering and then cross to the next product', async () => {
  const { editor, families } = toolbarHarness();
  let finish!: (value: unknown) => void;
  editor.catalog.productFamilies = () => new Promise(resolve => { finish = resolve; });
  const loading = editor.loadFamilies();
  assert.equal(editor.catalogueNeighbours(), null, 'No guessed order while family positions are still loading');
  finish(families);
  await loading;
  assert.equal(editor.catalogueNeighbours().previous.productId, 11);
  assert.equal(editor.catalogueNeighbours().next.productId, 21);
  assert.equal(editor.catalogueStepLabel('previous'), 'Vorige kleur: Red');
  assert.equal(editor.catalogueStepLabel('next'), 'Volgend product: Model B · Blue');
});

test('unavailable family ordering hides catalogue arrows while editing remains usable', async () => {
  const { editor, families } = toolbarHarness();
  await editor.loadFamilies();
  assert.ok(editor.catalogueNeighbours());
  editor.catalog.productFamilies = async () => { throw new Error('Unavailable'); };
  await editor.loadFamilies();
  assert.equal(editor.catalogueNeighbours(), null);
  assert.equal(editor.editorReady(), true);
  editor.catalog.productFamilies = async () => families;
  await editor.loadFamilies();
  assert.equal(editor.catalogueNeighbours().next.productId, 21);
});

test('toolbar opening and already-open actions are blocked throughout all writes and barcode allocation', () => {
  for (const flag of ['saving', 'photoUploading', 'agreementBusy', 'translationSaving', 'sharedFieldsBusy', 'stockSaving', 'takingCode']) {
    const { editor, actions, trigger } = toolbarHarness();
    editor.openToolbarMenu({ currentTarget: trigger });
    assert.ok(editor.toolbarMenu());
    editor[flag].set(true);
    for (const item of editor.toolbarMenuItems()) {
      assert.equal(item.disabled, true, `${flag}: ${item.id}`);
      editor.pickToolbarAction(item);
    }
    assert.deepEqual(actions, []);
    editor.closeToolbarMenu();
    editor.openToolbarMenu({ currentTarget: trigger });
    assert.equal(editor.toolbarMenu(), null, flag);
    editor[flag].set(false);
    editor.openToolbarMenu({ currentTarget: trigger });
    editor.pickToolbarAction({ id: 'variant' });
    assert.deepEqual(actions, ['variant'], 'Actions become available again after the operation');
  }
});

test('the toolbar preserves translation and family guards when invoking existing actions', () => {
  const { editor, actions, trigger } = toolbarHarness();
  editor.translationDirty.set(true);
  editor.openToolbarMenu({ currentTarget: trigger });
  for (const id of ['shared', 'variant', 'delete', 'unknown']) editor.pickToolbarAction({ id });
  assert.deepEqual(actions, []);
  editor.pickToolbarAction({ id: 'translations' });
  assert.deepEqual(actions, ['translations']);
  editor.translationDirty.set(false);
  editor.family.set({ ...editor.family(), members: [member(12, 1, 'White')] });
  editor.pickToolbarAction({ id: 'shared' });
  assert.deepEqual(actions, ['translations'], 'A family with no other variants is not a copy destination');
});

test('Tab closes the local menu, restores trigger focus and keeps native Tab behavior', () => {
  const { editor, trigger } = toolbarHarness();
  editor.openToolbarMenu({ currentTarget: trigger });
  let prevented = false;
  editor.toolbarMenuKeydown({ key: 'ArrowDown', preventDefault: () => { prevented = true; } });
  assert.ok(editor.toolbarMenu());
  editor.toolbarMenuKeydown({ key: 'Tab', preventDefault: () => { prevented = true; } });
  assert.equal(editor.toolbarMenu(), null);
  assert.equal(trigger.focusCalls, 1);
  assert.equal(prevented, false);
  editor.toolbarMenuKeydown({ key: 'Tab' });
  assert.equal(trigger.focusCalls, 1, 'No focus changes when the menu is already closed');
});

test('switching viewport closes the menu; mobile can open the same actions as a sheet', () => {
  const { editor, trigger } = toolbarHarness();
  editor.openToolbarMenu({ currentTarget: trigger });
  editor.syncToolbarViewport();
  assert.ok(editor.toolbarMenu(), 'Remaining on desktop does not dismiss an open menu');
  editor.desktop.active.set(false);
  editor.syncToolbarViewport();
  assert.equal(editor.toolbarMenu(), null);
  assert.equal(trigger.focusCalls, 0);
  editor.openToolbarMenu({ currentTarget: trigger });
  assert.ok(editor.toolbarMenu(), 'The mobile Actions button opens the sheet');
  editor.syncToolbarViewport();
  assert.ok(editor.toolbarMenu(), 'Remaining on mobile must not dismiss the sheet');
  editor.toolbarMenuKeydown({ key: 'Tab' });
  assert.ok(editor.toolbarMenu(), 'The mobile sheet owns its focus trap');
  editor.desktop.active.set(true);
  editor.syncToolbarViewport();
  assert.equal(editor.toolbarMenu(), null);
});

function member(
  productId: number,
  position: number,
  colour: string,
  active = true,
): ProductFamilyMember {
  return {
    productId,
    canonicalVariantKey: `variant-${productId}`,
    sku: `SKU-${productId}`,
    name: `Product ${productId}`,
    colour,
    colourHex: null,
    size: null,
    position,
    active,
  };
}

function product(
  id: number,
  familyId: number,
  name: string,
  colour: string,
  variantPosition: number,
): Product {
  return {
    id,
    familyId,
    familyKey: `model-${familyId}`,
    categoryId: 1,
    name,
    colour,
    colourHex: null,
    variantSize: null,
    variantPosition,
    canonicalVariantKey: `model-${familyId}-${colour.toLowerCase()}`,
    sku: `SKU-${id}`,
    active: true,
    photos: [],
  } as Product;
}

function family(
  id: number,
  name: string,
  productPosition: number,
  members: ProductFamilyMember[],
): ProductFamily {
  return {
    id,
    name,
    familyKey: `model-${id}`,
    categoryId: 1,
    productPosition,
    members,
    cardFeaturedProductId: null,
  } as ProductFamily;
}
