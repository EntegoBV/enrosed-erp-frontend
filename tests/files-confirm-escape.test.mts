import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/*
 * Ui.confirm renders its message as HTML. Every file or folder name (and any
 * other label a user typed) that goes into a confirm of Documenten & media
 * must pass escapeHtml, and no confirm may add a second "Annuleren" button.
 */
const source = await readFile(new URL('../src/app/features/files/files-controller.ts', import.meta.url), 'utf8');

/** The template literals in a stretch of code, with their raw contents. */
function templates(code: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < code.length; index++) {
    if (code[index] !== '`') continue;
    let depth = 0;
    let end = index + 1;
    for (; end < code.length; end++) {
      const char = code[end];
      if (char === '\\') { end++; continue; }
      if (depth === 0 && char === '`') break;
      if (char === '$' && code[end + 1] === '{') { depth++; end++; continue; }
      if (depth > 0 && char === '{') depth++;
      if (depth > 0 && char === '}') depth--;
    }
    found.push(code.slice(index + 1, end));
    index = end;
  }
  return found;
}

/** The ${…} expressions of one template literal. */
function interpolations(template: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < template.length; index++) {
    if (template[index] !== '$' || template[index + 1] !== '{') continue;
    let depth = 1;
    let end = index + 2;
    for (; end < template.length && depth > 0; end++) {
      if (template[end] === '{') depth++;
      if (template[end] === '}') depth--;
    }
    found.push(template.slice(index + 2, end - 1).trim());
    index = end - 1;
  }
  return found;
}

/** The code of every statement that builds a confirm message or an HTML fragment for one. */
function messageSources(): { where: string; code: string }[] {
  const out: { where: string; code: string }[] = [];
  const patterns = [/message:\s*/g, /const message\s*=\s*/g, /const \w+Html\s*=\s*/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const start = match.index! + match[0].length;
      let end = start;
      let inTemplate = false;
      let depth = 0;
      for (; end < source.length; end++) {
        const char = source[end];
        if (char === '`') inTemplate = !inTemplate;
        if (inTemplate) continue;
        if ('([{'.includes(char)) depth++;
        if (')]}'.includes(char)) { if (depth === 0) break; depth--; }
        if (depth === 0 && (char === ';' || char === ',' || char === '\n')) break;
      }
      out.push({ where: match[0].trim(), code: source.slice(start, end) });
    }
  }
  return out;
}

/** Numbers and sizes are safe; so are fragments named …Html, which are checked themselves. */
const SAFE = /^(escapeHtml\(|sizeLabel\(|[\w.]+\.length$|(skipped|deleted|failed|done|count|total)$|\w+Html$)/;

test('every name or label in a confirm message is escaped', () => {
  const sources = messageSources();
  assert.ok(sources.length >= 8, `found ${sources.length} confirm messages`);
  for (const { where, code } of sources) {
    for (const template of templates(code)) {
      for (const expression of interpolations(template)) {
        assert.match(expression, SAFE, `${where} interpolates \${${expression}} without escapeHtml`);
      }
    }
    if (where.endsWith('Html =') && !templates(code).length) {
      assert.match(code, /escapeHtml/, `${where} builds HTML without escapeHtml`);
    }
  }
});

test('the confirms that name a file or folder escape exactly that name', () => {
  for (const expected of ['escapeHtml(asset.name)', 'escapeHtml(list[0].name)', 'escapeHtml(deletable[0].name)', 'escapeHtml(folder.name)', 'escapeHtml(parentName)']) {
    assert.ok(source.includes(expected), expected);
  }
});

test('no confirm offers a second Annuleren', () => {
  assert.doesNotMatch(source, /secondaryLabel\s*:\s*'Annuleren'/);
  assert.doesNotMatch(source, /secondaryLabel/);
});
