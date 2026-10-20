import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayGroups, dayHead, discountText, displayText, matchesWords, pageTotals, periodText, presetOf, presetPeriod, saleMatches, saleTime, salesTotals,
  settlementCounts, settlementNote, settlementPeriod, settlementSections, settlementStatus, settlementSums, syncLine, ticaPieces,
} from '../src/app/features/tica/tica-list-model.ts';
import { linePieces } from '../src/app/features/analyses/tica-breakdown.ts';
import type { TicaSale, TicaSettlement, TicaStatus } from '../src/app/core/api/tica-api.ts';

let nextId = 1;
const sale = (patch: Partial<TicaSale>): TicaSale => ({
  id: nextId++, location: 'TICA - Brussel', exhibitor: '2132', soldAt: '2026-10-20T14:05:00', transactionNumber: '100', lineNumber: '1',
  description: 'Rose box rood', beeyondArticleNumber: 'B-1', sku: 'RB-RED', barcode: null, quantity: 1, discountPercent: 0,
  grossTotal: 20, netTotal: 20, vatRate: 21, transactionType: 'SALE', productId: 7, mappingStatus: 'MATCHED',
  firstSeenAt: '2026-10-20T12:10:00Z', updatedAt: '2026-10-20T12:10:00Z', ...patch,
});
const settlement = (patch: Partial<TicaSettlement>): TicaSettlement => ({
  id: nextId++, reference: 'CN-1', location: 'TICA - Brussel', documentDate: '2026-10-03', dueDate: '2026-10-17', periodFrom: '2026-09-01',
  periodTo: '2026-09-30', salesExcl: 1000, salesVat: 210, commissionExcl: 200, commissionVat: 42, netReceivable: 968, documentNote: null,
  sourceDocumentUrl: '/api/tica/settlements/documents/a', status: 'OPEN', importedRevenueExcl: 1000, reconciliationDifference: 0,
  commissionCostId: 3, bankStatementLineId: null, paidAt: null, createdAt: '2026-10-03T08:00:00Z', sourceKey: null, ...patch,
});
const status = (patch: Partial<TicaStatus>): TicaStatus => ({
  enabled: true, credentialsReady: true, syncState: 'READY', lastAttemptAt: null, lastSuccessAt: '2026-10-20T12:05:00Z', lastRangeFrom: null,
  lastRangeTo: null, lastError: null, importedLineCount: 0, unmatchedLineCount: 0, pushSubscriptions: 1, lastNotificationStatus: null,
  lastNotificationAt: null, ...patch,
});

test('the search folds accents and needs every word', () => {
  assert.ok(matchesWords('Crème brûlée box', 'creme box'));
  assert.ok(!matchesWords('Crème brûlée box', 'creme bowl'));
  assert.ok(matchesWords('anything', '  '));
  const line = sale({ description: 'Bowl roze', sku: 'BW-PNK', transactionNumber: '4711' });
  assert.ok(saleMatches(line, '4711'));
  assert.ok(saleMatches(line, 'bw-pnk roze'));
  assert.ok(!saleMatches(line, 'rood'));
});

test('totals count receipts once, pieces, net and gross, the discount and the lines without a product', () => {
  const totals = salesTotals([
    sale({ transactionNumber: '1', quantity: 2, grossTotal: 40, netTotal: 36 }),
    sale({ transactionNumber: '1', quantity: 1, grossTotal: 10.1, netTotal: 10.1, productId: null, mappingStatus: 'UNMATCHED' }),
    sale({ transactionNumber: '2', quantity: 3, grossTotal: 30, netTotal: 30 }),
    sale({ transactionNumber: '2', location: 'TICA - Antwerpen', quantity: 1, grossTotal: 5, netTotal: 5 }),
  ]);
  assert.deepEqual(totals, { lines: 4, transactions: 3, pieces: 7, netEur: 81.1, grossEur: 85.1, discountEur: 4, unmatched: 1 });
});

