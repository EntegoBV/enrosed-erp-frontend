import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentNavEntry, emptyNavStack, lastUrlFor, navEntryBelow, recordNavigation, upTarget,
} from '../src/app/core/platform/nav-history.ts';
import type { NavRecord, NavStack } from '../src/app/core/platform/nav-history.ts';

function play(records: NavRecord[]): NavStack {
  return records.reduce(recordNavigation, emptyNavStack());
}
const go = (id: number, url: string, replace = false): NavRecord => ({ id, url, trigger: 'imperative', replace });
const back = (id: number, url: string, restoredId: number | null): NavRecord => ({ id, url, trigger: 'popstate', restoredId });

test('a deep link has nothing below it', () => {
  const stack = play([go(1, '/sales/79/edit')]);
  assert.equal(currentNavEntry(stack)?.url, '/sales/79/edit');
  assert.equal(navEntryBelow(stack), null);
});

test('pushes stack up and the screen below is the one back returns to', () => {
  const stack = play([go(1, '/dashboard'), go(2, '/sales'), go(3, '/sales/79')]);
  assert.equal(navEntryBelow(stack)?.url, '/sales');
});

test('after a pop the screen below is the one under it, not the screen we came from', () => {
  /* Verkoop → Order 79 → Klant → back: the order's back control must read Verkoop. */
  const stack = play([go(1, '/sales'), go(2, '/sales/79'), go(3, '/customers?open=12'), back(4, '/sales/79', 2)]);
  assert.equal(currentNavEntry(stack)?.url, '/sales/79');
  assert.equal(navEntryBelow(stack)?.url, '/sales');
});

test('replaceUrl swaps the top and keeps what lies below', () => {
  const stack = play([go(1, '/dashboard'), go(2, '/sales'), go(3, '/sales?tab=facturen', true), go(4, '/sales?tab=facturen&scope=PARTNER', true)]);
  assert.equal(stack.entries.length, 2);
  assert.equal(currentNavEntry(stack)?.url, '/sales?tab=facturen&scope=PARTNER');
  assert.equal(navEntryBelow(stack)?.url, '/dashboard');
});

test('a push after going back drops the forward entries', () => {
  const stack = play([go(1, '/sales'), go(2, '/sales/79'), back(3, '/sales', 1), go(4, '/purchasing')]);
  assert.deepEqual(stack.entries.map((e) => e.url), ['/sales', '/purchasing']);
});

test('forward moves up to the restored entry again', () => {
  const stack = play([go(1, '/sales'), go(2, '/sales/79'), back(3, '/sales', 1), back(4, '/sales/79', 2)]);
  assert.equal(currentNavEntry(stack)?.url, '/sales/79');
  assert.equal(navEntryBelow(stack)?.url, '/sales');
});

test('going back to the same screen twice keeps the stack: the restored entry takes the pop\'s id', () => {
  /* Angular rewrites the browser entry it returns to with the pop's navigationId, so the
     second return to the PO restores id 4, not 2. */
  const stack = play([
    go(1, '/purchasing?status=open'), go(2, '/purchasing/62'), go(3, '/products/5'),
    back(4, '/purchasing/62', 2), go(5, '/products/6'), back(6, '/purchasing/62', 4),
  ]);
  assert.deepEqual(stack.entries.map((e) => [e.id, e.url]), [[1, '/purchasing?status=open'], [6, '/purchasing/62'], [5, '/products/6']]);
  assert.equal(currentNavEntry(stack)?.url, '/purchasing/62');
  assert.equal(navEntryBelow(stack)?.url, '/purchasing?status=open');
  assert.deepEqual(upTarget(stack, '/purchasing'), { back: true });
  /* and forward again, then back to the list, all by the rewritten ids */
  const forward = recordNavigation(stack, { id: 7, url: '/products/6', trigger: 'popstate', restoredId: 5 });
  assert.equal(navEntryBelow(forward)?.url, '/purchasing/62');
  const list = recordNavigation(recordNavigation(forward, back(8, '/purchasing/62', 6)), back(9, '/purchasing?status=open', 1));
  assert.equal(currentNavEntry(list)?.url, '/purchasing?status=open');
  assert.deepEqual(list.entries.map((e) => e.id), [9, 8, 7]);
});

test('after a reload an older entry with a known id but another screen restarts the stack', () => {
  /* The reloaded session numbers from 1 again; the entry before the reload carried id 2 in the old session. */
  const stack = play([go(1, '/sales/79'), go(2, '/customers'), back(3, '/sales/79', 1), back(4, '/settings', 2)]);
  assert.deepEqual(stack.entries.map((e) => e.url), ['/settings']);
  assert.equal(navEntryBelow(stack), null);
  /* a page that changed its own query in place is still the same entry */
  const query = play([go(1, '/purchasing/62'), go(2, '/products/5'), back(3, '/purchasing/62?section=ledger', 1)]);
  assert.equal(query.index, 0);
  assert.equal(query.entries.length, 2);
});

test('a popstate to an entry we never saw (before a reload) restarts the stack there', () => {
  const stack = play([go(1, '/sales/79'), back(2, '/sales', 7)]);
  assert.equal(stack.entries.length, 1);
  assert.equal(navEntryBelow(stack), null);
  const stateless = play([go(1, '/sales'), go(2, '/sales/79'), back(3, '/sales', null)]);
  assert.equal(stateless.entries.length, 1);
});

test('the last URL per path keeps the list filters, query-only changes included', () => {
  const stack = play([go(1, '/sales'), go(2, '/sales?tab=facturen&scope=PARTNER', true), go(3, '/sales/79')]);
  assert.equal(lastUrlFor(stack, '/sales'), '/sales?tab=facturen&scope=PARTNER');
  assert.equal(lastUrlFor(stack, '/sales/'), '/sales?tab=facturen&scope=PARTNER');
  assert.equal(lastUrlFor(stack, '/purchasing'), null);
});

test('way up: history back when the screen below is the parent, else the last parent URL or the parent', () => {
  const fromList = play([go(1, '/sales?tab=facturen'), go(2, '/sales/79')]);
  assert.deepEqual(upTarget(fromList, '/sales'), { back: true });

  const fromHome = play([go(1, '/sales?tab=facturen'), go(2, '/dashboard'), go(3, '/sales/79')]);
  assert.deepEqual(upTarget(fromHome, '/sales'), { back: false, url: '/sales?tab=facturen' });

  const deepLink = play([go(1, '/sales/79')]);
  assert.deepEqual(upTarget(deepLink, '/sales'), { back: false, url: '/sales' });
});
