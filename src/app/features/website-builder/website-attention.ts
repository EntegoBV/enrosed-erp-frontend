import type {
  Category,
  ContentTranslationGroup,
  LanguageCode,
  ProductFamily,
} from '../../core/api/models';

/**
 * What a public product reeks, a category or a website text still needs,
 * in one rule for every screen of Website beheren: the side and tab counts,
 * the Overzicht "Te doen" list, the Producten Aandacht groups and the SEO
 * score all read from here, so they cannot disagree.
 *
 * Rule 2 ("Nog niet publicatieklaar": active with publication points) is
 * exactly the dashboard's rule (dashboard/home-data.ts), so the home's
 * "7 producten niet publicatieklaar" equals this group's count.
 *
 * Pure and import-free at runtime (node-tested): the public family name and
 * the per-language Maat check are handed in by the caller.
 */

/** TRANSLATION_LANGUAGES order (products/product-translation-adapter.ts), kept here as plain codes. */
export const WEBSITE_LANGUAGE_ORDER: readonly LanguageCode[] = ['NL', 'EN', 'FR', 'DE', 'ES', 'PL', 'PT', 'TR', 'EL'];

export type WebsiteAttention = 'inactive-live' | 'issues' | 'ready' | 'incomplete';
export type WebsiteStatusWord = 'Live' | 'Concept' | 'Verborgen' | 'Niet actief in ERP';

/** Aandacht groups in this order: what blocks the website first. */
export const ATTENTION_ORDER: readonly WebsiteAttention[] = ['inactive-live', 'issues', 'ready', 'incomplete'];

const ATTENTION_HEADINGS: Record<WebsiteAttention, string> = {
  'inactive-live': 'Live, maar niet actief in ERP',
  issues: 'Nog niet publicatieklaar',
  ready: 'Klaar om live te zetten',
  incomplete: 'Live, teksten onvolledig',
};

export function attentionHeading(reason: WebsiteAttention): string {
  return ATTENTION_HEADINGS[reason];
}

export interface FamilyCompleteness {
  /** Languages with a public name and description ("Familietekst"). */
  text: number;
  /** Languages with an SEO title and description. */
  seo: number;
  missingName: LanguageCode[];
  missingDescription: LanguageCode[];
  missingText: LanguageCode[];
  missingSeo: LanguageCode[];
}

function filled(value: string | null | undefined): boolean {
  return !!value?.trim();
}

export function familyCompleteness(family: ProductFamily, codes: readonly LanguageCode[]): FamilyCompleteness {
  const textOf = (code: LanguageCode) => family.texts?.find((text) => text.language === code);
  const missingName = codes.filter((code) => !filled(textOf(code)?.name));
  const missingDescription = codes.filter((code) => !filled(textOf(code)?.description));
  const missingText = codes.filter((code) => !filled(textOf(code)?.name) || !filled(textOf(code)?.description));
  const missingSeo = codes.filter((code) => !filled(textOf(code)?.seoTitle) || !filled(textOf(code)?.seoDescription));
  return {
    text: codes.length - missingText.length,
    seo: codes.length - missingSeo.length,
    missingName, missingDescription, missingText, missingSeo,
  };
}

/** Why a reeks needs attention on the website, or null when it is live and complete (or simply not in use). */
export function websiteAttention(
  family: ProductFamily,
  completeness: Pick<FamilyCompleteness, 'text' | 'seo'>,
  languageCount: number,
): WebsiteAttention | null {
  const live = family.websiteStatus === 'PUBLISHED';
  if (!family.active && live) return 'inactive-live';
  if (!family.active) return null;
  if ((family.publicationIssues?.length ?? 0) > 0) return 'issues';
  if (!live) return 'ready';
  if (completeness.text < languageCount || completeness.seo < languageCount) return 'incomplete';
  return null;
}

/** One word per state (design §1): Live · Concept · Verborgen · Niet actief in ERP. */
export function websiteStatusWord(family: ProductFamily): WebsiteStatusWord {
  if (!family.active) return 'Niet actief in ERP';
  if (family.websiteStatus === 'PUBLISHED') return 'Live';
  return family.websiteStatus === 'READY' ? 'Verborgen' : 'Concept';
}

/** The variant whose product editor holds this reeks' texts, or null. */
export function familyProductId(family: ProductFamily): number | null {
  return family.members?.find((member) => member.active)?.productId
    ?? family.members?.[0]?.productId
    ?? null;
}

