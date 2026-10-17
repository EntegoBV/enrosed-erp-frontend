import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PERIOD, RECEIPT_PERIOD_KEYS, SALES_PERIOD_KEYS, customPeriod, parsePart, parsePeriod, parseOrderId, parseReceiptPeriod, parseSupplier,
  partParams, periodLabel, periodParams, periodRange, presetLabel, presetRange, samePeriod, yearStart,
} from '../src/app/features/analyses/analyses-period.ts';

const url = (query: string) => { const params = new URLSearchParams(query); return (key: string) => params.get(key); };

test('presets follow today: "Dit jaar" rolls over on 1 January', () => {
  assert.deepEqual(presetRange('jaar', '2026-10-16'), { from: '2026-01-01', to: '2026-10-16' });
  assert.deepEqual(presetRange('jaar', '2027-01-01'), { from: '2027-01-01', to: '2027-01-01' });
  assert.deepEqual(presetRange('maand', '2026-10-16'), { from: '2026-10-01', to: '2026-10-16' });
  assert.deepEqual(presetRange('kwartaal', '2026-10-16'), { from: '2026-10-01', to: '2026-10-16' });
  assert.deepEqual(presetRange('kwartaal', '2026-06-30'), { from: '2026-04-01', to: '2026-06-30' });
  assert.deepEqual(presetRange('vorigjaar', '2026-10-16'), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(presetRange('alle', '2026-10-16'), { from: '', to: '' });
  assert.equal(presetLabel('vorigjaar', '2026-10-16'), '2025');
  assert.equal(periodLabel({ from: '2026-02-01', to: '2026-02-28' }, '2026-10-16'), 'Eigen periode');
  assert.equal(periodLabel(DEFAULT_PERIOD, '2026-10-16'), 'Dit jaar');
  assert.equal(yearStart('2026-10-16'), '2026-01-01');
  assert.deepEqual(periodRange({ from: '2026-02-01', to: '' }, '2026-10-16'), { from: '2026-02-01', to: '' });
});

test('the URL carries the choice; "jaar" is omitted and unknown values fall back', () => {
  assert.deepEqual(parsePeriod(url(''), SALES_PERIOD_KEYS), { preset: 'jaar' });
  assert.deepEqual(parsePeriod(url('periode=vorigjaar'), SALES_PERIOD_KEYS), { preset: 'vorigjaar' });
  assert.deepEqual(parsePeriod(url('periode=decennium'), SALES_PERIOD_KEYS), { preset: 'jaar' });
  assert.deepEqual(parsePeriod(url('van=2026-02-01&tot=2026-02-28'), SALES_PERIOD_KEYS), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(parsePeriod(url('van=2026-02-30'), SALES_PERIOD_KEYS), { preset: 'jaar' }, 'an impossible day is no date');
  assert.deepEqual(parsePeriod(url('van=2026-03-01&tot=2026-02-01'), SALES_PERIOD_KEYS), { from: '2026-02-01', to: '2026-03-01' }, 'reversed dates are swapped');
  assert.deepEqual(periodParams({ preset: 'jaar' }, SALES_PERIOD_KEYS), { periode: null, van: null, tot: null });
  assert.deepEqual(periodParams({ preset: 'alle' }, SALES_PERIOD_KEYS), { periode: 'alle', van: null, tot: null });
  assert.deepEqual(periodParams({ from: '2026-02-01', to: '' }, SALES_PERIOD_KEYS), { periode: null, van: '2026-02-01', tot: null });
  assert.deepEqual(periodParams({ preset: 'maand' }, RECEIPT_PERIOD_KEYS), { ontvangst: 'maand', ovan: null, otot: null });
  assert.deepEqual(customPeriod('', ''), { preset: 'alle' });
  assert.ok(samePeriod({ preset: 'jaar' }, { preset: 'jaar' }));
  assert.ok(!samePeriod({ preset: 'jaar' }, { from: '2026-01-01', to: '2026-10-16' }));
});

test('Inkoop parts: ?deel, kosten by default, ?orderId means Afwijkingen over all years', () => {
  assert.equal(parsePart(url('')), 'kosten');
  assert.equal(parsePart(url('deel=partners')), 'partners');
  assert.equal(parsePart(url('deel=onzin')), 'kosten');
  assert.equal(parsePart(url('orderId=12')), 'afwijkingen');
  assert.equal(parsePart(url('deel=partners&orderId=12')), 'afwijkingen');
  assert.equal(parsePart(url('orderId=abc')), 'kosten');
  assert.deepEqual(partParams('kosten'), { deel: null });
  assert.deepEqual(partParams('kwaliteit'), { deel: 'kwaliteit' });
  assert.equal(parseOrderId(url('orderId=0')), null);
  assert.equal(parseSupplier(url('leverancier=7')), 7);
  assert.equal(parseSupplier(url('leverancier=-1')), null);
  assert.deepEqual(parseReceiptPeriod(url('')), { preset: 'jaar' });
  assert.deepEqual(parseReceiptPeriod(url('orderId=12')), { preset: 'alle' });
  assert.deepEqual(parseReceiptPeriod(url('orderId=12&ontvangst=jaar')), { preset: 'jaar' });
  assert.deepEqual(parseReceiptPeriod(url('ovan=2026-01-01&otot=2026-06-30')), { from: '2026-01-01', to: '2026-06-30' });
});
