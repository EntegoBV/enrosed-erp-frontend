/**
 * Shortens a long path in the middle ("/sales/79/…/edit"), so its start and
 * its end stay readable. Pure and import-free: node-tested.
 */
export function middleEllipsis(text: string, max = 60): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
