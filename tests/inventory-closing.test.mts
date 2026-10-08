import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type {
  ClosingArticle, ClosingArticleLocation, ClosingContainer, ClosingLayer, ClosingLocation, ClosingStream, ClosingSummary,
  ClosingTotals, ClosingView, Decision, DecisionKind, Notice, NoticeSegment, OpeningLayer, SeparateItem, WriteDownRow,
} from '../src/app/core/api/inventory-models.ts';
import {
  bookedLater, byName, carvedPieces, countStartRefusal, dateText, dateTimeText, needsLook, openingQuantity, openingReplaced, presentText,
  rollDirection, rollEffect, rollIntro, rollTickHead, rollTickLabel, sentence, todoText, versionStartRefusal,
} from '../src/app/features/inventory/inventory-closing.ts';
import {
  borderFixed, decisionWriteAccrual, decisionWriteCreditTreatment, decisionWriteInvoiced, decisionWriteMovement,
  decisionWriteOwnershipDate, decisionWritePartnerContainer, decisionWritePartnerQuantity, decisionWriteSupplierBilled,
  decisionWriteThirdParty, decisionWriteTransit, decisionWriteVatConfirmation, decisionWriteWriteDown,
  defaultInventoryYear, defaultOpeningDate, fileName, invoiceBulkWrite, laterRowsIntro, noticesFor, openingDateError,
  rollLine, stepStates, streamButtonLabel, streamNotice, stripItems, undecidedInvoiceIds, unvaluedRows, writeDownPreview,
} from '../src/app/features/inventory/inventory-closing.ts';

const TOTALS: ClosingTotals = {
  costValueEur: 3181.76, writeDownEur: 24.54, ownValueEur: 3157.22, demoValueEur: 0, partnerIncludedEur: 410.1,
  partnerExcludedEur: 0, transitIncludedEur: 1250.2, transitExcludedEur: 300, invoicedOutEur: 69, totalValueEur: 4817.52,
  estimatedEur: 188.33, ownQuantity: 1270, unvaluedQuantity: 0,
};

function view(input: Partial<ClosingView> = {}): ClosingView {
  return {
    id: 7, closingYear: 2026, versionNo: 1, closingDate: '2026-12-31', cutoffAt: '2026-12-31T23:00:00Z', status: 'CONCEPT',
    superseded: false, supersedesId: null, supersededById: null, correctionReason: null, previousClosing: null,
    previousClosingReplacedBy: null, versionChanges: null, olderInvoices: [], totals: TOTALS, notices: [], locations: [],
    articles: [], containers: [], separate: [], writeDowns: [], movements: [], decisions: [], openingLayers: [],
    writeDownReasons: [], computedAt: '2027-01-05T10:00:00Z', dataSha256: 'abc', finalizedByName: null, finalizedAt: null,
    signerName: null, pdfSha256: null, xlsxSha256: null, versions: [], canFinalize: false, canCorrect: false,
    ...input,
  } as ClosingView;
}

const blocker = (segment: NoticeSegment, code = 'X', input: Partial<Notice> = {}): Notice =>
  ({ code, severity: 'BLOCKER', segment, message: `${code} houdt tegen`, ...input });
const warning = (segment: NoticeSegment, code = 'W', input: Partial<Notice> = {}): Notice =>
  ({ code, severity: 'WARNING', segment, message: `${code} ter info`, ...input });
const decision = (kind: DecisionKind, input: Partial<Decision> = {}) => ({ id: 1, kind, salesOrderId: null, ...input }) as Decision;
const location = (anchor: ClosingLocation['anchor'], input: Partial<ClosingLocation> = {}) =>
  ({ locationId: 1, locationName: 'Magazijn', anchor, movementCount: 0, reviewCount: 0, ...input }) as ClosingLocation;
const article = (input: Partial<ClosingArticle> = {}) =>
  ({ productId: 1, productName: 'Roos in stolp rood', status: 'OK', unvaluedQuantity: 0, layers: [], locations: [], ...input }) as ClosingArticle;
const layer = (position: number, quantity: number, unitValueEur: number, valueEur: number, input: Partial<ClosingLayer> = {}) =>
  ({ block: 'EIGEN', position, source: 'PARTIJ', quantity, unitValueEur, valueEur, ...input }) as ClosingLayer;
const writeDown = (decisionId: number, layerPosition: number, quantity: number, amountEur: number) =>
  ({ decisionId, productId: 1, layerPosition, quantity, amountEur }) as WriteDownRow;

const stateOf = (closing: ClosingView, key: NoticeSegment) => stepStates(closing).find((step) => step.key === key)!.state;

/* ---- step states ---- */

test('the five steps come in order with their names', () => {
  const steps = stepStates(view());
  assert.deepEqual(steps.map((step) => step.key), ['tellen', 'datum', 'waarde', 'apart', 'afsluiten']);
  assert.deepEqual(steps.map((step) => step.label),
    ['Tellen', 'Bewegingen rond de afsluitdatum', 'Waarde', 'Afzonderlijk', 'Afsluiten']);
});

test('tellen: klaar without a blocker, todo with one, bezig once a location is counted', () => {
  assert.equal(stateOf(view({ locations: [location('BOEKSTAND')] }), 'tellen'), 'KLAAR');
  assert.equal(stateOf(view({ notices: [blocker('tellen', 'TELLING_ONTBREEKT')], locations: [location('BOEKSTAND')] }), 'tellen'), 'TODO');
  assert.equal(stateOf(view({
    notices: [blocker('tellen', 'TELLING_ONTBREEKT')], locations: [location('TELLING'), location('BOEKSTAND', { locationId: 2 })],
  }), 'tellen'), 'BEZIG');
  /* A warning never holds a step open. */
  assert.equal(stateOf(view({ notices: [warning('tellen', 'VERWIJDERD_PRODUCT')] }), 'tellen'), 'KLAAR');
});

test('datum: bezig once a movement was decided', () => {
  const negative = [blocker('datum', 'NEGATIEF')];
  assert.equal(stateOf(view(), 'datum'), 'KLAAR');
  assert.equal(stateOf(view({ notices: negative }), 'datum'), 'TODO');
  assert.equal(stateOf(view({ notices: negative, decisions: [decision('MOVEMENT')] }), 'datum'), 'BEZIG');
  /* A decision of another step does not count here. */
  assert.equal(stateOf(view({ notices: negative, decisions: [decision('WRITE_DOWN')] }), 'datum'), 'TODO');
});

