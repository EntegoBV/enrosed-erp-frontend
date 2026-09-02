import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SALES_SWIPE_ACTION_PX,
  SALES_SWIPE_COMMIT_PX,
  SALES_SWIPE_MAX_PX,
  SALES_SWIPE_REVEAL_PX,
  clampSalesSwipeOffset,
  isLocallyDeletableSalesDocument,
  isSwipeDeletableSalesDocument,
  salesDocumentLabel,
  salesSwipeDecision,
} from '../src/app/features/sales/sales-list-swipe.ts';

test('sales swipe keeps the purchase-list reveal and committed-delete thresholds', () => {
  assert.equal(SALES_SWIPE_ACTION_PX, 76);
  assert.equal(SALES_SWIPE_REVEAL_PX, 38);
  assert.equal(SALES_SWIPE_COMMIT_PX, 130);
  assert.equal(SALES_SWIPE_MAX_PX, 150);

  assert.equal(salesSwipeDecision(-37), 'close');
  assert.equal(salesSwipeDecision(-38), 'reveal');
  assert.equal(salesSwipeDecision(-129), 'reveal');
  assert.equal(salesSwipeDecision(-130), 'commit');
});

test('sales swipe offset is clamped to the left-hand rail', () => {
  assert.equal(clampSalesSwipeOffset(20), 0);
  assert.equal(clampSalesSwipeOffset(-80), -80);
  assert.equal(clampSalesSwipeOffset(-999), -150);
});

test('only a never-used concept document is offered for deletion', () => {
  const unused = unusedConcept();
  assert.equal(isLocallyDeletableSalesDocument(unused), true);
  assert.equal(isLocallyDeletableSalesDocument({
    ...unused,
    portalToken: 'not-yet-shared-customer-link',
  }), true, 'creating a portal token alone does not make a concept used');

  for (const used of [
    { ...unused, status: 'VERZONDEN' },
    { ...unused, sentAt: '2026-08-30T09:00:00Z' },
    { ...unused, viewedAt: '2026-08-30T09:05:00Z' },
    { ...unused, viewCount: 1 },
    { ...unused, decidedAt: '2026-08-30T10:00:00Z' },
  ]) {
    assert.equal(isLocallyDeletableSalesDocument(used), false);
  }
});

test('all quote statuses can be removed from the overview while invoices stay guarded', () => {
  const unused = unusedConcept();
  for (const quote of [
    { ...unused, docType: 'OFFERTE' },
    { ...unused, docType: null, status: 'VERZONDEN', sentAt: '2026-08-30T09:00:00Z' },
    { ...unused, docType: 'OFFERTE', status: 'BEKEKEN', viewedAt: '2026-08-30T09:05:00Z', viewCount: 1 },
    { ...unused, docType: 'OFFERTE', status: 'WIJZIGING_GEVRAAGD' },
    { ...unused, docType: 'OFFERTE', status: 'GEACCEPTEERD', decidedAt: '2026-08-30T10:00:00Z' },
    { ...unused, docType: 'OFFERTE', status: 'AFGEWEZEN' },
    { ...unused, docType: 'OFFERTE', status: 'VERLOPEN' },
  ]) {
    assert.equal(isSwipeDeletableSalesDocument(quote), true);
  }

  assert.equal(isSwipeDeletableSalesDocument({
    ...unused,
    docType: 'FACTUUR',
  }), true);
  assert.equal(isSwipeDeletableSalesDocument({
    ...unused,
    docType: 'FACTUUR',
    status: 'VERZONDEN',
    sentAt: '2026-08-30T09:00:00Z',
  }), false);
});

test('confirmation copy distinguishes invoices from quotes', () => {
  assert.equal(salesDocumentLabel('FACTUUR'), 'Verkoopfactuur');
  assert.equal(salesDocumentLabel('OFFERTE'), 'Offerte');
  assert.equal(salesDocumentLabel(null), 'Offerte');
});

function unusedConcept() {
  return {
    status: 'CONCEPT',
    portalToken: null,
    sentAt: null,
    viewedAt: null,
    viewCount: 0,
    decidedAt: null,
  };
}
