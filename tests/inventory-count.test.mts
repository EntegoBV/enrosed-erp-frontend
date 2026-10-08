import assert from 'node:assert/strict';
import test from 'node:test';
import type { BookingCheck, CountLine } from '../src/app/core/api/inventory-models.ts';
import {
  COUNT_CHIPS, bookingSummaryText, canConfirmEqual, conflictText, countProgress, countSections, differenceText,
  filterLines, lineState, openDocumentText, rebaseWrite, sameReasonWrites,
} from '../src/app/features/inventory/inventory-count.ts';

let nextId = 1;

function line(input: Partial<CountLine> = {}): CountLine {
  const id = input.id ?? nextId++;
  return {
    id, productId: 100 + id, sku: `SKU-${id}`, productName: `Product ${id}`, categoryName: 'Rozen', familyId: null,
    unitKey: null, salesUnit: 'PIECE', piecesPerUnit: null, addedByHand: false, liveQuantity: 10, expectedQuantity: null,
    countedQuantity: null, difference: null, reasonCode: null, reasonLabel: null, reasonNote: null, countedByName: null,
    countedAt: null, revision: 0, moved: false, bookedQuantity: null, openDocuments: [], documentsConfirmed: false,
    ...input,
  };
}

/** A counted line: the server froze the system figure and worked out the difference. */
function countedLine(expected: number, counted: number, input: Partial<CountLine> = {}): CountLine {
  return line({
    liveQuantity: expected, expectedQuantity: expected, countedQuantity: counted, difference: counted - expected,
    countedByName: 'Berat', countedAt: '2027-01-02T09:15:00Z', revision: 1, ...input,
  });
}

const names = (lines: CountLine[]) => lines.map((row) => row.productName);

test('a line is to count, equal, or a difference with or without a reason', () => {
  assert.equal(lineState(line()), 'TE_TELLEN');
  assert.equal(lineState(countedLine(10, 10)), 'KLOPT');
  assert.equal(lineState(countedLine(0, 0)), 'KLOPT');
  assert.equal(lineState(countedLine(10, 7)), 'VERSCHIL_ZONDER_REDEN');
  assert.equal(lineState(countedLine(10, 12, { reasonCode: 'TERUGGEVONDEN', reasonLabel: 'Teruggevonden' })), 'VERSCHIL_MET_REDEN');
});

test('the chips read in screen order', () => {
  assert.deepEqual(COUNT_CHIPS.map((chip) => chip.label), ['Te tellen', 'Geteld', 'Verschillen', 'Gewijzigd', 'Alles']);
});

test('"Te tellen" holds what is not counted and has a system figure, plus lines added by hand', () => {
  const lines = [
    line({ productName: 'Met voorraad', liveQuantity: 12 }),
    line({ productName: 'Onder nul', liveQuantity: -2 }),
    line({ productName: 'Actief zonder voorraad', liveQuantity: 0 }),
    line({ productName: 'Toegevoegd', liveQuantity: 0, addedByHand: true }),
    countedLine(5, 5, { productName: 'Geteld gelijk' }),
    countedLine(0, 3, { productName: 'Toegevoegd en geteld', addedByHand: true }),
  ];
  assert.deepEqual(names(filterLines(lines, 'TE_TELLEN', '')), ['Met voorraad', 'Onder nul', 'Toegevoegd']);
  assert.deepEqual(names(filterLines(lines, 'GETELD', '')), ['Geteld gelijk', 'Toegevoegd en geteld']);
  assert.deepEqual(names(filterLines(lines, 'VERSCHILLEN', '')), ['Toegevoegd en geteld']);
  assert.equal(filterLines(lines, 'ALLES', '').length, 6);
});

test('"Gewijzigd" holds the lines whose stock changed after counting', () => {
  const lines = [countedLine(10, 7, { productName: 'Stil' }), countedLine(10, 7, { productName: 'Afgepunt', moved: true, liveQuantity: 7 })];
  assert.deepEqual(names(filterLines(lines, 'GEWIJZIGD', '')), ['Afgepunt']);
});

