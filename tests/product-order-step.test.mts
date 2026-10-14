import assert from 'node:assert/strict';
import test from 'node:test';
import type { Packaging, Product } from '../src/app/core/api/models.ts';
import {
  effectiveOrderStep, localUnitsPerOrderStep, orderStepChoices, orderStepLabel, orderStepMultiple, orderStepNotice, orderStepSentence,
  orderStepOf, packageStepPieces, roundToOrderStep, unitsPerOrderStep,
} from '../src/app/features/products/product-order-step.ts';

function product(packaging: Partial<Packaging> = {}, piecesPerCarton: number | null = 12, server?: number): Product {
  return {
    packaging: { kind: 'NONE', dimensions: { lengthCm: null, widthCm: null, heightCm: null }, barcode: null,
      piecesPerUnit: null, salesUnit: 'PIECE', unitKey: 'stolp', ...packaging },
    carton: { lengthCm: null, widthCm: null, heightCm: null, piecesPerCarton, weightKg: null },
    ...(server === undefined ? {} : { unitsPerOrderStep: server }),
  } as Product;
}
const bowlDisplay = (packaging: Partial<Packaging> = {}, piecesPerCarton: number | null = 40) =>
  product({ kind: 'DISPLAY', piecesPerUnit: 8, salesUnit: 'PIECE', unitKey: 'bowl', ...packaging }, piecesPerCarton);
const STOLP = { singular: 'stolp', plural: 'stolpen' };
const BOWL = { singular: 'bowl', plural: 'bowls' };
const DISPLAY = { singular: 'display', plural: 'displays' };

test('absent, null or unknown reads as a full carton, as on the server', () => {
  assert.equal(orderStepOf(product()), 'CARTON');
  assert.equal(orderStepOf(product({ orderStep: null })), 'CARTON');
  assert.equal(orderStepOf(product({ orderStep: 'PER_PALLET' as never })), 'CARTON');
  assert.equal(orderStepOf({ packaging: undefined } as unknown as Product), 'CARTON');
  assert.equal(orderStepOf(null), 'CARTON');
  assert.equal(orderStepOf(product({ orderStep: 'UNIT' })), 'UNIT');
});

test('units per step: the carton content, the pieces of a display, or one', () => {
  assert.equal(localUnitsPerOrderStep(product()), 12);
  assert.equal(localUnitsPerOrderStep(product({}, null)), 1, 'unknown carton content still steps by one');
  assert.equal(localUnitsPerOrderStep(product({}, 0)), 1);
  assert.equal(localUnitsPerOrderStep(product({ orderStep: 'UNIT' })), 1);
  assert.equal(localUnitsPerOrderStep(bowlDisplay({ orderStep: 'PACKAGE' })), 8);
  assert.equal(localUnitsPerOrderStep(bowlDisplay()), 40);
});

test('only a display of two or more pieces, sold per piece, can be the step', () => {
  assert.equal(packageStepPieces(bowlDisplay()), 8);
  assert.equal(packageStepPieces(bowlDisplay({ salesUnit: 'DISPLAY' })), null, 'a display basis already counts displays');
  assert.equal(packageStepPieces(bowlDisplay({ piecesPerUnit: 1 })), null);
  assert.equal(packageStepPieces(bowlDisplay({ piecesPerUnit: null })), null);
  assert.equal(packageStepPieces(product({ kind: 'GIFT_BOX', piecesPerUnit: 1 })), null, 'a gift box holds one piece');
  // PACKAGE without such a display is one unit, which is what the server rounds it to.
  assert.equal(effectiveOrderStep(product({ kind: 'GIFT_BOX', orderStep: 'PACKAGE' })), 'UNIT');
  assert.equal(localUnitsPerOrderStep(bowlDisplay({ salesUnit: 'DISPLAY', orderStep: 'PACKAGE' })), 1);
});

test('the server figure of a saved product wins; without one the rule decides', () => {
  assert.equal(unitsPerOrderStep(product({ orderStep: 'UNIT' }, 12, 1)), 1);
  assert.equal(unitsPerOrderStep(product({}, 12, 24)), 24, 'the server knows the saved carton content');
  assert.equal(unitsPerOrderStep(product({}, 12)), 12);
  assert.equal(unitsPerOrderStep(product({}, 12, 0)), 12, 'nonsense from the server falls back to the rule');
  assert.equal(unitsPerOrderStep(undefined), 1);
});

