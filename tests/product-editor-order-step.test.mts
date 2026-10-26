import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import type { UnitName } from '../src/app/core/api/models.ts';
import * as orderSteps from '../src/app/features/products/product-order-step.ts';
import * as salesUnits from '../src/app/features/products/product-sales-unit.ts';
import { supplierMissing } from '../src/app/features/products/product-suppliers.ts';

/*
 * "Hoe verkoop je dit product?" (2026-10-15): the sales card's members and the
 * editor's packaging patch, run with real signals and the real helpers. AST
 * selection leaves out the Angular inputs, outputs and decorators; the test
 * hands the inputs in as signals and wires the card's patches into the
 * editor's own patchPackaging, as the template does.
 */
function isolate(file: string, className: string, names: Set<string>) {
  return readFile(new URL(`../src/app/features/products/${file}`, import.meta.url), 'utf8').then((source) => {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className);
    assert.ok(original, className);
    const members = original.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
    assert.equal(members.length, names.size, `Every tested ${className} member must still exist`);
    const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
      original.name, original.typeParameters, undefined, members);
    return {
      source,
      javascript: ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText,
    };
  });
}

const editorFile = await isolate('product-editor.ts', 'ProductEditor',
  new Set(['salesUnit', 'patchPackaging', 'settleOrderStep', 'packagingOf', 'missingFields']));
const cardFile = await isolate('product-sales-setup.ts', 'ProductSalesSetup', new Set([
  'capitalize', 'packagingOptions', 'unit', 'piece', 'kind', 'count', 'unitKey', 'step', 'choices', 'example', 'fellBack', 'sentence',
  'reading', 'erp', 'pieceFigure', 'displayFigure', 'cartonLine', 'change', 'warning', 'switched', 'switchNow', 'convertBase',
  'convertTarget', 'convertLabel', 'familyOthers', 'colourName', 'attention', 'canCollapse', 'collapsed', 'patch', 'whole', 'chooseUnit',
  'chooseKind', 'chooseBasis', 'fill', 'patchBasis', 'undoConvertedPrice', 'chooseStep', 'restore',
]));

const NAMES: UnitName[] = [
  { key: 'stuk', one: 'stuk', other: 'stuks', per: 'per stuk', short: 'st.' },
  { key: 'bowl', one: 'bowl', other: 'bowls', per: 'per bowl', short: 'bowls' },
  { key: 'diamant', one: 'diamant', other: 'diamanten', per: 'per diamant', short: 'diamanten' },
  { key: 'roos', one: 'roos', other: 'rozen', per: 'per roos', short: 'rozen' },
];
const plain = (text: string) => text.replace(/ /g, ' ');

function setup(packaging: Record<string, unknown>, options: { piecesPerCarton?: number | null; saved?: boolean; price?: number; fixedPrice?: boolean; desktop?: boolean } = {}) {
  salesUnits.rememberUnitNames(NAMES);
  const editorExports: { ProductEditor?: new () => any } = {};
  vm.runInNewContext(editorFile.javascript, { exports: editorExports, computed, ...salesUnits, ...orderSteps, supplierMissing });
  const editor = new editorExports.ProductEditor!();
  const product = {
    id: 45, familyId: null, colour: 'Red', colourHex: '#C0303A', name: 'Diamantroos', supplierId: 1, stockQuantity: 96,
    fixedSalesPriceEur: options.price ?? 2.95, computedSalesPriceEur: options.price ?? 2.95,
    packaging: { kind: 'NONE', dimensions: { lengthCm: null, widthCm: null, heightCm: null }, barcode: null,
      piecesPerUnit: null, salesUnit: 'PIECE', unitKey: 'bowl', ...packaging },
    carton: { piecesPerCarton: options.piecesPerCarton === undefined ? 40 : options.piecesPerCarton },
  };
  Object.assign(editor, { draft: signal(product), autoCartonPieces: signal(null), priceStrategy: signal('FIXED'),
    purchaseMode: signal('rows'), supplierRows: signal([{ supplierId: 1 }]) });
  const cardExports: { ProductSalesSetup?: new () => any } = {};
  vm.runInNewContext(cardFile.javascript, { exports: cardExports, computed, signal, ...salesUnits, ...orderSteps });
  const card = new cardExports.ProductSalesSetup!();
  const prices: number[] = [];
  Object.assign(card, {
    product: editor.draft, saved: signal(options.saved === false ? null : structuredClone(product)), units: signal(NAMES),
    price: computed(() => editor.draft().fixedSalesPriceEur ?? 0), fixedPrice: signal(options.fixedPrice ?? true),
    cartonCount: computed(() => editor.draft().carton.piecesPerCarton), family: signal(null), disabled: signal(false),
    desktop: signal(options.desktop ?? true), expanded: signal(false),
    packagingChange: { emit: (changes: Record<string, unknown>) => editor.patchPackaging(changes) },
    priceChange: { emit: (value: number) => { prices.push(value); editor.draft.update((p: any) => ({ ...p, fixedSalesPriceEur: value })); } },
  });
  return { editor, card, prices };
}
const options = (card: any) => card.choices().map((choice: { label: string; detail: string }) => `${choice.label} · ${choice.detail}`);