/**
 * Variant texts or photo alt texts that the publication check reports per
 * language. A per-language Maat (older backend) is not a translation task:
 * the caller hands in isPerLanguageSizeIssue (products/publication-issues.ts).
 */
export function detailTranslationLanguages(
  family: ProductFamily,
  codes: readonly LanguageCode[],
  isSizeIssue: (issue: string) => boolean,
): LanguageCode[] {
  const detailIssues = (family.publicationIssues ?? []).filter((issue) =>
    /\.variants\.|(?:image|photo|foto).*alt|alt(?:text)?/i.test(issue) && !isSizeIssue(issue));
  return codes.filter((code) => {
    const pattern = new RegExp(`(^|[._:/-])${code}([._:/-]|$)`, 'i');
    return detailIssues.some((issue) => pattern.test(issue));
  });
}

/* ---- SEO */

export interface SeoAttention {
  englishTitle: string | null;
  missingLanguages: LanguageCode[];
  /** The English SEO title reads as Dutch: check it by hand. */
  suspiciousEnglish: boolean;
  attention: boolean;
}

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** A heuristic, never a block: strong Dutch words, or two common Dutch function words. */
export function looksDutch(value: string | null): boolean {
  if (!value) return false;
  const text = normalized(value);
  const strongDutch = /\b(?:glazen|roos|rozen|bloemen|steelrozen|zeep|geschenk|bewaard|gepreserveerd\w*|geconserveerd\w*|droogbloemen|stolp|spiegeldoos|hartvorm\w*|vensterdoos|diamantroos|soaproos)\b/;
  if (strongDutch.test(text)) return true;
  const padded = ` ${text} `;
  return [' de ', ' het ', ' een ', ' voor ', ' met ', ' van ', ' en '].filter((token) => padded.includes(token)).length >= 2;
}

export function seoAttention(family: ProductFamily, codes: readonly LanguageCode[]): SeoAttention {
  const englishTitle = family.texts?.find((text) => text.language === 'EN')?.seoTitle?.trim() || null;
  const missingLanguages = familyCompleteness(family, codes).missingSeo;
  const suspiciousEnglish = looksDutch(englishTitle);
  return { englishTitle, missingLanguages, suspiciousEnglish, attention: suspiciousEnglish || missingLanguages.length > 0 };
}

/* ---- categories */

type CategoryField = 'navigationName' | 'footerName' | 'mobileName' | 'eyebrow' | 'description';
const CATEGORY_FIELDS: readonly CategoryField[] = ['navigationName', 'footerName', 'mobileName', 'eyebrow', 'description'];

/** A menu field counts once any language (or the base field) uses it. */
function categoryFieldUsed(category: Category, field: CategoryField): boolean {
  return filled(category[field]) || (category.texts ?? []).some((text) => filled(text[field]));
}

/** Languages in which the category name or one of its used menu fields is empty. */
export function categoryMissingLanguages(category: Category, codes: readonly LanguageCode[]): LanguageCode[] {
  const used = CATEGORY_FIELDS.filter((field) => categoryFieldUsed(category, field));
  return codes.filter((code) => {
    const text = category.texts?.find((item) => item.language === code);
    return !filled(text?.name) || used.some((field) => !filled(text?.[field]));
  });
}

/* ---- Te doen */

export type WebsiteTodoKind = 'reeks' | 'categorie' | 'tekst';
export type WebsiteTodoSection = 'inactive' | 'publish' | 'live' | 'translate';

/** Te doen in the order of Producten's Aandacht groups; "Nog niet publicatieklaar" counts what the dashboard counts. */
export const TODO_SECTION_ORDER: readonly WebsiteTodoSection[] = ['inactive', 'publish', 'live', 'translate'];
const TODO_SECTION_HEADINGS: Record<WebsiteTodoSection, string> = {
  inactive: 'Live, maar niet actief in ERP',
  publish: 'Nog niet publicatieklaar',
  live: 'Klaar om live te zetten',
  translate: 'Vertalen',
};

export function todoSectionHeading(section: WebsiteTodoSection): string {
  return TODO_SECTION_HEADINGS[section];
}

export interface WebsiteTodo {
  key: string;
  kind: WebsiteTodoKind;
  section: WebsiteTodoSection;
  title: string;
  detail: string;
  /** In WEBSITE_LANGUAGE_ORDER. */
  missingLanguages: LanguageCode[];
  link: string | readonly (string | number)[];
  query?: Record<string, string>;
  /** Sort keys: live reeksen first, then most publication points. */
  live: boolean;
  points: number;
}

