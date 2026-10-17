/**
 * Where the phone back control of Analyses leads (critique B8).
 *
 * The page reads the screen below it in the foundation's history stack
 * (NavHistory.below(); the tab chips replace the URL, so that entry stays
 * the origin across tab switches) and maps it here:
 * - none, another Analyses tab, or a workspace (Kosten & bank, Documenten,
 *   login…) → "‹ Meer" to /more;
 * - anything else → that screen by its own name ("‹ Vandaag",
 *   "Inkooporder" as a chevron circle because it is longer than ten
 *   characters) and its URL.
 *
 * Pure and import-free (node-tested): the label and workspace rules are
 * passed in (screenLabel and isWorkspaceUrl from core/platform/return-label).
 */

export interface AnalysesOrigin {
  label: string;
  url: string;
}

export const MEER_ORIGIN: AnalysesOrigin = { label: 'Meer', url: '/more' };

function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}

export function originOf(
  previousUrl: string | null | undefined,
  labelOf: (url: string) => string,
  isWorkspace: (url: string) => boolean,
): AnalysesOrigin {
  if (!previousUrl) return MEER_ORIGIN;
  const path = pathOf(previousUrl);
  if (path === '/analyses' || path.startsWith('/analyses/') || isWorkspace(previousUrl)) return MEER_ORIGIN;
  return { label: labelOf(previousUrl), url: previousUrl };
}
