/** "1,2 MB", "340 kB", "512 B": file sizes the way the Bestanden page shows them. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toLocaleString('nl-BE', { maximumFractionDigits: 1 })} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

/** "JPG", "PDF": the file type from its name, or from the content type when the name has none. */
export function fileTypeLabel(filename: string | null | undefined, contentType?: string | null): string {
  const name = filename ?? '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).slice(0, 4).toUpperCase();
  const slash = (contentType ?? '').lastIndexOf('/');
  return slash >= 0 ? (contentType ?? '').slice(slash + 1).slice(0, 4).toUpperCase() : '';
}
