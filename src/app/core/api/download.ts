import { postHostFile } from '../platform/host';

/**
 * Offers a blob to the user as a file.
 *
 * The link is put in the page before it is clicked and the blob address is
 * only released a while later: a link outside the document, or an address
 * revoked in the same tick, is dropped by Safari on a phone before the
 * download has started.
 *
 * Inside the native host (enrosed-erp-ios) a blob up to 20 MB travels as a
 * `file` message instead and opens in the native viewer; a bigger one
 * keeps the anchor, which the host catches as a download.
 */
export function saveBlob(blob: Blob, filename: string): void {
  if (postHostFile(window, document, blob, filename)) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}
