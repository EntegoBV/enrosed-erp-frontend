import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { schedulePreset, scheduleRowAmount, scheduleRowAmounts, scheduleRequest, advanceInvoiceScheduleRequest,
  scheduleDraft, scheduleRowFixed, resplitRemainder, remainderRequest, scheduleRemainder, scheduleDraftChanges,
  scheduleConceptNote, scheduleDraftStatus, thirdsResplitAvailable } from '../src/app/features/purchasing/partner-advance-schedule-state.ts';
import type { PartnerAdvanceScheduleRow } from '../src/app/core/api/models.ts';
import { partialSettlementPreview } from '../src/app/features/sales/partner-settlement-progress.ts';
import type { PartnerSettlementAvailability } from '../src/app/core/api/models.ts';

test('30/70 invoices divide the financed partner amount, not the whole container', () => {
  const containerCost = 12000;
  for (const [fundingPct, expected] of [[50, [1800, 4200]], [100, [3600, 8400]]] as const) {
    const agreed = containerCost * fundingPct / 100;
    const rows = schedulePreset('30_70', agreed);
    assert.deepEqual(rows.map((row) => scheduleRowAmount(row, agreed)), expected);
    assert.deepEqual(scheduleRequest(rows, agreed).rows.map((row) => row.percentage), [30, 70]);
  }
});

test('thirds preserve the exact agreed cents and arbitrary amount/date terms stay explicit', () => {
  const rows = schedulePreset('THIRDS', 1000);
  assert.deepEqual(rows.map((row) => row.value), [333.33, 666.67]);
  rows[0].dueDate = '2026-10-01';
  assert.equal(scheduleRequest(rows, 1000).rows[0].dueDate, '2026-10-01');
  assert.throws(() => scheduleRequest([{ ...rows[0], value: 1001 }], 1000), /overschrijden/);
  assert.throws(() => scheduleRequest([{ ...rows[0], value: 1.001 }], 1000), /decimalen/);
  assert.throws(() => scheduleRequest(rows, 1000, 200), /overschrijden/, 'older advances reserve part of the agreed amount');
});

test('100% plans assign rounding residual only to an unbilled percentage row', () => {
  const rows = schedulePreset('30_70', .05).map((row) => ({ ...row, value: 50 }));
  assert.deepEqual(scheduleRowAmounts(rows, .05), [.03, .02]);
  assert.deepEqual(scheduleRowAmounts([{ ...rows[0], locked: true, fixedAmountEur: .02 }, rows[1]], .05), [.02, .03]);
  assert.doesNotThrow(() => scheduleRequest(rows, .05));
});

test('unused saved terms can all be removed before beginning the auction settlement', () => {
  assert.throws(() => scheduleRequest([], 6000), /minstens/);
  assert.deepEqual(scheduleRequest([], 6000, 0, true), { rows: [] });
});

test('draft invoice plan captures all agreed advances and dates, and rejects an incomplete allocation', () => {
  const rows = schedulePreset('30_70', 6000);
  rows[0].dueDate = '2026-10-01';
  assert.deepEqual(advanceInvoiceScheduleRequest(rows, 6000).rows.map(row => [row.percentage, row.dueDate]), [[30, '2026-10-01'], [70, null]]);
  assert.throws(() => advanceInvoiceScheduleRequest(rows.slice(0, 1), 6000), /volledig/);
  assert.throws(() => advanceInvoiceScheduleRequest([], 6000), /minstens/);
  assert.deepEqual(advanceInvoiceScheduleRequest(schedulePreset('THIRDS', 1000), 1000).rows.map(row => row.amountEur), [333.33, 666.67]);
});

test('a deal without advance funding has no zero-value invoices and settles later', () => {
  assert.throws(() => advanceInvoiceScheduleRequest(schedulePreset('30_70', 0), 0), /ongeldig/);
  assert.throws(() => advanceInvoiceScheduleRequest([], Number.NaN), /ongeldig/);
  assert.throws(() => advanceInvoiceScheduleRequest([], -1), /ongeldig/);
});