test('pieces: an article the stock link maps as a full display of N counts N pieces; anything else TICA\'s quantity', () => {
  const display = sale({ quantity: 2, netTotal: 80, grossTotal: 80, stockSourceUnit: 'DISPLAY', stockUnitPieces: 12 });
  const single = sale({ quantity: 10, netTotal: 40, grossTotal: 40, stockSourceUnit: 'PIECE', stockUnitPieces: 12, transactionNumber: '2' });
  const unlinked = sale({ quantity: 3, transactionNumber: '3' });
  assert.equal(ticaPieces(display), 24);
  assert.equal(ticaPieces(single), 10);
  assert.equal(ticaPieces(unlinked), 3);
  assert.equal(ticaPieces(sale({ quantity: -1, stockSourceUnit: 'DISPLAY', stockUnitPieces: 12 })), -12, 'a returned display');
  assert.equal(ticaPieces(sale({ quantity: 2, stockSourceUnit: 'DISPLAY', stockUnitPieces: null })), 2, 'no known size: TICA\'s quantity');
  assert.equal(displayText(display), '2 × 12');
  assert.equal(displayText(single), '');
  assert.equal(salesTotals([display, single, unlinked]).pieces, 37);
  for (const line of [display, single, unlinked]) assert.equal(linePieces(line), ticaPieces(line), 'Analyses counts the same pieces');
});

test('the period total: the lines when complete; past the cap the server sums plus the loaded displays\' extra pieces', () => {
  const display = sale({ quantity: 2, netTotal: 80, grossTotal: 90, stockSourceUnit: 'DISPLAY', stockUnitPieces: 12 });
  const page = { from: '2026-10-01', to: '2026-10-20', page: 0, size: 200, totalLines: 500, transactionCount: 300, quantity: 900,
    grossTotal: 10_000, netTotal: 9_500.5, unmatchedLineCount: 4, lines: [display, sale({ quantity: 1 })] };
  assert.deepEqual(pageTotals({ ...page, complete: false }),
    { lines: 500, transactions: 300, pieces: 922, netEur: 9_500.5, grossEur: 10_000, discountEur: 499.5, unmatched: 4 });
  assert.deepEqual(pageTotals({ ...page, complete: true }), salesTotals(page.lines));
});

test('lines group per day, newest day and newest line first, each with its sums', () => {
  const groups = dayGroups([
    sale({ soldAt: '2026-10-19T10:00:00', netTotal: 5 }),
    sale({ soldAt: '2026-10-20T09:00:00', netTotal: 7, transactionNumber: '9' }),
    sale({ soldAt: '2026-10-20T15:30:00', netTotal: 3, transactionNumber: '10' }),
  ]);
  assert.deepEqual(groups.map((group) => group.date), ['2026-10-20', '2026-10-19']);
  assert.deepEqual(groups[0].lines.map((line) => saleTime(line.soldAt)), ['15:30', '09:00']);
  assert.equal(groups[0].totals.netEur, 10);
  assert.equal(groups[0].totals.transactions, 2);
});

test('day heads and times read as words', () => {
  assert.equal(dayHead('2026-10-20', '2026-10-20'), 'Vandaag');
  assert.equal(dayHead('2026-10-19', '2026-10-20'), 'Gisteren');
  assert.equal(dayHead('2026-10-14', '2026-10-20'), 'wo 14 okt');
  assert.equal(dayHead('2025-12-31', '2026-01-02'), 'wo 31 dec 2025');
  assert.equal(saleTime('2026-10-20T14:05:33'), '14:05');
  assert.equal(saleTime('2026-10-20'), '');
});

