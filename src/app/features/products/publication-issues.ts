/**
 * Publication blockers in plain words.
 *
 * The backend reports issues as keys such as
 * "website.families.<family>.variants.<variant>.fr.color"; one line per
 * language per field. Humans think per field: "Kleurnaam niet vertaald in
 * FR, DE, PL". This groups the keys that way and passes free-text issues
 * through untouched.
 */
const FIELD_LABEL: Record<string, string> = {
  name: 'Naam', color: 'Kleurnaam', description: 'Beschrijving',
  highlights: 'Highlights', seoTitle: 'SEO-titel', seoDescription: 'SEO-beschrijving',
  summary: 'Korte samenvatting', format: 'Formaat', alt: 'Foto-alt-tekst',
};

const PER_LANGUAGE_SIZE = /\.variants\.[^.]+\.[a-z]{2}\.size$/i;

/**
 * A per-language Maat key ("...variants.<variant>.fr.size"). The Maat is one
 * value for every language and is never translated; only a backend from
 * before 2026-09-28 still reports these keys.
 */
export function isPerLanguageSizeIssue(issue: string): boolean {
  return PER_LANGUAGE_SIZE.test(issue);
}

export function describePublicationIssues(
  issues: readonly string[],
  variantNames: Map<string, string> = new Map(),
): string[] {
  const grouped = new Map<string, Set<string>>();
  const sizes = new Map<string, Set<string>>();
  const plain: string[] = [];
  for (const issue of issues) {
    const variant = /\.variants\.([^.]+)\.([a-z]{2})\.(\w+)$/i.exec(issue);
    if (variant) {
      const [, key, lang, field] = variant;
      const name = variantNames.get(key) ?? `variant ${key}`;
      /* Never "nog niet vertaald": there is nothing to translate. */
      if (isPerLanguageSizeIssue(issue)) add(sizes, name, lang);
      else add(grouped, `${FIELD_LABEL[field] ?? field} van ${name}`, lang);
      continue;
    }
    const family = /\.([a-z]{2})\.(\w+)$/i.exec(issue);
    if (family && (issue.startsWith('website.') || issue.startsWith('catalog.'))) {
      const [, lang, field] = family;
      const where = issue.startsWith('catalog.') ? ' (catalogus)' : '';
      add(grouped, `${FIELD_LABEL[field] ?? field}${where}`, lang);
      continue;
    }
    plain.push(issue);
  }
  const lines = [...grouped.entries()].map(([label, langs]) =>
      `${label} nog niet vertaald in ${[...langs].join(', ')}`);
  const sizeLines = [...sizes.entries()].map(([name, langs]) =>
      `Maat van ${name} geldt voor alle talen en wordt niet vertaald; `
      + `een oudere server vraagt die nog in ${[...langs].join(', ')}`);
  return [...lines, ...sizeLines, ...plain];
}

function add(map: Map<string, Set<string>>, label: string, lang: string): void {
  const set = map.get(label) ?? new Set<string>();
  set.add(lang.toUpperCase());
  map.set(label, set);
}
