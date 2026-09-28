import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';
import { LANGUAGES } from '../src/app/core/api/models.ts';
import { describePublicationIssues, isPerLanguageSizeIssue } from '../src/app/features/products/publication-issues.ts';

/**
 * The Maat is one value for every language: the translation adapter never
 * asks for it, never reports it missing and never shows or edits a stored
 * per-language copy, and the product editor's publish-fix sheet never asks
 * for it per language. A stored copy goes back untouched on every write, so
 * an older backend never loses it (the size-neutral backend ignores it).
 */
const adapterSource = await readFile(new URL('../src/app/features/products/product-translation-adapter.ts', import.meta.url), 'utf8');
const adapterJavascript = ts.transpileModule(adapterSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const adapter: Record<string, any> = {};
vm.runInNewContext(adapterJavascript, {
  exports: adapter,
  require: (path: string) => {
    assert.equal(path, '../../core/api/models');
    return { LANGUAGES };
  },
});

const labelSource = await readFile(new URL('../src/app/features/website-builder/website-family-label.ts', import.meta.url), 'utf8');
const familyLabel: Record<string, any> = {};
vm.runInNewContext(ts.transpileModule(labelSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: familyLabel,
  require: (path: string) => assert.fail(`website-family-label must stay free of runtime imports, got ${path}`),
});

const editorSource = await readFile(new URL('../src/app/features/products/product-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-editor.ts', editorSource, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductEditor');
assert.ok(original);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && member.name.text === 'planPublishFix');
assert.equal(members.length, 1, 'planPublishFix must still exist');
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const editorJavascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;

/* Only CatalogApi.productWriteBody, the body of PUT /api/products/{id}, without Angular. */
const apiSource = await readFile(new URL('../src/app/core/api/catalog-api.ts', import.meta.url), 'utf8');
const apiParsed = ts.createSourceFile('catalog-api.ts', apiSource, ts.ScriptTarget.Latest, true);
const apiClass = apiParsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'CatalogApi');
assert.ok(apiClass);
const writeBody = apiClass.members.filter(member => member.name && ts.isIdentifier(member.name) && member.name.text === 'productWriteBody');
assert.equal(writeBody.length, 1, 'productWriteBody must still exist');
const apiJavascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(apiParsed, [
  ts.factory.updateClassDeclaration(apiClass, apiClass.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
    apiClass.name, apiClass.typeParameters, undefined, writeBody),
])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;

function catalogApi() {
  const exports: { CatalogApi?: new () => any } = {};
  vm.runInNewContext(apiJavascript, { exports });
  return new exports.CatalogApi!();
}

/** Values built inside the vm realm carry its prototypes; compare them as plain data. */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function diamondDisplay() {
  return {
    id: 21, canonicalVariantKey: 'DIAMOND-RD', name: 'Diamond display', colour: 'Rood', colourHex: '#A91F32',
    variantSize: '4.8*4.8cm', description: null,
    texts: [
      { language: 'FR', name: 'Présentoir diamant', description: null, colour: 'Rouge', variantSize: '4.5*4.5cm' },
      { language: 'DE', name: null, description: null, colour: null, variantSize: '4.5*4.5cm' },
    ],
  };
}

function editor(draft = diamondDisplay()) {
  const exports: { ProductEditor?: new () => any } = {};
  vm.runInNewContext(editorJavascript, { exports });
  const instance = new exports.ProductEditor!();
  instance.draft = signal(draft);
  return instance;
}

test('no language reports a missing Maat, even when an old translated size is stored', () => {
  const product = diamondDisplay();
  for (const { code } of LANGUAGES) {
    const keys = adapter.translationGaps(null, product, code).map((gap: { key: string }) => gap.key);
    assert.ok(!keys.includes('variant-size'), `${code} must not ask for a Maat`);
  }
  assert.deepEqual(plain(adapter.translationGaps(null, product, 'FR')), []);
  assert.deepEqual(plain(adapter.translationGaps(null, product, 'DE').map((gap: { key: string }) => gap.key)),
    ['variant-name', 'variant-colour']);
});

test('a stored per-language size is never shown, and every language labels the variant with the one Maat', () => {
  const product = diamondDisplay();
  assert.equal(adapter.productText(product, 'FR').variantSize, null);
  assert.equal(adapter.productText(product, 'FR').colour, 'Rouge');
  assert.equal(adapter.productText(product, 'ES').variantSize, null);

  assert.equal(adapter.variantLabelIn(product, 'FR'), 'Rouge · 4.8*4.8cm');
  assert.equal(adapter.variantLabelIn(product, 'DE'), 'Rood · 4.8*4.8cm');
  assert.equal(adapter.variantLabelIn(product, 'NL'), 'Rood · 4.8*4.8cm');
  assert.equal(adapter.variantLabelIn({ ...product, colour: null }, 'DE'), '4.8*4.8cm');
});

test('editing a language never writes a per-language size and sends a stored one back untouched', () => {
  const product = diamondDisplay();
  const updated = adapter.upsertProductText(product, 'FR', { colour: 'Rouge vif', variantSize: '9*9cm' });
  assert.deepEqual(plain(updated.texts.find((text: { language: string }) => text.language === 'FR')),
    { language: 'FR', name: 'Présentoir diamant', description: null, colour: 'Rouge vif', variantSize: '4.5*4.5cm' });
  assert.deepEqual(plain(updated.texts.find((text: { language: string }) => text.language === 'DE')),
    plain(product.texts[1]));
  assert.equal(updated.variantSize, '4.8*4.8cm');

  const added = adapter.upsertProductText(product, 'ES', { colour: 'Rojo', variantSize: '9*9cm' });
  assert.deepEqual(plain(added.texts.find((text: { language: string }) => text.language === 'ES')),
    { language: 'ES', name: null, description: null, colour: 'Rojo', variantSize: null });
  assert.equal(product.texts[0].colour, 'Rouge', 'the input stays untouched');
});

test('a product save sends the loaded texts back unchanged, stored per-language size included', () => {
  const product = { ...diamondDisplay(), supplierNote: null, colourHex: null };
  const body = plain(catalogApi().productWriteBody(product));
  assert.deepEqual(body.texts, plain(diamondDisplay().texts));
  assert.equal(body.variantSize, '4.8*4.8cm');
  assert.equal(body.colourHex, '', 'an empty optional field is still an explicit clear');
  assert.equal(body.supplierNote, '');

  assert.equal(plain(catalogApi().productWriteBody({ ...product, variantSize: null })).variantSize, '');
});

test('the publish-fix sheet asks for the colour per language but never for the Maat', () => {
  const plan = editor().planPublishFix('Productfamilie diamond-display niet publiceerbaar: '
    + 'website.families.diamond-display.variants.DIAMOND-RD.fr.size; '
    + 'website.families.diamond-display.variants.DIAMOND-RD.fr.color; '
    + 'website.families.diamond-display.variants.DIAMOND-BL.de.size');

  assert.deepEqual(plain(plan.items.map((item: { field: string; languages: string[] }) => [item.field, item.languages])),
    [['color', ['FR']]]);
  assert.deepEqual(plain(plan.notes), []);
});

test('a refusal about the Maat alone opens no fix sheet', () => {
  assert.equal(editor().planPublishFix('Productfamilie diamond-display niet publiceerbaar: '
    + 'website.families.diamond-display.variants.DIAMOND-RD.fr.size; '
    + 'website.families.diamond-display.variants.DIAMOND-RD.de.size'), null);
});

test('an old per-language size issue never reads as a missing translation', () => {
  const lines = describePublicationIssues([
    'website.families.diamond-display.variants.DIAMOND-RD.fr.size',
    'website.families.diamond-display.variants.DIAMOND-RD.de.size',
    'website.families.diamond-display.variants.DIAMOND-RD.fr.color',
  ], new Map([['DIAMOND-RD', 'Rood']]));

  assert.deepEqual(lines, [
    'Kleurnaam van Rood nog niet vertaald in FR',
    'Maat van Rood geldt voor alle talen en wordt niet vertaald; een oudere server vraagt die nog in FR, DE',
  ]);
  assert.ok(lines.every((line) => !/Maat.*nog niet vertaald/.test(line)));
  assert.equal(isPerLanguageSizeIssue('website.families.x.variants.RD.fr.size'), true);
  assert.equal(isPerLanguageSizeIssue('website.families.x.variants.RD.fr.color'), false);
  assert.equal(isPerLanguageSizeIssue('products.21.size'), false);
});

test('the website translation brief gives the Maat as fixed context, never as a value to translate', () => {
  const line = familyLabel.variantBriefSource([
    { productId: 21, name: 'Diamond display', colour: 'Rood', size: '4.8*4.8cm' },
    { productId: 22, name: 'Diamond display', colour: null, size: null },
  ]);

  assert.equal(line, 'productId=21; naam=Diamond display; kleur=Rood; maat (niet vertalen, geldt voor alle talen)=4.8*4.8cm'
    + ' || productId=22; naam=Diamond display; kleur=; maat (niet vertalen, geldt voor alle talen)=');
  assert.ok(!/(^|; )maat=/.test(line), 'no bare maat= value that reads as translatable');
});
