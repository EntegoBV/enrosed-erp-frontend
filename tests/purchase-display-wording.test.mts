import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';

/*
 * "set" became "display" everywhere on 2026-10-15 (Emre): the sales and product
 * screens, and purchasing, nacalculatie and Analyses › Inkoop, where it meant a
 * product sold per display. Scans the screens for the words the old wording used.
 */
const OLD = [/'sets?'/, /\/set\b/, /\b[Pp]er set\b/, /\b(bruikbare|bestelde|verloren|verkochte) sets?\b/, /Geland \/ set/, /\bset of stuk\b/, /\bsets (als|en)\b/, /Setprijs/];

test('no purchasing, nacalculatie, analysis, sales or product screen says "set" for a display', async () => {
  const offenders: string[] = [];
  for (const folder of ['purchasing', 'analyses', 'sales', 'products']) {
    const url = new URL(`../src/app/features/${folder}/`, import.meta.url);
    for (const file of (await readdir(url)).filter((name) => name.endsWith('.ts'))) {
      const source = await readFile(new URL(file, url), 'utf8');
      source.split('\n').forEach((line, index) => {
        // The NacalcProductRow property `set` (a display product's size) is code, not wording.
        const words = line.replace(/Pick<NacalcProductRow, 'set'/g, 'Pick<NacalcProductRow, ');
        if (OLD.some((pattern) => pattern.test(words))) offenders.push(`${folder}/${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});
