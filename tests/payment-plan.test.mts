import assert from 'node:assert/strict';
import test from 'node:test';
import { PAYMENT_TOLERANCE_EUR, instalmentsOf, paymentPlanLabel, planPreview, splitInstalments, splitTotal, withinTolerance } from '../src/app/features/purchasing/payment-plan.ts';

test('a split of one\'s own skips the moments with nothing to pay and reads as words', () => {
  const steps = splitInstalments(40, 0, 60);
  assert.deepEqual(steps.map((step) => step.label), ['40% bij bestelling', '60% bij aankomst']);
  assert.deepEqual(steps.map((step) => step.due), ['ORDERED', 'ARRIVED']);
  assert.equal(steps[0].share, 0.4);
  assert.deepEqual(splitInstalments(null, null, null), []);
  assert.equal(splitInstalments(33.5, 66.5, null)[0].label, '33.5% bij bestelling');
});

test('the shares are checked against a hundred', () => {
  assert.equal(splitTotal(25, 25, 50), 100);
  assert.equal(splitTotal(30, 70, null), 100);
  assert.equal(splitTotal(30, 30, null), 60);
});

test('an order pays by its own split under CUSTOM and by the preset otherwise', () => {
  const presets = [{ value: 'THIRDS' as const, label: '1/3 · 1/3 · 1/3', instalments: [
    { label: '1/3 bij bestelling', share: 1 / 3, due: 'ORDERED' as const },
    { label: '1/3 bij vertrek', share: 1 / 3, due: 'SHIPPED' as const },
    { label: '1/3 bij aankomst', share: 1 / 3, due: 'ARRIVED' as const } ] }];
  assert.equal(instalmentsOf({ paymentTerms: 'THIRDS' }, presets).length, 3);
  assert.equal(instalmentsOf({ paymentTerms: 'CUSTOM', payPctOrdered: 30, payPctArrived: 70 }, presets).length, 2);
  assert.equal(paymentPlanLabel({ paymentTerms: 'CUSTOM', payPctOrdered: 30, payPctArrived: 70 }, presets), '30% bij bestelling, 70% bij aankomst');
  assert.equal(paymentPlanLabel({ paymentTerms: 'CUSTOM' }, presets), 'Anders: eigen verdeling');
  assert.equal(paymentPlanLabel({ paymentTerms: 'THIRDS' }, presets), '1/3 · 1/3 · 1/3');
});

test('the small change of paying counts as exact up to ten euro', () => {
  assert.equal(PAYMENT_TOLERANCE_EUR, 10);
  assert.equal(withinTolerance(-9.46), true);
  assert.equal(withinTolerance(10), true);
  assert.equal(withinTolerance(10.01), false);
  assert.equal(withinTolerance(-25), false);
});

test('the plan preview splits the agreement to the cent and the last term takes the rest', () => {
  const thirds = [{ label: '1/3 bij bestelling', share: 1 / 3, due: 'ORDERED' as const }, { label: '1/3 bij vertrek', share: 1 / 3, due: 'SHIPPED' as const },
    { label: '1/3 bij aankomst', share: 1 / 3, due: 'ARRIVED' as const }];
  assert.deepEqual(planPreview(100, thirds).map(step => step.amountEur), [33.33, 33.33, 33.34]);
  const deposit = splitInstalments(30, 70, null);
  assert.deepEqual(planPreview(139113.37, deposit).map(step => [step.due, step.label, step.amountEur]),
    [['ORDERED', '30% bij bestelling', 41734.01], ['SHIPPED', '70% bij vertrek', 97379.36]]);
  const custom = splitInstalments(25, 25, 50);
  assert.deepEqual(planPreview(1000.01, custom).map(step => step.amountEur), [250, 250, 500.01]);
  const total = planPreview(987.65, custom).reduce((sum, step) => sum + Math.round(step.amountEur * 100), 0);
  assert.equal(total, 98765);
  assert.deepEqual(planPreview(0, deposit).map(step => step.amountEur), [0, 0]);
  assert.deepEqual(planPreview(500, []), []);
});
