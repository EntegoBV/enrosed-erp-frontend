# Transparent catalogue photo import

Catalogue Studio accepts one JSON manifest and the exact corresponding PNG files. This uses the signed-in ERP session and the existing product photo endpoints. It does not activate the retired catalogue migration service.

Create a separate manifest for each environment from that environment's current product records. A source-conversion plan is not an upload manifest: the SHA and dimensions below must describe the final approved PNG bytes.

```json
{
  "schemaVersion": "enrosed.catalogue-transparent-photos.v1",
  "apiBaseUrl": "https://enrosed-erp-backend-production.up.railway.app",
  "items": [
    {
      "productId": 49,
      "familyId": 12,
      "familyKey": "COPY_THE_CURRENT_ERP_FAMILY_KEY",
      "sku": "COPY_THE_CURRENT_ERP_SKU",
      "colour": "COPY_THE_CURRENT_ERP_COLOUR",
      "filename": "product-049-catalogue-transparent-v1.png",
      "sha256": "REPLACE_WITH_FINAL_FILE_SHA256_LOWERCASE_HEX",
      "width": 1536,
      "height": 1024
    }
  ]
}
```

The UI checks all files before any write: environment, unique product/file, exact product/family/SKU/colour identity, PNG signature, declared and decoded dimensions, and SHA-256. At least 1% of pixels must be transparent (alpha ≤ 1), at least 1% visibly opaque (alpha ≥ 240), and transparency must reach at least two image edges and 1% of the perimeter. This rejects an almost-opaque alpha channel or a stray transparent pixel. PNG header dimensions are checked before decoding. Limits are 200 files, 25 MB per file and 40 megapixels per image. Visual product accuracy remains a separate review; alpha validation cannot establish that an image shows the correct product.

Every target must already have a usable own product photo or the server-computed `members[].hasPublicWebsiteImage` flag. Without a usable own photo, this flag proves that a matching/shared eligible WEBSITE family image exists: the backend computes it through the same `PublicFamilyPhotoProjection.primary` selection used by both public catalogue endpoints. That family image suppresses the appended own fallback because the new image receives no WEBSITE role. Missing flags fail closed. Family and photo snapshots are checked again before and after each write.

The importer never reorders or deletes photos. It appends the new original with `POST /api/products/{id}/photos`, downloads those stored bytes to verify the SHA, and uses `PUT /api/products/{id}/photos/{photoId}/lead` with `{"role":"CATALOGUE","lead":true}`. It does not set a WEBSITE role, publish family images, or change manual family overview/detail selections. Own product photos use their existing product translations; this path does not create family alt-text records. For a variant that previously had only inherited family photos, adding its first own photo also makes that photo the internal first-photo fallback. The WEBSITE guard does not claim unchanged automatic fallback for a separate channel without its own eligible family image.

Before and after each item it reads back the product and family. All product data apart from photo additions and catalogue role choices must match. Existing image identities, original metadata, relative order and WEBSITE roles must remain unchanged. Family images, members and manual selections are compared too. Derived catalogue-photo options and publication issue messages are excluded from these comparisons.

Items run sequentially. The normal endpoints lock each write, but the whole batch is not one transaction and does not offer an atomic cross-request precondition. Concurrent changes stop the batch when detected; completed uploads are retained. Stop finishes the current item. After an interrupted or uncertain request, run the complete preflight again: same-size existing own photos are checked by original-byte SHA and reused. A conflicting identical filename blocks the import. No automatic deletion or rollback is attempted.

The downloadable report records environment, product identity, intended file SHA, resulting photo ID and outcome. It contains no authentication material. Verification here describes API readback; export and inspect the requested hosted PDF separately before declaring the catalogue visually complete.
