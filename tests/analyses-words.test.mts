import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayMonth, daysLabel, eurShort, monthLabel, monthShort, plural, rangeLabel, rangeLabelShort, weekdayDayMonth, wholeNumber, yearSpans,
} from '../src/app/features/analyses/analyses-words.ts';

test('plurals say one word, never "factuur/facturen" or "offerte(s)"', () => {
  assert.equal(plural(1, 'factuur', 'facturen'), '1 factuur');
  assert.equal(plural(5, 'factuur', 'facturen'), '5 facturen');
  assert.equal(plural(0, 'offerte', 'offertes'), '0 offertes');
  assert.equal(plural(84994, 'stuk', 'stuks'), '84.994 stuks');
  assert.equal(plural(2, 'SKU', 'SKU’s'), '2 SKU’s');
  assert.equal(daysLabel(1), '1 dag');
  assert.equal(daysLabel(7), '7 dagen');
  assert.equal(wholeNumber(-1200), '−1.200');
});

test('months read "mrt 2026", days "vr 16 okt"', () => {
  assert.equal(monthLabel('2026-03'), 'mrt 2026');
  assert.equal(monthLabel('2026-10'), 'okt 2026');
  assert.equal(monthLabel('rubbish'), 'rubbish');
  assert.equal(monthShort('2026-05'), 'mei');
  assert.equal(dayMonth('2026-10-16'), '16 okt');
  assert.equal(dayMonth('2025-12-01', '2026'), '1 dec 2025');
  assert.equal(weekdayDayMonth('2026-10-16'), 'vr 16 okt');
  assert.equal(weekdayDayMonth('2027-01-09'), 'za 9 jan');
});

test('the range shows one year once and says "alle jaren" without bounds', () => {
  assert.equal(rangeLabel('2026-01-01', '2026-10-16'), '1 jan – 16 okt 2026');
  assert.equal(rangeLabel('2025-12-01', '2026-01-31'), '1 dec 2025 – 31 jan 2026');
  assert.equal(rangeLabel('', ''), 'alle jaren');
  assert.equal(rangeLabel(null, undefined), 'alle jaren');
  assert.equal(rangeLabel('2026-01-01', ''), 'vanaf 1 jan 2026');
  assert.equal(rangeLabel('', '2026-03-31'), 't/m 31 mrt 2026');
  assert.equal(rangeLabel('2026-04-02', '2026-04-02'), '2 apr 2026');
  assert.equal(rangeLabelShort('2026-01-01', '2026-10-16', '2026-10-16'), '1 jan – 16 okt');
  assert.equal(rangeLabelShort('2025-01-01', '2025-12-31', '2026-10-16'), '1 jan – 31 dec 2025');
});

test('whole euros carry the minus before the sign', () => {
  assert.equal(eurShort(3620.53), '€ 3.621');
  assert.equal(eurShort(-3620.53), '− € 3.621');
  assert.equal(eurShort(0), '€ 0');
  assert.equal(eurShort(-0.4), '€ 0');
});

test('Overzicht: the Inkoop digest in whole euros with the card\'s names (critique N6)', async () => {
  const { paymentResultLine, openContainersLine } = await import('../src/app/features/analyses/analyses-words.ts');
  assert.equal(paymentResultLine(-3620.53, 3), 'betaalresultaat − € 3.621');
  assert.equal(paymentResultLine(412.2, 3), 'netto extra opbrengst € 412');
  assert.equal(paymentResultLine(-10, 0), null, 'no eligible container: no line');
  assert.equal(paymentResultLine(0.2, 6), null, '€ 0 says nothing: no line');
  assert.equal(openContainersLine(10, 2), 'op 10 containers · 2 voorlopig', 'the containers with something open, and the provisional ones (D-O2)');
  assert.equal(openContainersLine(1, 0), 'op 1 container');
});

