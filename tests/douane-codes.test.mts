import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedFields, countByCode, formatHs, matchesTariff, mismatchWords, normalizeHs, oneLine, parsePct, pctInput, pctLabel, spellingMismatches, validateTariff, withoutCode,
} from '../src/app/features/purchasing/douane-codes.ts';

// Douane (Inkoop redesign I8, F22): the codes as people read them, the products per code and the two checks.
const plain = (text: string): string => text.replace(/[  ]/g, ' ');
const codes = [{ code: '0603900000' }, { code: '7013 99 00' }, { code: '9505' }];
const product = (id: number, hsCode: string | null) => ({ id, name: `Product ${id}`, hsCode });
const products = [product(1, '0603900000'), product(2, '0603 90 00 00'), product(3, '0603.90.00.00'), product(4, null), product(5, '  '),
  product(6, '7013 99 00'), product(7, '70139900'), product(8, '9999')];

test('codes read 4-2-2-2 or 4-2-2; anything else as stored; spellings normalise alike', () => {
  assert.equal(formatHs('0603900000'), '0603 90 00 00');
  assert.equal(formatHs('0603 90 00 00'), '0603 90 00 00');
  assert.equal(formatHs('70139900'), '7013 99 00');
  assert.equal(formatHs('9505'), '9505');
  assert.equal(formatHs('ex 9505 10'), 'ex 9505 10');
  assert.equal(normalizeHs('0603.90-00 00'), '0603900000');
});

test('products per tariff match exactly, as the server does; the ones without a code and the other spellings are found', () => {
  assert.deepEqual([...countByCode(products, codes)], [['0603900000', 1], ['7013 99 00', 1], ['9505', 0]]);
  assert.deepEqual(withoutCode(products).map((row) => row.id), [4, 5]);
  const mismatches = spellingMismatches(products, codes);
  assert.deepEqual(mismatches.map((row) => [row.code, row.spelled, row.products.map((p) => p.id)]),
    [['0603900000', '0603 90 00 00', [2]], ['0603900000', '0603.90.00.00', [3]], ['7013 99 00', '70139900', [7]]]);
});

test('the edit row checks a new code in every spelling and the duty between 0 and 100 %', () => {
  assert.deepEqual(validateTariff({ code: '', dutyText: '10', isNew: true }, codes), { code: 'Vul een code in' });
  // The stored spelling literally: grouped, it would echo back what was typed.
  assert.deepEqual(validateTariff({ code: '0603 90 00 00', dutyText: '10', isNew: true }, codes), { code: 'Deze code bestaat al als „0603900000”' });
  assert.deepEqual(validateTariff({ code: '0603 10', dutyText: '6,5', isNew: true }, codes), {});
  assert.deepEqual(validateTariff({ code: '0603900000', dutyText: '101', isNew: false }, codes), { duty: 'Invoerrecht tussen 0 en 100 %' });
  assert.deepEqual(validateTariff({ code: '0603900000', dutyText: 'tien', isNew: false }, codes), { duty: 'Invoerrecht tussen 0 en 100 %' });
  assert.equal(parsePct('6,5'), 6.5);
  assert.equal(parsePct(''), null);
  assert.equal(plain(pctLabel(10)), '10,0 %');
  assert.equal(pctInput(6.5), '6,5');
});

test('the strip names what changed; the search finds a code in any spelling or a word of the description', () => {
  const original = { code: '9505', description: 'Feestartikelen', dutyRatePct: 2.7 };
  assert.deepEqual(changedFields(original, { code: '9505', description: 'Feestartikelen', dutyText: '2,7' }), []);
  assert.deepEqual(changedFields(original, { code: '9505', description: 'Kerst', dutyText: '3' }), ['omschrijving', 'invoerrecht']);
  assert.deepEqual(changedFields(null, { code: '1', description: '', dutyText: '' }), ['nieuw tarief']);
  assert.ok(matchesTariff({ code: '0603900000', description: 'Kunstbloemen' }, '0603 90'));
  assert.ok(matchesTariff({ code: '0603900000', description: 'Kunstbloemen' }, 'bloemen'));
  assert.ok(!matchesTariff({ code: '0603900000', description: 'Kunstbloemen' }, 'glas'));
  assert.ok(matchesTariff({ code: '0603900000', description: null }, ' '));
});

test('the spelling note follows its count: one product vindt and rekent, several vinden and rekenen', () => {
  assert.deepEqual(mismatchWords(1), { verb: 'heeft',
    rest: 'Dat product vindt geen tarief en rekent met het invoerrecht van de inkooporder. Pas de code op het product aan.' });
  assert.deepEqual(mismatchWords(3), { verb: 'hebben',
    rest: 'Die producten vinden geen tarief en rekenen met het invoerrecht van de inkooporder. Pas de code op de producten aan.' });
  // '06031100' stored, '0603 11 00' on the product: grouped, both read '0603 11 00', so the note names them as they are.
  assert.equal(formatHs('06031100'), formatHs('0603 11 00'));
  const [mismatch] = spellingMismatches([product(9, '0603 11 00')], [{ code: '06031100' }]);
  assert.deepEqual([mismatch.spelled, mismatch.code], ['0603 11 00', '06031100']);
});

test('a description stays one line: breaks from the phone text area become one space, the rest is kept as typed', () => {
  assert.equal(oneLine('Glaswerk voor tafel,\nkeuken en versiering'), 'Glaswerk voor tafel, keuken en versiering');
  assert.equal(oneLine('Rozen \r\n\n vers afgesneden'), 'Rozen vers afgesneden');
  assert.equal(oneLine('Rozen, vers afgesneden'), 'Rozen, vers afgesneden');
  assert.equal(oneLine('  spaties  blijven  '), '  spaties  blijven  ', 'only line breaks change');
});

