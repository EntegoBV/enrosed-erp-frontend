/*
 * A partner customer's company in one or two words, for a quiet label: "Frans
 * Verhoeven Bloemen BV" reads "Verhoeven" ("via Verhoeven", "Verhoeven 100 %").
 * The legal form and trade words go; a short rest stays whole, a long one
 * keeps its last word (the family name). Pure; the full name belongs in a title.
 */

const LEGAL = /^(b\.?v\.?b\.?a\.?|b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|c\.?v\.?|s\.?a\.?r\.?l\.?|s\.?a\.?|s\.?r\.?l\.?|gmbh|ltd|bvba|comm\.?v\.?|srl|sprl)\.?$/i;
const TRADE = new Set(['bloemen', 'bloemenhandel', 'bloemist', 'flowers', 'flower', 'fleurs', 'kwekerij', 'handel', 'tuincentrum', 'groothandel',
  'plants', 'planten', 'trading', '(test)', 'test']);

export function partnerShortName(company: string | null | undefined, fallback = 'de partner'): string {
  const words = (company ?? '').replace(/[,]/g, ' ').trim().split(/\s+/).filter(Boolean);
  let kept = words.filter((word) => !TRADE.has(word.toLowerCase()));
  while (kept.length > 1 && LEGAL.test(kept[kept.length - 1])) kept = kept.slice(0, -1);
  if (!kept.length) kept = words;
  const rest = kept.join(' ');
  if (!rest) return fallback;
  if (rest.length <= 12) return rest;
  const last = kept.at(-1) ?? rest;
  return last.length >= 4 ? last : rest.slice(0, 12).trim();
}