test('Overzicht: Markt, Bezoekers and the Aandacht rows (critique N7, N17)', async () => {
  const { marketLines, dollarValue, deltaMeta, varianceAttention, advanceTermsSub, overdueSub } = await import('../src/app/features/analyses/analyses-words.ts');
  assert.deepEqual(marketLines(7.4993, -4.93, 6), ['¥ 7,4993 voor € 1', 'euro 4,9 % zwakker t.o.v. dollar (6 mnd)'], 'beside "$ 1,1208 voor € 1": one notation (C.1)');
  assert.deepEqual(marketLines(7.4993, 2.04, 3), ['¥ 7,4993 voor € 1', 'euro 2,0 % sterker t.o.v. dollar (3 mnd)']);
  assert.deepEqual(marketLines(7.5, null, 6), ['¥ 7,5000 voor € 1', null]);
  assert.deepEqual(marketLines(7.4993, 0, 6), ['¥ 7,4993 voor € 1', 'euro even sterk t.o.v. dollar (6 mnd)']);
  assert.equal(dollarValue(1.12081), '$ 1,1208');
  assert.deepEqual(deltaMeta(1877, 561), { text: '▲ 235 %', tone: 'ok' });
  assert.deepEqual(deltaMeta(80, 100), { text: '▼ 20 %', tone: 'warn' });
  assert.equal(deltaMeta(10, 0), null);
  assert.deepEqual(varianceAttention([{ name: 'Half Heart Mix Container', missingPieces: 108, damagedPieces: 0 }]),
    { title: 'Order met ontvangstafwijkingen', sub: 'Half Heart Mix Container · 108 st ontbreken' });
  assert.deepEqual(varianceAttention([{ name: 'A', missingPieces: 100, damagedPieces: 3 }, { name: 'B', missingPieces: 8, damagedPieces: 0 }]),
    { title: 'Orders met ontvangstafwijkingen', sub: '2 orders · 108 st ontbreken · 3 st beschadigd' });
  assert.equal(advanceTermsSub([{ name: 'PO-2026-013', terms: 1, nextDue: '2026-10-30' }, { name: 'PO-2026-011', terms: 2, nextDue: '2026-11-15' }], '2026-10-16'),
    '3 termijnen · volgende 30 okt', 'two long aliases do not fit a row');
  assert.equal(advanceTermsSub([{ name: 'Half Heart Mix Container', terms: 2, nextDue: '2027-01-15' }, { name: 'X', terms: 0, nextDue: null }], '2026-10-16'),
    'Half Heart Mix Container · volgende 15 jan 2027');
  assert.equal(overdueSub(0), 'Niets na de vervaldatum');
  assert.equal(overdueSub(1), '1 factuur na de vervaldatum');
});

test('Resultaat month bars: margin up, own costs down from one zero line, three rounded ticks', async () => {
  const { monthBars } = await import('../src/app/features/analyses/analyses-words.ts');
  const geometry = monthBars([
    { month: '2026-08', marginEur: 0, costsEur: 0, resultEur: 0 },
    { month: '2026-09', marginEur: 3800, costsEur: 900, resultEur: 2900 },
    { month: '2026-10', marginEur: -1200, costsEur: 1106, resultEur: -2306 },
  ]);
  assert.deepEqual(geometry.ticks.map((tick) => tick.value), [4000, 0, -2000]);
  assert.equal(Math.round(geometry.zeroPct * 100) / 100, 66.67);
  const [empty, september, october] = geometry.bars;
  assert.equal(empty.marginHeight, 0, 'an empty month is a bar of 0');
  assert.equal(Math.round(september.marginTop * 100) / 100, 3.33);
  assert.equal(Math.round(september.marginHeight * 100) / 100, 63.33);
  assert.equal(october.marginNegative, true);
  assert.equal(october.marginTop, geometry.zeroPct, 'a loss hangs from the zero line');
  assert.equal(Math.round(october.costHeight * 100) / 100, 18.43);
  assert.deepEqual(monthBars([{ month: '2026-01', marginEur: 0, costsEur: 0, resultEur: 0 }]).ticks.map((tick) => tick.value), [0]);
});

test('month bars over several years get a year band; one year gets none', () => {
  assert.deepEqual(yearSpans(['2026-01', '2026-02', '2026-03']), []);
  assert.deepEqual(yearSpans([]), []);
  const months = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  assert.deepEqual(yearSpans(months), [{ year: '2025', start: 0, span: 4 }, { year: '2026', start: 4, span: 10 }]);
  assert.deepEqual(yearSpans(['2025-12', '2026-01']), [{ year: '2025', start: 0, span: 1 }, { year: '2026', start: 1, span: 1 }]);
});
