import { PhotoDto, Product, ProductFamily } from '../../core/api/models';

export const CATALOGUE_PHOTO_MANIFEST_VERSION = 'enrosed.catalogue-transparent-photos.v1';

export interface CataloguePhotoImportItem {
  productId: number;
  familyId: number;
  familyKey: string;
  sku: string;
  colour: string;
  filename: string;
  sha256: string;
  width: number;
  height: number;
}

export interface CataloguePhotoImportManifest {
  schemaVersion: typeof CATALOGUE_PHOTO_MANIFEST_VERSION;
  apiBaseUrl: string;
  items: CataloguePhotoImportItem[];
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function parseCataloguePhotoManifest(value: unknown, apiBase: string): CataloguePhotoImportManifest {
  requireValue(!!value && typeof value === 'object', 'Het manifest is geen JSON-object.');
  const manifest = value as CataloguePhotoImportManifest;
  requireValue(manifest.schemaVersion === CATALOGUE_PHOTO_MANIFEST_VERSION, 'Onbekende manifestversie.');
  requireValue(typeof manifest.apiBaseUrl === 'string'
    && manifest.apiBaseUrl.replace(/\/+$/, '') === apiBase.replace(/\/+$/, ''),
  'Dit manifest hoort bij een andere ERP-omgeving.');
  requireValue(Array.isArray(manifest.items) && manifest.items.length > 0 && manifest.items.length <= 200,
    'Een manifest bevat 1 tot 200 foto’s.');
  const products = new Set<number>();
  const filenames = new Set<string>();
  for (const item of manifest.items) {
    requireValue(item && typeof item === 'object', 'Ongeldige manifestregel.');
    requireValue(Number.isSafeInteger(item.productId) && item.productId > 0
      && Number.isSafeInteger(item.familyId) && item.familyId > 0, 'Product- en reeksnummer ontbreken.');
    for (const key of ['familyKey', 'sku', 'colour'] as const) {
      requireValue(typeof item[key] === 'string' && item[key].trim().length > 0,
        `Product ${item.productId}: ${key} ontbreekt.`);
    }
    requireValue(typeof item.filename === 'string' && /^[^/\\]+\.png$/i.test(item.filename)
      && !filenames.has(item.filename), `Product ${item.productId}: unieke PNG-bestandsnaam vereist.`);
    requireValue(typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256),
      `Product ${item.productId}: geldige SHA-256 vereist.`);
    requireValue(Number.isSafeInteger(item.width) && item.width > 0
      && Number.isSafeInteger(item.height) && item.height > 0 && item.width * item.height <= 40_000_000,
    `Product ${item.productId}: ongeldige afmetingen (maximaal 40 megapixels).`);
    requireValue(!products.has(item.productId), `Product ${item.productId} staat meer dan eenmaal in het manifest.`);
    products.add(item.productId);
    filenames.add(item.filename);
  }
  return manifest;
}

export async function photoSha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Decode the real alpha pixels; an RGBA header alone does not prove transparency. */
export async function validateTransparentPhoto(file: File, item: CataloguePhotoImportItem): Promise<void> {
  requireValue(file.size > 0 && file.size <= 25 * 1024 * 1024, `${file.name}: maximaal 25 MB per foto.`);
  const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  requireValue(header.length === 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)
    && [73, 72, 68, 82].every((byte, index) => header[index + 12] === byte),
    `${file.name}: dit bestand is geen PNG.`);
  const dimensions = new DataView(header.buffer);
  requireValue(dimensions.getUint32(16) === item.width && dimensions.getUint32(20) === item.height,
    `${file.name}: PNG-afmetingen komen niet overeen met het manifest.`);
  requireValue(await photoSha256(file) === item.sha256, `${file.name}: SHA-256 komt niet overeen met het manifest.`);
  const bitmap = await createImageBitmap(file);
  try {
    requireValue(bitmap.width === item.width && bitmap.height === item.height,
      `${file.name}: pixelafmetingen komen niet overeen met het manifest.`);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    requireValue(context, 'Deze browser kan de transparantie niet controleren.');
    context.drawImage(bitmap, 0, 0);
    let transparentPixels = 0;
    let opaquePixels = 0;
    const transparentEdges = [0, 0, 0, 0]; // top, right, bottom, left
    for (let y = 0; y < bitmap.height; y += 64) {
      const rows = Math.min(64, bitmap.height - y);
      const data = context.getImageData(0, y, bitmap.width, rows).data;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] <= 1) transparentPixels++;
        if (data[index] >= 240) opaquePixels++;
      }
      for (let row = 0; row < rows; row++) {
        const start = row * bitmap.width * 4;
        if (data[start + 3] <= 1) transparentEdges[3]++;
        if (data[start + (bitmap.width - 1) * 4 + 3] <= 1) transparentEdges[1]++;
        const boundary = y + row === 0 ? 0 : y + row === bitmap.height - 1 ? 2 : null;
        if (boundary !== null) {
          for (let x = 0; x < bitmap.width; x++) {
            if (data[start + x * 4 + 3] <= 1) transparentEdges[boundary]++;
          }
        }
      }
    }
    const minimumArea = Math.ceil(bitmap.width * bitmap.height * 0.01);
    const minimumEdge = Math.ceil((bitmap.width + bitmap.height) * 2 * 0.01);
    requireValue(transparentPixels >= minimumArea && opaquePixels >= minimumArea
      && transparentEdges.filter(count => count > 0).length >= 2
      && transparentEdges.reduce((total, count) => total + count, 0) >= minimumEdge,
    `${file.name}: minimaal 1% vrije transparante achtergrond, transparantie aan de beeldrand en een zichtbaar product zijn vereist.`);
    canvas.width = canvas.height = 0;
  } finally {
    bitmap.close();
  }
}

