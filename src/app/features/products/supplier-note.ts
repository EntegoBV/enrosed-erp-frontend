/**
 * The supplier note as the product pages and the PDF read it: a line that
 * starts with "-", "*" or "•" is a point, an indented one a sub-point,
 * anything else a paragraph.
 */
export interface NoteItem { text: string; children: string[]; }
export type NoteBlock = { kind: 'p'; text: string } | { kind: 'list'; items: NoteItem[] };

export function parseSupplierNote(note: string | null | undefined): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join('\n') });
    paragraph = [];
  };
  for (const raw of (note ?? '').split(/\r?\n/)) {
    const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(raw);
    if (bullet) {
      flush();
      const nested = bullet[1].replace(/\t/g, '  ').length >= 2;
      const last = blocks[blocks.length - 1];
      const list = last?.kind === 'list' ? last : (blocks.push({ kind: 'list', items: [] }), blocks[blocks.length - 1] as { kind: 'list'; items: NoteItem[] });
      const text = bullet[2].trim();
      if (nested && list.items.length) list.items[list.items.length - 1].children.push(text);
      else list.items.push({ text, children: [] });
      continue;
    }
    if (!raw.trim()) { flush(); continue; }
    paragraph.push(raw.trim());
  }
  flush();
  return blocks;
}

/** "see Reference 2" becomes a tappable reference when photo 2 exists. */
export function noteParts(text: string): { text: string; ref: number | null }[] {
  const parts: { text: string; ref: number | null }[] = [];
  const pattern = /\bReference\s+(\d+)\b/gi;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index), ref: null });
    parts.push({ text: match[0], ref: Number(match[1]) });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), ref: null });
  return parts;
}