const availability = (cost = 12000, advance = 6000): PartnerSettlementAvailability => ({
  purchaseOrderId: 1, partnerCustomerId: 2, externalCostEur: cost, issuedAdvanceEur: advance, creditedAdvanceEur: 0, remainingAdvanceEur: advance,
  lines: [{ productId: 9, productName: 'Roses', totalQuantity: 100, settledQuantity: 0, remainingQuantity: 100, totalCostEur: cost, settledCostEur: 0, remainingCostEur: cost }], settlements: [],
});

test('partial auctions allocate cost and advance once, with final batch taking exact residual', () => {
  const first = partialSettlementPreview(availability(), { 9: 40 }, { 9: 8000 }, 50);
  assert.equal(first.quantity, 40);
  assert.equal(first.costEur, 4800);
  assert.equal(first.advanceEur, 2400);
  assert.equal(first.profitShareEur, 1600);
  assert.equal(first.netEur, 4000);
  assert.equal(first.remainingQuantity, 60);
  assert.equal(first.finalSettlement, false);
  const remaining = availability();
  remaining.remainingAdvanceEur = 3600;
  Object.assign(remaining.lines[0], { settledQuantity: 40, remainingQuantity: 60, settledCostEur: 4800, remainingCostEur: 7200 });
  const final = partialSettlementPreview(remaining, { 9: 60 }, { 9: 12000 }, 50);
  assert.equal(final.finalSettlement, true);
  assert.equal(final.remainingQuantity, 0);
  assert.equal(first.costEur + final.costEur, 12000);
  assert.equal(first.advanceEur + final.advanceEur, 6000);
  assert.equal(first.profitShareEur + final.profitShareEur, 4000);
  assert.equal(first.netEur + final.netEur, 10000);
});

test('unselected products and loss batches do not lose reserved cost or hide credit', () => {
  const zero = partialSettlementPreview(availability(), {}, {}, 50);
  assert.equal(zero.costEur, 0);
  assert.equal(zero.advanceEur, 0);
  assert.equal(zero.finalSettlement, false);
  const loss = partialSettlementPreview(availability(3000, 3000), { 9: 100 }, { 9: 0 }, 50);
  assert.equal(loss.profitShareEur, -1500);
  assert.equal(loss.netEur, -1500);
  const halfCentLoss = partialSettlementPreview(availability(.01, .01), { 9: 100 }, { 9: 0 }, 50);
  assert.equal(halfCentLoss.profitShareEur, -.01, 'negative half cents round away from zero like the server');
});

const planRow = (id: number, label: string, amountEur: number, changes: Partial<PartnerAdvanceScheduleRow> = {}): PartnerAdvanceScheduleRow => ({
  id, label, percentage: null, amountEur, dueDate: null, invoiceId: null, invoiceNumber: null, invoiceStatus: null,
  receivedEur: 0, remainingEur: 0, ...changes });

test('a term is fixed by an issued invoice; a never-issued concept follows the new split; an older backend fixes any invoice', () => {
  assert.equal(scheduleRowFixed(planRow(1, 'a', 1, { invoiceId: 81, invoiceFixed: true })), true);
  assert.equal(scheduleRowFixed(planRow(1, 'a', 1, { invoiceId: 81, invoiceFixed: false })), false);
  assert.equal(scheduleRowFixed(planRow(1, 'a', 1, { invoiceId: 81 })), true, 'No invoiceFixed from the server: the old rule');
  assert.equal(scheduleRowFixed(planRow(1, 'a', 1)), false);
  const draft = scheduleDraft([planRow(1, '1/3 bij start productie', 5000, { invoiceId: 81, invoiceNumber: 'container/2026/009', invoiceFixed: true }),
    planRow(2, '2/3 na productie', 10000, { invoiceId: 82, invoiceNumber: 'container/2026/010', invoiceStatus: 'CONCEPT', invoiceFixed: false })]);
  assert.deepEqual(draft.map(row => [row.locked, row.fixedAmountEur ?? null, row.conceptNumber ?? null]), [[true, 5000, null], [false, null, 'container/2026/010']]);
});

