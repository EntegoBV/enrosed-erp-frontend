import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { Observable, finalize, firstValueFrom } from 'rxjs';

/**
 * The families cache inside CatalogApi (critique B8): every write through
 * the API forgets it, each caller gets its own copy, and only the product
 * screens opt into a 20 s reuse. catalog-families-cache.test.mts covers the
 * pure cachedOnce helper; this file covers the wiring around it.
 */
const apiSource = await readFile(new URL('../src/app/core/api/catalog-api.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('catalog-api.ts', apiSource, ts.ScriptTarget.Latest, true);
const proxy = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'clearingOnWrite');
assert.ok(proxy, 'clearingOnWrite still exists');
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [proxy])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context: { finalize: typeof finalize; exports: Record<string, unknown>; clearingOnWrite?: (http: object, clear: () => void) => any } = { finalize, exports: {} };
vm.runInNewContext(`${javascript}\nthis.clearingOnWrite = clearingOnWrite;`, context);
const clearingOnWrite = context.clearingOnWrite!;

/** A stand-in HttpClient: each call answers once the test says so, and logs when it was subscribed. */
function fakeHttp(log: string[]) {
  const answers: Array<() => void> = [];
  const call = (method: string) => (url: string) => new Observable<string>((subscriber) => {
    log.push(`${method} ${url}`);
    answers.push(() => { subscriber.next('ok'); subscriber.complete(); });
  });
  return { http: { get: call('GET'), post: call('POST'), put: call('PUT'), patch: call('PATCH'), delete: call('DELETE'), base: 'kept' }, answers };
}

test('every write clears the cache before it is sent and again once it is answered', async () => {
  for (const method of ['post', 'put', 'patch', 'delete'] as const) {
    const log: string[] = [];
    const { http, answers } = fakeHttp(log);
    const wrapped = clearingOnWrite(http, () => log.push('clear'));
    const done = firstValueFrom(wrapped[method]('/api/products/1'));
    assert.deepEqual(log, ['clear', `${method.toUpperCase()} /api/products/1`], method);
    answers[0]();
    await done;
    assert.deepEqual(log, ['clear', `${method.toUpperCase()} /api/products/1`, 'clear'], method);
  }
});

test('a read leaves the cache alone and other members pass through', async () => {
  const log: string[] = [];
  const { http, answers } = fakeHttp(log);
  const wrapped = clearingOnWrite(http, () => log.push('clear'));
  const done = firstValueFrom(wrapped.get('/api/product-families'));
  answers[0]();
  await done;
  assert.deepEqual(log, ['GET /api/product-families']);
  assert.equal(wrapped.base, 'kept');
});

test('CatalogApi writes only through the clearing client and hands each caller a copy', () => {
  assert.match(apiSource, /private readonly http = clearingOnWrite\(inject\(HttpClient\), \(\) => this\.familiesCache\.clear\(\)\);/);
  assert.equal(apiSource.match(/inject\(HttpClient\)/g)?.length, 1, 'no second, unwrapped HttpClient');
  assert.doesNotMatch(apiSource, /\.request\(|\.jsonp\(/, 'every write uses post/put/patch/delete, which the proxy covers');
  assert.match(apiSource, /property === 'post' \|\| property === 'put' \|\| property === 'patch' \|\| property === 'delete'/);
  assert.match(apiSource, /productFamilies\(options\?: \{ maxAgeMs\?: number \}\): Promise<ProductFamily\[\]> \{\s*return this\.familiesCache\.get\(options\?\.maxAgeMs \?\? 0\)\.then\(\(families\) => structuredClone\(families\)\);/);
});

async function sources(dir: URL): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...await sources(url));
    else if (entry.name.endsWith('.ts')) out.push({ path: url.pathname, text: await readFile(url, 'utf8') });
  }
  return out;
}

test('only the product screens reuse a young answer; every other caller asks as before', async () => {
  const all = await sources(new URL('../src/app/', import.meta.url));
  /* catalog-api.ts names the option in its own documentation; the callers are the screens. */
  const reusing = all.filter((file) => !file.path.endsWith('/core/api/catalog-api.ts') && /productFamilies\(\{\s*maxAgeMs/.test(file.text))
    .map((file) => file.path.replace(/^.*\/src\/app\//, '')).sort();
  assert.deepEqual(reusing, [
    'features/products/product-list.ts',
    'features/products/product-variant-group.ts',
    'features/products/product-view.ts',
    'features/products/stock-page.ts',
  ]);
  for (const file of reusing) {
    const text = all.find((item) => item.path.endsWith(file))!.text;
    for (const match of text.matchAll(/productFamilies\(\{\s*maxAgeMs:\s*([\d_]+)\s*\}\)/g)) assert.equal(Number(match[1].replace(/_/g, '')), 20000, file);
  }
});
