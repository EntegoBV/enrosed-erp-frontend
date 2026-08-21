import {
  LANGUAGES,
  LanguageCode,
  Product,
  ProductFamily,
  ProductFamilyText,
  ProductText,
} from '../../core/api/models';

const LANGUAGE_ORDER: LanguageCode[] = ['NL', 'EN', 'FR', 'DE', 'ES', 'PL', 'PT', 'TR'];

export const TRANSLATION_LANGUAGES = LANGUAGE_ORDER.map((code) =>
  LANGUAGES.find((language) => language.code === code)!,
);

export interface TranslationGap {
  area: 'FAMILY' | 'VARIANT' | 'IMAGE';
  key: string;
  label: string;
}

export function familyText(family: ProductFamily, language: LanguageCode): ProductFamilyText {
  return family.texts.find((item) => item.language === language) ?? blankFamilyText(language);
}

export function productText(product: Product, language: LanguageCode): ProductText {
  const existing = product.texts.find((item) => item.language === language);
  return existing ? { ...blankProductText(language), ...existing } : blankProductText(language);
}

export function upsertFamilyText(
  family: ProductFamily,
  language: LanguageCode,
  changes: Partial<ProductFamilyText>,
): ProductFamily {
  const text = { ...familyText(family, language), ...changes, language };
  const texts = family.texts.some((item) => item.language === language)
    ? family.texts.map((item) => item.language === language ? text : item)
    : [...family.texts, text];
  return {
    ...family,
    texts,
    ...(language === 'EN'
      ? {
          name: text.name ?? '',
          summary: text.summary,
          description: text.description,
          format: text.format,
          highlights: text.highlights,
          seoTitle: text.seoTitle,
          seoDescription: text.seoDescription,
        }
      : {}),
  };
}

export function upsertProductText(
  product: Product,
  language: LanguageCode,
  changes: Partial<ProductText>,
): Product {
  const text = { ...productText(product, language), ...changes, language };
  const texts = product.texts.some((item) => item.language === language)
    ? product.texts.map((item) => item.language === language ? text : item)
    : [...product.texts, text];
  return { ...product, texts };
}

export function translationGaps(
  family: ProductFamily | null,
  product: Product,
  language: LanguageCode,
): TranslationGap[] {
  const variant = productText(product, language);
  const gaps: TranslationGap[] = [];

  if (family) {
    const shared = familyText(family, language);
    required(gaps, 'FAMILY', 'family-name', 'Naam', true, shared.name);
    required(gaps, 'FAMILY', 'family-summary', 'Samenvatting', familyUsesText(family, 'summary'), shared.summary);
    required(
      gaps,
      'FAMILY',
      'family-description',
      'Beschrijving',
      familyUsesText(family, 'description'),
      shared.description,
    );
    required(gaps, 'FAMILY', 'family-format', 'Formaat', familyUsesText(family, 'format'), shared.format);
    required(
      gaps,
      'FAMILY',
      'family-highlights',
      'Highlights',
      familyUsesHighlights(family),
      shared.highlights.join(' '),
    );
    required(
      gaps,
      'FAMILY',
      'family-seo-title',
      'SEO-titel of naam',
      true,
      shared.seoTitle || shared.name,
    );
    required(
      gaps,
      'FAMILY',
      'family-seo-description',
      'SEO-beschrijving of intro',
      true,
      shared.seoDescription || shared.summary || shared.description,
    );
  }

  required(gaps, 'VARIANT', 'variant-name', 'Variantnaam', productUsesText(product, 'name'), variant.name);
  required(gaps, 'VARIANT', 'variant-colour', 'Kleur', productUsesText(product, 'colour'), variant.colour);
  required(
    gaps,
    'VARIANT',
    'variant-size',
    'Maat',
    productUsesText(product, 'variantSize'),
    variant.variantSize,
  );
  required(
    gaps,
    'VARIANT',
    'variant-description',
    'Variantbeschrijving',
    productUsesText(product, 'description'),
    variant.description,
  );

  for (const [index, image] of (family?.images ?? []).entries()) {
    const alt = image.altTexts.find((item) => item.language === language)?.alt;
    required(gaps, 'IMAGE', `image-${image.id}`, `Fototekst ${index + 1}`, true, alt);
  }
  return gaps;
}

export function blankFamilyText(language: LanguageCode): ProductFamilyText {
  return {
    language,
    name: null,
    summary: null,
    description: null,
    format: null,
    highlights: [],
    seoTitle: null,
    seoDescription: null,
  };
}

export function blankProductText(language: LanguageCode): ProductText {
  return { language, name: null, description: null, colour: null, variantSize: null };
}

function required(
  gaps: TranslationGap[],
  area: TranslationGap['area'],
  key: string,
  label: string,
  applies: boolean,
  value: string | null | undefined,
): void {
  if (applies && !present(value)) gaps.push({ area, key, label });
}

function present(value: string | null | undefined): boolean {
  return !!value?.trim();
}

function familyUsesText(
  family: ProductFamily,
  field: 'summary' | 'description' | 'format',
): boolean {
  return present(family[field]) || family.texts.some((text) => present(text[field]));
}

function familyUsesHighlights(family: ProductFamily): boolean {
  return family.highlights.some(present)
    || family.texts.some((text) => text.highlights.some(present));
}

function productUsesText(
  product: Product,
  field: 'name' | 'description' | 'colour' | 'variantSize',
): boolean {
  return present(product[field]) || product.texts.some((text) => present(text[field]));
}
