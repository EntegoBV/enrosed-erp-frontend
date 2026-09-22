import type {
  LanguageCode,
  ProductPhotoExportPhotos,
  ProductPhotoExportRequest,
  ProductPhotoExportResult,
  ProductPhotoExportScope,
} from '../../core/api/models';

/**
 * Pure helpers behind the product photo export sheet: the options it offers,
 * the request it sends and the one-line summary of a prepared ZIP. Kept free
 * of Angular so the rules can be tested on their own.
 */

export interface PhotoExportChoice<T extends string> {
  value: T;
  label: string;
}

export const PHOTO_EXPORT_SCOPES: readonly PhotoExportChoice<ProductPhotoExportScope>[] = [
  { value: 'ACTIVE', label: 'Actieve producten' },
  { value: 'WEBSITE', label: 'Op de website' },
  { value: 'ALL', label: 'Alle producten' },
];

export const PHOTO_EXPORT_PHOTO_SETS: readonly PhotoExportChoice<ProductPhotoExportPhotos>[] = [
  { value: 'ALL', label: 'Alle foto’s' },
  { value: 'WEBSITE', label: 'Alleen websitefoto’s' },
];

const LANGUAGE_CODES: readonly LanguageCode[] = ['NL', 'FR', 'EN', 'DE', 'ES', 'PL', 'PT', 'TR', 'EL'];

export const DEFAULT_PHOTO_EXPORT_REQUEST: Readonly<ProductPhotoExportRequest> = {
  scope: 'ACTIVE',
  photos: 'ALL',
  language: 'NL',
};

/** Whatever the sheet holds, the backend only ever receives one of its known values. */
export function photoExportRequest(
  options: Partial<Record<keyof ProductPhotoExportRequest, string | null>> = {},
): ProductPhotoExportRequest {
  const scope = PHOTO_EXPORT_SCOPES.find((choice) => choice.value === options.scope)?.value;
  const photos = PHOTO_EXPORT_PHOTO_SETS.find((choice) => choice.value === options.photos)?.value;
  const language = LANGUAGE_CODES.find((code) => code === options.language);
  return {
    scope: scope ?? DEFAULT_PHOTO_EXPORT_REQUEST.scope,
    photos: photos ?? DEFAULT_PHOTO_EXPORT_REQUEST.photos,
    language: language ?? DEFAULT_PHOTO_EXPORT_REQUEST.language,
  };
}

const NUMBER = new Intl.NumberFormat('nl-BE');
const DECIMAL = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 1 });
const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/** "± 780 MB", "± 1,4 GB", "± 4,5 MB": an estimate, so whole megabytes once it is large. */
export function approximateExportSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= GB) return `± ${DECIMAL.format(bytes / GB)} GB`;
  if (bytes >= 10 * MB) return `± ${NUMBER.format(Math.round(bytes / MB))} MB`;
  if (bytes >= MB) return `± ${DECIMAL.format(bytes / MB)} MB`;
  return `± ${NUMBER.format(Math.max(1, Math.round(bytes / KB)))} kB`;
}

/** "63 producten · 412 foto’s · ± 780 MB", with the singular where it reads better. */
export function photoExportSummary(
  result: Pick<ProductPhotoExportResult, 'productCount' | 'photoCount' | 'totalBytes'>,
): string {
  const products = Math.max(0, result.productCount || 0);
  const photos = Math.max(0, result.photoCount || 0);
  const parts = [
    `${NUMBER.format(products)} ${products === 1 ? 'product' : 'producten'}`,
    `${NUMBER.format(photos)} ${photos === 1 ? 'foto' : 'foto’s'}`,
  ];
  const size = approximateExportSize(result.totalBytes);
  if (size) parts.push(size);
  return parts.join(' · ');
}

/**
 * The download link the backend hands out is relative to the API; the browser
 * must fetch it from the API host itself. Absolute http(s) links are kept.
 */
export function photoExportDownloadHref(apiBase: string, downloadUrl: string): string {
  const url = downloadUrl.trim();
  if (/^https?:\/\//i.test(url)) return url;
  const base = apiBase.replace(/\/+$/, '');
  return base + (url.startsWith('/') ? url : `/${url}`);
}

/**
 * True once the link can no longer be trusted to work. A small margin keeps
 * a tap at the very last second from ending in the backend's 404.
 */
export function photoExportExpired(expiresAt: string | null | undefined, now: number, marginMs = 5000): boolean {
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return false;
  return now >= expires - marginMs;
}

/** "14:32": until when the prepared link stays valid, in the local clock. */
export function photoExportValidUntil(expiresAt: string | null | undefined): string {
  if (!expiresAt) return '';
  const expires = new Date(expiresAt);
  if (!Number.isFinite(expires.getTime())) return '';
  return expires.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
}
