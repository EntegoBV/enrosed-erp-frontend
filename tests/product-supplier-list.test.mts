import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import * as rules from '../src/app/features/products/product-suppliers.ts';

/**
 * Several suppliers (2026-10-25), the editor's Inkoop list and its sheet: the
 * CSS pins of the list rows (two lines, a long name ends in an ellipsis, the
 * price never wraps), the template words, and the sheet's write rules run on
 * the production class bodies (AST selection, Angular's DI left out).
 */
const listSource = await readFile(new URL('../src/app/features/products/product-supplier-list.ts', import.meta.url), 'utf8');
const sheetSource = await readFile(new URL('../src/app/features/products/product-supplier-sheet.ts', import.meta.url), 'utf8');

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  assert.ok(match, `rule ${selector} exists`);
  return match[1];
}

/** The class (and the file's plain functions) as runnable JavaScript; imports come from the context. */
function classCode(source: string, file: string, name: string, external: Set<string>): string {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(declaration);
  const members = declaration.members.filter((member) => !(member.name && ts.isIdentifier(member.name) && external.has(member.name.text)));
  const isolated = ts.factory.updateClassDeclaration(declaration, declaration.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
    declaration.name, undefined, undefined, members);
  const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node));
  return ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [...functions, isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

function row(id: number, supplierId: number, supplierName: string, extra: Partial<Record<string, unknown>> = {}) {
  return { id, productId: 94, supplierId, supplierName, supplierCity: null, supplierCurrency: 'USD', supplierIncoterm: 'FOB',
    supplierLeadTimeDays: 40, preferred: false, active: true, versionLabel: null, supplierReference: null, exwPrice: 2.35,
    exwCurrency: 'USD', extraUnitCost: null, moq: null, leadTimeDays: null, supplierNote: null, photoCount: 0, lastOrder: null,
    lastCost: null, purchaseLineCount: 0, updatedAt: '2026-10-25T19:02:11.123456Z', ...extra } as any;
}

test('list rows: a long supplier name ends in an ellipsis and the price never wraps', () => {
  const name = cssRule(listSource, '.psl-row__name');
  assert.match(name, /min-width:\s*0/);
  assert.match(name, /overflow:\s*hidden/);
  assert.match(name, /text-overflow:\s*ellipsis/);
  assert.match(name, /white-space:\s*nowrap/);
  const price = cssRule(listSource, '.psl-row__price');
  assert.match(price, /flex:\s*none/);
  assert.match(price, /white-space:\s*nowrap/);
  const sub = cssRule(listSource, '.psl-row__sub');
  assert.match(sub, /text-overflow:\s*ellipsis/, 'line 2 stays one line too: rows are at most two lines');
  assert.match(sub, /white-space:\s*nowrap/);
});

test('list template: add button the editor focuses, Voorkeur and Inactief pills, the inactive fold', () => {
  assert.match(listSource, /<button class="psl-add" id="ps-add" type="button" \[disabled\]="disabled\(\)" \(click\)="add\(\)">\+ Leverancier toevoegen<\/button>/);
  assert.match(listSource, /<span class="wk-pill tone-accent psl-row__pill">Voorkeur<\/span>/);
  assert.match(listSource, /<span class="wk-pill psl-row__pill">Inactief<\/span>/);
  assert.match(listSource, /\{\{ inactive\(\)\.length \}\} inactief <span aria-hidden="true">\{\{ showInactive\(\) \? '⌄' : '›' \}\}<\/span>/);
  assert.match(listSource, /\(changed\)="changed\.emit\(\$event\)" \(stale\)="reload\.emit\(\)" \(closed\)="sheet\.set\(null\)"/);
});

function list() {
  const exports: { ProductSupplierList?: new () => any } = {};
  vm.runInNewContext(classCode(listSource, 'product-supplier-list.ts', 'ProductSupplierList',
    new Set(['productId', 'rows', 'suppliers', 'unitSingular', 'disabled', 'desktop', 'changed', 'reload'])),
  { exports, signal, computed, Intl, ...rules });
  const component = new exports.ProductSupplierList!();
  Object.assign(component, { rows: signal([]), disabled: signal(false) });
  return component;
}

test('list: Voorkeur first, inactive rows apart; price in the row\'s own currency with the extra; two-part line 2', () => {
  const component = list();
  component.rows.set([
    row(3, 9, 'Ningbo Brightway Homeware', { active: false, exwPrice: 52, exwCurrency: 'CNY' }),
    row(2, 7, 'Yiwu Rosegift Trading Co., Ltd', { versionLabel: 'B · dikker glas', supplierReference: 'RG-1530', moq: 600,
      leadTimeDays: 40, extraUnitCost: 0.15, exwPrice: 9.1, lastOrder: { orderId: 31, number: 'PO-2025-022', name: 'x', orderDate: null,
        status: 'ONTVANGEN', exwPrice: 8.9, exwCurrency: 'USD' }, lastCost: { unitEur: 8.318, appliedAt: '2026-08-23', orderNumber: null } }),
    row(1, 3, 'Yiwu Jerry Crafts Co., Ltd', { preferred: true }),
  ]);
  assert.deepEqual(component.active().map((item: any) => item.id), [1, 2]);
  assert.deepEqual(component.inactive().map((item: any) => item.id), [3]);
  assert.deepEqual([...component.taken()], [9, 7, 3], 'inactive suppliers count as taken: one row per supplier');
  const nbsp = (text: string) => text.replace(/ /g, ' ');
  assert.equal(nbsp(component.price(component.active()[1])), 'US$ 9,10 + 0,15');
  assert.equal(nbsp(component.price(component.inactive()[0])), 'CN¥ 52,00');
  assert.equal(nbsp(component.price(row(4, 1, 'X', { exwPrice: 1.855 }))), 'US$ 1,855', 'a third decimal stays visible');
  assert.equal(component.price(row(5, 1, 'X', { exwPrice: null })), '—', 'a backfilled row without price');
  assert.equal(nbsp(component.sub(component.active()[1])), 'Versie B · dikker glas · ref RG-1530 · MOQ 600 · 40 dagen · laatst PO-2025-022 · kostprijs € 8,32');
  assert.equal(component.sub(component.active()[0]), 'nog niet besteld');
});

test('list: nothing opens while the editor is busy', () => {
  const component = list();
  component.disabled.set(true);
  component.add();
  component.edit(row(1, 3, 'Jerry'));
  assert.equal(component.sheet(), null);
  component.disabled.set(false);
  component.add();
  assert.equal(component.sheet()?.row, null);
  assert.notEqual(component.sheet(), null, 'the add sheet is open');
});

function sheet(current: any = null) {
  const exports: { ProductSupplierSheet?: new () => any } = {};
  vm.runInNewContext(classCode(sheetSource, 'product-supplier-sheet.ts', 'ProductSupplierSheet',
    new Set(['catalog', 'ui', 'productId', 'row', 'suppliers', 'taken', 'unitSingular', 'variant', 'changed', 'stale', 'closed'])),
  { exports, signal, computed, JSON, Number, ...rules, escapeHtml: (text: string) => text,
    messageOf: (failure: any, fallback: string) => failure?.error?.message ?? fallback });
  const component = new exports.ProductSupplierSheet!();
  const events: string[] = [];
  const toasts: [string, string?][] = [];
  const writes: unknown[][] = [];
  const confirms: { title: string; message: string; onConfirm: () => void }[] = [];
  const answer = { rows: [], product: { supplierId: 3, supplierNote: null, exwPrice: 2.35, exwCurrency: 'USD', extraUnitCost: null } };
  Object.assign(component, {
    productId: signal(94), row: signal(current), taken: signal([3]), unitSingular: signal('stuk'), variant: signal('default'),
    suppliers: signal([{ id: 3, name: 'Jerry', currency: 'USD', leadTimeDays: 40 }, { id: 9, name: 'Ningbo', currency: 'CNY', leadTimeDays: 30 }]),
    changed: { emit: (value: unknown) => events.push(`changed:${value === answer}`) },
    stale: { emit: () => events.push('stale') },
    closed: { emit: () => events.push('closed') },
    ui: { toast: (message: string, type?: string) => toasts.push([message, type]),
      confirm: (options: any, onConfirm: () => void) => confirms.push({ ...options, onConfirm }) },
    catalog: {
      addProductSupplier: async (...args: unknown[]) => { writes.push(['add', ...args]); return answer; },
      updateProductSupplier: async (...args: unknown[]) => { writes.push(['update', ...args]); return answer; },
      setPreferredProductSupplier: async (...args: unknown[]) => { writes.push(['preferred', ...args]); return answer; },
      setProductSupplierActive: async (...args: unknown[]) => { writes.push(['active', ...args]); return answer; },
      deleteProductSupplier: async (...args: unknown[]) => { writes.push(['delete', ...args]); return answer; },
    },
  });
  component.ngOnInit();
  return { component, events, toasts, writes, confirms };
}

test('sheet add: only suppliers not on the product; a chosen supplier brings its currency; the client refuses first', async () => {
  const { component, events, toasts, writes } = sheet();
  assert.deepEqual(component.choices().map((supplier: any) => supplier.id), [9]);
  assert.equal(component.title(), 'Leverancier toevoegen');
  await component.submit();
  assert.deepEqual(toasts.at(-1), ['Kies een leverancier', 'err']);
  component.pickSupplier(9);
  assert.equal(component.form().exwCurrency, 'CNY');
  assert.equal(component.leadPlaceholder(), '30', 'the supplier\'s own lead time as the hint');
  await component.submit();
  assert.deepEqual(toasts.at(-1), ['Vul de EXW-prijs in', 'err']);
  component.set({ exwPrice: 50, versionLabel: '  C · kunststof voet ' });
  component.moqText.set('1.200');
  component.leadText.set('x');
  await component.submit();
  assert.deepEqual(toasts.at(-1), ['Vul een heel aantal in', 'err']);
  assert.equal(writes.length, 0, 'nothing is sent before the form is right');
  component.leadText.set('');
  await component.submit();
  assert.deepEqual(writes, [['add', 94, { supplierId: 9, versionLabel: 'C · kunststof voet', supplierReference: null, exwPrice: 50,
    exwCurrency: 'CNY', extraUnitCost: null, moq: 1200, leadTimeDays: null }]]);
  assert.deepEqual(events, ['changed:true', 'closed']);
  assert.deepEqual(toasts.at(-1), ['Leverancier toegevoegd', undefined]);
});

test('sheet edit: sends the row\'s updatedAt; row actions wait while the form has unsaved edits', async () => {
  const current = row(702, 7, 'Yiwu Rosegift Trading Co., Ltd', { moq: 600, purchaseLineCount: 2 });
  const { component, events, toasts, writes } = sheet(current);
  assert.equal(component.title(), 'Yiwu Rosegift Trading Co., Ltd');
  assert.equal(component.moqText(), '600');
  assert.equal(component.formDirty(), false);
  component.set({ exwPrice: 2.4 });
  assert.equal(component.formDirty(), true, 'Maak voorkeur and Zet op inactief are disabled with "Eerst opslaan"');
  await component.submit();
  assert.deepEqual(writes[0], ['update', 94, 702, { versionLabel: null, supplierReference: null, exwPrice: 2.4, exwCurrency: 'USD',
    extraUnitCost: null, moq: 600, leadTimeDays: null, updatedAt: '2026-10-25T19:02:11.123456Z' }]);
  assert.deepEqual(events, ['changed:true', 'closed']);
  assert.deepEqual(toasts.at(-1), ['Leverancier bijgewerkt', undefined]);
  assert.match(sheetSource, /Staat op \{\{ current\.purchaseLineCount \}\} inkooporder\{\{ current\.purchaseLineCount === 1 \? '' : 's' \}\} · verwijderen kan niet meer/);
});

test('sheet actions: Voorkeur, inactief, weer actief and delete each say what happened', async () => {
  const other = row(702, 7, 'Rosegift');
  let context = sheet(other);
  context.component.makePreferred(other);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(context.writes[0], ['preferred', 94, 702]);
  assert.deepEqual(context.toasts.at(-1), ['Rosegift is nu voorkeur', undefined]);
  context = sheet(other);
  context.component.setActive(other, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(context.writes[0], ['active', 94, 702, false]);
  assert.deepEqual(context.toasts.at(-1), ['Rosegift op inactief', undefined]);
  context = sheet(other);
  context.component.setActive(other, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(context.toasts.at(-1), ['Rosegift weer actief', undefined]);
  context = sheet(other);
  context.component.confirmDelete(other);
  assert.equal(context.writes.length, 0, 'delete asks first');
  assert.equal(context.confirms[0].title, 'Leverancier verwijderen?');
  assert.equal(context.confirms[0].message, '<b>Rosegift</b> verdwijnt van dit product, met zijn afspraakfoto\'s.');
  context.confirms[0].onConfirm();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(context.writes[0], ['delete', 94, 702]);
  assert.deepEqual(context.toasts.at(-1), ['Leverancier verwijderd', undefined]);
  assert.deepEqual(context.events, ['changed:true', 'closed']);
});

test('sheet: a 409 says the server\'s words, closes and asks the host to reload; another failure keeps the sheet open', async () => {
  const current = row(702, 7, 'Rosegift', { exwPrice: 2 });
  let context = sheet(current);
  context.component.catalog.updateProductSupplier = async () => {
    throw { status: 409, error: { message: 'Deze leverancier is intussen gewijzigd; laad het product opnieuw.' } };
  };
  await context.component.submit();
  assert.deepEqual(context.toasts.at(-1), ['Deze leverancier is intussen gewijzigd; laad het product opnieuw.', 'err']);
  assert.deepEqual(context.events, ['stale', 'closed']);
  context = sheet(current);
  context.component.catalog.updateProductSupplier = async () => { throw { status: 0 }; };
  await context.component.submit();
  assert.deepEqual(context.toasts.at(-1), ['Opslaan mislukt', 'err']);
  assert.deepEqual(context.events, [], 'the typed form stays');
  assert.equal(context.component.busy(), false);
});