test('presets: today, seven days, this month, the whole previous month (across a year)', () => {
  assert.deepEqual(presetPeriod('today', '2026-10-20'), { from: '2026-10-20', to: '2026-10-20' });
  assert.deepEqual(presetPeriod('week', '2026-10-20'), { from: '2026-10-14', to: '2026-10-20' });
  assert.deepEqual(presetPeriod('month', '2026-10-20'), { from: '2026-10-01', to: '2026-10-20' });
  assert.deepEqual(presetPeriod('prev', '2026-01-05'), { from: '2025-12-01', to: '2025-12-31' });
  assert.equal(presetOf('2026-10-14', '2026-10-20', '2026-10-20'), 'week');
  assert.equal(presetOf('2026-10-02', '2026-10-20', '2026-10-20'), null);
});

test('period words', () => {
  const today = '2026-10-20';
  assert.equal(periodText('2026-10-20', '2026-10-20', today), 'Vandaag');
  assert.equal(periodText('2026-10-14', '2026-10-20', today), '7 dagen');
  assert.equal(periodText('2026-10-01', '2026-10-20', today), 'oktober');
  assert.equal(periodText('2026-09-01', '2026-09-30', today), 'september');
  assert.equal(periodText('2025-09-01', '2025-09-30', today), 'september 2025');
  assert.equal(periodText('2026-10-12', '2026-10-18', today), '12–18 okt');
  assert.equal(periodText('2026-09-28', '2026-10-04', today), '28 sep – 4 okt');
  assert.equal(periodText('2026-10-05', '2026-10-05', today), 'ma 5 okt');
});

test('a discount reads as its percentage, or "korting" when only the amounts differ', () => {
  assert.equal(discountText({ discountPercent: 10, grossTotal: 20, netTotal: 18 }), '−10 %');
  assert.equal(discountText({ discountPercent: 12.5, grossTotal: 20, netTotal: 17.5 }), '−12,5 %');
  assert.equal(discountText({ discountPercent: 0, grossTotal: 20, netTotal: 18 }), 'korting');
  assert.equal(discountText({ discountPercent: 0, grossTotal: 20, netTotal: 20 }), '');
});

test('the import state in a few words: the time today, the date before, busy, warnings', () => {
  const now = new Date('2026-10-20T12:30:00Z');
  assert.deepEqual(syncLine(status({}), false, now), { text: 'Bijgewerkt 14:05', short: '14:05', tone: 'ok', title: 'Laatste geslaagde import om 14:05' });
  assert.equal(syncLine(status({ lastSuccessAt: '2026-10-19T08:00:00Z' }), false, now).text, 'Bijgewerkt 19 okt');
  assert.equal(syncLine(status({ lastSuccessAt: '2026-10-19T08:00:00Z' }), false, now).short, '19 okt');
  assert.equal(syncLine(status({ syncState: 'RUNNING' }), false, now).tone, 'busy');
  assert.equal(syncLine(status({ syncState: 'PENDING' }), false, now).short, 'Ophalen…', 'a narrow desk still says it is busy, not only by colour');
  assert.equal(syncLine(status({ syncState: 'NEVER_SYNCED', lastSuccessAt: null }), false, now).short, 'Nog niet opgehaald');
  assert.equal(syncLine(status({ syncState: 'ERROR' }), false, now).short, '', 'the error banner says it');
  const error = syncLine(status({ syncState: 'ERROR', lastError: 'Portaal antwoordt niet' }), false, now);
  assert.equal(error.text, 'Ophalen mislukt');
  assert.match(error.title, /^Portaal antwoordt niet · Laatste geslaagde import om 14:05$/);
  assert.equal(syncLine(status({ syncState: 'DISABLED' }), false, now).text, 'Ophalen staat uit');
  assert.equal(syncLine(status({ syncState: 'NOT_CONFIGURED' }), false, now).text, 'Verbinding instellen');
  assert.equal(syncLine(null, true, now).tone, 'warn');
  assert.equal(syncLine(null, false, now).tone, 'muted');
});