test('waarde: bezig after one of its decisions or a beginwaarde layer', () => {
  const open = [blocker('waarde', 'ZONDER_WAARDE')];
  assert.equal(stateOf(view(), 'waarde'), 'KLAAR');
  assert.equal(stateOf(view({ notices: open }), 'waarde'), 'TODO');
  for (const kind of ['ACCRUAL', 'SUPPLIER_BILLED', 'CREDIT_TREATMENT', 'OWNERSHIP_DATE', 'WRITE_DOWN'] as const) {
    assert.equal(stateOf(view({ notices: open, decisions: [decision(kind)] }), 'waarde'), 'BEZIG', kind);
  }
  for (const kind of ['MOVEMENT', 'TRANSIT', 'INVOICED', 'VAT_CONFIRMATION'] as const) {
    assert.equal(stateOf(view({ notices: open, decisions: [decision(kind)] }), 'waarde'), 'TODO', kind);
  }
  const opening = article({ layers: [layer(1, 20, 2.1, 42, { source: 'BEGINWAARDE' })] });
  assert.equal(stateOf(view({ notices: open, articles: [opening] }), 'waarde'), 'BEZIG');
  assert.equal(stateOf(view({ notices: open, articles: [article({ layers: [layer(1, 20, 2.1, 42)] })] }), 'waarde'), 'TODO');
});

test('apart: bezig after one of its decisions', () => {
  const open = [blocker('apart', 'BESLISSING_ONDERWEG')];
  assert.equal(stateOf(view(), 'apart'), 'KLAAR');
  assert.equal(stateOf(view({ notices: open }), 'apart'), 'TODO');
  for (const kind of ['TRANSIT', 'PARTNER_CONTAINER', 'PARTNER_QUANTITY', 'INVOICED', 'THIRD_PARTY'] as const) {
    assert.equal(stateOf(view({ notices: open, decisions: [decision(kind)] }), 'apart'), 'BEZIG', kind);
  }
  assert.equal(stateOf(view({ notices: open, decisions: [decision('ACCRUAL')] }), 'apart'), 'TODO');
});

test('afsluiten: klaar when final, bezig on a concept nothing holds back, todo otherwise', () => {
  assert.equal(stateOf(view({ status: 'DEFINITIEF' }), 'afsluiten'), 'KLAAR');
  assert.equal(stateOf(view(), 'afsluiten'), 'BEZIG');
  assert.equal(stateOf(view({ notices: [warning('waarde', 'GESCHAT'), warning('afsluiten', 'KOERS_INGEVOERD')] }), 'afsluiten'), 'BEZIG');
  /* A blocker in any step, its own included. */
  assert.equal(stateOf(view({ notices: [blocker('tellen', 'TELLING_OPEN')] }), 'afsluiten'), 'TODO');
  assert.equal(stateOf(view({ notices: [blocker('afsluiten', 'BTW_BEVESTIGING')] }), 'afsluiten'), 'TODO');
});

test('the step lines carry their counters', () => {
  const closing = view({
    locations: [
      location('TELLING', { movementCount: 4, reviewCount: 1 }),
      location('BOEKSTAND', { locationId: 2, movementCount: 2, reviewCount: 1 }),
      location('GEEN', { locationId: 3 }),
    ],
    articles: [article({ status: 'ZONDER_WAARDE', unvaluedQuantity: 5 }), article({ productId: 2, status: 'ZONDER_WAARDE', unvaluedQuantity: 1 }), article({ productId: 3 })],
    notices: [
      blocker('waarde', 'ZONDER_WAARDE'), blocker('apart', 'BESLISSING_ONDERWEG'), blocker('apart', 'BESLISSING_PARTNER'),
      warning('apart', 'APART_ZONDER_MARKTTOETS'),
    ],
  });
  assert.deepEqual(stepStates(closing).map((step) => step.line), [
    '1 Tellen · 1 van 2 locaties geboekt',
    '2 Bewegingen rond de afsluitdatum · 6 bewegingen, 2 na te kijken',
    '3 Waarde · 2 producten zonder waarde',
    '4 Afzonderlijk · 2 beslissingen open',
    '5 Afsluiten',
  ]);
});

test('the value line counts open points when every product has a value, and is bare when nothing is open', () => {
  const lineOf = (closing: ClosingView) => stepStates(closing)[2].line;
  assert.equal(lineOf(view({ notices: [blocker('waarde', 'GEEN_PRIJS'), blocker('waarde', 'TEGOED_ZONDER_SOORT'), warning('waarde', 'GESCHAT')] })),
    '3 Waarde · 2 punten open');
  assert.equal(lineOf(view({ notices: [warning('waarde', 'GESCHAT')] })), '3 Waarde');
  assert.equal(stepStates(view())[0].line, '1 Tellen · 0 van 0 locaties geboekt');
  /* Nothing open: the chip carries no counter instead of "0 beslissingen open". */
  assert.equal(stepStates(view())[3].line, '4 Afzonderlijk');
});

test('a counter of one is singular on every step', () => {
  const closing = view({
    locations: [location('TELLING', { movementCount: 1, reviewCount: 0 })],
    articles: [article({ status: 'ZONDER_WAARDE', unvaluedQuantity: 3 })],
    notices: [blocker('waarde', 'ZONDER_WAARDE'), blocker('apart', 'BESLISSING_PARTNER')],
  });
  assert.deepEqual(stepStates(closing).map((step) => step.line), [
    '1 Tellen · 1 van 1 locatie geboekt',
    '2 Bewegingen rond de afsluitdatum · 1 beweging, 0 na te kijken',
    '3 Waarde · 1 product zonder waarde',
    '4 Afzonderlijk · 1 beslissing open',
    '5 Afsluiten',
  ]);
  assert.equal(stepStates(view({ notices: [blocker('waarde', 'GEEN_PRIJS')] }))[2].line, '3 Waarde · 1 punt open');
});

test('the hub says what is left, and never "Nog 0 te doen"', () => {
  assert.equal(todoText(6), 'Nog 6 te doen');
  assert.equal(todoText(1), 'Nog 1 te doen');
  assert.equal(todoText(0), 'Klaar om definitief te maken');
});

test('the notices of a step come with the blockers first', () => {
  const closing = view({ notices: [
    warning('waarde', 'GESCHAT'), blocker('apart', 'BESLISSING_PARTNER'), blocker('waarde', 'GEEN_PRIJS'),
    warning('waarde', 'DEMO_VOL'), blocker('waarde', 'ZONDER_WAARDE'),
  ] });
  assert.deepEqual(noticesFor(closing, 'waarde').map((notice) => notice.code), ['GEEN_PRIJS', 'ZONDER_WAARDE', 'GESCHAT', 'DEMO_VOL']);
  assert.deepEqual(noticesFor(closing, 'datum'), []);
});

/* ---- strip ---- */

