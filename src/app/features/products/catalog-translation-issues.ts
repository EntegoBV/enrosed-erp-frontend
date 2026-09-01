export type CatalogTranslationIssueKind =
  | 'CATALOG_COPY'
  | 'CATEGORY'
  | 'FAMILY'
  | 'PRODUCT'
  | 'UNKNOWN';

export interface CatalogIssueProduct {
  id: number | null;
  familyKey: string | null;
  categoryId: number | null;
  name: string;
}

export interface CatalogIssueCategory {
  id: number | null;
  code: string;
  name: string;
}

export interface CatalogTranslationLink {
  path: string;
  kind: CatalogTranslationIssueKind;
  entityLabel: string;
  fieldLabel: string;
  route: string | null;
  queryParams: Readonly<Record<string, string>>;
  /** Selected products that can remove this issue from the current export. */
  affectedProductIds: readonly number[];
}

interface ParsedIssue {
  path: string;
  kind: CatalogTranslationIssueKind;
  entityKey: string;
  field: string;
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'Naam',
  summary: 'Samenvatting',
  description: 'Beschrijving',
  format: 'Formaat',
  highlights: 'Highlights',
  color: 'Kleur',
  colour: 'Kleur',
  size: 'Maat',
  navigationName: 'Korte navigatienaam',
  mobileName: 'Mobiele naam',
  footerName: 'Naam in de footer',
  eyebrow: 'Bovenregel',
};

const FAMILY_FOCUS: Readonly<Record<string, string>> = {
  name: 'family-name',
  summary: 'family-summary',
  description: 'family-description',
  format: 'family-format',
  highlights: 'family-highlights',
};

const PRODUCT_FOCUS: Readonly<Record<string, string>> = {
  name: 'variant-name',
  description: 'variant-description',
  color: 'variant-colour',
  colour: 'variant-colour',
  size: 'variant-size',
};

/**
 * Turns the strict backend paths into human-readable links to the one editor
 * that owns the missing value. It deliberately stays Angular-free so every
 * supported path and fallback can be covered by the lightweight Node tests.
 */
export function catalogTranslationLinks(
  paths: readonly unknown[],
  language: string,
  products: readonly CatalogIssueProduct[],
  categories: readonly CatalogIssueCategory[],
  selectedProductIds: ReadonlySet<number> = new Set(),
): CatalogTranslationLink[] {
  const uniquePaths = [...new Set(paths
    .filter((path): path is string => typeof path === 'string')
    .map((path) => path.trim())
    .filter(Boolean))];

  return uniquePaths.map((path) => linkFor(
    parseCatalogTranslationIssue(path),
    language,
    products,
    categories,
    selectedProductIds,
  ));
}

/** Deduplicate every selected product that can be removed to clear an issue. */
export function catalogTranslationAffectedProductIds(
  issues: readonly CatalogTranslationLink[],
): Set<number> {
  return new Set(issues.flatMap((issue) => issue.affectedProductIds));
}

function parseCatalogTranslationIssue(path: string): ParsedIssue {
  const catalogCopy = /^catalog\.copy\.(.+)$/.exec(path);
  if (catalogCopy) {
    return { path, kind: 'CATALOG_COPY', entityKey: catalogCopy[1], field: 'value' };
  }

  const category = /^categories\.([^.]+)\.(.+)$/.exec(path);
  if (category) {
    return { path, kind: 'CATEGORY', entityKey: category[1], field: category[2] };
  }

  const family = /^families\.([^.]+)\.(.+)$/.exec(path);
  if (family) {
    return { path, kind: 'FAMILY', entityKey: family[1], field: family[2] };
  }

  const product = /^products\.(\d+)\.(.+)$/.exec(path);
  if (product) {
    return { path, kind: 'PRODUCT', entityKey: product[1], field: product[2] };
  }

  return { path, kind: 'UNKNOWN', entityKey: path, field: '' };
}

function linkFor(
  issue: ParsedIssue,
  language: string,
  products: readonly CatalogIssueProduct[],
  categories: readonly CatalogIssueCategory[],
  selectedProductIds: ReadonlySet<number>,
): CatalogTranslationLink {
  const common = { language, returnTo: '/catalog-export' };

  if (issue.kind === 'CATALOG_COPY') {
    return {
      path: issue.path,
      kind: issue.kind,
      entityLabel: `Catalogustekst · ${humanize(issue.entityKey)}`,
      fieldLabel: 'Tekst invullen',
      route: '/catalog/texts',
      queryParams: { ...common, key: issue.entityKey },
      affectedProductIds: [],
    };
  }

  if (issue.kind === 'CATEGORY') {
    const category = categories.find((candidate) => candidate.code === issue.entityKey);
    return {
      path: issue.path,
      kind: issue.kind,
      entityLabel: `Categorie · ${category?.name || humanize(issue.entityKey)}`,
      fieldLabel: fieldLabel(issue.field),
      route: '/settings',
      queryParams: {
        ...common,
        sectie: 'categories',
        category: issue.entityKey,
        focus: categoryFocus(issue.field),
      },
      affectedProductIds: affectedProductIdsFor(products, selectedProductIds, (product) =>
        category?.id !== null
        && category?.id !== undefined
        && product.categoryId === category.id),
    };
  }

  if (issue.kind === 'FAMILY') {
    const familyProducts = products.filter((product) =>
      product.id !== null && product.familyKey === issue.entityKey);
    const product = familyProducts.find((candidate) =>
      candidate.id !== null && selectedProductIds.has(candidate.id)) ?? familyProducts[0];
    return {
      path: issue.path,
      kind: issue.kind,
      entityLabel: `Productreeks · ${product?.name || humanize(issue.entityKey)}`,
      fieldLabel: fieldLabel(issue.field),
      route: product?.id === null || product?.id === undefined
        ? null : `/products/${product.id}/translations`,
      queryParams: { ...common, focus: familyFocus(issue.field) },
      affectedProductIds: affectedProductIdsFor(familyProducts, selectedProductIds),
    };
  }

  if (issue.kind === 'PRODUCT') {
    const productId = Number(issue.entityKey);
    const product = products.find((candidate) => candidate.id === productId);
    return {
      path: issue.path,
      kind: issue.kind,
      entityLabel: `Product · ${product?.name || `#${productId}`}`,
      fieldLabel: fieldLabel(issue.field),
      route: `/products/${productId}/translations`,
      queryParams: { ...common, focus: productFocus(issue.field) },
      affectedProductIds: affectedProductIdsFor(products, selectedProductIds, (candidate) =>
        candidate.id === productId),
    };
  }

  return {
    path: issue.path,
    kind: issue.kind,
    entityLabel: 'Onbekende vertaallokatie',
    fieldLabel: issue.path,
    route: null,
    queryParams: common,
    affectedProductIds: [],
  };
}

function affectedProductIdsFor(
  products: readonly CatalogIssueProduct[],
  selected: ReadonlySet<number>,
  include: (product: CatalogIssueProduct) => boolean = () => true,
): number[] {
  return products.flatMap((product) =>
    product.id !== null && selected.has(product.id) && include(product) ? [product.id] : []);
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? humanize(field);
}

function familyFocus(field: string): string {
  return FAMILY_FOCUS[field] ?? `family-${slug(field)}`;
}

function productFocus(field: string): string {
  return PRODUCT_FOCUS[field] ?? `variant-${slug(field)}`;
}

function categoryFocus(field: string): string {
  return `category-${slug(field)}`;
}

function humanize(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[._:/-]+/)
    .filter(Boolean)
    .join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Tekst';
}

function slug(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
