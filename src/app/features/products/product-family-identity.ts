import type {
  ProductFamily,
  ProductFamilyIdentityFinalization,
  ProductFamilyMember,
} from '../../core/api/models';

const TECHNICAL_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A local validation error that can be shown before an unsafe identity request is sent. */
export class ProductFamilyIdentityFinalizationError extends Error {
  readonly error: { message: string };

  constructor(message: string) {
    super(message);
    this.name = 'ProductFamilyIdentityFinalizationError';
    /* Keep local validation compatible with the shared HTTP-error presenter. */
    this.error = { message };
  }
}

/**
 * A saved series without a public URL can still choose its identity, once. That is an imported
 * concept series and also every series made by linking colours (the server creates those as
 * model-<id>-<id> without a URL). Pass the SAVED series, what the server has: with the draft,
 * the first typed character of the URL closed every field (2026-11-10).
 */
export function hasFinalizableDraftIdentity(saved: ProductFamily | null): boolean {
  return saved !== null && saved.id !== null && !clean(saved.publicHandle);
}

/**
 * Whether the identity fields take input. A new series (no id yet) chooses freely; a saved one
 * only while the server has no public URL for it. `draft` is what the form shows, `saved` what
 * the server has, so the answer changes on a save, never while someone types.
 */
export function canEditProductFamilyIdentity(
  draft: ProductFamily | null,
  saved: ProductFamily | null,
): boolean {
  if (draft === null) return false;
  if (draft.id === null) return true;
  return saved !== null && saved.id === draft.id && hasFinalizableDraftIdentity(saved);
}

/**
 * Creates the complete optimistic command expected by the backend. A null result means that the
 * missing imported identity was left untouched and an ordinary family update remains sufficient.
 */
export function planProductFamilyIdentityFinalization(
  previous: ProductFamily | null,
  desired: ProductFamily,
): ProductFamilyIdentityFinalization | null {
  if (!previous || !hasFinalizableDraftIdentity(previous)) return null;
  if (desired.id !== previous.id) {
    throw new ProductFamilyIdentityFinalizationError(
      'De productreeks is intussen gewijzigd. Herlaad de laatste gegevens en probeer opnieuw.',
    );
  }
  if (!identityWasEdited(previous, desired)) return null;

  const expectedFamilyKey = requiredTechnicalKey(
    previous.familyKey,
    'De bestaande vaste productreeks-sleutel',
  );
  const familyKey = requiredTechnicalKey(desired.familyKey, 'De vaste productreeks-sleutel');
  const publicHandle = requiredTechnicalKey(desired.publicHandle, 'De permanente publieke URL');

  if (!previous.members.length) {
    throw new ProductFamilyIdentityFinalizationError(
      "Deze productreeks heeft nog geen SKU's. Koppel eerst minstens één product.",
    );
  }

  const desiredByProductId = uniqueMembersByProductId(desired.members);
  const seenSkus = new Set<string>();
  const seenTargetKeys = new Set<string>();
  const variants = previous.members.map((member) => {
    const wanted = desiredByProductId.get(member.productId);
    if (!wanted) {
      throw new ProductFamilyIdentityFinalizationError(
        'De varianten van deze productreeks zijn gewijzigd. Herlaad de laatste gegevens.',
      );
    }
    const sku = clean(member.sku);
    if (!sku) {
      throw new ProductFamilyIdentityFinalizationError(
        `Product ${member.name || '#' + member.productId} heeft nog geen SKU.`,
      );
    }
    if (clean(wanted.sku) !== sku || seenSkus.has(sku)) {
      throw new ProductFamilyIdentityFinalizationError(
        'De SKU-lijst is gewijzigd of bevat dubbels. Herlaad de laatste gegevens.',
      );
    }
    seenSkus.add(sku);

    const expectedCanonicalVariantKey = optionalTechnicalKey(
      member.canonicalVariantKey,
      `De bestaande interne variantcode van SKU ${sku}`,
    );
    const canonicalVariantKey = requiredTechnicalKey(
      wanted.canonicalVariantKey,
      `De interne variantcode van SKU ${sku}`,
    );
    if (seenTargetKeys.has(canonicalVariantKey)) {
      throw new ProductFamilyIdentityFinalizationError(
        `De interne variantcode ${canonicalVariantKey} is meer dan één keer ingevuld.`,
      );
    }
    seenTargetKeys.add(canonicalVariantKey);
    return { sku, expectedCanonicalVariantKey, canonicalVariantKey };
  });

  if (desiredByProductId.size !== previous.members.length) {
    throw new ProductFamilyIdentityFinalizationError(
      'De varianten van deze productreeks zijn gewijzigd. Herlaad de laatste gegevens.',
    );
  }

  return { expectedFamilyKey, familyKey, publicHandle, variants };
}

function identityWasEdited(previous: ProductFamily, desired: ProductFamily): boolean {
  if (clean(previous.familyKey) !== clean(desired.familyKey)) return true;
  if (clean(previous.publicHandle) !== clean(desired.publicHandle)) return true;
  const desiredByProductId = new Map(
    desired.members.map((member) => [member.productId, member] as const),
  );
  return previous.members.some(
    (member) =>
      optional(member.canonicalVariantKey) !==
      optional(desiredByProductId.get(member.productId)?.canonicalVariantKey),
  );
}

function uniqueMembersByProductId(
  members: ProductFamilyMember[],
): Map<number, ProductFamilyMember> {
  const byId = new Map<number, ProductFamilyMember>();
  for (const member of members) {
    if (byId.has(member.productId)) {
      throw new ProductFamilyIdentityFinalizationError(
        'De productreeks bevat hetzelfde product meer dan één keer. Herlaad de laatste gegevens.',
      );
    }
    byId.set(member.productId, member);
  }
  return byId;
}

function requiredTechnicalKey(value: string | null | undefined, label: string): string {
  const key = clean(value);
  if (!key) throw new ProductFamilyIdentityFinalizationError(`${label} ontbreekt.`);
  if (!TECHNICAL_KEY.test(key)) {
    throw new ProductFamilyIdentityFinalizationError(
      `${label} mag alleen kleine letters, cijfers en koppeltekens bevatten.`,
    );
  }
  return key;
}

function optionalTechnicalKey(value: string | null | undefined, label: string): string | null {
  const key = optional(value);
  if (key !== null && !TECHNICAL_KEY.test(key)) {
    throw new ProductFamilyIdentityFinalizationError(
      `${label} mag alleen kleine letters, cijfers en koppeltekens bevatten.`,
    );
  }
  return key;
}

function optional(value: string | null | undefined): string | null {
  return clean(value) || null;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
}
