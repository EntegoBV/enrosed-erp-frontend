import type { Category, LanguageCode, ProductFamily } from '../../core/api/models';

/**
 * How Categorieën (/website/categories) reads, checks and writes a category:
 * the code rules, the menu names on one line, the reeksen per category, the
 * order moves, the address of a deep link and the payload of a save. The
 * rules are the ones of the settings page's category section (settings-page.ts),
 * copied by name so a later merge into one shared form stays mechanical.
 * Pure and import-free at runtime (node-tested).
 */

/** Category codes are public URL keys: lower case, digits and single dashes. */
export const CATEGORY_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The fields a deep link may focus (`?focus=`), the ids of the translation editor's inputs. */
export const CATEGORY_TRANSLATION_FOCUS: readonly string[] = [
  'category-name',
  'category-navigation-name',
  'category-mobile-name',
  'category-footer-name',
  'category-eyebrow',
  'category-description',
];

/** One canonical form everywhere: accents off, lower case, dashes between words. */
export function normalizeCategoryCode(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function categoryCodeValid(code: string): boolean {
  return CATEGORY_CODE_PATTERN.test(normalizeCategoryCode(code));
}

/** Another category already uses this code (after normalising both). */
export function categoryCodeTaken(categories: readonly Category[], draft: Pick<Category, 'id' | 'code'>): boolean {
  const code = normalizeCategoryCode(draft.code);
  if (!code) return false;
  return categories.some((category) => category.id !== draft.id && normalizeCategoryCode(category.code) === code);
}

export function categoryDraftValid(categories: readonly Category[], draft: Category | null): boolean {
  return !!draft?.name.trim() && categoryCodeValid(draft.code)
    && Number.isFinite(draft.position) && draft.position >= 0
    && !categoryCodeTaken(categories, draft);
}

/** The form's copy of a stored category: optional names as null, texts complete. */
export function categoryEditDraft(category: Category): Category {
  return {
    ...category,
    revision: category.revision ?? null,
    navigationName: category.navigationName ?? null,
    footerName: category.footerName ?? null,
    texts: (category.texts ?? []).map((text) => ({
      ...text,
      navigationName: text.navigationName ?? null,
      footerName: text.footerName ?? null,
    })),
  };
}

/** A new category goes after the last one. */
export function blankCategoryDraft(categories: readonly Category[]): Category {
  return {
    id: null,
    revision: null,
    code: '',
    name: '',
    navigationName: null,
    footerName: null,
    mobileName: null,
    eyebrow: null,
    description: '',
    texts: [],
    position: Math.max(0, ...categories.map((category) => category.position)) + 1,
    featuredProductId: null,
  };
}

/** What a list answer looks like after loading: revision and texts always present. */
export function normalizeCategory(category: Category): Category {
  return { ...category, revision: category.revision ?? null, texts: category.texts ?? [] };
}

/** The body of a save: trimmed, empty optional names as null, the code in its canonical form. */
export function categorySavePayload(draft: Category): Category {
  return {
    ...draft,
    code: normalizeCategoryCode(draft.code),
    name: draft.name.trim(),
    navigationName: draft.navigationName?.trim() || null,
    footerName: draft.footerName?.trim() || null,
    mobileName: draft.mobileName?.trim() || null,
    eyebrow: draft.eyebrow?.trim() || null,
    description: draft.description?.trim() || '',
    texts: (draft.texts ?? []).map((text) => ({
      ...text,
      name: text.name?.trim() || null,
      navigationName: text.navigationName?.trim() || null,
      footerName: text.footerName?.trim() || null,
      description: text.description?.trim() || null,
      eyebrow: text.eyebrow?.trim() || null,
      mobileName: text.mobileName?.trim() || null,
    })),
    position: Math.round(draft.position),
    featuredProductId: draft.featuredProductId ?? null,
  };
}

/** The saved category in the list, the list in its order (position, then name). */
export function mergeSavedCategory(categories: readonly Category[], saved: Category, created: boolean): Category[] {
  const next = created
    ? [...categories, saved]
    : categories.map((category) => category.id === saved.id ? saved : category);
  return next.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, 'nl'));
}

