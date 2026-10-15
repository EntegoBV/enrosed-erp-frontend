import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import type { UnitName } from '../src/app/core/api/models.ts';
import * as orderSteps from '../src/app/features/products/product-order-step.ts';
import { productSalesUnit, rememberUnitNames } from '../src/app/features/products/product-sales-unit.ts';

/* The editor's "Verkocht per" members, run with real signals and the real helpers. */
const source = await readFile(new URL('../src/app/features/products/product-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductEditor');
assert.ok(original);
const names = new Set(['salesUnit', 'selectedOrderStep', 'orderStepChoiceList', 'chooseOrderStep', 'patchPackaging', 'settleOrderStep', 'packagingOf']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size, 'Every tested production member must still exist');
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const NAMES: UnitName[] = [
  { key: 'stuk', one: 'stuk', other: 'stuks', per: 'per stuk', short: 'st.' },
  { key: 'bowl', one: 'bowl', other: 'bowls', per: 'per bowl', short: 'bowls' },
  { key: 'stolp', one: 'stolp', other: 'stolpen', per: 'per stolp', short: 'stolpen' },
];

function editor(packaging: Record<string, unknown>, piecesPerCarton: number | null = 40, autoPieces: number | null = null) {
  const exports: { ProductEditor?: new () => any } = {};
  vm.runInNewContext(javascript, { exports, computed, productSalesUnit, ...orderSteps });
  const screen = new exports.ProductEditor!();
  Object.assign(screen, {
    draft: signal({
      packaging: { kind: 'NONE', dimensions: { lengthCm: null, widthCm: null, heightCm: null }, barcode: null,
        piecesPerUnit: null, salesUnit: 'PIECE', unitKey: 'bowl', ...packaging },
      carton: { piecesPerCarton },
    }),
    autoCartonPieces: signal(autoPieces),
  });
  return screen;
}
const labels = (screen: any) => screen.orderStepChoiceList().map((choice: { label: string }) => choice.label);

test('the choices follow the draft: a display appears only while it can be the step', () => {
  rememberUnitNames(NAMES);
  const screen = editor({});
  assert.deepEqual(labels(screen), ['Volle omdoos · 40 bowls', 'Per bowl']);
  assert.equal(screen.selectedOrderStep(), 'CARTON', 'an existing product without a setting sells per full carton');
  screen.patchPackaging({ kind: 'DISPLAY', piecesPerUnit: 8 });
  assert.deepEqual(labels(screen), ['Volle omdoos · 40 bowls', 'Per display · 8 bowls', 'Per bowl']);
  screen.patchPackaging({ kind: 'GIFT_BOX' });
  assert.deepEqual(labels(screen), ['Volle omdoos · 40 bowls', 'Per bowl · geschenkverpakking']);
});

test('the carton choice counts what will be saved: typed, automatic, or missing', () => {
  rememberUnitNames(NAMES);
  assert.equal(labels(editor({}, null, 24))[0], 'Volle omdoos · 24 bowls');
  assert.equal(labels(editor({}, null, null))[0], 'Volle omdoos · doosinhoud ontbreekt');
});

test('choosing writes packaging.orderStep; the same choice again changes nothing', () => {
  rememberUnitNames(NAMES);
  const screen = editor({ kind: 'DISPLAY', piecesPerUnit: 8 });
  const before = screen.draft();
  screen.chooseOrderStep('CARTON');
  assert.equal(screen.draft(), before, 'no setting yet already means a full carton');
  screen.chooseOrderStep('PACKAGE');
  assert.equal(screen.draft().packaging.orderStep, 'PACKAGE');
  assert.equal(screen.selectedOrderStep(), 'PACKAGE');
  screen.chooseOrderStep('UNIT');
  assert.equal(screen.draft().packaging.orderStep, 'UNIT');
});

test('another kind of packaging turns "per display" into per unit at once', () => {
  rememberUnitNames(NAMES);
  for (const change of [{ kind: 'NONE' }, { kind: 'GIFT_BOX' }]) {
    const screen = editor({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
    screen.patchPackaging(change);
    assert.equal(screen.draft().packaging.orderStep, 'UNIT', JSON.stringify(change));
  }
  const kept = editor({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
  kept.patchPackaging({ piecesPerUnit: 12, barcode: '5400000000000' });
  assert.equal(kept.draft().packaging.orderStep, 'PACKAGE');
  const carton = editor({ kind: 'DISPLAY', piecesPerUnit: 8 });
  carton.patchPackaging({ kind: 'NONE' });
  assert.equal(carton.draft().packaging.orderStep, undefined, 'other settings are left as they are');
});

test('retyping the display contents or switching the basis keeps "per display"', () => {
  rememberUnitNames(NAMES);
  // 8 becomes 12: the field passes through "1" or an empty field on the way.
  for (const between of [1, null]) {
    const screen = editor({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
    screen.patchPackaging({ piecesPerUnit: between });
    assert.equal(screen.draft().packaging.orderStep, 'PACKAGE', 'the stored choice stays while typing');
    assert.equal(screen.selectedOrderStep(), 'UNIT', 'meanwhile the chips read it as one bowl, the step it has');
    screen.patchPackaging({ piecesPerUnit: 12 });
    assert.equal(screen.selectedOrderStep(), 'PACKAGE');
    assert.deepEqual(labels(screen), ['Volle omdoos · 40 bowls', 'Per display · 12 bowls', 'Per bowl']);
  }
  const basis = editor({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
  basis.patchPackaging({ salesUnit: 'DISPLAY' });
  basis.patchPackaging({ salesUnit: 'PIECE' });
  assert.equal(basis.selectedOrderStep(), 'PACKAGE', 'there and back again');
});

test('a save stores what the chips show: "per display" without a display to count is per unit', () => {
  rememberUnitNames(NAMES);
  const lost = editor({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
  lost.patchPackaging({ piecesPerUnit: 1 });
  lost.settleOrderStep();
  assert.equal(lost.draft().packaging.orderStep, 'UNIT');
  for (const packaging of [{ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' }, { orderStep: 'CARTON' }, {}]) {
    const screen = editor(packaging);
    const before = screen.draft();
    screen.settleOrderStep();
    assert.equal(screen.draft(), before, JSON.stringify(packaging));
  }
  assert.match(source, /this\.settleOrderStep\(\);\s*const missing = this\.missingFields\(\);/, 'save() settles it before it sends');
});

test('a stored "per verpakking" that no longer qualifies shows as per unit until staff choose again', () => {
  rememberUnitNames(NAMES);
  const screen = editor({ kind: 'GIFT_BOX', orderStep: 'PACKAGE' });
  assert.equal(screen.selectedOrderStep(), 'UNIT');
  screen.chooseOrderStep('UNIT');
  assert.equal(screen.draft().packaging.orderStep, 'UNIT', 'picking it again stores it');
});

test('the field sits in the sales section, right after the unit chips, with its hint', async () => {
  const sales = source.slice(source.indexOf('id="sales"'), source.indexOf('<fieldset class="price-method">'));
  assert.match(sales, /<label id="p-unit-label">Eenheid<\/label>[\s\S]*<label id="p-order-step-label">Verkocht per<\/label>/);
  assert.match(sales, /\(click\)="chooseOrderStep\(choice\.step\)"/);
  assert.match(sales, /Geldt voor offertes, het klantportaal en de website\. Bestaande documenten veranderen niet\./);
  assert.match(source, /unitKey: 'stuk', orderStep: 'CARTON' \}/, 'a new product starts on a full carton');
});