test('the strip builds up to the total, which comes last with the estimated part under it', () => {
  assert.deepEqual(stripItems(TOTALS).map((item) => [item.label, item.valueEur]), [
    ['Aanschafwaarde eigen voorraad', 3181.76],
    ['Waardeverminderingen', 24.54],
    ['Eigen voorraad na waardevermindering', 3157.22],
    ['Partner en onderweg, opgenomen', 1660.3],
    ['Totaal voorraadwaarde', 4817.52],
  ]);
  const items = stripItems(TOTALS);
  /* "Waarvan geschat" is a part of the total and of no other figure: it hangs under the total, the one figure set apart. */
  assert.deepEqual(items.filter((item) => item.grand).map((item) => item.key), ['total']);
  assert.deepEqual(items[4].sub, { label: 'waarvan geschat', valueEur: 188.33 });
  assert.equal(items.filter((item) => item.sub).length, 1);
  /* 0,10 + 0,20 is not 0,30 in floating point; the strip adds cents. */
  assert.equal(stripItems({ ...TOTALS, partnerIncludedEur: 0.1, transitIncludedEur: 0.2 })[3].valueEur, 0.3);
});

/* ---- step 2 ---- */

const articleLocation = (input: Partial<ClosingArticleLocation>) => ({ locationId: 1, locationName: 'Magazijn', ...input }) as ClosingArticleLocation;

test('a count after the closing date is rolled back to it (worked example 3.8)', () => {
  /* Counted 1.210 on 02/01; the sale of -40 of that morning is taken out again. */
  const magazijn = articleLocation({ countAfterClosingDate: true, anchorQuantity: 1210, rollDelta: 40, closingQuantity: 1250 });
  assert.equal(rollLine(magazijn, '2026-12-31'),
    'Geteld 1.210, bewegingen sinds 31/12/2026 teruggeteld: +40 → 1.250 op 31/12/2026');
});

test('a count before the closing date is rolled forward to it', () => {
  const tica = articleLocation({ countAfterClosingDate: false, anchorQuantity: 50, rollDelta: 0, closingQuantity: 50 });
  assert.equal(rollLine(tica, '2026-12-31'), 'Geteld 50, bewegingen tot 31/12/2026 bijgeteld: 0 → 50');
  const sold = articleLocation({ countAfterClosingDate: false, anchorQuantity: 60, rollDelta: -12, closingQuantity: 48 });
  assert.equal(rollLine(sold, '2026-12-31'), 'Geteld 60, bewegingen tot 31/12/2026 bijgeteld: -12 → 48');
});

test('a tick of step 2 means one thing in both tables: the movement is counted back (or on) to the closing date', () => {
  /* Counted after the closing date: the same word, head and effect in the main table and in "Later geboekt". */
  assert.equal(rollTickLabel(true), 'Terugtellen');
  assert.equal(rollTickHead(true, '2026-12-31'), 'Terugtellen naar 31/12/2026');
  assert.equal(rollTickLabel(false), 'Bijtellen');
  assert.equal(rollTickHead(false, '2026-12-31'), 'Bijtellen t/m 31/12/2026');
  assert.equal(rollIntro(true, '2026-12-31', '2027-01-02T09:15:00Z'),
    'De telling was op 02/01/2027, na de afsluitdatum. Een vinkje betekent: deze beweging gebeurde na 31/12/2026 en wordt '
    + 'teruggeteld, zodat het aantal van 31/12/2026 overblijft. Was ze op 31/12/2026 al gebeurd en alleen later geboekt? Haal het vinkje dan weg.');
  assert.equal(rollIntro(false, '2026-12-31', '2026-12-28'),
    'De telling was op 28/12/2026, vóór de afsluitdatum. Een vinkje betekent: deze beweging gebeurde nog tot en met 31/12/2026 '
    + 'en wordt bij het getelde aantal geteld. Gebeurde ze pas na 31/12/2026? Haal het vinkje dan weg.');
  assert.equal(laterRowsIntro(true, '2026-12-31', '2027-01-02T09:15:00Z'),
    'Geboekt na de telling van 02/01/2027. Zet alleen een vinkje bij wat in werkelijkheid tussen 31/12/2026 en de telling '
    + 'gebeurde en pas later geboekt is: het wordt dan teruggeteld. Een gewone beweging van na de telling laat je zonder vinkje.');
  assert.equal(laterRowsIntro(false, '2026-12-31', '2026-12-28'),
    'Geboekt na 31/12/2026. Zet alleen een vinkje bij wat in werkelijkheid tot en met 31/12/2026 gebeurde en pas later geboekt is: '
    + 'het wordt dan bijgeteld. Een gewone beweging van na 31/12/2026 laat je zonder vinkje.');
  /* The count day is the Brussels day: 23:30 UTC on 1 January is already 2 January there. */
  assert.match(laterRowsIntro(true, '2026-12-31', '2027-01-01T23:30:00Z'), /de telling van 02\/01\/2027/);
});

test('a ticked row shows what it does to the closing quantity (worked example 3.8: the sale of -40 gives +40 terug)', () => {
  assert.equal(rollEffect(-40, true, true), '+40 terug');
  assert.equal(rollEffect(12, true, true), '-12 terug');
  assert.equal(rollEffect(-12, true, false), '-12 erbij');
  assert.equal(rollEffect(1250, true, false), '+1.250 erbij');
  /* No tick, or no stock change: nothing happens to the figure. */
  assert.equal(rollEffect(-40, false, true), '');
  assert.equal(rollEffect(0, true, true), '');
  /* The effects of the ticked rows add up to the rollDelta the result line prints. */
  const magazijn = articleLocation({ countAfterClosingDate: true, anchorQuantity: 1210, rollDelta: 40, closingQuantity: 1250 });
  assert.match(rollLine(magazijn, '2026-12-31'), /teruggeteld: \+40 → 1\.250/);
});

test('a row is "later geboekt" after the later of the count and the cut-off', () => {
  const cutoff = Date.parse('2026-12-31T23:00:00Z');
  /* Counted on 02/01, after the cut-off: later = booked after the count. */
  assert.equal(bookedLater('2027-01-02T08:00:00Z', '2027-01-02T09:15:00Z', cutoff), false);
  assert.equal(bookedLater('2027-01-02T09:15:00Z', '2027-01-02T09:15:00Z', cutoff), false);
  assert.equal(bookedLater('2027-01-02T09:15:01Z', '2027-01-02T09:15:00Z', cutoff), true);
  /* Counted on 28/12, before the cut-off: later = booked from the cut-off on. */
  assert.equal(bookedLater('2026-12-30T10:00:00Z', '2026-12-28T10:00:00Z', cutoff), false);
  assert.equal(bookedLater('2026-12-31T23:00:00Z', '2026-12-28T10:00:00Z', cutoff), true);
  /* Counted exactly on the cut-off counts as after it. */
  assert.equal(bookedLater('2026-12-31T23:00:00Z', '2026-12-31T23:00:00Z', cutoff), false);
  /* Without an anchor (or with an unreadable instant) every row is between. */
  assert.equal(bookedLater('2027-03-01T10:00:00Z', null, cutoff), false);
  assert.equal(bookedLater('geen datum', '2027-01-02T09:15:00Z', cutoff), false);
  assert.equal(bookedLater('2027-03-01T10:00:00Z', '2027-01-02T09:15:00Z', NaN), false);
});

