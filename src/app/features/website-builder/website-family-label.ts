import {
  LanguageCode,
  ProductFamily,
  ProductFamilyText,
} from '../../core/api/models';

/**
 * ProductFamily.name is a legacy/base field and can lag behind revisioned
 * localized public copy. Website management must therefore lead with the
 * requested localized title, then EN/NL, and only use the base field as a
 * clearly last-resort compatibility fallback.
 */
export function publicFamilyName(
  family: ProductFamily,
  requestedLanguage?: LanguageCode,
): string {
  for (const language of languagePriority(requestedLanguage)) {
    const name = family.texts?.find((text) => text.language === language)?.name?.trim();
    if (name) return name;
  }
  const translated = family.texts?.find((text) => !!text.name?.trim())?.name?.trim();
  return translated || family.name?.trim() || family.familyKey;
}

export function localizedFamilySource(
  family: ProductFamily,
  requestedLanguage?: LanguageCode,
): ProductFamilyText | null {
  const texts = family.texts ?? [];
  for (const language of languagePriority(requestedLanguage)) {
    const text = texts.find((candidate) => candidate.language === language);
    if (text && familyTextHasSource(text)) return text;
  }
  return texts.find(familyTextHasSource) ?? null;
}

function languagePriority(requestedLanguage?: LanguageCode): LanguageCode[] {
  return [...new Set([requestedLanguage, 'EN' as const, 'NL' as const]
    .filter((language): language is LanguageCode => !!language))];
}

function familyTextHasSource(text: ProductFamilyText): boolean {
  return !!text.name?.trim() || !!text.summary?.trim() || !!text.description?.trim()
    || !!text.format?.trim() || (text.highlights ?? []).some((item) => !!item.trim())
    || !!text.seoTitle?.trim() || !!text.seoDescription?.trim();
}
