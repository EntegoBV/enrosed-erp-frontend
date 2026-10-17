import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookingHelp, bookingKinds, bookingLabel, bookingPreview, bookingReady, bookingToast, containerOptionLabel,
  dayLabel, newBookingDraft, parseCount, stockCellEdit, switchBookingKind, undoAllowed,
  type BookingDraft, type BookingKind, type BookingLevel,
} from '../src/app/features/products/stock-booking.ts';

const levels: BookingLevel[] = [
  { locationId: 1, name: 'Zaltbommel', quantity: 6000 },
  { locationId: 2, name: 'Tica Brussel', quantity: 8 },
];

const draft = (patch: Partial<BookingDraft>): BookingDraft => ({
  kind: 'RECOUNT', locationId: 1, toLocationId: null, quantity: null, note: '', containerId: null, ...patch,
});

test('parseCount takes whole, non-negative counts only', () => {
  const table: Array<[string, number | null]> = [
    ['', null], ['   ', null], [' 12 ', 12], ['12', 12], ['0', 0], ['-3', null], ['1.5', null], ['abc', null],
    ['1e3', null], ['12abc', null], ['+4', null], ['1,5', null], ['0012', 12],
  ];
  for (const [raw, expected] of table) assert.equal(parseCount(raw), expected, JSON.stringify(raw));
});

test('parseCount reads Dutch thousands', () => {
  assert.equal(parseCount('1.000'), 1000);
  assert.equal(parseCount('1 000'), 1000);
  assert.equal(parseCount('12.500'), 12500);
  assert.equal(parseCount('1.250.000'), 1250000);
  assert.equal(parseCount('1 000'), 1000);
  assert.equal(parseCount('1.00'), null, 'a group needs three digits');
  assert.equal(parseCount('1000.000.0'), null);
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(7), 7);
  assert.equal(parseCount(-1), null);
});

test('a typed cell reverts on nonsense, does nothing on the same figure, books otherwise', () => {
  assert.deepEqual(stockCellEdit('', 40), { action: 'revert' });
  assert.deepEqual(stockCellEdit('-2', 40), { action: 'revert' });
  assert.deepEqual(stockCellEdit('4,5', 40), { action: 'revert' });
  assert.deepEqual(stockCellEdit('40', 40), { action: 'none' });
  assert.deepEqual(stockCellEdit('1.040', 40), { action: 'book', quantity: 1040 });
  assert.equal(undoAllowed(52, 52), true);
  assert.equal(undoAllowed(51, 52), false);
  assert.equal(undoAllowed(null, 52), false);
});

test('Verplaatsen is only offered with two locations', () => {
  assert.deepEqual(bookingKinds(1).map((option) => option.kind), ['RECOUNT', 'DAMAGED', 'SHORTAGE', 'DEMO']);
  assert.deepEqual(bookingKinds(2).map((option) => option.label), ['Hertelling', 'Beschadigd', 'Te weinig', 'Demo', 'Verplaatsen']);
});

test('the preview per kind', () => {
  assert.deepEqual(bookingPreview(draft({ quantity: 6012 }), levels),
    { state: 'change', location: 'Zaltbommel', before: 6000, after: 6012, delta: 12, to: null });
  assert.equal(bookingPreview(draft({ quantity: 6000 }), levels)?.state, 'same');
  assert.equal(bookingPreview(draft({ quantity: null }), levels), null);
  for (const kind of ['DAMAGED', 'SHORTAGE', 'DEMO'] as BookingKind[]) {
    assert.deepEqual(bookingPreview(draft({ kind, locationId: 2, quantity: 3 }), levels),
      { state: 'change', location: 'Tica Brussel', before: 8, after: 5, delta: -3, to: null }, kind);
    assert.equal(bookingPreview(draft({ kind, locationId: 2, quantity: 9 }), levels)?.state, 'short', kind);
  }
  assert.deepEqual(bookingPreview(draft({ kind: 'TRANSFER', locationId: 1, toLocationId: 2, quantity: 40 }), levels), {
    state: 'move', location: 'Zaltbommel', before: 6000, after: 5960, delta: -40,
    to: { location: 'Tica Brussel', before: 8, after: 48 },
  });
  /* Without a level the product's own figure stands in. */
  assert.deepEqual(bookingPreview(draft({ locationId: null, quantity: 5 }), [], 3),
    { state: 'change', location: 'Voorraad', before: 3, after: 5, delta: 2, to: null });
});