test('every instant of the Jaarinventaris reads in Brussels time, whatever the device zone', () => {
  /* 23:30 UTC on New Year's Eve is 00:30 on 1 January in Brussels: the day the server and the PDF print. */
  assert.equal(dateText('2026-12-31T23:30:00Z'), '01/01/2027');
  assert.equal(dateTimeText('2026-12-31T23:30:00Z'), '01/01/2027 00:30');
  /* Summer time: 22:10 UTC is 00:10 the next day. */
  assert.equal(dateText('2026-07-14T22:10:00Z'), '15/07/2026');
  assert.equal(dateTimeText('2026-10-08T04:57:00Z'), '08/10/2026 06:57');
  /* A plain date is no instant and never shifts. */
  assert.equal(dateText('2026-12-31'), '31/12/2026');
  assert.equal(dateText(null), '—');
  assert.equal(dateTimeText(undefined), '—');
  assert.equal(dateText('geen datum'), 'geen datum');
});

test('names sort with their numbers in order, as on the shelf', () => {
  const names = ['Rose Bear 100 cm', 'Rose Bear 25 cm', 'Mini Rose Display 40', 'Mini Rose Display 4', 'Mini Rose Display 34'];
  assert.deepEqual([...names].sort(byName),
    ['Mini Rose Display 4', 'Mini Rose Display 34', 'Mini Rose Display 40', 'Rose Bear 25 cm', 'Rose Bear 100 cm']);
});

test('a refusal reads as a sentence', () => {
  assert.equal(sentence('De gegevens zijn intussen gewijzigd. Herbereken en kijk de cijfers opnieuw na'),
    'De gegevens zijn intussen gewijzigd. Herbereken en kijk de cijfers opnieuw na.');
  assert.equal(sentence('Al definitief.'), 'Al definitief.');
  assert.equal(sentence('  Kan dat?  '), 'Kan dat?');
  assert.equal(sentence(''), '');
  /* The server sends every refusal without its full stop (StockCountService, StockClosingService, StockClosingFinalizer). */
  for (const message of [
    'Voor Magazijn loopt al een telling', 'Voor 2026 bestaat al een afsluiting. Open ze, of maak een nieuwe versie',
    'Voor 2026 staat al een concept open', 'Een definitieve afsluiting kan niet verwijderd worden', 'Deze telling is al geboekt',
    'Corrigeren kan alleen op de laatste geboekte telling van Magazijn voor 2026', 'Afsluiting 2 bestaat niet',
  ]) assert.equal(sentence(message), `${message}.`);
});

test('every server sentence the inventory screens show goes through sentence()', () => {
  const folder = new URL('../src/app/features/inventory/', import.meta.url);
  const bare: string[] = [];
  let shown = 0;
  for (const file of readdirSync(folder).filter((name) => name.endsWith('.ts'))) {
    readFileSync(new URL(file, folder), 'utf8').split('\n').forEach((line, index) => {
      if (!line.includes('messageOf(') || line.trimStart().startsWith('import ')) return;
      shown += 1;
      if (!line.includes('sentence(messageOf(')) bare.push(`${file}:${index + 1}`);
    });
  }
  assert.ok(shown >= 20, `only ${shown} messageOf calls found: the check reads the wrong lines`);
  assert.deepEqual(bare, []);
});

test('a refused start says what the screen does next', () => {
  /* Somebody else started the location: their session opens. */
  assert.deepEqual(countStartRefusal('TELLING_LOOPT', { countId: 3 }), { open: 3, reload: false });
  /* A newer full count was booked meanwhile: "Telling corrigeren" stood on the old one, the overview is read again. */
  assert.deepEqual(countStartRefusal('GEEN_TELLING_OM_TE_CORRIGEREN', {}), { open: null, reload: true });
  assert.deepEqual(countStartRefusal('TELLING_LOOPT', {}), { open: null, reload: false });
  assert.deepEqual(countStartRefusal(null, null), { open: null, reload: false });
  /* A concept of the year is open: that version opens. */
  assert.deepEqual(versionStartRefusal('CONCEPT_BESTAAT', { closingId: 9 }), { open: 9, reload: false });
  /* No longer the valid final version: read it again, so "Corrigeren" goes and the replacing version shows. */
  assert.deepEqual(versionStartRefusal('GEEN_DEFINITIEVE', {}), { open: null, reload: true });
  assert.deepEqual(versionStartRefusal('DEFINITIEF', {}), { open: null, reload: false });
  assert.deepEqual(versionStartRefusal(null, null), { open: null, reload: false });
});

test('a table of step 2 takes its direction from the places of its products', () => {
  const late = { anchoredAt: '2027-01-02T09:15:00Z', countAfterClosingDate: true };
  const early = { anchoredAt: '2026-12-28T10:00:00Z', countAfterClosingDate: false };
  /* "Lege locatie bevestigen": the count booked no line, so the location answers no moment and "before", its products the count. */
  const emptyCount = { anchoredAt: null, countAfterClosingDate: false };
  assert.deepEqual(rollDirection([late, late], emptyCount), { after: true, anchoredAt: '2027-01-02T09:15:00Z' });
  assert.equal(rollTickHead(rollDirection([late], emptyCount).after, '2026-12-31'), 'Terugtellen naar 31/12/2026');
  /* The usual case: location and products agree; the latest count moment of the table is named. */
  assert.deepEqual(rollDirection([late, { ...late, anchoredAt: '2027-01-03T08:00:00Z' }], late), { after: true, anchoredAt: '2027-01-03T08:00:00Z' });
  assert.deepEqual(rollDirection([early, null], early), { after: false, anchoredAt: '2026-12-28T10:00:00Z' });
  /* No place known (the product left the articles), or the products disagree: the location decides. */
  assert.deepEqual(rollDirection([null], late), { after: true, anchoredAt: '2027-01-02T09:15:00Z' });
  assert.deepEqual(rollDirection([], early), { after: false, anchoredAt: '2026-12-28T10:00:00Z' });
  assert.deepEqual(rollDirection([late, early], late), { after: true, anchoredAt: '2027-01-02T09:15:00Z' });
  /* A level read from the book has no moment of its own: the direction is the place's, the moment the location's (none). */
  assert.deepEqual(rollDirection([{ anchoredAt: null, countAfterClosingDate: true }], emptyCount), { after: true, anchoredAt: null });
});

/* ---- waardevermindering: worked example 3.8 ---- */

