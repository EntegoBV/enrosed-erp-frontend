import type {
  ProductFamily,
  ProductFamilyIdentityFinalization,
  ProductFamilyMember,
} from '../../core/api/models';

const TECHNICAL_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Codes of the old webshop; the server takes no new one (ProductValidator.validateCanonicalVariantKey). */
const RETIRED_VARIANT_KEY_PREFIX = 'shopify-';

/** The heading of the section "Vaste koppeling & URL": where a refusal without a field of its own lands. */
export const IDENTITY_SECTION_ID = 'publication-identity-title';
export const IDENTITY_KEY_FIELD_ID = 'publication-family-key';
export const IDENTITY_URL_FIELD_ID = 'publication-public-handle';

/** The id of the code input of one variant in the list "Interne variantcodes". */
export function identityVariantFieldId(productId: number): string {
  return `publication-variant-key-${productId}`;
}

/** A local validation error that can be shown before an unsafe identity request is sent. */
export class ProductFamilyIdentityFinalizationError extends Error {
  readonly error: { message: string };
  /**
   * The element the editor jumps to: the input a person can act on, or the section heading. Null
   * when there is nothing to do in this form (stale data that needs a reload, or a save that
   * already made the identity final).
   */
  readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super(message);
    this.name = 'ProductFamilyIdentityFinalizationError';
    /* Keep local validation compatible with the shared HTTP-error presenter. */
    this.error = { message };
    this.field = field;
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
  const familyKey = requiredTechnicalKey(
    desired.familyKey,
    'De vaste productreeks-sleutel',
    IDENTITY_KEY_FIELD_ID,
  );
  const publicHandle = requiredTechnicalKey(
    desired.publicHandle,
    'De permanente publieke URL',
    IDENTITY_URL_FIELD_ID,
  );

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
    const field = identityVariantFieldId(member.productId);
    const canonicalVariantKey = requiredTechnicalKey(
      wanted.canonicalVariantKey,
      `De interne variantcode van SKU ${sku}`,
      field,
    );
    /* The server refuses these with "herlaad het product", which helps nobody in this form. */
    if (canonicalVariantKey.startsWith(RETIRED_VARIANT_KEY_PREFIX)) {
      throw new ProductFamilyIdentityFinalizationError(
        `De interne variantcode van SKU ${sku} mag niet met ${RETIRED_VARIANT_KEY_PREFIX} beginnen.`,
        field,
      );
    }
    if (seenTargetKeys.has(canonicalVariantKey)) {
      throw new ProductFamilyIdentityFinalizationError(
        `De interne variantcode ${canonicalVariantKey} is meer dan één keer ingevuld.`,
        field,
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

/** The server's words for the three identity values, and the form's label and input for each. */
const SERVER_SUBJECTS: readonly (readonly [RegExp, string, string])[] = [
  [/^Publieke handle\b/, 'De permanente publieke URL', IDENTITY_URL_FIELD_ID],
  [/^(?:Nieuwe familiecode|Familiecode)\b/, 'De vaste productreeks-sleutel', IDENTITY_KEY_FIELD_ID],
  [/^Canonieke variantcode\b/, 'De interne variantcode', IDENTITY_SECTION_ID],
];

/**
 * The server refused the one-time identity (nothing was changed). It names the values
 * "Publieke handle", "Familiecode" and "Canonieke variantcode"; the refusal is put in the
 * labels of the form and points at that field, so it reads like the local checks above. Any
 * other refusal keeps its text and points at the section.
 */
export function identityRefusedByServer(
  reason: string,
  desired: ProductFamily,
): ProductFamilyIdentityFinalizationError {
  for (const [subject, label, field] of SERVER_SUBJECTS) {
    if (!subject.test(reason)) continue;
    const rest = reason.replace(subject, '');
    /* "Canonieke variantcode <code> bestaat al": the row that holds that code. */
    const code = field === IDENTITY_SECTION_ID ? /^ (\S+) /.exec(rest)?.[1] : undefined;
    const member = code
      ? desired.members.find((item) => clean(item.canonicalVariantKey) === code)
      : undefined;
    return new ProductFamilyIdentityFinalizationError(
      `${label}${rest}${/[.!?]$/.test(rest) ? '' : '.'}`,
      member ? identityVariantFieldId(member.productId) : field,
    );
  }
  return new ProductFamilyIdentityFinalizationError(reason, IDENTITY_SECTION_ID);
}

/** The identity became final on the server but the rest of the save was refused: both are said. */
export function identitySavedRestRefused(reason: string): ProductFamilyIdentityFinalizationError {
  return new ProductFamilyIdentityFinalizationError(`Vaste koppeling & URL opgeslagen · ${reason}`);
}

/**
 * The server's members with the variant codes that are still being typed laid back over them.
 * `draft` and `saved` are the members before the refresh; a code counts as typed where they differ.
 */
export function keepTypedVariantKeys(
  fresh: ProductFamilyMember[],
  draft: ProductFamilyMember[],
  saved: ProductFamilyMember[],
): ProductFamilyMember[] {
  const savedKeys = new Map(
    saved.map((member) => [member.productId, optional(member.canonicalVariantKey)] as const),
  );
  const typed = new Map<number, string | null>();
  for (const member of draft) {
    if (optional(member.canonicalVariantKey) !== (savedKeys.get(member.productId) ?? null)) {
      typed.set(member.productId, member.canonicalVariantKey);
    }
  }
  return fresh.map((member) => typed.has(member.productId)
    ? { ...member, canonicalVariantKey: typed.get(member.productId) ?? null }
    : { ...member });
}

/**
 * A fresh server copy of the same series, with the identity that is being typed laid back over
 * it: key and URL where they differ from the last saved ones, and the typed variant codes. For a
 * server action that reloads the series while its identity is still open (a colour linked or
 * taken out half way the code list).
 */
export function keepTypedIdentity(
  fresh: ProductFamily,
  draft: ProductFamily,
  saved: ProductFamily,
): ProductFamily {
  return {
    ...fresh,
    familyKey: clean(draft.familyKey) !== clean(saved.familyKey) ? draft.familyKey : fresh.familyKey,
    publicHandle: clean(draft.publicHandle) !== clean(saved.publicHandle)
      ? draft.publicHandle
      : fresh.publicHandle,
    members: keepTypedVariantKeys(fresh.members, draft.members, saved.members),
  };
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

function requiredTechnicalKey(
  value: string | null | undefined,
  label: string,
  field: string | null = null,
): string {
  const key = clean(value);
  if (!key) throw new ProductFamilyIdentityFinalizationError(`${label} ontbreekt.`, field);
  if (!TECHNICAL_KEY.test(key)) {
    throw new ProductFamilyIdentityFinalizationError(
      `${label} mag alleen kleine letters, cijfers en koppeltekens bevatten.`,
      field,
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