test('ready only when the booking changes what can change', () => {
  assert.equal(bookingReady(draft({ quantity: 6000 }), levels), false, 'a recount on the same figure');
  assert.equal(bookingReady(draft({ quantity: 0 }), levels), true, 'a recount to zero is a real recount');
  assert.equal(bookingReady(draft({ kind: 'DAMAGED', quantity: 0 }), levels), false);
  assert.equal(bookingReady(draft({ kind: 'DAMAGED', locationId: 2, quantity: 9 }), levels), false, 'too much disables');
  assert.equal(bookingReady(draft({ kind: 'DAMAGED', locationId: 2, quantity: 8 }), levels), true);
  assert.equal(bookingReady(draft({ kind: 'TRANSFER', toLocationId: 1, quantity: 4 }), levels), false, 'same location');
  assert.equal(bookingReady(draft({ kind: 'TRANSFER', toLocationId: null, quantity: 4 }), levels), false);
  assert.equal(bookingReady(draft({ kind: 'TRANSFER', toLocationId: 2, quantity: 4 }), levels), true);
  assert.equal(bookingReady(draft({ kind: 'TRANSFER', locationId: 2, toLocationId: 1, quantity: 9 }), levels), false);
});

test('a new draft and a kind switch', () => {
  assert.deepEqual(newBookingDraft('RECOUNT', levels, 2), draft({ locationId: 2, quantity: 8 }));
  assert.deepEqual(newBookingDraft('DEMO', [{ locationId: 1, name: 'A', quantity: 0 }, { locationId: 2, name: 'B', quantity: 4 }]),
    draft({ kind: 'DEMO', locationId: 2 }), 'the first location with stock');
  assert.deepEqual(newBookingDraft('TRANSFER', levels), draft({ kind: 'TRANSFER', locationId: 1, toLocationId: 2 }));
  const damaged = { ...draft({ kind: 'DAMAGED', quantity: 4, containerId: 9, note: 'x' }) };
  assert.deepEqual(switchBookingKind(damaged, 'SHORTAGE', levels), { ...damaged, kind: 'SHORTAGE' });
  assert.deepEqual(switchBookingKind(damaged, 'DEMO', levels), { ...damaged, kind: 'DEMO', containerId: null });
  assert.deepEqual(switchBookingKind(damaged, 'RECOUNT', levels), { ...damaged, kind: 'RECOUNT', quantity: 6000, containerId: null });
  assert.deepEqual(switchBookingKind(draft({ quantity: 6000 }), 'DAMAGED', levels), draft({ kind: 'DAMAGED', quantity: null }));
  assert.equal(switchBookingKind(damaged, 'TRANSFER', levels).toLocationId, 2);
});

test('the help texts use the product unit and never say stuks', () => {
  for (const option of bookingKinds(2)) {
    const help = bookingHelp(option.kind, 'bowls');
    assert.doesNotMatch(help, /stuks/, option.kind);
    assert.ok(help.length > 20, option.kind);
  }
  assert.match(bookingHelp('DAMAGED', 'bowls'), /de bowls gaan uit de voorraad/);
  assert.match(bookingHelp('SHORTAGE', 'displays'), /De displays gaan uit de voorraad en de container hoort het\./);
  assert.deepEqual((['RECOUNT', 'DAMAGED', 'SHORTAGE', 'DEMO', 'TRANSFER'] as BookingKind[]).map(bookingLabel),
    ['Boek hertelling', 'Boek beschadigd', 'Boek tekort', 'Boek demo', 'Verplaatsen']);
});

test('the toasts name the location, the container and the unit', () => {
  const unit = { singular: 'bowl', plural: 'bowls' };
  const base = { delta: 12, quantity: 12, location: 'Zaltbommel', container: null, toLocation: null, unit };
  assert.equal(bookingToast({ ...base, kind: 'RECOUNT' }), 'Hertelling geboekt: +12 op Zaltbommel');
  assert.equal(bookingToast({ ...base, kind: 'RECOUNT', delta: -1200 }), 'Hertelling geboekt: -1.200 op Zaltbommel');
  assert.equal(bookingToast({ ...base, kind: 'DAMAGED', container: 'container/2026/002' }), 'Beschadigd geboekt · gemeld op container/2026/002');
  assert.equal(bookingToast({ ...base, kind: 'DAMAGED' }), 'Beschadigd geboekt');
  assert.equal(bookingToast({ ...base, kind: 'SHORTAGE', container: 'PO-2026-013' }), 'Tekort geboekt · gemeld op PO-2026-013');
  assert.equal(bookingToast({ ...base, kind: 'DEMO' }), 'Demo geboekt');
  assert.equal(bookingToast({ ...base, kind: 'TRANSFER', quantity: 40, toLocation: 'Tica Brussel' }), '40 bowls naar Tica Brussel');
  assert.equal(bookingToast({ ...base, kind: 'TRANSFER', quantity: 1, toLocation: 'Tica Brussel' }), '1 bowl naar Tica Brussel');
});

test('container options read name and received date', () => {
  assert.equal(dayLabel('2026-12-20'), '20/12/2026');
  assert.equal(containerOptionLabel({ name: 'container/2026/002', receivedOn: '2026-09-03' }), 'container/2026/002 · ontvangen 03/09/2026');
  assert.equal(containerOptionLabel({ name: 'PO-2026-013', receivedOn: null }), 'PO-2026-013');
});
