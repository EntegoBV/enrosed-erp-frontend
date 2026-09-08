/** A failed or unfinished edit must never become the blank product creation flow. */
export function productEditorReady(routeId: string | null | undefined, draftId: number | null,
                                   loading: boolean, error: string | null): boolean {
  if (loading || error) return false;
  if (!routeId || routeId === 'new') return true;
  const requestedId = Number(routeId);
  return Number.isSafeInteger(requestedId) && requestedId > 0 && requestedId === draftId;
}

/** Deep links and viewport changes can request a section unavailable on this screen. */
export function visibleProductEditorTab(requested: string, visibleIds: readonly string[]): string {
  return visibleIds.includes(requested) ? requested : visibleIds[0] ?? 'identity';
}
