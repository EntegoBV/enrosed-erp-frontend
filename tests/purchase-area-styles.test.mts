import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';

/*
 * The Inkoop redesign's own stylesheets (2026-10-17). Each partial under
 * src/styles/ loads with its screen: a style host component in the page's own
 * file (encapsulation None, styleUrl to the partial), rendered once by the page,
 * never from styles.scss (the initial bundle's 1 MB budget). Every rule hangs on
 * the page's host, so the area never restyles a kit or shell class bare.
 * The hosts are found, not listed: a reverted package takes its own check along.
 */
const SRC = new URL('../src/', import.meta.url);
const read = (path: string) => readFile(new URL(path, SRC), 'utf8');
const HOST = /@Component\(\{\s*selector: '([\w-]+)',\s*changeDetection: ChangeDetectionStrategy\.OnPush,\s*encapsulation: ViewEncapsulation\.None,\s*host: \{ hidden: '' \},\s*template: '',\s*styleUrl: '\.\.\/\.\.\/\.\.\/styles\/([\w-]+)\.scss',\s*\}\)/g;

interface Found { file: string; styleHost: string; partial: string; page: string; source: string }

async function styleHosts(): Promise<Found[]> {
  const found: Found[] = [];
  for (const dir of ['app/features/purchasing/', 'app/features/suppliers/']) {
    for (const name of (await readdir(new URL(dir, SRC))).filter((file) => file.endsWith('.ts'))) {
      const source = await read(dir + name);
      for (const match of source.matchAll(HOST)) {
        const page = [...source.matchAll(/selector: '([\w-]+)'/g)].map((m) => m[1]).find((selector) => selector !== match[1]);
        found.push({ file: dir + name, styleHost: match[1], partial: match[2], page: page ?? '', source });
      }
    }
  }
  return found;
}

/** Every selector list of a stylesheet (comments removed), nested ones included. */
function selectorsOf(scss: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const char of scss.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') {
      const text = buffer.trim();
      if (text) selectors.push(text);
      buffer = '';
      depth++;
    } else if (char === '}') { buffer = ''; depth--; } else if (char === ';') { buffer = ''; } else { buffer += char; }
  }
  assert.equal(depth, 0, 'balanced braces');
  return selectors;
}

/** The selectors of a list, split on the commas outside parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let level = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') level++;
    if (char === ')') level--;
    if (char === ',' && level === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

test('every area stylesheet loads once, with its screen, and every rule hangs on its page host', async () => {
  const hosts = await styleHosts();
  assert.ok(hosts.some((host) => host.partial === 'purchase-desk'), 'the container desk has its partial');
  const styles = await read('styles.scss');
  for (const { file, styleHost, partial, page, source } of hosts) {
    assert.ok(!styles.includes(`styles/${partial}'`), `${partial}: not in the initial styles.scss`);
    assert.equal(hosts.filter((host) => host.partial === partial).length, 1, `${partial}: one style host loads it`);
    assert.ok(page.startsWith('app-'), `${file}: the page next to the style host`);
    assert.equal(source.split(`<${styleHost} />`).length - 1, 1, `${file}: the page renders ${styleHost} once`);
    const selectors = selectorsOf(await read(`styles/${partial}.scss`));
    assert.ok(selectors.length > 10, `${partial}: ${selectors.length} selectors`);
    const scope = new RegExp(`^(@media|@container|@keyframes|${page}(?![\\w-]))`);
    assert.deepEqual(selectors.flatMap(splitTopLevel).filter((selector) => !scope.test(selector)), [], `${partial}: every rule under ${page}`);
  }
});