test('1/3 issued + 2/3 open becomes 1/3 · 1/3 · 1/3: the fixed term and the reused term keep their ids', () => {
  for (const [agreed, expected] of [[15000, [5000, 5000, 5000]], [15982.97, [5327.66, 5327.66, 5327.65]]] as const) {
    const first = Math.round(agreed / 3 * 100) / 100;
    const rows = scheduleDraft([planRow(1, '1/3 bij start productie', first, { invoiceId: 81, invoiceFixed: true, dueDate: '2026-08-01' }),
      planRow(2, '2/3 na productie', Math.round((agreed - first) * 100) / 100, { invoiceId: 82, invoiceNumber: 'container/2026/010', invoiceFixed: false, dueDate: '2026-10-15' })]);
    const thirds = resplitRemainder(rows, agreed, 0, 2, ['1/3 na productie', '1/3 bij aankomst']);
    assert.deepEqual(scheduleRowAmounts(thirds, agreed), expected);
    assert.deepEqual(thirds.map(row => row.id ?? null), [1, 2, null], 'The concept term is reused, the new term has no invoice yet');
    assert.deepEqual(thirds.map(row => row.label), ['1/3 bij start productie', '1/3 na productie', '1/3 bij aankomst']);
    assert.equal(thirds[1].dueDate, '2026-10-15'); assert.equal(thirds[1].conceptNumber, 'container/2026/010');
    const body = remainderRequest(thirds, agreed);
    assert.deepEqual(body.rows.map(row => row.id ?? null), [1, 2, null]);
    assert.equal(Math.round(body.rows.reduce((sum, row) => sum + (row.amountEur ?? 0), 0) * 100) / 100, agreed, 'Every cent of the agreed amount is planned');
  }
});

test('the €15.982,97 remainder splits in cents with the last term taking the residual', () => {
  const rows = resplitRemainder([], 15982.97, 0, 3);
  assert.deepEqual(rows.map(row => row.value), [5327.66, 5327.66, 5327.65]);
  assert.deepEqual(rows.map(row => row.label), ['Termijn 1', 'Termijn 2', 'Termijn 3']);
});

test('a fixed 30 % term keeps its amount and percentage; share labels of open terms stop lying', () => {
  const rows = scheduleDraft([planRow(1, '30% bij start productie', 1800, { percentage: 30, invoiceId: 81, invoiceFixed: true }),
    planRow(2, '70% na productie', 4200, { percentage: 70 })]);
  const split = resplitRemainder(rows, 6000, 0, 2);
  assert.deepEqual(scheduleRowAmounts(split, 6000), [1800, 2100, 2100]);
  assert.deepEqual(split.map(row => row.label), ['30% bij start productie', 'Na productie', 'Termijn 3']);
  assert.deepEqual(remainderRequest(split, 6000).rows.map(row => [row.id ?? null, row.percentage ?? null, row.amountEur ?? null]),
    [[1, 30, null], [2, null, 2100], [null, null, 2100]]);
  assert.deepEqual(scheduleRemainder(split, 6000), { fixedEur: 1800, openEur: 4200, restEur: 4200, leftEur: 0 });
});

test('an incomplete remainder is refused with what is left; reservations outside the plan count', () => {
  const rows = resplitRemainder(scheduleDraft([planRow(1, '1/3', 5000, { invoiceId: 81, invoiceFixed: true }), planRow(2, '2/3', 10000)]), 15000, 0, 2);
  rows[2] = { ...rows[2], value: 4000 };
  assert.throws(() => remainderRequest(rows, 15000), /Verdeel het resterende voorschot volledig: nog € 1\.000,00 te verdelen\./);
  rows[2] = { ...rows[2], value: 6000 };
  assert.throws(() => remainderRequest(rows, 15000), /overschrijden/);
  const outside = resplitRemainder(scheduleDraft([planRow(1, 'Eerste', 5000, { invoiceId: 81, invoiceFixed: true })]), 15000, 1000, 2);
  assert.deepEqual(scheduleRowAmounts(outside, 15000), [5000, 4500, 4500]);
  assert.doesNotThrow(() => remainderRequest(outside, 15000, 1000));
});

