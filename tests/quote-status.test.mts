import assert from 'node:assert/strict';
import test from 'node:test';
import { statusOf } from '../src/app/features/sales/quote-status.ts';

const credit = (status: string, summary: { status: string; creditEur: number } | null) =>
  ({ order: { status, docType: 'CREDITNOTA' }, paymentSummary: summary } as Parameters<typeof statusOf>[0]);
const invoice = (status: string, summaryStatus: string, total: number, creditedEur?: number) =>
  ({ order: { status, docType: 'FACTUUR' }, paymentSummary: { status: summaryStatus, invoiceTotalEur: total }, creditedEur } as Parameters<typeof statusOf>[0]);

test('a credit note reads Concept, Tegoed open, Afgehandeld or Geannuleerd; the mail state only without money', () => {
  assert.deepEqual(statusOf(credit('CONCEPT', { status: 'CREDIT', creditEur: 100 })), { label: 'Concept', cls: 'neutral' });
  assert.deepEqual(statusOf(credit('UITGEREIKT', { status: 'CREDIT', creditEur: 220.2 })), { label: 'Tegoed open', cls: 'gold' });
  assert.deepEqual(statusOf(credit('VERZONDEN', { status: 'CREDIT', creditEur: 50 })), { label: 'Tegoed open', cls: 'gold' });
  assert.deepEqual(statusOf(credit('UITGEREIKT', { status: 'PAID', creditEur: 0 })), { label: 'Afgehandeld', cls: 'ok' });
  assert.deepEqual(statusOf(credit('BETAALD', null)), { label: 'Afgehandeld', cls: 'ok' });
  assert.deepEqual(statusOf(credit('UITGEREIKT', null)), { label: 'Uitgereikt · niet gemaild', cls: 'rose' });
  assert.deepEqual(statusOf(credit('VERZONDEN', null)), { label: 'Uitgereikt', cls: 'rose' });
  assert.deepEqual(statusOf(credit('GEANNULEERD', { status: 'CREDIT', creditEur: 0 })), { label: 'Geannuleerd', cls: 'neutral' });
});

test('an invoice reads Gecrediteerd once its credit notes took the whole claim back, else as before', () => {
  assert.deepEqual(statusOf(invoice('UITGEREIKT', 'PAID', 5120, 5120)), { label: 'Gecrediteerd', cls: 'neutral' });
  assert.deepEqual(statusOf(invoice('UITGEREIKT', 'UNPAID', 5120, 5120.004)), { label: 'Gecrediteerd', cls: 'neutral' });
  assert.deepEqual(statusOf(invoice('BETAALD', 'PAID', 5120, 220.2)), { label: 'Betaald', cls: 'ok' });
  assert.deepEqual(statusOf(invoice('UITGEREIKT', 'PARTIAL', 6350.4, 0)), { label: 'Deels betaald', cls: 'gold' });
  assert.deepEqual(statusOf(invoice('UITGEREIKT', 'UNPAID', 2178)), { label: 'Uitgereikt · niet gemaild', cls: 'rose' });
  assert.deepEqual(statusOf(invoice('CONCEPT', 'UNPAID', 100, 100)), { label: 'Concept', cls: 'neutral' }, 'a concept is never credited');
});