test('"Klant bestelt per" follows the draft: small to large, a display only while it can be the step', () => {
  const { editor, card } = setup({}, { saved: false });
  assert.deepEqual(options(card), ['Bowl · Elk aantal', 'Omdoos · Per 40 bowls']);
  assert.equal(card.step(), 'CARTON', 'an existing product without a setting sells per full carton');
  card.chooseKind('DISPLAY');
  card.patch({ piecesPerUnit: card.whole('8') });
  assert.deepEqual(options(card), ['Bowl · Elk aantal', 'Display · Per 8 bowls', 'Omdoos · Per 40 bowls']);
  card.chooseKind('GIFT_BOX');
  assert.deepEqual(options(card), ['Bowl · Elk aantal', 'Omdoos · Per 40 bowls']);
  assert.equal(editor.draft().packaging.kind, 'GIFT_BOX');
});

test('choosing writes packaging.orderStep; the same choice again changes nothing', () => {
  const { editor, card } = setup({ kind: 'DISPLAY', piecesPerUnit: 8 });
  const before = editor.draft();
  card.chooseStep('CARTON');
  assert.equal(editor.draft(), before, 'no setting yet already means a full carton');
  card.chooseStep('PACKAGE');
  assert.equal(editor.draft().packaging.orderStep, 'PACKAGE');
  assert.equal(card.step(), 'PACKAGE');
  assert.equal(card.example(), 'Voorbeeld: 9 bowls op een offerte worden 16 (2 displays).');
  card.chooseStep('UNIT');
  assert.equal(editor.draft().packaging.orderStep, 'UNIT');
  assert.equal(card.example(), 'Geen afronding: 13 bowls blijven 13.');
});