test('the search reads the name and the SKU, every word, without case or accents', () => {
  const lines = [
    line({ productName: 'Roos in stolp rood', sku: 'RS-001' }),
    line({ productName: 'Roos in stolp blauw', sku: 'RS-002' }),
    line({ productName: 'Café bowl', sku: null }),
  ];
  assert.deepEqual(names(filterLines(lines, 'ALLES', 'STOLP rood')), ['Roos in stolp rood']);
  assert.deepEqual(names(filterLines(lines, 'ALLES', 'rs-002')), ['Roos in stolp blauw']);
  assert.deepEqual(names(filterLines(lines, 'ALLES', 'cafe')), ['Café bowl']);
  assert.deepEqual(names(filterLines(lines, 'ALLES', '  roos   ')), ['Roos in stolp rood', 'Roos in stolp blauw']);
  assert.deepEqual(filterLines(lines, 'ALLES', 'tulp'), []);
  /* The chip still applies while searching. */
  assert.deepEqual(filterLines(lines, 'GETELD', 'roos'), []);
});

test('progress counts hand-added lines and leaves untouched zero-level lines out of the total', () => {
  const lines = [
    line({ liveQuantity: 12 }),
    line({ liveQuantity: 0 }),
    line({ liveQuantity: 0 }),
    line({ liveQuantity: 0, addedByHand: true }),
    countedLine(0, 0),
    countedLine(10, 10),
    countedLine(10, 7),
    countedLine(10, 12, { reasonCode: 'TERUGGEVONDEN' }),
    /* Counted 4 where the system said 4; the stock moved to 0 since. */
    countedLine(4, 4, { liveQuantity: 0, moved: true }),
  ];
  assert.deepEqual(countProgress(lines), { counted: 5, total: 7, differences: 2, missingReasons: 1 });
  assert.deepEqual(countProgress([]), { counted: 0, total: 0, differences: 0, missingReasons: 0 });
});

test('a line whose count was wiped still counts while its frozen figure says there was stock', () => {
  assert.equal(countProgress([line({ liveQuantity: 0, expectedQuantity: 6 })]).total, 1);
});

test('sections group per category, keep one family together and count like the header', () => {
  const lines = [
    line({ productName: 'Zeep lavendel', categoryName: 'Zeep', liveQuantity: 3 }),
    line({ productName: 'Stolp rood', categoryName: 'Rozen', familyId: 7, liveQuantity: 5 }),
    line({ productName: 'Beer wit', categoryName: 'Rozen', familyId: null, liveQuantity: 0 }),
    countedLine(4, 4, { productName: 'Stolp blauw', categoryName: 'Rozen', familyId: 7 }),
    line({ productName: 'Boeket', categoryName: 'Rozen', familyId: 3, liveQuantity: 2 }),
    line({ productName: 'Los staal', categoryName: null, liveQuantity: 1 }),
    line({ productName: 'Doos', categoryName: '  ', liveQuantity: 0, addedByHand: true }),
  ];
  const sections = countSections(lines);
  assert.deepEqual(sections.map((section) => section.category), ['Rozen', 'Zeep', 'Zonder categorie']);
  assert.deepEqual(names(sections[0].lines), ['Boeket', 'Stolp blauw', 'Stolp rood', 'Beer wit']);
  assert.deepEqual([sections[0].counted, sections[0].total], [1, 3]);
  assert.deepEqual([sections[1].counted, sections[1].total], [0, 1]);
  assert.deepEqual(names(sections[2].lines), ['Doos', 'Los staal']);
  assert.deepEqual([sections[2].counted, sections[2].total], [0, 2]);
  assert.deepEqual(countSections([]), []);
});

test('a difference reads as too few, too many or equal', () => {
  assert.equal(differenceText(0), 'klopt');
  assert.equal(differenceText(-3), '3 te weinig');
  assert.equal(differenceText(2), '2 te veel');
  assert.equal(differenceText(-1200), '1.200 te weinig');
});