/** "Roos in stolp rood": three own containers, 30 invoiced pieces carved from the oldest. */
const LAYERS_3_8: ClosingLayer[] = [
  layer(1, 930, 2.5449, 2366.76),
  layer(2, 300, 2.41, 723),
  layer(3, 40, 2.3, 92),
  layer(3, 30, 2.3, 69, { block: 'GEFACTUREERD' }),
];

test('12 damaged pieces at € 0,50 give 24,54 and leave 3.157,22 (worked example 3.8)', () => {
  assert.deepEqual(writeDownPreview(LAYERS_3_8, [], 12, 0.5, null), { amountEur: 24.54, valueEur: 3157.22 });
});

test('a market value at or above cost writes nothing down', () => {
  assert.deepEqual(writeDownPreview(LAYERS_3_8, [], 12, 3, null), { amountEur: 0, valueEur: 3181.76 });
  assert.deepEqual(writeDownPreview(LAYERS_3_8, [], null, 2.5449, null), { amountEur: 0, valueEur: 3181.76 });
});

test('editing the saved decision releases its own rows and gives the same amount', () => {
  const saved = [writeDown(5, 1, 12, 24.54)];
  assert.deepEqual(writeDownPreview(LAYERS_3_8, saved, 12, 0.5, 5), { amountEur: 24.54, valueEur: 3157.22 });
  /* A second, new decision comes after it and takes the next twelve of the same layer. */
  assert.deepEqual(writeDownPreview(LAYERS_3_8, saved, 12, 0.5, null), { amountEur: 24.54, valueEur: 3132.68 });
});

test('a null quantity next to an explicit decision takes only what is left', () => {
  const saved = [writeDown(5, 1, 12, 24.54)];
  /* 918 x 0,5449 = 500,22; 300 x 0,41 = 123,00; 40 x 0,30 = 12,00. The invoiced 30 are no own stock. */
  assert.deepEqual(writeDownPreview(LAYERS_3_8, saved, null, 2, null), { amountEur: 635.22, valueEur: 2522 });
  /* Alone it takes all 1.270 pieces: 930 x 0,5449 = 506,76. */
  assert.deepEqual(writeDownPreview(LAYERS_3_8, [], null, 2, null), { amountEur: 641.76, valueEur: 2540 });
});

test('the dearest layers go first, each rounded to the cent on its own', () => {
  /* 930 x 2,0449 = 1.901,757 → 1.901,76; the next 10 from layer 2: 10 x 1,91 = 19,10. */
  assert.deepEqual(writeDownPreview(LAYERS_3_8, [], 940, 0.5, null), { amountEur: 1920.86, valueEur: 1260.9 });
  /* Equal unit values: the lower position first. */
  const equal = [layer(2, 10, 2, 20), layer(1, 10, 2, 20), layer(3, 10, 1.5, 15)];
  const first = writeDownPreview(equal, [], 10, 1, null);
  const afterFirst = writeDownPreview(equal, [writeDown(1, 1, 10, 10)], 15, 1, null);
  assert.deepEqual(first, { amountEur: 10, valueEur: 45 });
  /* Layer 1 is taken: 10 of layer 2 at 1,00 and 5 of layer 3 at 0,50. */
  assert.deepEqual(afterFirst, { amountEur: 12.5, valueEur: 32.5 });
});

test('rows of decisions with a higher id are ignored while an earlier one is edited', () => {
  const saved = [writeDown(5, 1, 12, 24.54), writeDown(8, 1, 918, 500.22), writeDown(8, 2, 300, 123)];
  assert.deepEqual(writeDownPreview(LAYERS_3_8, saved, 12, 0.5, 5), { amountEur: 24.54, valueEur: 3157.22 });
  /* Editing the later one keeps the earlier twelve taken. */
  assert.deepEqual(writeDownPreview(LAYERS_3_8, saved, null, 2, 8), { amountEur: 635.22, valueEur: 2522 });
});

test('more pieces than the own stock holds takes what is there', () => {
  assert.deepEqual(writeDownPreview(LAYERS_3_8, [], 5000, 2, null), writeDownPreview(LAYERS_3_8, [], null, 2, null));
  assert.deepEqual(writeDownPreview([], [], null, 1, null), { amountEur: 0, valueEur: 0 });
});

/* ---- zonder waarde, beginwaarden ---- */

test('the rows without a value are the products with an unvalued remainder', () => {
  const closing = view({ articles: [
    article({ productId: 1, productName: 'Gedekt' }),
    article({ productId: 2, productName: 'Deels', unvaluedQuantity: 14, status: 'ZONDER_WAARDE' }),
    article({ productId: 3, productName: 'Niets', unvaluedQuantity: 3, status: 'ZONDER_WAARDE' }),
  ] });
  assert.deepEqual(unvaluedRows(closing).map((row) => [row.productName, row.unvaluedQuantity]), [['Deels', 14], ['Niets', 3]]);
  assert.deepEqual(unvaluedRows(view()), []);
});

const PREVIOUS = { id: 3, closingYear: 2025, closingDate: '2025-12-31', versionNo: 1 };

test('a beginwaarde is dated the day after the previous closing', () => {
  assert.equal(defaultOpeningDate(view({ previousClosing: PREVIOUS })), '2026-01-01');
  /* An extended year that closed on 31 March: the day after it, across the month end. */
  assert.equal(defaultOpeningDate(view({ previousClosing: { ...PREVIOUS, closingDate: '2026-03-31' } })), '2026-04-01');
  assert.equal(defaultOpeningDate(view({ previousClosing: { ...PREVIOUS, closingDate: '2024-02-28' } })), '2024-02-29');
});

test('without a previous closing it is the day before the first day of the year', () => {
  assert.equal(defaultOpeningDate(view()), '2025-12-31');
  assert.equal(defaultOpeningDate(view({ closingYear: 2027, closingDate: '2027-12-31' })), '2026-12-31');
});

test('the default date never lies after the closing date', () => {
  assert.equal(defaultOpeningDate(view({ closingDate: '2025-06-30' })), '2025-06-30');
  assert.equal(defaultOpeningDate(view({ closingDate: '2026-12-31', previousClosing: { ...PREVIOUS, closingDate: '2026-12-31' } })), '2026-12-31');
});

test('a beginwaarde date on the previous closing date itself is refused', () => {
  const closing = view({ previousClosing: PREVIOUS });
  const refusal = 'De datum moet na 31/12/2025 en op of voor 31/12/2026 liggen';
  assert.equal(openingDateError(closing, '2025-12-31'), refusal);
  assert.equal(openingDateError(closing, '2025-06-30'), refusal);
  assert.equal(openingDateError(closing, '2027-01-01'), refusal);
  assert.equal(openingDateError(closing, '2026-01-01'), null);
  assert.equal(openingDateError(closing, '2026-12-31'), null);
  assert.equal(openingDateError(closing, defaultOpeningDate(closing)), null);
});

