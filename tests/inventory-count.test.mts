import assert from 'node:assert/strict';
import test from 'node:test';
import type { BookingCheck, CountLine, CountView } from '../src/app/core/api/inventory-models.ts';
import {
  BOOKING_QUIET_NOTE, COUNT_CHIPS, bookingSummaryText, canConfirmEqual, conflictText, countProgress, countSections, differenceText,
  filterLines, lineState, mergeCountView, openDocumentHint, openDocumentText, overtakenDrafts, reasonsFor, rebaseWrite,
  sameReasonWrites,
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
  /* One line that is right "klopt"; several "kloppen". */
  assert.equal(bookingSummaryText({ lines: 4, equal: 1, short: 2, shortUnits: 8, over: 1, overUnits: 1 }),
    'Je boekt 4 regels: 1 klopt, 2 te weinig (-8), 1 te veel (+1).');
  assert.equal(bookingSummaryText({ lines: 1, equal: 0, short: 1, shortUnits: 2, over: 0, overUnits: 0 }),
    'Je boekt 1 regel: 0 kloppen, 1 te weinig (-2), 0 te veel (+0).');
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

/* ---- order, reasons and hints ---- */

test('names with numbers come in the order of the shelf', () => {
  const lines = ['Rose Bear 100 cm', 'Rose Bear 25 cm', 'Mini Rose Display 40', 'Mini Rose Display 4', 'Mini Rose Display 34', 'Los product 6', 'Los product 54']
    .map((productName) => line({ productName }));
  assert.deepEqual(names(countSections(lines)[0].lines), [
    'Los product 6', 'Los product 54', 'Mini Rose Display 4', 'Mini Rose Display 34', 'Mini Rose Display 40',
    'Rose Bear 25 cm', 'Rose Bear 100 cm',
  ]);
});

const REASONS = ['BESCHADIGD', 'NIET_GEVONDEN', 'TELFOUT', 'ANDERE_LOCATIE', 'DEMO', 'TERUGGEVONDEN', 'ANDERS'].map((code) => ({ code }));
const codes = (reasons: { code: string }[]) => reasons.map((reason) => reason.code);

test('the reasons offered fit the direction of the difference', () => {
  /* 2 te weinig: nothing was "found back". */
  assert.deepEqual(codes(reasonsFor(REASONS, [-2])), ['BESCHADIGD', 'NIET_GEVONDEN', 'TELFOUT', 'ANDERE_LOCATIE', 'DEMO', 'ANDERS']);
  /* 1 te veel: nothing was lost, broken or given away. */
  assert.deepEqual(codes(reasonsFor(REASONS, [1])), ['TELFOUT', 'ANDERE_LOCATIE', 'TERUGGEVONDEN', 'ANDERS']);
  /* The same reason for lines that go both ways, or no difference known: every reason. */
  assert.deepEqual(codes(reasonsFor(REASONS, [-2, 1])), codes(REASONS));
  assert.deepEqual(codes(reasonsFor(REASONS, [null])), codes(REASONS));
  assert.deepEqual(codes(reasonsFor(REASONS, [-2, -5])), codes(reasonsFor(REASONS, [-2])));
  /* A reason this screen does not know stays on both sides. */
  assert.deepEqual(codes(reasonsFor([{ code: 'NIEUW' }, { code: 'TERUGGEVONDEN' }], [-1])), ['NIEUW']);
});

test('the way out under an open document names the right action', () => {
  const invoice = { kind: 'FACTUUR' as const, id: 1, number: 'F-2026-118', quantity: 30 };
  const container = { kind: 'CONTAINER' as const, id: 46, number: 'Kunming september', quantity: 3 };
  assert.equal(openDocumentHint([container]), 'Zijn dit die stuks? Boek dan eerst de container bij; het verschil verdwijnt dan uit de telling.');
  assert.equal(openDocumentHint([invoice]), 'Zijn dit die stuks? Punt dan eerst de factuur af; het verschil verdwijnt dan uit de telling.');
  assert.equal(openDocumentHint([invoice, container]),
    'Zijn dit die stuks? Punt dan eerst de factuur af en boek de container bij; het verschil verdwijnt dan uit de telling.');
});

/* ---- a reload against the screen ---- */

const session = (status: CountView['status'], lines: CountLine[], input: Partial<CountView> = {}) =>
  ({ id: 5, status, bookedByName: null, bookedAt: null, lines, ...input }) as CountView;

test('a reload keeps the newer local line and a line added here meanwhile', () => {
  const saved = countedLine(10, 9, { id: 1, revision: 3 });
  const added = line({ id: 9, addedByHand: true });
  const current = session('OPEN', [saved, line({ id: 2 }), added]);
  const theirs = countedLine(10, 7, { id: 2, revision: 1, countedByName: 'Emre' });
  const merged = mergeCountView(current, session('OPEN', [line({ id: 1, revision: 2 }), theirs]));
  assert.deepEqual(merged.lines.map((row) => [row.id, row.countedQuantity, row.revision]), [[1, 9, 3], [2, 7, 1], [9, null, 0]]);
  /* Another session, or nothing on screen: the answer as it is. */
  const other = session('OPEN', [], { id: 6 });
  assert.equal(mergeCountView(current, other), other);
  assert.equal(mergeCountView(null, other), other);
});

test('a reload that is older than the booking never opens the session again', () => {
  const booked = session('GEBOEKT', [countedLine(10, 9, { id: 1, revision: 3 })], { bookedByName: 'Tester', bookedAt: '2026-10-08T04:57:00Z' });
  const late = session('OPEN', [countedLine(10, 9, { id: 1, revision: 3 })]);
  const merged = mergeCountView(booked, late);
  assert.equal(merged, booked);
  assert.equal(merged.status, 'GEBOEKT');
  assert.equal(merged.bookedByName, 'Tester');
  assert.equal(mergeCountView(session('GEANNULEERD', []), late).status, 'GEANNULEERD');
  /* The other way round is news: an open screen learns that the session was booked elsewhere. */
  assert.equal(mergeCountView(late, booked).status, 'GEBOEKT');
});

test('a number typed in a line somebody else counted meanwhile is not lost', () => {
  const current = session('OPEN', [line({ id: 2 }), line({ id: 3 }), line({ id: 4 }), countedLine(10, 10, { id: 5, revision: 1 })]);
  const fresh = session('OPEN', [
    countedLine(10, 10, { id: 2, revision: 1, countedByName: 'Tester' }), line({ id: 3 }),
    countedLine(10, 8, { id: 4, revision: 1 }), countedLine(10, 10, { id: 5, revision: 1 }),
  ]);
  const overtaken = overtakenDrafts(current, fresh, { 2: ' 12 ', 3: '9', 5: '4' });
  /* Line 2 was typed in here and counted there; 3 is still open (its draft stays in its field); 4 had no draft; 5 was no field. */
  assert.deepEqual(overtaken.map((entry) => [entry.line.id, entry.line.countedQuantity, entry.draft]), [[2, 10, '12']]);
  /* An answer that is older than the local line overtakes nothing. */
  const wiped = session('OPEN', [line({ id: 2, revision: 4 })]);
  assert.deepEqual(overtakenDrafts(wiped, session('OPEN', [countedLine(10, 10, { id: 2, revision: 3 })]), { 2: '12' }), []);
  assert.deepEqual(overtakenDrafts(null, fresh, { 2: '12' }), []);
});

test('the booking screen says a movement during the booking can still be missed', () => {
  /* The booking runs for seconds, not an instant; the advice to book in a quiet moment stays. */
  assert.match(BOOKING_QUIET_NOTE, /Het boeken duurt enkele seconden\./);
  assert.match(BOOKING_QUIET_NOTE, /kan die beweging nog gemist worden\./);
  assert.match(BOOKING_QUIET_NOTE, /Boek de telling op een moment dat niemand verzendt of ontvangt\.$/);
});