test('a term with a concept invoice is never dropped by a shorter split', () => {
  const rows = scheduleDraft([planRow(1, 'Eerste', 3000, { invoiceId: 81, invoiceFixed: true }),
    planRow(2, 'Tweede', 3000), planRow(3, 'Derde', 4000, { invoiceId: 83, invoiceNumber: 'F-2026-0083', invoiceFixed: false })]);
  const split = resplitRemainder(rows, 10000, 0, 1);
  assert.deepEqual(split.map(row => row.id ?? null), [1, 3], 'The plain term goes, the concept term takes the rest');
  assert.deepEqual(scheduleRowAmounts(split, 10000), [3000, 7000]);
  const two = resplitRemainder(rows, 10000, 0, 2);
  assert.deepEqual(two.map(row => row.id ?? null), [1, 2, 3]);
});

test('only a draft that adds or changes terms counts as a re-split; dropping unused terms does not', () => {
  const saved = [planRow(1, 'Eerste', 5000, { invoiceId: 81, invoiceFixed: true }), planRow(2, 'Tweede', 5000), planRow(3, 'Derde', 5000)];
  const draft = scheduleDraft(saved);
  assert.equal(scheduleDraftChanges(draft, saved), false);
  assert.equal(scheduleDraftChanges(draft.slice(0, 2), saved), false, 'Removing an unused term before the settlement may leave part unplanned');
  assert.equal(scheduleDraftChanges([draft[0], { ...draft[1], value: 10000 }], saved), true);
  assert.equal(scheduleDraftChanges([...draft, { label: 'Vierde', mode: 'AMOUNT', value: 1, dueDate: '', locked: false }], saved), true);
  assert.equal(scheduleDraftChanges(resplitRemainder(draft, 15000, 0, 2), saved), false, 'The same split again changes nothing');
  assert.equal(scheduleDraftChanges(resplitRemainder(draft, 15000, 0, 3), saved), true);
});

/* Verhoeven BV, ORDER (3e) OOSTENRIJKER / STOLP FRANS- 40FTHQ: € 54.435,82 agreed at 50 %, 1/3 partner/2026/008 paid,
   2/3 container/2026/009 issued and reopened to concept (production, 2026-10-01). */
const AGREED = 54435.82;
const verhoeven = (second: Partial<PartnerAdvanceScheduleRow> = {}): PartnerAdvanceScheduleRow[] => [
  planRow(1, '1/3 bij start productie', 18145.27, { invoiceId: 81, invoiceNumber: 'partner/2026/008', invoiceStatus: 'UITGEREIKT',
    invoiceFixed: true, invoiceReopened: false, receivedEur: 18145.27 }), // btw verlegd
  planRow(2, '2/3 na productie', 36290.55, { invoiceId: 82, invoiceNumber: 'container/2026/009', invoiceStatus: 'CONCEPT',
    invoiceFixed: false, invoiceReopened: true, ...second }),
];

test('a paid 1/3 and a reopened concept 2/3 of € 54.435,82 become 1/3 · 1/3 · 1/3 in one click', () => {
  const saved = verhoeven();
  const draft = scheduleDraft(saved);
  assert.deepEqual(draft.map(row => [row.locked, row.fixedAmountEur ?? null, row.conceptNumber ?? null, row.conceptReopened ?? false]),
    [[true, 18145.27, null, false], [false, null, 'container/2026/009', true]], 'Only the paid third is frozen; the reopened concept is open');
  assert.equal(thirdsResplitAvailable(draft, AGREED), true, 'The one-click 1/3 · 1/3 · 1/3 is offered');
  assert.deepEqual(scheduleRemainder(draft, AGREED), { fixedEur: 18145.27, openEur: 36290.55, restEur: 36290.55, leftEur: 0 });

  const thirds = resplitRemainder(draft, AGREED, 0, 2, ['1/3 na productie', '1/3 bij aankomst']);
  assert.deepEqual(scheduleRowAmounts(thirds, AGREED), [18145.27, 18145.28, 18145.27], 'Each part in cents, the last one takes what is left');
  assert.deepEqual(thirds.map(row => row.id ?? null), [1, 2, null], 'container/2026/009 stays with its term; the new third has no invoice');
  assert.deepEqual(thirds.map(row => row.label), ['1/3 bij start productie', '1/3 na productie', '1/3 bij aankomst']);
  assert.equal(thirds[1].conceptNumber, 'container/2026/009');
  assert.equal(thirds[1].conceptReopened, true);
  assert.equal(scheduleDraftChanges(thirds, saved), true);
  const body = remainderRequest(thirds, AGREED);
  assert.deepEqual(body.rows.map(row => [row.id ?? null, row.amountEur ?? null]), [[1, 18145.27], [2, 18145.28], [null, 18145.27]]);
  assert.equal(Math.round(body.rows.reduce((sum, row) => sum + (row.amountEur ?? 0), 0) * 100) / 100, AGREED, 'Every cent of the agreed advance');
  assert.deepEqual(scheduleRemainder(thirds, AGREED), { fixedEur: 18145.27, openEur: 36290.55, restEur: 36290.55, leftEur: 0 });
});