test('without a previous closing only the closing date bounds a beginwaarde date', () => {
  assert.equal(openingDateError(view(), '2025-12-31'), null);
  assert.equal(openingDateError(view(), '2019-01-01'), null);
  assert.equal(openingDateError(view(), '2026-12-31'), null);
  assert.equal(openingDateError(view(), '2027-01-01'), 'De datum moet op of voor 31/12/2026 liggen');
  assert.equal(openingDateError(view(), defaultOpeningDate(view())), null);
  assert.equal(openingDateError(view(), ''), 'Geef de datum van deze waarde');
  assert.equal(openingDateError(view(), null), 'Geef de datum van deze waarde');
});

/* ---- containers ---- */

const stream = (input: Partial<ClosingStream> = {}) =>
  ({ payee: 'SUPPLIER', payeeLabel: 'Leverancier', status: 'PAID', openEur: 0, accrual: null, ...input }) as ClosingStream;
const container = (input: Partial<ClosingContainer> = {}) =>
  ({ purchaseOrderId: 14, displayName: 'Najaar 2026', rateCutoffSource: 'ONTVANGST', ...input }) as ClosingContainer;

test('a stream offers to confirm an open or entered amount, otherwise to add one', () => {
  assert.equal(streamButtonLabel(stream()), 'Nog verschuldigd bedrag toevoegen');
  assert.equal(streamButtonLabel(stream({ openEur: 420.5 })), 'Bedrag bevestigen of aanpassen');
  const accrual = { decisionId: 4, amountEur: 0, invoiceReceived: true, reason: 'factuur', stale: false };
  assert.equal(streamButtonLabel(stream({ accrual })), 'Bedrag bevestigen of aanpassen');
});

test('the notice of a stream is found by container and payee', () => {
  const closing = view({ notices: [
    warning('waarde', 'MEER_BETAALD', { purchaseOrderId: 14, payee: 'LOGISTICS', amountEur: 35.2 }),
    warning('waarde', 'LAGER_AFGEREKEND', { purchaseOrderId: 14, payee: 'SUPPLIER', amountEur: 120 }),
    warning('waarde', 'MEER_BETAALD', { purchaseOrderId: 9, payee: 'SEPARATE', amountEur: 8 }),
    /* Another notice about the same container and payee is not a stream notice. */
    blocker('waarde', 'GESCHAT_BEDRAG_VEROUDERD', { purchaseOrderId: 14, payee: 'SEPARATE' }),
  ] });
  const own = container();
  assert.equal(streamNotice(closing, own, stream({ payee: 'LOGISTICS' }))?.amountEur, 35.2);
  assert.equal(streamNotice(closing, own, stream({ payee: 'LOGISTICS' }))?.code, 'MEER_BETAALD');
  assert.equal(streamNotice(closing, own, stream({ payee: 'SUPPLIER' }))?.code, 'LAGER_AFGEREKEND');
  assert.equal(streamNotice(closing, own, stream({ payee: 'SEPARATE' })), null);
  assert.equal(streamNotice(closing, container({ purchaseOrderId: 9 }), stream({ payee: 'SEPARATE' }))?.amountEur, 8);
  assert.equal(streamNotice(view(), own, stream()), null);
});

test('the border date is fixed only when the previous closing set it', () => {
  assert.equal(borderFixed(container({ rateCutoffSource: 'VORIGE_AFSLUITING' })), true);
  for (const source of ['BESLISSING', 'ONDERWEG', 'ONTVANGST', 'AFSLUITDATUM'] as const) {
    assert.equal(borderFixed(container({ rateCutoffSource: source })), false, source);
  }
});

/* ---- decisions ---- */

const invoiceRow = (salesOrderId: number, input: Partial<SeparateItem> = {}) =>
  ({ id: salesOrderId * 10, kind: 'GEFACTUREERD', salesOrderId, automatic: false, decisionId: null, ...input }) as SeparateItem;

test('the bulk write names every undecided invoice once', () => {
  const closing = view({
    separate: [
      invoiceRow(118), invoiceRow(118, { id: 1181 }),
      invoiceRow(120, { decisionId: 31, choice: 'UIT' }),
      /* Step 2 already took these pieces out: nothing to decide. */
      invoiceRow(121, { automatic: true, choice: 'AL_WEG' }),
      invoiceRow(125),
      invoiceRow(126, { automatic: true }), invoiceRow(126, { id: 1261 }),
      { id: 5, kind: 'ONDERWEG', salesOrderId: null, purchaseOrderId: 14, automatic: false, decisionId: null } as SeparateItem,
    ],
    decisions: [decision('INVOICED', { id: 31, salesOrderId: 120 })],
  });
  assert.deepEqual(undecidedInvoiceIds(closing), [118, 125, 126]);
  assert.deepEqual(invoiceBulkWrite(closing, 'UIT', null),
    { kind: 'INVOICED', salesOrderIds: [118, 125, 126], choice: 'UIT', reason: null });
  assert.deepEqual(invoiceBulkWrite(closing, 'AL_WEG', '  verzonden vóór kerst '),
    { kind: 'INVOICED', salesOrderIds: [118, 125, 126], choice: 'AL_WEG', reason: 'verzonden vóór kerst' });
});

test('an invoice whose decision is stored but whose row is not rebuilt yet counts as decided', () => {
  const closing = view({ separate: [invoiceRow(118)], decisions: [decision('INVOICED', { salesOrderId: 118 })] });
  assert.deepEqual(undecidedInvoiceIds(closing), []);
});