test('leaving the display turns "per display" into one unit at once, and the card says so', () => {
  for (const kind of ['NONE', 'GIFT_BOX']) {
    const { editor, card } = setup({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
    assert.equal(card.fellBack(), false);
    card.chooseKind(kind);
    assert.equal(editor.draft().packaging.orderStep, 'UNIT', kind);
    assert.equal(card.fellBack(), true, `${kind}: announced, not silent`);
    assert.equal(card.attention(), true);
  }
  const kept = setup({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
  kept.card.patch({ piecesPerUnit: 12, barcode: '5400000000000' });
  assert.equal(kept.editor.draft().packaging.orderStep, 'PACKAGE');
});

test('retyping the display contents or switching the basis keeps "per display"', () => {
  for (const between of [1, null]) {
    const { editor, card } = setup({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
    card.patch({ piecesPerUnit: between });
    assert.equal(editor.draft().packaging.orderStep, 'PACKAGE', 'the stored choice stays while typing');
    assert.equal(card.step(), 'UNIT', 'meanwhile the card reads it as one bowl, the step it has');
    card.patch({ piecesPerUnit: 12 });
    assert.equal(card.step(), 'PACKAGE');
    assert.deepEqual(options(card), ['Bowl · Elk aantal', 'Display · Per 12 bowls', 'Omdoos · Per 40 bowls']);
  }
  const basis = setup({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
  basis.card.chooseBasis('DISPLAY');
  basis.card.chooseBasis('PIECE');
  assert.equal(basis.card.step(), 'PACKAGE', 'there and back again');
  assert.equal(basis.card.change(), null);
});

test('a save stores what the card shows: "per display" without a display to count is per unit', () => {
  const lost = setup({ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' });
  lost.card.patch({ piecesPerUnit: 1 });
  lost.editor.settleOrderStep();
  assert.equal(lost.editor.draft().packaging.orderStep, 'UNIT');
  for (const packaging of [{ kind: 'DISPLAY', piecesPerUnit: 8, orderStep: 'PACKAGE' }, { orderStep: 'CARTON' }, {}]) {
    const { editor } = setup(packaging);
    const before = editor.draft();
    editor.settleOrderStep();
    assert.equal(editor.draft(), before, JSON.stringify(packaging));
  }
  assert.match(editorFile.source, /this\.settleOrderStep\(\);\s*const wasNew = this\.isNew\(\);/, 'save() settles it before it sends');
  const save = editorFile.source.slice(editorFile.source.indexOf('async save(): Promise<void> {'));
  assert.ok(save.indexOf("title: 'Prijsbasis wijzigen?'") < save.indexOf('this.settleOrderStep();'),
    'and only after "Prijsbasis wijzigen?": Annuleren must not leave a settled step in the draft');
  assert.ok(save.indexOf("title: 'Prijsbasis wijzigen?'") < save.indexOf('this.patchCarton('), 'nor an automatic carton count');
});

test('DIAM-D-RD: the sentence, the customer line and the other option at today\'s price', () => {
  const { card } = setup({ kind: 'DISPLAY', piecesPerUnit: 12, unitKey: 'diamant', orderStep: 'PACKAGE' }, { piecesPerCarton: 12 });
  assert.equal(card.sentence().map((part: { text: string }) => part.text).join(''),
    'Je verkoopt diamanten, per 12 in een display. Je prijs geldt per diamant; de klant bestelt per display.');
  assert.deepEqual({ main: plain(card.reading().main), detail: plain(card.reading().detail) },
    { main: '€ 35,40 per display van 12 diamanten', detail: '€ 2,95 per diamant · bestellen per display · 12 diamanten per doos' });
  assert.equal(card.pieceFigure(), null);
  assert.equal(plain(card.displayFigure()), '€ 2,95 per display ≈ € 0,25 per diamant');
  assert.equal(card.cartonLine(), '12 diamanten (1 display)');
  assert.equal(card.example(), 'Voorbeeld: 13 diamanten op een offerte worden 24 (2 displays).');
  assert.equal(card.change(), null);
});

test('switching the basis of a saved product warns, offers the price only, and Terugzetten undoes both', () => {
  const { editor, card, prices } = setup({ kind: 'DISPLAY', piecesPerUnit: 12, unitKey: 'diamant', orderStep: 'PACKAGE' }, { piecesPerCarton: 12 });
  card.chooseBasis('DISPLAY');
  assert.deepEqual(card.change(), { to: 'DISPLAY', pieces: 12, leftDisplay: false });
  assert.match(plain(card.warning()), /^Let op: het prijsveld wordt de prijs van een volledig display\. Nu € 2,95, dus ≈ € 0,25 per diamant\. Voorraad, doosinhoud \(12\) en kostprijs worden niet omgerekend/);
  assert.equal(plain(card.convertLabel()), 'Prijs × 12 = € 35,40 invullen');
  assert.equal(card.attention(), true, 'a phone keeps the card open while it warns');
  // The button fills the price and nothing else.
  card.fill(card.convertTarget());
  assert.equal(editor.draft().fixedSalesPriceEur, 35.4);
  assert.equal(card.convertTarget(), null, 'done once');
  assert.equal(editor.draft().stockQuantity, 96);
  assert.equal(editor.draft().carton.piecesPerCarton, 12);
  card.restore();
  assert.equal(editor.draft().packaging.salesUnit, 'PIECE');
  assert.equal(editor.draft().fixedSalesPriceEur, 2.95, 'a converted price goes back too');
  assert.deepEqual(prices, [35.4, 2.95]);
  assert.equal(card.change(), null);
});

test('going back with the option or the packaging takes a converted price back, as Terugzetten does', () => {
  const diam = setup({ kind: 'DISPLAY', piecesPerUnit: 12, unitKey: 'diamant', orderStep: 'PACKAGE' }, { piecesPerCarton: 12 });
  diam.card.chooseBasis('DISPLAY');
  diam.card.fill(diam.card.convertTarget());
  assert.equal(diam.editor.draft().fixedSalesPriceEur, 35.4);
  diam.card.chooseBasis('PIECE');
  assert.equal(diam.card.change(), null);
  assert.equal(diam.editor.draft().fixedSalesPriceEur, 2.95, 'not € 35,40 per diamant without a warning or a question');
  assert.deepEqual(diam.prices, [35.4, 2.95]);
  // The steelrozen the other way: Los, "Prijs ÷ 12 ≈ € 4,16 invullen", then Display again.
  const roses = setup({ kind: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos', salesUnit: 'DISPLAY', orderStep: 'UNIT' }, { price: 49.95, piecesPerCarton: 4 });
  roses.card.chooseKind('NONE');
  assert.equal(roses.card.change().leftDisplay, true);
  roses.card.fill(roses.card.convertTarget());
  assert.equal(roses.editor.draft().fixedSalesPriceEur, 4.16);
  roses.card.chooseKind('DISPLAY');
  assert.equal(roses.card.change(), null);
  assert.equal(roses.editor.draft().fixedSalesPriceEur, 49.95, 'not € 4,16 per display');
  // A price typed after the switch is the user's own: it stays, and the field shows it.
  const typed = setup({ kind: 'DISPLAY', piecesPerUnit: 12, unitKey: 'diamant' });
  typed.card.chooseBasis('DISPLAY');
  typed.editor.draft.update((p: any) => ({ ...p, fixedSalesPriceEur: 36 }));
  assert.equal(typed.card.convertTarget(), null, 'typed over: the button is done');
  typed.card.chooseBasis('PIECE');
  assert.equal(typed.editor.draft().fixedSalesPriceEur, 36);
  assert.deepEqual(typed.prices, []);
});

test('the convert button converts the price as it stood at the switch, and says "≈" when it is rounded', () => {
  const { editor, card, prices } = setup({ kind: 'DISPLAY', piecesPerUnit: 12, unitKey: 'diamant', orderStep: 'PACKAGE' }, { piecesPerCarton: 12 });
  editor.draft.update((p: any) => ({ ...p, fixedSalesPriceEur: 3.1 }));
  card.chooseBasis('DISPLAY');
  assert.match(plain(card.warning()), /Nu € 3,10, dus ≈ € 0,26 per diamant/);
  assert.equal(plain(card.convertLabel()), 'Prijs × 12 = € 37,20 invullen', 'the box agrees with itself');
  card.fill(card.convertTarget());
  assert.equal(editor.draft().fixedSalesPriceEur, 37.2);
  card.restore();
  assert.equal(editor.draft().fixedSalesPriceEur, 3.1, 'Terugzetten puts the typed price back, not the saved one');
  assert.deepEqual(prices, [37.2, 3.1]);
  const roses = setup({ kind: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos', salesUnit: 'DISPLAY', orderStep: 'UNIT' }, { price: 49.95, piecesPerCarton: 4 });
  roses.card.chooseBasis('PIECE');
  assert.equal(plain(roses.card.convertLabel()), 'Prijs ÷ 12 ≈ € 4,16 invullen');
  const bowls = setup({ kind: 'DISPLAY', piecesPerUnit: 8, salesUnit: 'DISPLAY' }, { price: 31.6 });
  bowls.card.chooseBasis('PIECE');
  assert.equal(plain(bowls.card.convertLabel()), 'Prijs ÷ 8 = € 3,95 invullen');
});

test('with cost + markup there is no price to fill in', () => {
  const { card } = setup({ kind: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos', salesUnit: 'DISPLAY', orderStep: 'UNIT' }, { price: 49.95, fixedPrice: false, piecesPerCarton: 4 });
  card.chooseBasis('PIECE');
  assert.equal(card.change().to, 'PIECE');
  assert.equal(card.convertTarget(), null);
  assert.equal(plain(card.pieceFigure() ?? ''), '');
  assert.equal(plain(card.displayFigure()), '€ 49,95 per display ≈ € 4,16 per roos');
});

test('a new product never warns; a display without its count asks for it on the sales tab', () => {
  const { editor, card } = setup({}, { saved: false });
  card.chooseKind('DISPLAY');
  assert.equal(card.change(), null);
  assert.equal(card.attention(), true, 'no count yet');
  assert.deepEqual({ ...editor.missingFields().find((item: { field: string }) => item.field === 'p-packaging-pieces') },
    { tab: 'sales', field: 'p-packaging-pieces', label: 'bowls in één display' });
});

test('on a phone a complete saved product folds to its sentence until opened', () => {
  const phone = setup({ kind: 'DISPLAY', piecesPerUnit: 12, unitKey: 'diamant', orderStep: 'PACKAGE' }, { desktop: false });
  assert.equal(phone.card.collapsed(), true);
  phone.card.expanded.set(true);
  assert.equal(phone.card.collapsed(), false);
  phone.card.expanded.set(false);
  phone.card.chooseBasis('DISPLAY');
  assert.equal(phone.card.collapsed(), false, 'a warning keeps it open');
  assert.equal(setup({}, { desktop: false, saved: false }).card.collapsed(), false, 'a new product stays open');
  assert.equal(setup({ kind: 'DISPLAY', piecesPerUnit: 12 }, { desktop: true }).card.collapsed(), false, 'desk never folds');
});

test('the card is the first block of Verkoopprijs; Basisgegevens keeps one line and the physical facts', () => {
  const source = editorFile.source;
  const sales = source.slice(source.indexOf('id="sales"'), source.indexOf('<fieldset class="price-method">'));
  assert.match(sales, /<app-product-sales-setup[\s\S]*\(packagingChange\)="patchPackaging\(\$event\)"[\s\S]*\(priceChange\)="setFixedSalesPrice\(\$event\)"/);
  assert.doesNotMatch(sales, /p-unit-label|p-order-step-label|Klant leest/, 'the old chips and the "Klant leest" line live in the card now');
  const basis = source.slice(source.indexOf('<legend>Geschenkdoosje of display</legend>'), source.indexOf('id="p-packaging-barcode"'));
  assert.match(basis, /\{\{ packagingLine\(\) \}\}/);
  assert.match(basis, /Wijzigen bij/);
  assert.doesNotMatch(basis, /<select|p-packaging-pieces|p-packaging-sales-unit|Volledig display \(set\)/);
  assert.match(source, /<label class="req" for="p-price">Vaste verkoopprijs per \{\{ salesUnit\(draft\(\)\)\.singular \}\}<\/label>/);
  assert.match(source, /EUR \/ \{\{ salesUnit\(draft\(\)\)\.singular \}\}/);
  assert.match(source, /unitKey: 'stuk', orderStep: 'CARTON' \}/, 'a new product starts on a full carton');
  const card = cardFile.source;
  const rows = ['Eén stuk heet', 'Verpakking', 'Prijs geldt per', 'Klant bestelt per', 'Zo leest de klant het', 'Zo rekent het ERP'].map((label) => card.indexOf(label));
  assert.ok(rows.every((at, i) => at > 0 && (i === 0 || at > rows[i - 1])), 'rows in the order of the sentence, previews below');
});
