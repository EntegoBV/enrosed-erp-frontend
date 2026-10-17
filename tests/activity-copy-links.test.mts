import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityEvent } from '../src/app/core/api/models.ts';
import { activityCategory, activityEntityLabel, activityQueryParams, activityRoute } from '../src/app/features/activity/activity-copy.ts';

const event = (entityType: string, entityId: string | null = '12', action = 'UPDATED'): ActivityEvent =>
  ({ id: 1, at: '2026-09-24T10:00:00Z', actor: null, action, entityType, entityId, entityLabel: 'x', summary: 'x' });

test('finance entries open Kosten & bank with the section in the query, never in the path', () => {
  assert.deepEqual(activityRoute(event('COMPANY_COST')), ['/costs']);
  assert.deepEqual(activityQueryParams(event('COMPANY_COST')), { view: 'costs', cost: '12' });
  assert.deepEqual(activityRoute(event('RECURRING_COST')), ['/costs']);
  assert.deepEqual(activityQueryParams(event('RECURRING_COST')), { view: 'costs', tab: 'recurring' });
  assert.deepEqual(activityRoute(event('BANK_BALANCE')), ['/costs']);
  assert.deepEqual(activityQueryParams(event('BANK_BALANCE')), { view: 'bank' });
  assert.deepEqual(activityRoute(event('BANK_STATEMENT')), ['/costs']);
  assert.deepEqual(activityQueryParams(event('BANK_STATEMENT')), { view: 'bank', tab: 'movements' });
  assert.equal(activityCategory(event('BANK_STATEMENT')), 'FINANCE');
  assert.equal(activityEntityLabel(event('BANK_STATEMENT')), 'Bankbeweging');
});

test('orders keep their routes and carry no query', () => {
  assert.deepEqual(activityRoute(event('PURCHASE_ORDER')), ['/purchasing', '12']);
  assert.equal(activityQueryParams(event('PURCHASE_ORDER')), null);
  assert.deepEqual(activityRoute(event('SALES_ORDER')), ['/sales', '12']);
  assert.equal(activityQueryParams(event('SALES_ORDER')), null);
});

test('a deleted entry links nowhere', () => {
  assert.equal(activityRoute(event('COMPANY_COST', '12', 'DELETED')), null);
  assert.equal(activityQueryParams(event('COMPANY_COST', '12', 'DELETED')), null);
  assert.equal(activityRoute(event('BANK_STATEMENT', null)), null);
});

test('customers, suppliers and planner items link (bug 13); costs and bank are Kosten & bank even when filed as OTHER', async () => {
  const { activityCategoryIcon } = await import('../src/app/features/activity/activity-copy.ts');
  const customer = { ...event('CUSTOMER'), entityLabel: 'Bloemen Verhoeven BV' };
  assert.deepEqual(activityRoute(customer), ['/customers']);
  assert.deepEqual(activityQueryParams(customer), { q: 'Bloemen Verhoeven BV' });
  const supplier = { ...event('SUPPLIER'), entityLabel: 'Yunnan Pubei' };
  assert.deepEqual(activityRoute(supplier), ['/suppliers']);
  assert.deepEqual(activityQueryParams(supplier), { q: 'Yunnan Pubei' });
  assert.deepEqual(activityRoute(event('PLANNER_ITEM')), ['/dashboard/agenda']);
  assert.equal(activityQueryParams(event('PLANNER_ITEM')), null);
  assert.equal(activityCategory({ ...event('BANK_STATEMENT'), category: 'OTHER' }), 'FINANCE');
  assert.equal(activityCategory({ ...event('PRODUCT'), category: 'OTHER' }), 'OTHER');
  assert.equal(activityCategoryIcon('PLANNING'), 'calendar');
});

test('record filter chip and the inspector foot read as Dutch', async () => {
  const { activityRecordChip, activityRecordPhrase } = await import('../src/app/features/activity/activity-copy.ts');
  assert.equal(activityRecordChip('PURCHASE_ORDER', '62'), 'Inkooporder #62');
  assert.equal(activityRecordChip('SALES_ORDER', '391'), 'Verkoopdocument #391');
  assert.equal(activityRecordChip('PRODUCT', '301'), 'Product #301');
  assert.equal(activityRecordPhrase(event('PURCHASE_ORDER')), 'deze inkooporder');
  assert.equal(activityRecordPhrase(event('PRODUCT')), 'dit product');
  assert.equal(activityRecordPhrase(event('PRODUCT_FAMILY')), 'deze productfamilie');
  assert.equal(activityRecordPhrase(event('PLANNER_ITEM')), 'dit agendapunt');
  assert.equal(activityRecordPhrase(event('BANK_BALANCE')), 'dit banksaldo');
  assert.equal(activityRecordPhrase(event('SUPPLIER')), 'deze leverancier');
});
