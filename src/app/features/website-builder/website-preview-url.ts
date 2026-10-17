/**
 * The address of the homepage preview in the builder. The website serves
 * each language at its own root ('/nl/', '/fr/', …) and English at '/'; the
 * bare root is a language chooser, not a homepage, so the preview always
 * names a language. builderPreview busts the frame's cache after a publish.
 *
 * Tonight the builder always asks for 'nl': the site's language dialog
 * makes the other roots unreliable inside the frame until the website skips
 * it for builderPreview (website follow-up G6). The parameter stays for then.
 * Pure and import-free (node-tested).
 *
 *   websitePreviewUrl('https://enrosed.com', 'nl', 3, 'flowerboxes')
 *     → 'https://enrosed.com/nl/?builderPreview=3#flowerboxes'
 *   websitePreviewUrl('https://enrosed.com', 'en', 3, '')
 *     → 'https://enrosed.com/?builderPreview=3'
 */
export function websitePreviewUrl(base: string, lang: string, nonce: number, anchor: string): string {
  const hashAt = base.indexOf('#');
  const withoutHash = hashAt < 0 ? base : base.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  const root = (queryAt < 0 ? withoutHash : withoutHash.slice(0, queryAt)).replace(/\/+$/, '');
  const query = queryAt < 0 ? '' : withoutHash.slice(queryAt + 1);
  const language = lang.trim().toLowerCase();
  const path = !language || language === 'en' ? '/' : `/${encodeURIComponent(language)}/`;
  const params = [query, `builderPreview=${nonce}`].filter(Boolean).join('&');
  const hash = anchor.trim() ? `#${encodeURIComponent(anchor.trim())}` : '';
  return `${root}${path}?${params}${hash}`;
}