export function verifyPhotoImportIdentity(item: CataloguePhotoImportItem, product: Product, family: ProductFamily): void {
  requireValue(product.id === item.productId && product.familyId === item.familyId
    && product.familyKey === item.familyKey && product.sku === item.sku && product.colour === item.colour
    && family.id === item.familyId && family.familyKey === item.familyKey,
  `${item.filename}: productnummer, reeks, SKU of kleur wijkt af van het ERP.`);
  requireValue(product.active && !product.demo && family.active, `${item.filename}: product/reeks is niet actief.`);
  requireValue(family.members.some(member => member.productId === item.productId), `${item.filename}: variant ontbreekt in de reeks.`);
  requireValue(product.photos.some(photo => isOwnPhoto(photo) && photo.sizeBytes > 0
    && (photo.widthPx ?? 0) > 0 && (photo.heightPx ?? 0) > 0 && photo.contentType?.startsWith('image/')),
  `${item.filename}: geen bestaande bruikbare eigen foto; controleer de websitekeuze eerst handmatig.`);
}

export function isOwnPhoto(photo: PhotoDto): boolean { return photo.origin === 'PRODUCT' && !photo.readOnly; }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function without(value: object, ignored: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.includes(key)));
}

/** Ignore only projections that this catalogue-only operation legitimately changes. */
export function familyImportSnapshot(family: ProductFamily): string {
  return stable(without(family, ['cataloguePhotoOptions', 'publicationIssues']));
}

export function productImportSnapshot(product: Product): string {
  return stable(without(product, ['photos', 'publicationIssues']));
}

export function assertImportUnchanged(before: Product, after: Product, allowedPhotoId?: number): void {
  requireValue(productImportSnapshot(before) === productImportSnapshot(after),
    `Product ${before.id}: productgegevens zijn tussentijds gewijzigd; import gestopt.`);
  const oldIds = new Set(before.photos.map(photo => photo.id));
  const retained = after.photos.filter(photo => oldIds.has(photo.id));
  requireValue(stable(before.photos.map(photo => photo.id)) === stable(retained.map(photo => photo.id)),
    `Product ${before.id}: bestaande foto’s of volgorde zijn gewijzigd.`);
  for (const original of before.photos) {
    const current = retained.find(photo => photo.id === original.id)!;
    const snapshot = (photo: PhotoDto) => ({
      ...without(photo, ['position', 'leadFor']),
      leadFor: (photo.leadFor ?? []).filter(role => allowedPhotoId === undefined || role !== 'CATALOGUE').sort(),
    });
    requireValue(stable(snapshot(original)) === stable(snapshot(current)),
      `Product ${before.id}: bestaande foto ${original.id} of websitekeuze is gewijzigd.`);
  }
  const additions = after.photos.filter(photo => !oldIds.has(photo.id));
  requireValue(additions.every(photo => photo.id === allowedPhotoId && isOwnPhoto(photo)
    && !(photo.leadFor ?? []).includes('WEBSITE')), `Product ${before.id}: onverwachte nieuwe foto.`);
}