test('every decision kind has its payload', () => {
  assert.deepEqual(decisionWriteAccrual(14, 'LOGISTICS', 420.5, true, ' factuur forwarder '),
    { kind: 'ACCRUAL', purchaseOrderId: 14, payee: 'LOGISTICS', amountEur: 420.5, flag: true, reason: 'factuur forwarder' });
  assert.deepEqual(decisionWriteSupplierBilled(14, 'GELEVERD', 'creditnota'),
    { kind: 'SUPPLIER_BILLED', purchaseOrderId: 14, choice: 'GELEVERD', reason: 'creditnota' });
  assert.deepEqual(decisionWriteCreditTreatment(14, 6, 'IN_BETALING', 'afgetrokken van het saldo'),
    { kind: 'CREDIT_TREATMENT', purchaseOrderId: 14, creditId: 6, choice: 'IN_BETALING', reason: 'afgetrokken van het saldo' });
  assert.deepEqual(decisionWriteOwnershipDate(14, '2026-10-02', 'FOB, aan boord'),
    { kind: 'OWNERSHIP_DATE', purchaseOrderId: 14, decisionDate: '2026-10-02', reason: 'FOB, aan boord' });
  assert.deepEqual(decisionWriteTransit(15, true, '2026-12-18', 'FOB, aan boord'),
    { kind: 'TRANSIT', purchaseOrderId: 15, flag: true, decisionDate: '2026-12-18', reason: 'FOB, aan boord' });
  /* Not included: no ownership date goes along, whatever the field still held. */
  assert.deepEqual(decisionWriteTransit(15, false, '2026-12-18', 'DAP'),
    { kind: 'TRANSIT', purchaseOrderId: 15, flag: false, decisionDate: null, reason: 'DAP' });
  assert.deepEqual(decisionWritePartnerContainer(16, false, 'eigendom van de partner'),
    { kind: 'PARTNER_CONTAINER', purchaseOrderId: 16, flag: false, reason: 'eigendom van de partner' });
  assert.deepEqual(decisionWritePartnerQuantity(16, 201, 0, 'alles opgehaald'),
    { kind: 'PARTNER_QUANTITY', purchaseOrderId: 16, productId: 201, quantity: 0, reason: 'alles opgehaald' });
  assert.deepEqual(decisionWriteInvoiced(118, 'UIT', null), { kind: 'INVOICED', salesOrderId: 118, choice: 'UIT', reason: null });
  assert.deepEqual(decisionWriteInvoiced(118, 'BLIJFT', 'wordt in januari opgehaald'),
    { kind: 'INVOICED', salesOrderId: 118, choice: 'BLIJFT', reason: 'wordt in januari opgehaald' });
  assert.deepEqual(decisionWriteThirdParty(201, 12, ' Bloemen Jansen ', 'in bewaring'),
    { kind: 'THIRD_PARTY', productId: 201, quantity: 12, counterparty: 'Bloemen Jansen', reason: 'in bewaring' });
  assert.deepEqual(decisionWriteThirdParty(201, 10, 'Bloemen Jansen', 'in bewaring', 44),
    { id: 44, kind: 'THIRD_PARTY', productId: 201, quantity: 10, counterparty: 'Bloemen Jansen', reason: 'in bewaring' });
  assert.deepEqual(decisionWriteWriteDown(201, 12, 0.5, 'BESCHADIGD', 'gebarsten stolpen'),
    { kind: 'WRITE_DOWN', productId: 201, quantity: 12, unitValueEur: 0.5, reasonCode: 'BESCHADIGD', reason: 'gebarsten stolpen' });
  /* An empty quantity is every piece without a waardevermindering; the id changes a saved one. */
  assert.deepEqual(decisionWriteWriteDown(201, null, 1.25, 'MARKT', 'lagere verkoopprijs', 52),
    { id: 52, kind: 'WRITE_DOWN', productId: 201, quantity: null, unitValueEur: 1.25, reasonCode: 'MARKT', reason: 'lagere verkoopprijs' });
  assert.deepEqual(decisionWriteMovement(9001, false, 'al verzonden op 30/12'),
    { kind: 'MOVEMENT', movementId: 9001, flag: false, reason: 'al verzonden op 30/12' });
  assert.deepEqual(decisionWriteVatConfirmation(), { kind: 'VAT_CONFIRMATION', flag: true });
});

/* ---- files and the hub ---- */

test('a download is named like the server names it', () => {
  assert.equal(fileName(view(), 'pdf'), 'jaarinventaris-2026-v1-concept.pdf');
  assert.equal(fileName(view(), 'xlsx'), 'jaarinventaris-2026-v1-concept.xlsx');
  assert.equal(fileName(view({ status: 'DEFINITIEF', versionNo: 2 }), 'pdf'), 'jaarinventaris-2026-v2.pdf');
  assert.equal(fileName(view({ status: 'DEFINITIEF', versionNo: 2 }), 'xlsx'), 'jaarinventaris-2026-v2.xlsx');
});

const summary = (closingYear: number, status: ClosingSummary['status'], versionNo = 1) =>
  ({ id: closingYear * 10 + versionNo, closingYear, versionNo, status }) as ClosingSummary;

test('the hub opens on the year of an open concept', () => {
  assert.equal(defaultInventoryYear('2027-09-01', [summary(2026, 'DEFINITIEF'), summary(2025, 'CONCEPT', 2)]), 2025);
  assert.equal(defaultInventoryYear('2027-02-01', [summary(2027, 'CONCEPT'), summary(2026, 'CONCEPT', 2)]), 2027);
});

test('without a concept it is last year until June and this year from July', () => {
  assert.equal(defaultInventoryYear('2027-01-02', []), 2026);
  assert.equal(defaultInventoryYear('2027-06-30', [summary(2026, 'DEFINITIEF')]), 2026);
  assert.equal(defaultInventoryYear('2027-07-01', [summary(2026, 'DEFINITIEF')]), 2027);
  assert.equal(defaultInventoryYear('2026-12-31', []), 2026);
});

/* ---- waardevermindering: editing a decision that is not the last one ---- */

test('editing an earlier waardevermindering replays the later ones on the pieces it leaves (the figure the row shows after saving)', () => {
  /*
   * One layer of 1.045 x 2,0000 = 2.090,00. Saved: id 10 (255 at 0,6812), id 13 (604 at 0,3826), id 16 (the rest at 0,5988).
   * Stored rows: 255 x 1,3188 = 336,29; 604 x 1,6174 = 976,91; 186 x 1,4012 = 260,62.
   */
  const one = [layer(1, 1045, 2, 2090)];
  const rows = [writeDown(10, 1, 255, 336.29), writeDown(13, 1, 604, 976.91), writeDown(16, 1, 186, 260.62)];
  const saved = [
    { decisionId: 10, quantity: 255, marketUnitEur: 0.6812 },
    { decisionId: 13, quantity: 604, marketUnitEur: 0.3826 },
    { decisionId: 16, quantity: null, marketUnitEur: 0.5988 },
  ];
  /* Unchanged, the preview of id 13 gives back what is stored: 2.090,00 - 336,29 - 976,91 - 260,62 = 516,18. */
  assert.deepEqual(writeDownPreview(one, rows, 604, 0.3826, 13, saved), { amountEur: 976.91, valueEur: 516.18 });
  /*
   * Id 13 edited to 104 pieces at 2,0106 (above cost): it lowers nothing but still takes its 104 pieces, and id 16
   * now gets 1.045 - 255 - 104 = 686 pieces: 686 x 1,4012 = 961,22. Value 2.090,00 - 336,29 - 0 - 961,22 = 792,49,
   * not the 1.753,71 that leaving the later decision out gave.
   */
  assert.deepEqual(writeDownPreview(one, rows, 104, 2.0106, 13, saved), { amountEur: 0, valueEur: 792.49 });
  /* Editing the first decision replays both later ones: 100 x 1,5 = 150,00; 604 x 1,6174 = 976,91; 341 x 1,4012 = 477,81. */
  assert.deepEqual(writeDownPreview(one, rows, 100, 0.5, 10, saved), { amountEur: 150, valueEur: 485.28 });
  /* Editing the last one replays nothing, and a new decision comes after all stored rows: no piece is left. */
  assert.deepEqual(writeDownPreview(one, rows, null, 1, 16, saved), { amountEur: 186, valueEur: 590.8 });
  assert.deepEqual(writeDownPreview(one, rows, null, 0, null, saved), { amountEur: 0, valueEur: 516.18 });
});