test('a reopened concept reads heropend and follows the new split, never nog niet uitgegeven', () => {
  const [paid, reopened] = verhoeven();
  assert.equal(scheduleConceptNote(reopened), 'Concept container/2026/009 · heropend · volgt de nieuwe verdeling');
  assert.equal(scheduleConceptNote(reopened, false), 'Concept · heropend · volgt de nieuwe verdeling', 'The number already stands above it');
  assert.equal(scheduleConceptNote({ ...reopened, invoiceReopened: false }), 'Concept container/2026/009 · nog niet uitgegeven · volgt de nieuwe verdeling');
  assert.equal(scheduleConceptNote({ ...reopened, invoiceReopened: undefined }), 'Concept container/2026/009 · volgt de nieuwe verdeling',
    'Without the history the screen claims nothing about it');
  assert.equal(scheduleConceptNote({ ...reopened, invoiceFixed: undefined, invoiceReopened: undefined }), 'Concept container/2026/009', 'An older backend');
  assert.equal(scheduleConceptNote(paid), null, 'An issued invoice shows its receipts instead');
  const [, draft] = scheduleDraft([paid, reopened]);
  assert.equal(scheduleDraftStatus(draft), 'Concept container/2026/009 · heropend · volgt de nieuwe verdeling');
  assert.equal(scheduleDraftStatus(scheduleDraft([{ ...reopened, invoiceReopened: false }])[0]), 'Nog te factureren · concept container/2026/009 · volgt de nieuwe verdeling');
  assert.equal(scheduleDraftStatus(scheduleDraft([paid])[0]), 'Gefactureerd · staat vast');
  assert.equal(scheduleDraftStatus(scheduleDraft([planRow(3, 'Rest', 10)])[0]), 'Nog te factureren');
});

test('the server decides: a concept with payment history or a credit note stays fixed and offers no thirds', () => {
  const saved = verhoeven({ invoiceFixed: true });
  const draft = scheduleDraft(saved);
  assert.deepEqual(draft.map(row => row.locked), [true, true]);
  assert.equal(scheduleConceptNote(saved[1]), 'Concept container/2026/009 · staat vast (betaalhistoriek of creditnota)');
  assert.equal(thirdsResplitAvailable(draft, AGREED), false, 'Two fixed terms: nothing to split into thirds');
  assert.equal(thirdsResplitAvailable(scheduleDraft(verhoeven({ invoiceFixed: undefined })), AGREED), false, 'An older backend freezes any invoice');
  assert.equal(thirdsResplitAvailable(scheduleDraft(verhoeven()), AGREED, 100), false, 'A reservation outside the plan');
  const notAThird = scheduleDraft([planRow(1, 'Start', 20000, { invoiceId: 81, invoiceFixed: true }), verhoeven()[1]]);
  assert.equal(thirdsResplitAvailable(notAThird, AGREED), false, 'The fixed term is not a third');
});

test('purchase screens take the concept wording from the plan, and ?terms=edit leaves the URL once used', () => {
  const source = (file: string) => readFileSync(new URL(`../src/app/features/purchasing/${file}`, import.meta.url), 'utf8');
  const payments = source('purchase-partner-payments.ts');
  assert.doesNotMatch(payments, /nog niet uitgegeven/, 'a reopened concept in the document list is not called never issued');
  assert.match(payments, /scheduleConceptNote\(/);
  assert.doesNotMatch(source('purchase-partner-panel.ts'), /nog niet uitgegeven/);
  assert.match(source('partner-advance-schedule.ts'), /queryParams: \{ terms: null \}, queryParamsHandling: 'merge', replaceUrl: true/,
    'a rail switch, reload or history step does not reopen the editor');
});
