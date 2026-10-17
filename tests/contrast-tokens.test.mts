import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/* WCAG contrast of the meta text colour and the terracotta accent (foundation design §2.1). */
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const styles = readFileSync(new URL('../src/styles.scss', import.meta.url), 'utf8');
const token = (block: string, name: string) => block.match(new RegExp(`${name}: (#[0-9a-f]{6})`))?.[1] ?? '';

test('meta text (--muted) reaches AA on white, the desk beige and the phone beige', () => {
  const muted = token(styles.slice(styles.indexOf(':root {')), '--muted');
  assert.equal(muted, '#736a64');
  for (const bg of ['#ffffff', '#f7f4f1', '#f2efeb']) assert.ok(ratio(muted, bg) >= 4.5, `${muted} on ${bg}: ${ratio(muted, bg).toFixed(2)}`);
});

test('the terracotta accent reaches AA as link text and under white button text', () => {
  const block = styles.slice(styles.indexOf('.theme-terracotta {'));
  const rose = token(block, '--rose');
  const dark = token(block, '--rose-dark');
  assert.ok(ratio(rose, '#f7f4f1') >= 4.5, `link ${ratio(rose, '#f7f4f1').toFixed(2)}`);
  assert.ok(ratio('#ffffff', rose) >= 4.5, `button ${ratio('#ffffff', rose).toFixed(2)}`);
  assert.ok(ratio('#ffffff', dark) >= 4.5);
  const theme = readFileSync(new URL('../src/app/core/platform/theme.ts', import.meta.url), 'utf8');
  assert.ok(theme.includes(`swatch: '${rose}'`), 'the swatch shows the accent itself');
});