test('a later decision for "all that are left" gets nothing when the edited one takes every piece', () => {
  const two = [layer(1, 100, 3, 300), layer(2, 50, 2, 100)];
  const rows = [writeDown(4, 1, 20, 20), writeDown(7, 1, 80, 160), writeDown(7, 2, 50, 50)];
  const saved = [{ decisionId: 4, quantity: 20, marketUnitEur: 2 }, { decisionId: 7, quantity: null, marketUnitEur: 1 }];
  /* Id 4 edited to all pieces at 2,50: 100 x 0,50 = 50,00 on the dear layer, nothing on the layer of 2,00; id 7 finds no piece. */
  assert.deepEqual(writeDownPreview(two, rows, null, 2.5, 4, saved), { amountEur: 50, valueEur: 350 });
  /* Id 4 edited to 30 pieces at 2,00: 30,00; id 7 then lowers 70 x 2,00 + 50 x 1,00 = 190,00. */
  assert.deepEqual(writeDownPreview(two, rows, 30, 2, 4, saved), { amountEur: 30, valueEur: 180 });
});

/* ---- beginwaarden: one value per product and date ---- */

const opening = (input: Partial<OpeningLayer>) =>
  ({ id: 1, productId: 1, quantity: 100, unitValueEur: 2.5, asOfDate: '2025-12-31', source: 'inventaris 2025', ...input }) as OpeningLayer;

test('a new beginwaarde on the date of a saved one replaces it, and proposes its pieces too', () => {
  const layers = [opening({ id: 3, productId: 1, quantity: 100 }), opening({ id: 4, productId: 2, quantity: 40, asOfDate: '2026-03-01' })];
  /* Product 1 has 100 pieces valued on 31/12/2025; a count correction adds 5 without a value. */
  const old = openingReplaced(layers, 1, '2025-12-31');
  assert.equal(old?.id, 3);
  /* Saving 5 on that date would retire the 100: the proposal is 105, so the 100 keep their value. */
  assert.equal(openingQuantity(5, old), 105);
  /* Another date, or another product, replaces nothing: the proposal is the remainder alone. */
  assert.equal(openingReplaced(layers, 1, '2026-01-01'), null);
  assert.equal(openingReplaced(layers, 2, '2025-12-31'), null);
  assert.equal(openingQuantity(5, null), 5);
});

test('the pieces of a product that are present but not own stock are named', () => {
  const partner = { closingQuantity: 360, ownQuantity: 0, partnerQuantity: 360, thirdPartyQuantity: 0, invoicedOutQuantity: 0, unvaluedQuantity: 0 };
  assert.equal(presentText(partner), '360 aanwezig · 360 van partner');
  assert.equal(presentText({ closingQuantity: 1250, ownQuantity: 1140, partnerQuantity: 60, thirdPartyQuantity: 10, invoicedOutQuantity: 30, unvaluedQuantity: 10 }),
    '1.250 aanwezig · 60 van partner · 10 van derden · 30 gefactureerd · 10 zonder waarde');
  assert.equal(presentText({ ...partner, closingQuantity: 90, ownQuantity: 90, partnerQuantity: 0 }), '');
});

/* ---- shapes the backend added after the review ---- */

test('an invoiced row names the pieces its value covers, not the invoiced pieces', () => {
  /* FifoValuerTest.anInvoiceLargerThanThePoolStatesHowManyPiecesItsValueCovers: 30 invoiced, 20 taken, 2,0000, 40,00. */
  assert.equal(carvedPieces({ quantity: 30, carvedQuantity: 20, unitValueEur: 2, valueEur: 40 }), 20);
  assert.equal(carvedPieces({ quantity: 30, carvedQuantity: 30, unitValueEur: 4.3083, valueEur: 129.25 }), 30);
  /* Not decided, "Nog van ons" or "al weg": nothing taken out, so no value and only the invoiced quantity. */
  assert.equal(carvedPieces({ quantity: 30, carvedQuantity: 0, unitValueEur: null, valueEur: null }), null);
  /* A row frozen before the field existed reads as fully taken. */
  assert.equal(carvedPieces({ quantity: 12, carvedQuantity: null, unitValueEur: 11.2375, valueEur: 134.85 }), 12);
});

test('a removed row and an undecided row to review open the fold they sit in', () => {
  assert.equal(needsLook({ removed: true, review: false, decisionId: null }), true);
  assert.equal(needsLook({ removed: false, review: true, decisionId: null }), true);
  assert.equal(needsLook({ removed: false, review: true, decisionId: 53 }), false);
  assert.equal(needsLook({ removed: false, review: false, decisionId: null }), false);
});

test('a blocker the screen has no special case for is listed by its message under its container', () => {
  const goods = blocker('waarde', 'TEGOED_MEER_DAN_GOEDEREN', { purchaseOrderId: 41, productId: 101,
    message: 'Container Kunming september, Eternal Rose Box Rood: prijstegoed € 250,00 is hoger dan de goederen van de partij (€ 184,00). '
      + 'Kijk het tegoed na of geef aan dat het buiten de voorraadwaarde blijft.' });
  const loss = blocker('waarde', 'TEGOED_MEER_DAN_VERLIES', { purchaseOrderId: 41, amountEur: 141,
    message: 'Container Kunming september: tegoed voor tekort of schade € 141,00, terwijl de ontbrekende en beschadigde stuks samen € 140,90 kostten. '
      + 'Geef per tegoed aan wat het is.' });
  const gone = warning('datum', 'BEWEGING_VERDWENEN', {
    message: '1 beweging uit de vorige berekening staat niet meer in de voorraadgeschiedenis: F-2026-119. Ze telt niet mee in het aantal op de afsluitdatum.' });
  const closing = view({ notices: [gone, goods, loss], decisions: [decision('CREDIT_TREATMENT', { purchaseOrderId: 41, creditId: 71 })] });
  assert.deepEqual(noticesFor(closing, 'waarde').map((notice) => notice.message), [goods.message, loss.message]);
  assert.deepEqual(noticesFor(closing, 'datum'), [gone]);
  /* One credit decided and the blocker still stands: the step stays under way, with two points open. */
  const value = stepStates(closing).find((step) => step.key === 'waarde')!;
  assert.equal(value.state, 'BEZIG');
  assert.equal(value.line, '3 Waarde · 2 punten open');
  assert.equal(stateOf(closing, 'datum'), 'KLAAR');
});
