import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/*
 * Inkoop fix round 2: a row menu's head is the container name (B4: never cut)
 * and the supplier menu's head the supplier name (N13: up to two lines). The
 * kit's popover head and the iOS sheet title are one line with an ellipsis and
 * no title, so under each menu's own class they wrap instead. The selectors
 * must beat the kit's encapsulated `.cm__head[_ngcontent]` (0,2,0) and the
 * kit's `.sheet--ios .sheet__head h2` (0,2,1).
 */
const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const strip = (scss: string) => scss.replace(/\/\*[\s\S]*?\*\//g, '');

for (const [page, file, partial, cls, title] of [
  ['app-purchase-list', '../src/app/features/purchasing/purchase-list.ts', '../src/styles/purchase-list.scss', 'pl-menu', 'containerName(menu.row.order)'],
  ['app-supplier-list', '../src/app/features/suppliers/supplier-list.ts', '../src/styles/suppliers.scss', 'sup-menu', 'open.supplier.name'],
] as const) {
  test(`${page}: the menu head wraps, on the desk and in the phone sheet`, async () => {
    const source = await read(file);
    assert.ok(source.includes(`<app-context-menu class="${cls}" [title]="${title}"`), 'the menu carries its own class');
    const css = strip(await read(partial));
    assert.ok(css.includes(`${page} .${cls} .cm__head{white-space:normal;overflow-wrap:anywhere}`), 'desk popover head');
    assert.ok(css.includes(`@media (max-width:679.98px){${page} .${cls} .sheet--ios .sheet__head h2{white-space:normal;overflow-wrap:anywhere;text-wrap:balance}}`), 'phone sheet title');
  });
}