test('settlement status and what a row still needs', () => {
  assert.deepEqual(settlementStatus({ status: 'DRAFT', sourceKey: 'odoo:1' }), { label: 'Te controleren', tone: 'amber' });
  assert.deepEqual(settlementStatus({ status: 'DRAFT', sourceKey: null }), { label: 'Concept', tone: 'grey' });
  assert.deepEqual(settlementStatus({ status: 'OPEN', sourceKey: null }), { label: 'Te ontvangen', tone: 'blue' });
  assert.deepEqual(settlementStatus({ status: 'PAID', sourceKey: null }), { label: 'Ontvangen', tone: 'ok' });
  const today = '2026-10-20';
  assert.deepEqual(settlementNote(settlement({ status: 'DRAFT', sourceDocumentUrl: null }), false, today), { text: 'Broncreditnota ontbreekt', tone: 'warn' });
  assert.deepEqual(settlementNote(settlement({ status: 'DRAFT', reconciliationDifference: -12.5 }), false, today), { text: 'Omzet wijkt € 12,50 af', tone: 'warn' });
  assert.deepEqual(settlementNote(settlement({ status: 'DRAFT' }), false, today), { text: 'Bedragen sluiten niet aan', tone: 'warn' });
  assert.deepEqual(settlementNote(settlement({ status: 'DRAFT' }), true, today), { text: 'Klaar om te boeken', tone: 'ok' });
  assert.deepEqual(settlementNote(settlement({ status: 'OPEN', dueDate: '2026-10-17' }), false, today), { text: 'verwacht 17 okt', tone: 'warn' });
  assert.deepEqual(settlementNote(settlement({ status: 'OPEN', dueDate: '2026-10-27' }), false, today), { text: 'verwacht 27 okt', tone: null });
  assert.deepEqual(settlementNote(settlement({ status: 'PAID', paidAt: '2026-09-18T22:30:00Z' }), false, today), { text: 'ontvangen 19 sep', tone: null });
  assert.equal(settlementNote(settlement({ status: 'OPEN', dueDate: null }), false, today), null);
});

test('settlement periods', () => {
  assert.equal(settlementPeriod('2026-09-01', '2026-09-30'), 'september 2026');
  assert.equal(settlementPeriod('2026-09-01', '2026-09-15'), '1–15 sep 2026');
  assert.equal(settlementPeriod('2026-09-28', '2026-10-04'), '28 sep – 4 okt 2026');
});

test('settlements group in working order, follow the search and the status filter, and sum as before', () => {
  const rows = [
    settlement({ reference: 'CN-AUG', status: 'PAID', documentDate: '2026-09-02', periodFrom: '2026-08-01', periodTo: '2026-08-31', netReceivable: 980, commissionExcl: 150 }),
    settlement({ reference: 'CN-SEP', status: 'OPEN', documentDate: '2026-10-03', netReceivable: 968, commissionExcl: 200 }),
    settlement({ reference: 'CN-OCT', status: 'DRAFT', sourceKey: 'odoo:9', documentDate: '2026-10-19', periodFrom: '2026-10-01', periodTo: '2026-10-15', netReceivable: 300, commissionExcl: 60 }),
  ];
  assert.deepEqual(settlementSections(rows, '', 'all').map((section) => [section.label, section.rows.map((row) => row.reference), section.netEur]),
    [['Te boeken', ['CN-OCT'], 300], ['Te ontvangen', ['CN-SEP'], 968], ['Ontvangen', ['CN-AUG'], 980]]);
  assert.deepEqual(settlementSections(rows, 'augustus', 'all').map((section) => section.rows[0].reference), ['CN-AUG']);
  assert.deepEqual(settlementSections(rows, '', 'ontvangen').map((section) => section.id), ['ontvangen']);
  assert.deepEqual(settlementCounts(rows, ''), { boeken: 1, ontvangen: 1, betaald: 1 });
  assert.deepEqual(settlementCounts(rows, 'cn-sep'), { boeken: 0, ontvangen: 1, betaald: 0 });
  assert.deepEqual(settlementSums(rows), { openEur: 968, paidEur: 980, commissionEur: 350, draftCount: 1 });
});