test('the booking summary names the lines, and an empty one confirms that nothing lies there', () => {
  const summary: BookingCheck['summary'] = { lines: 42, equal: 37, short: 3, shortUnits: 14, over: 2, overUnits: 5 };
  assert.equal(bookingSummaryText(summary), 'Je boekt 42 regels: 37 kloppen, 3 te weinig (-14), 2 te veel (+5).');
  assert.equal(bookingSummaryText({ lines: 0, equal: 0, short: 0, shortUnits: 0, over: 0, overUnits: 0 }),
    'Je bevestigt dat hier niets ligt.');
});

test('a conflict says who counted what and when, in Brussels time', () => {
  const theirs = countedLine(100, 70, { countedByName: 'Berat', countedAt: '2027-01-02T08:02:00Z' });
  assert.equal(conflictText(theirs, 68), 'Berat telde hier al 70 (09:02). Jouw telling: 68.');
  /* Summer time: 14:30 UTC is 16:30 in Brussels. */
  assert.equal(conflictText(countedLine(5, 5, { countedByName: 'Emre', countedAt: '2026-07-01T14:30:00Z' }), 4),
    'Emre telde hier al 5 (16:30). Jouw telling: 4.');
  assert.equal(conflictText(theirs, null), 'Berat telde hier al 70 (09:02). Jij wiste het aantal.');
});

test('a conflict with a wiped count has no name and no time to show', () => {
  assert.equal(conflictText(line({ revision: 4 }), 12), 'Het aantal is hier intussen gewist. Jouw telling: 12.');
});

test('an open document names the invoice or the container that explains the difference', () => {
  assert.equal(openDocumentText({ kind: 'FACTUUR', id: 9, number: 'F-2026-118', quantity: 30 }),
    'Factuur F-2026-118 (30 stuks) is nog niet afgepunt.');
  assert.equal(openDocumentText({ kind: 'CONTAINER', id: 4, number: 'Najaar 2026', quantity: 1200 }),
    'Container Najaar 2026 (1.200 stuks) is nog niet bijgeboekt.');
});

test('"Zelfde reden voor alle" keeps the count and the revision of every line', () => {
  const lines = [
    countedLine(10, 7, { id: 501, revision: 3 }),
    countedLine(0, 2, { id: 502, revision: 1, documentsConfirmed: true }),
  ];
  assert.deepEqual(sameReasonWrites(lines, 'NIET_GEVONDEN', null), [
    { lineId: 501, write: { countedQuantity: 7, reasonCode: 'NIET_GEVONDEN', reasonNote: null, revision: 3 } },
    { lineId: 502, write: { countedQuantity: 2, reasonCode: 'NIET_GEVONDEN', reasonNote: null, revision: 1 } },
  ]);
  const [first] = sameReasonWrites(lines, 'ANDERS', '  na de beurs  ');
  assert.equal(first.write.reasonNote, 'na de beurs');
  /* Nothing asks the server for a new count or touches the document tick. */
  assert.equal('rebase' in first.write, false);
  assert.equal('documentsConfirmed' in first.write, false);
  assert.deepEqual(sameReasonWrites([], 'ANDERS', 'x'), []);
});

test('a rebase resends the same count with its reason and asks for the level of now', () => {
  const moved = countedLine(100, 70, { id: 77, revision: 5, liveQuantity: 70, moved: true, reasonCode: 'NIET_GEVONDEN', reasonNote: 'doos 3' });
  assert.deepEqual(rebaseWrite(moved),
    { countedQuantity: 70, reasonCode: 'NIET_GEVONDEN', reasonNote: 'doos 3', revision: 5, rebase: true });
});

test('"Klopt" is offered only while the system figure is not below zero', () => {
  assert.equal(canConfirmEqual(line({ liveQuantity: 3 })), true);
  assert.equal(canConfirmEqual(line({ liveQuantity: 0 })), true);
  assert.equal(canConfirmEqual(line({ liveQuantity: -1 })), false);
});
