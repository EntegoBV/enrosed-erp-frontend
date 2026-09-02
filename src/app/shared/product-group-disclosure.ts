export function toggleProductGroup(
  openGroups: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  const next = new Set(openGroups);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
