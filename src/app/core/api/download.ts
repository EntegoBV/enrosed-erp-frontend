/**
 * Offers a blob to the user as a file.
 *
 * The link is put in the page before it is clicked and the blob address is
 * only released a while later: a link outside the document, or an address
 * revoked in the same tick, is dropped by Safari on a phone before the
 * download has started.
 */
export function saveBlob(blob: Blob, filename: string): void {
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