/**
 * The whole order after one step of one category, as the reorder call wants
 * it (one call writes every position); null when the step is not possible.
 */
export function movedCategoryIds(categories: readonly Category[], id: number, direction: -1 | 1): number[] | null {
  const ids = categories.map((category) => category.id).filter((value): value is number => value !== null);
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

/** The website menu names of a category on one line: desktop „…” · mobiel „…” · footer „…” · bovenregel „…”. */
export function categoryMenuLine(category: Category): string {
  const parts = [
    category.navigationName?.trim() ? `desktop „${category.navigationName.trim()}”` : null,
    category.mobileName?.trim() ? `mobiel „${category.mobileName.trim()}”` : null,
    category.footerName?.trim() ? `footer „${category.footerName.trim()}”` : null,
    category.eyebrow?.trim() ? `bovenregel „${category.eyebrow.trim()}”` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(' · ');
}

/**
 * The text of the chosen "Uitgelicht product" option, in the order the select
 * lists them: a product label (name · kleur — SKU) is wider than the desk
 * inspector, so the select carries it in full as its title. '' when nothing
 * the select shows matches.
 */
export function featuredChoiceText(
  choices: readonly { id: number; label: string }[],
  featuredProductId: number | null,
  dependencyMissing: boolean,
  missingFeaturedId: number | null,
): string {
  if (featuredProductId === null) return 'Geen uitgelicht product';
  const choice = choices.find((item) => item.id === featuredProductId);
  if (choice) return choice.label;
  if (dependencyMissing) return `Huidige keuze #${featuredProductId} · productgegevens niet geladen`;
  return missingFeaturedId === featuredProductId ? `Product #${featuredProductId} · geen publieke foto` : '';
}

/** Reeksen of this category: by category id where the reeks has one, else by name. */
export function categoryReeksCount(category: Category, families: readonly ProductFamily[]): number {
  const name = category.name.trim().toLocaleLowerCase('nl');
  return families.filter((family) => family.categoryId !== null && category.id !== null
    ? family.categoryId === category.id
    : !!name && (family.categoryName ?? '').trim().toLocaleLowerCase('nl') === name).length;
}

/** "1 reeks", "3 reeksen": real plurals. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The phone row: "{n} reeksen · {x}/9 talen · {mobiele naam}". */
export function categoryPhoneLine(reeksen: number, complete: number, total: number, mobileName: string | null): string {
  return [plural(reeksen, 'reeks', 'reeksen'), `${complete}/${total} talen`, mobileName?.trim() || null]
    .filter((part): part is string => !!part)
    .join(' · ');
}

export interface CategoryDeepLink {
  /** The category to open: `?code=` (Te doen) or `?category=` (older links and Instellingen). */
  code: string | null;
  language: LanguageCode;
  focus: string | null;
}

/** Reads `?code=` / `?category=`, `?language=` and `?focus=`; anything unknown falls back. */
export function categoryDeepLink(
  params: { code?: string | null; category?: string | null; language?: string | null; focus?: string | null },
  languages: readonly LanguageCode[],
): CategoryDeepLink {
  const code = (params.code ?? '').trim() || (params.category ?? '').trim() || null;
  const requested = params.language?.trim().toUpperCase() ?? '';
  const language = (languages as readonly string[]).includes(requested) ? requested as LanguageCode : 'NL';
  const focus = params.focus && CATEGORY_TRANSLATION_FOCUS.includes(params.focus) ? params.focus : null;
  return { code, language, focus };
}

/** The address of a deep-linked category, compared in the canonical form (`?code=Rose Dome` finds rose-dome). */
export function findCategoryByCode(categories: readonly Category[], code: string | null): Category | null {
  if (!code) return null;
  const wanted = normalizeCategoryCode(code);
  return categories.find((category) => category.code === code || normalizeCategoryCode(category.code) === wanted) ?? null;
}