export interface WebsiteTodoInput {
  families: readonly ProductFamily[];
  categories: readonly Category[];
  groups: readonly ContentTranslationGroup[];
  codes?: readonly LanguageCode[];
  /** publicFamilyName (website-family-label.ts), handed in. */
  familyName: (family: ProductFamily) => string;
  /** isPerLanguageSizeIssue (products/publication-issues.ts), handed in. */
  isSizeIssue: (issue: string) => boolean;
}

/** "1 publicatiepunt", "2 publicatiepunten": real plurals, never "(en)". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} en ${words[words.length - 1]}`;
}

function ordered(codes: readonly LanguageCode[], sets: readonly (readonly LanguageCode[])[]): LanguageCode[] {
  const wanted = new Set(sets.flat());
  return codes.filter((code) => wanted.has(code));
}

function reeksLink(family: ProductFamily): { link: string; query?: Record<string, string> } {
  return family.id === null ? { link: '/website/products' } : { link: '/website/products', query: { reeks: String(family.id) } };
}

/**
 * The Te doen rows: one per reeks, category or required text group (never
 * one per missing field), sorted inactive → publish → live → translate, then live
 * reeksen first, most points, name.
 */
export function websiteTodos(input: WebsiteTodoInput): WebsiteTodo[] {
  const codes = input.codes ?? WEBSITE_LANGUAGE_ORDER;
  const rows: WebsiteTodo[] = [];

  for (const family of input.families) {
    const completeness = familyCompleteness(family, codes);
    const reason = websiteAttention(family, completeness, codes.length);
    if (!reason) continue;
    const title = input.familyName(family) || 'Productreeks zonder publieke naam';
    const key = `reeks-${family.id ?? family.familyKey}`;
    const live = family.websiteStatus === 'PUBLISHED';
    const points = family.publicationIssues?.length ?? 0;
    const details = detailTranslationLanguages(family, codes, input.isSizeIssue);
    const missingLanguages = ordered(codes, [completeness.missingText, completeness.missingSeo, details]);

    if (reason === 'inactive-live') {
      rows.push({ key, kind: 'reeks', section: 'inactive', title, detail: 'Niet actief in het ERP; je kunt ze nog van de website halen',
        missingLanguages: [], ...reeksLink(family), live, points });
    } else if (reason === 'issues') {
      const parts = [plural(points, 'publicatiepunt', 'publicatiepunten')];
      if (family.variantCount === 0) parts.push('nog geen varianten gekoppeld');
      const what = [
        completeness.missingName.length ? 'naam' : null,
        completeness.missingDescription.length ? 'beschrijving' : null,
        completeness.missingSeo.length ? 'SEO' : null,
        details.length ? 'details' : null,
      ].filter((word): word is string => word !== null);
      if (what.length) parts.push(`${joinWords(what)} ${what.length === 1 ? 'ontbreekt' : 'ontbreken'}`);
      rows.push({ key, kind: 'reeks', section: 'publish', title, detail: parts.join(' · '),
        missingLanguages, ...reeksLink(family), live, points });
    } else if (reason === 'ready') {
      const gaps = [
        completeness.text < codes.length ? `Tekst ${completeness.text}/${codes.length}` : null,
        completeness.seo < codes.length ? `SEO ${completeness.seo}/${codes.length}` : null,
      ].filter((word): word is string => word !== null);
      const detail = gaps.length
        ? ['Klaar om live te zetten', ...gaps].join(' · ')
        : `Alles compleet · staat nog op ${websiteStatusWord(family)}`;
      rows.push({ key, kind: 'reeks', section: 'live', title, detail, missingLanguages, ...reeksLink(family), live, points });
    } else {
      const productId = familyProductId(family);
      const what = [
        completeness.missingText.length ? 'Tekst' : null,
        completeness.missingSeo.length ? 'SEO' : null,
        details.length ? 'Details' : null,
      ].filter((word): word is string => word !== null);
      rows.push({ key, kind: 'reeks', section: 'translate', title, detail: what.join(' · '), missingLanguages,
        ...(productId === null ? reeksLink(family) : { link: ['/products', productId, 'translations'] }), live, points });
    }
  }

  for (const category of input.categories) {
    const missingLanguages = categoryMissingLanguages(category, codes);
    if (!missingLanguages.length) continue;
    rows.push({ key: `categorie-${category.id ?? category.code}`, kind: 'categorie', section: 'translate',
      title: category.name || 'Categorie zonder naam', detail: 'Categorienaam of menunamen', missingLanguages,
      link: '/website/categories', query: { code: category.code }, live: false, points: 0 });
  }

  for (const group of input.groups) {
    if (!group.required || !group.missingLanguages?.length) continue;
    rows.push({ key: `tekst-${group.key}`, kind: 'tekst', section: 'translate', title: group.label,
      detail: 'Verplichte websitetekst', missingLanguages: ordered(codes, [group.missingLanguages]),
      link: '/website/texts', query: { key: group.key }, live: false, points: 0 });
  }

  const kindOrder: Record<WebsiteTodoKind, number> = { reeks: 0, categorie: 1, tekst: 2 };
  return rows.sort((left, right) =>
    TODO_SECTION_ORDER.indexOf(left.section) - TODO_SECTION_ORDER.indexOf(right.section)
    || kindOrder[left.kind] - kindOrder[right.kind]
    || Number(right.live) - Number(left.live)
    || right.points - left.points
    || left.title.localeCompare(right.title, 'nl'));
}

