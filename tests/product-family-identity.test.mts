import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductFamily, ProductFamilyMember } from '../src/app/core/api/models.ts';
import {
  canEditProductFamilyIdentity,
  hasFinalizableDraftIdentity,
  planProductFamilyIdentityFinalization,
  ProductFamilyIdentityFinalizationError,
} from '../src/app/features/products/product-family-identity.ts';

test('identity is editable only for a new family or a persisted family without a handle', () => {
  const imported = family();

  assert.equal(hasFinalizableDraftIdentity(imported), true);
  assert.equal(canEditProductFamilyIdentity(imported), true);
  assert.equal(canEditProductFamilyIdentity({ ...imported, id: null }), true);
  assert.equal(canEditProductFamilyIdentity({ ...imported, publicHandle: 'foam-bear' }), false);
  assert.equal(canEditProductFamilyIdentity(null), false);
});

test('ordinary edits do not accidentally invoke one-time identity finalization', () => {
  const previous = family();
  const desired = { ...structuredClone(previous), name: 'Nieuwe publieke titel' };

  assert.equal(planProductFamilyIdentityFinalization(previous, desired), null);
});

test('plans the complete optimistic family and SKU identity command', () => {
  const previous = family();
  const desired = structuredClone(previous);
  desired.familyKey = 'foam-bear';
  desired.publicHandle = ' foam-bear ';
  desired.members[0].canonicalVariantKey = 'foam-bear-red';
  desired.members[1].canonicalVariantKey = 'foam-bear-pink';

  assert.deepEqual(planProductFamilyIdentityFinalization(previous, desired), {
    expectedFamilyKey: 'model-foam-bear',
    familyKey: 'foam-bear',
    publicHandle: 'foam-bear',
    variants: [
      {
        sku: 'FOAM-BEAR-RED',
        expectedCanonicalVariantKey: null,
        canonicalVariantKey: 'foam-bear-red',
      },
      {
        sku: 'FOAM-BEAR-PINK',
        expectedCanonicalVariantKey: 'model-foam-bear-pink',
        canonicalVariantKey: 'foam-bear-pink',
      },
    ],
  });
  assert.equal(previous.publicHandle, null, 'planning must not mutate the loaded precondition');
});

test('refuses incomplete, duplicate, or stale variant identity before an API call', async (t) => {
  await t.test('missing handle', () => {
    const previous = family();
    const desired = structuredClone(previous);
    desired.familyKey = 'foam-bear';

    assert.throws(
      () => planProductFamilyIdentityFinalization(previous, desired),
      (failure: unknown) => validationMessage(failure).includes('publieke URL'),
    );
  });

  await t.test('duplicate canonical keys', () => {
    const previous = family();
    const desired = completeDesired(previous);
    desired.members[1].canonicalVariantKey = desired.members[0].canonicalVariantKey;

    assert.throws(
      () => planProductFamilyIdentityFinalization(previous, desired),
      (failure: unknown) => validationMessage(failure).includes('meer dan één keer'),
    );
  });

  await t.test('invalid technical key', () => {
    const previous = family();
    const desired = completeDesired(previous);
    desired.members[0].canonicalVariantKey = 'Foam Bear Red';

    assert.throws(
      () => planProductFamilyIdentityFinalization(previous, desired),
      (failure: unknown) => validationMessage(failure).includes('kleine letters'),
    );
  });

  await t.test('membership drift', () => {
    const previous = family();
    const desired = completeDesired(previous);
    desired.members.pop();

    assert.throws(
      () => planProductFamilyIdentityFinalization(previous, desired),
      (failure: unknown) => validationMessage(failure).includes('varianten'),
    );
  });
});

function completeDesired(previous: ProductFamily): ProductFamily {
  const desired = structuredClone(previous);
  desired.familyKey = 'foam-bear';
  desired.publicHandle = 'foam-bear';
  desired.members[0].canonicalVariantKey = 'foam-bear-red';
  desired.members[1].canonicalVariantKey = 'foam-bear-pink';
  return desired;
}

function validationMessage(failure: unknown): string {
  assert.ok(failure instanceof ProductFamilyIdentityFinalizationError);
  return failure.message;
}

function family(): ProductFamily {
  const members: ProductFamilyMember[] = [
    member(101, 'FOAM-BEAR-RED', null, 'Red'),
    member(102, 'FOAM-BEAR-PINK', 'model-foam-bear-pink', 'Pink'),
  ];
  return {
    id: 17,
    familyKey: 'model-foam-bear',
    publicHandle: null,
    categoryId: 5,
    categoryKey: 'foam',
    categoryName: 'Foam Rose',
    categoryPosition: 0,
    collectionKey: null,
    collections: [],
    productPosition: 0,
    cardFeaturedProductId: null,
    tags: [],
    websiteStatus: 'DRAFT',
    orderAppStatus: 'DRAFT',
    catalogueStatus: 'DRAFT',
    active: true,
    name: 'Foam Bear',
    summary: null,
    description: null,
    format: null,
    highlights: [],
    seoTitle: null,
    seoDescription: null,
    dimensions: null,
    texts: [],
    packages: [],
    images: [],
    externalIdentifiers: [],
    priceObservations: [],
    provenance: [],
    conflicts: [],
    publicationIssues: [],
    members,
    variantCount: members.length,
  };
}

function member(
  productId: number,
  sku: string,
  canonicalVariantKey: string | null,
  colour: string,
): ProductFamilyMember {
  return {
    productId,
    canonicalVariantKey,
    sku,
    name: `Foam Bear ${colour}`,
    colour,
    colourHex: null,
    size: null,
    position: productId,
    active: true,
  };
}
