import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { LANGUAGES } from '../src/app/core/api/models.ts';

const source = await readFile(new URL('../src/app/features/portal/portal-page.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('portal-page.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PortalPage');
assert.ok(original);
const names = new Set(['language', 'locale', 'load', 'storedLanguage', 'setLanguage', 'local', 't', 'agreementSettlementText']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, undefined, undefined, members);
const constants = parsed.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ['PORTAL_LOCALES', 'PORTAL_FALLBACKS'].includes(declaration.name.getText(parsed))));
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [...constants, isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function harness() {
  const storage = new Map<string, string>(), calls: any[] = [], exports: any = {};
  vm.runInNewContext(javascript, { exports, signal, computed, LANGUAGES, Intl,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  });
  const page = new exports.PortalPage();
  Object.assign(page, { token: () => 'fixture', quote: signal(null), catalog: signal([]), error: signal(false), proposeBy: signal(''),
    sales: {
      portalQuote: async (token: string, language?: string) => { calls.push(['quote', token, language]); return {
        language: language ?? 'EL', contactName: 'Πελάτης', text: { quote: 'Προσφορά', lineUnavailable: 'Προσωρινά μη διαθέσιμο',
          advanceAgreementSettlement: 'Το μερίδιο της ENROSED (%s%%) στο αποτέλεσμα.' },
      }; },
      portalCatalog: async (token: string, language: string) => { calls.push(['catalog', token, language]); return [{ description: 'Τριαντάφυλλο' }]; },
    },
  });
  return { page, calls, storage };
}

test('a Greek customer quote adopts Greek text and numeric locale without modifying the customer', async () => {
  const { page, calls } = harness(); await page.load('fixture');
  assert.equal(page.language(), 'EL'); assert.equal(page.locale(), 'el-GR');
  assert.equal(page.t('quote'), 'Προσφορά'); assert.equal(page.t('lineUnavailable'), 'Προσωρινά μη διαθέσιμο');
  assert.equal(page.local('chooseLanguage'), 'Επιλογή γλώσσας');
  assert.equal(page.local('nameRequired'), 'Συμπληρώστε το όνομά σας για να υπογράψετε.');
  assert.deepEqual(calls, [['quote', 'fixture', undefined], ['catalog', 'fixture', 'EL']]);
  page.quote.update((quote: any) => ({ ...quote, advanceAgreement: { sharePct: 12.5 } }));
  assert.equal(page.agreementSettlementText(), 'Το μερίδιο της ENROSED (12,5%) στο αποτέλεσμα.');
});

test('Greek selection and a remembered Greek preference use only localized read endpoints', async () => {
  const { page, calls, storage } = harness();
  await page.setLanguage('EL'); assert.equal(storage.get('enrosed.portalLanguage.fixture'), 'EL');
  assert.equal(page.storedLanguage('fixture'), 'EL');
  assert.equal(page.local('loading'), 'Φόρτωση…'); assert.equal(page.t('portalNotFound'), 'Η προσφορά δεν βρέθηκε');
  await page.load('fixture');
  assert.deepEqual(calls, [['quote', 'fixture', 'EL'], ['catalog', 'fixture', 'EL'], ['quote', 'fixture', 'EL'], ['catalog', 'fixture', 'EL']]);
});

test('product and customer language controls include Greek exactly once and retain all other languages', async () => {
  assert.equal(LANGUAGES.filter(({ code }) => code === 'EL').length, 1);
  assert.equal(LANGUAGES.find(({ code }) => code === 'EL')?.label, 'Grieks');
  const editor = await readFile(new URL('../src/app/features/products/product-editor.ts', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../src/app/features/products/product-translation-adapter.ts', import.meta.url), 'utf8');
  const parseLanguages = (text: string, pattern: RegExp) => Array.from(text.match(pattern)?.[1].matchAll(/'([A-Z]{2})'/g) ?? [], m => m[1]);
  assert.deepEqual(parseLanguages(editor, /readonly fixLanguages: LanguageCode\[\] = \[([^\]]+)\]/).sort(), LANGUAGES.map(({ code }) => code).sort());
  assert.deepEqual(parseLanguages(adapter, /const LANGUAGE_ORDER: LanguageCode\[\] = \[([^\]]+)\]/).sort(), LANGUAGES.map(({ code }) => code).sort());
});
