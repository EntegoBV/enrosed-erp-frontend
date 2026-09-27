import assert from 'node:assert/strict';
import test from 'node:test';
import { MEDIA_PAGE_SIZE, collectPages } from '../src/app/core/api/media-paging.ts';

interface Row { id: number }

/** A server holding `total` rows with ids 1..total, capped at 200 per request like the real one. */
function server(total: number) {
  const calls: Array<{ offset: number; limit: number }> = [];
  const fetchPage = async (offset: number, limit: number): Promise<Row[]> => {
    calls.push({ offset, limit });
    const size = Math.min(limit, MEDIA_PAGE_SIZE);
    return Array.from({ length: Math.max(0, Math.min(size, total - offset)) }, (_, i) => ({ id: offset + i + 1 }));
  };
  return { calls, fetchPage };
}

test('the page size is the server cap', () => {
  assert.equal(MEDIA_PAGE_SIZE, 200);
});

test('a short page ends the walk and the list is complete', async () => {
  const { calls, fetchPage } = server(450);
  const result = await collectPages(fetchPage, { pageSize: 200, max: 1000 });
  assert.equal(result.items.length, 450);
  assert.equal(result.complete, true);
  assert.deepEqual(result.items.slice(0, 2).map((row) => row.id), [1, 2]);
  assert.equal(result.items.at(-1)?.id, 450);
  assert.deepEqual(calls, [
    { offset: 0, limit: 200 },
    { offset: 200, limit: 200 },
    { offset: 400, limit: 200 },
  ], 'always asks a full page and advances by what came back');
});

test('max cuts the list short and says it is incomplete', async () => {
  const { calls, fetchPage } = server(5000);
  const result = await collectPages(fetchPage, { pageSize: 200, max: 500 });
  assert.equal(result.items.length, 500);
  assert.equal(result.complete, false);
  assert.equal(result.items.at(-1)?.id, 500);
  assert.deepEqual(calls.map((call) => call.offset), [0, 200, 400]);
});

test('a list that is exactly max long and ends on a short page is complete', async () => {
  const { fetchPage } = server(300);
  const result = await collectPages(fetchPage, { pageSize: 200, max: 300 });
  assert.equal(result.items.length, 300);
  assert.equal(result.complete, true);
});

test('ids repeated by a shifted page are kept once, in first-seen order', async () => {
  /* An upload between two requests pushes asset 200 onto the second page. */
  const pages: Row[][] = [
    Array.from({ length: 200 }, (_, i) => ({ id: i + 1 })),
    [{ id: 200 }, { id: 201 }, { id: 202 }],
  ];
  const offsets: number[] = [];
  const result = await collectPages(async (offset) => {
    offsets.push(offset);
    return pages[offsets.length - 1] ?? [];
  }, { pageSize: 200, max: 1000 });
  assert.equal(result.items.length, 202);
  assert.deepEqual(result.items.slice(198).map((row) => row.id), [199, 200, 201, 202]);
  assert.equal(result.complete, true);
});

test('the first failure is passed on', async () => {
  let call = 0;
  await assert.rejects(
    collectPages(async () => {
      call++;
      if (call === 2) throw new Error('server down');
      if (call > 2) throw new Error('should not be reached');
      return Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));
    }, { pageSize: 200, max: 1000 }),
    /server down/,
  );
  assert.equal(call, 2);
});

test('an empty first page gives an empty, complete list', async () => {
  const { calls, fetchPage } = server(0);
  assert.deepEqual(await collectPages(fetchPage, { pageSize: 200, max: 1000 }), { items: [], complete: true });
  assert.equal(calls.length, 1);
});

test('a server that keeps repeating the same page cannot make the walk spin', async () => {
  let calls = 0;
  const result = await collectPages(async () => {
    calls++;
    return Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));
  }, { pageSize: 200, max: 1000 });
  assert.equal(calls, 7, 'ceil(1000 / 200) + 2 rounds at most');
  assert.equal(result.items.length, 200);
  assert.equal(result.complete, false);
});