/* ---- counts for the side, the tab bar and the Overzicht */

export interface WebsiteCounts {
  families: number;
  live: number;
  concept: number;
  hidden: number;
  /** Aandacht = every reeks with a reason. */
  attention: number;
  /** "Nog niet publicatieklaar": the dashboard's number. */
  notReady: number;
  byReason: Record<WebsiteAttention, number>;
  categoriesMissing: number;
  /** Empty required language fields over all website text groups. */
  textsMissing: number;
  textGroups: number;
  /** Required fields filled, as a whole percentage. */
  textsPercent: number;
  /** Active reeksen without an SEO point, of all active reeksen. */
  seoOk: number;
  seoTotal: number;
  /** Live reeksen with an SEO point (the side's SEO count), and how many are live and active. */
  seoLiveAttention: number;
  seoLiveTotal: number;
}

export function websiteCounts(input: {
  families: readonly ProductFamily[] | null;
  categories: readonly Category[] | null;
  groups: readonly ContentTranslationGroup[] | null;
  codes?: readonly LanguageCode[];
}): WebsiteCounts {
  const codes = input.codes ?? WEBSITE_LANGUAGE_ORDER;
  const families = input.families ?? [];
  const byReason: Record<WebsiteAttention, number> = { 'inactive-live': 0, issues: 0, ready: 0, incomplete: 0 };
  let seoOk = 0;
  let seoTotal = 0;
  let seoLiveAttention = 0;
  let seoLiveTotal = 0;
  for (const family of families) {
    const reason = websiteAttention(family, familyCompleteness(family, codes), codes.length);
    if (reason) byReason[reason]++;
    if (!family.active) continue;
    const seo = seoAttention(family, codes);
    seoTotal++;
    if (!seo.attention) seoOk++;
    if (family.websiteStatus === 'PUBLISHED') {
      seoLiveTotal++;
      if (seo.attention) seoLiveAttention++;
    }
  }
  const required = (input.groups ?? []).filter((group) => group.required);
  const textsMissing = required.reduce((total, group) => total + (group.missingLanguages?.length ?? 0), 0);
  const fields = required.length * codes.length;
  const textsPercent = fields ? Math.floor(((fields - textsMissing) / fields) * 100) : 100;
  return {
    families: families.length,
    live: families.filter((family) => family.websiteStatus === 'PUBLISHED').length,
    concept: families.filter((family) => family.websiteStatus === 'DRAFT').length,
    hidden: families.filter((family) => family.websiteStatus === 'READY').length,
    attention: ATTENTION_ORDER.reduce((total, reason) => total + byReason[reason], 0),
    notReady: byReason.issues,
    byReason,
    categoriesMissing: (input.categories ?? []).filter((category) => categoryMissingLanguages(category, codes).length > 0).length,
    textsMissing,
    textGroups: (input.groups ?? []).length,
    textsPercent,
    seoOk, seoTotal, seoLiveAttention, seoLiveTotal,
  };
}

/** Required fields still empty per language, in WEBSITE_LANGUAGE_ORDER, only the languages that miss something. */
export function missingPerLanguage(
  groups: readonly ContentTranslationGroup[],
  codes: readonly LanguageCode[] = WEBSITE_LANGUAGE_ORDER,
): { code: LanguageCode; missing: number }[] {
  return codes
    .map((code) => ({ code, missing: groups.filter((group) => group.required && group.missingLanguages?.includes(code)).length }))
    .filter((row) => row.missing > 0);
}
