import assert from 'node:assert/strict';
import test from 'node:test';
import { bounceLine, compareLine, deltaOf, deltaShort, durationLabel, peakLine } from '../src/app/features/analyses/website-analytics-math.ts';

test('a delta compares with the period before and stays silent without one', () => {
  assert.deepEqual(deltaOf(120, 100), { pct: 20, direction: 'up' });
  assert.deepEqual(deltaOf(80, 100), { pct: -20, direction: 'down' });
  assert.deepEqual(deltaOf(100, 100), { pct: 0, direction: 'flat' });
  assert.equal(deltaOf(5, 0), null);
  assert.equal(deltaOf(Number.NaN, 3), null);
});

test('a session length reads as minutes and seconds', () => {
  assert.equal(durationLabel(0), '—');
  assert.equal(durationLabel(45), '45 s');
  assert.equal(durationLabel(60), '1 min');
  assert.equal(durationLabel(80.4), '1 min 20 s');
});

test('the bounce sub reads nl-BE, never a JS decimal (analyses2 D-W6)', () => {
  assert.equal(bounceLine(43.5, 120), '43,5 % na één pagina');
  assert.equal(bounceLine(40, 12), '40 % na één pagina');
  assert.equal(bounceLine(0, 0), 'nog geen sessies');
});

test('an empty window says "geen bezoeken" on the axis, not "piek 1" (D-W7)', () => {
  assert.equal(peakLine([]), 'geen bezoeken');
  assert.equal(peakLine([{ visits: 0 }, { visits: 0 }]), 'geen bezoeken');
  assert.equal(peakLine([{ visits: 3 }, { visits: 1250 }]), 'piek 1.250 op een dag');
});

test('a figure shows only its change; the tool row says once against what (C.10)', () => {
  assert.equal(deltaShort(112, 100), '▲ 12 %');
  assert.equal(deltaShort(97, 100), '▼ 3 %');
  assert.equal(deltaShort(100, 100), '= 0 %');
  assert.equal(deltaShort(5, 0), 'geen vergelijking');
  assert.equal(compareLine(30), 't.o.v. vorige 30 dagen');
  assert.equal(compareLine(365), 't.o.v. vorige 365 dagen');
  assert.equal(compareLine(1), 't.o.v. gisteren');
});