test('rounds up to the next whole step and leaves zero and negatives alone', () => {
  assert.equal(roundToOrderStep(500, 12), 504);
  assert.equal(roundToOrderStep(10, 8), 16);
  assert.equal(roundToOrderStep(16, 8), 16);
  assert.equal(roundToOrderStep(3, 1), 3);
  assert.equal(roundToOrderStep(0, 12), 0);
  assert.equal(roundToOrderStep(-3, 12), -3);
  assert.equal(roundToOrderStep(5, 0), 5, 'a step below one counts as one');
});

test('the editor offers a full carton and one unit always, a display only when it can be the step', () => {
  assert.deepEqual(orderStepChoices(product(), STOLP, 12), [
    { step: 'CARTON', label: 'Volle omdoos · 12 stolpen' },
    { step: 'UNIT', label: 'Per stolp' },
  ]);
  assert.deepEqual(orderStepChoices(bowlDisplay(), BOWL, 40), [
    { step: 'CARTON', label: 'Volle omdoos · 40 bowls' },
    { step: 'PACKAGE', label: 'Per display · 8 bowls' },
    { step: 'UNIT', label: 'Per bowl' },
  ]);
  assert.deepEqual(orderStepChoices(product({ kind: 'GIFT_BOX' }), STOLP, 1).map((choice) => choice.label),
    ['Volle omdoos · 1 stolp', 'Per stolp · geschenkverpakking']);
  assert.deepEqual(orderStepChoices(bowlDisplay({ salesUnit: 'DISPLAY' }), DISPLAY, 5).map((choice) => choice.label),
    ['Volle omdoos · 5 displays', 'Per display'], 'a display basis sells one display per unit');
  assert.equal(orderStepChoices(product(), STOLP, null)[0].label, 'Volle omdoos · doosinhoud ontbreekt');
});

test('read-only views say the setting in a few words', () => {
  assert.equal(orderStepLabel(product(), STOLP), 'Volle omdoos (12 stolpen)');
  assert.equal(orderStepLabel(product({}, null), STOLP), 'Volle omdoos (doosinhoud ontbreekt)');
  assert.equal(orderStepLabel(bowlDisplay({ orderStep: 'PACKAGE' }), BOWL), 'Per display (8 bowls)');
  assert.equal(orderStepLabel(product({ orderStep: 'UNIT' }), STOLP), 'Per stolp');
  assert.equal(orderStepLabel(product({ kind: 'GIFT_BOX', orderStep: 'UNIT' }), STOLP), 'Per stolp (geschenkverpakking)');
  assert.equal(orderStepLabel(product({ kind: 'GIFT_BOX', orderStep: 'PACKAGE' }), STOLP), 'Per stolp (geschenkverpakking)');
});

test('as one phrase the setting reads without a doubled "per"', () => {
  assert.equal(orderStepSentence(product(), STOLP), 'Verkocht per volle omdoos (12 stolpen)');
  assert.equal(orderStepSentence(product({}, null), STOLP), 'Verkocht per volle omdoos (doosinhoud ontbreekt)');
  assert.equal(orderStepSentence(bowlDisplay({ orderStep: 'PACKAGE' }), BOWL), 'Verkocht per display (8 bowls)');
  assert.equal(orderStepSentence(product({ orderStep: 'UNIT' }), STOLP), 'Verkocht per stolp');
  assert.equal(orderStepSentence(product({ kind: 'GIFT_BOX', orderStep: 'UNIT' }), STOLP), 'Verkocht per stolp (geschenkverpakking)');
});

test('notices name the step; a step of one needs no multiple', () => {
  assert.equal(orderStepNotice('CARTON', 12), 'Volle doos');
  assert.equal(orderStepNotice(undefined, 12), 'Volle doos');
  assert.equal(orderStepNotice('PACKAGE', 8), 'Per display van 8');
  assert.equal(orderStepMultiple('CARTON', 12, STOLP), 'volle dozen van 12 stolpen');
  assert.equal(orderStepMultiple('PACKAGE', 8, BOWL), 'displays van 8 bowls');
  assert.equal(orderStepMultiple('UNIT', 1, STOLP), null);
  assert.equal(orderStepMultiple('CARTON', 1, STOLP), null, 'an exempt document rounds nothing');
});
