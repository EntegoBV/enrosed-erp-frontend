/**
 * Why the customer's quotation link shows no quotation.
 *
 * The page route answers two refusals with HTTP 409 that are no dead link:
 * `QUOTE_BEING_UPDATED` (Enrosed reopened the quotation and has not sent it
 * again) and `QUOTE_CANCELLED` (cancelled while it was an unsent draft, so
 * nothing of it may be shown). Each gets its own calm notice. Everything
 * else - a 404, no connection, a 409 without a code as an older backend
 * sends it - stays the "not found" text.
 *
 * Pure and without imports, so node can test it as it is.
 */
export type PortalRefusalKind = 'updating' | 'cancelled' | 'notFound';

export interface PortalRefusal {
  kind: PortalRefusalKind;
  /**
   * What staff wrote for the customer when cancelling, exactly as typed
   * (line breaks and spaces included); null when they wrote nothing, and
   * always null for the other kinds.
   */
  staffMessage: string | null;
  /**
   * The language on the customer's file as the refusal names it; null when
   * it names none or one this page does not have. Never set for 'notFound'.
   */
  language: string | null;
}

export const PORTAL_NOT_FOUND: PortalRefusal = { kind: 'notFound', staffMessage: null, language: null };

const KIND_BY_CODE: Record<string, PortalRefusalKind> = {
  QUOTE_BEING_UPDATED: 'updating',
  QUOTE_CANCELLED: 'cancelled',
};

/**
 * Reads the failure of the page's first call. `languages` are the codes the
 * page can show. The Dutch `message` of the body is deliberately not read:
 * the page words the notice itself, in the customer's language, and the
 * staff sentence arrives in its own field so no sentence is cut apart.
 */
export function portalRefusalOf(failure: unknown, languages: readonly string[] = []): PortalRefusal {
  const response = failure as { status?: unknown; error?: unknown } | null | undefined;
  if (!response || response.status !== 409) return PORTAL_NOT_FOUND;
  const body = response.error;
  if (!body || typeof body !== 'object') return PORTAL_NOT_FOUND;
  const { code, cancellationMessage, language } = body as { code?: unknown; cancellationMessage?: unknown; language?: unknown };
  const kind = typeof code === 'string' && Object.hasOwn(KIND_BY_CODE, code) ? KIND_BY_CODE[code] : null;
  if (!kind) return PORTAL_NOT_FOUND;
  const typed = kind === 'cancelled' && typeof cancellationMessage === 'string' && cancellationMessage.trim()
    ? cancellationMessage : null;
  const named = typeof language === 'string' ? language.trim().toUpperCase() : '';
  return { kind, staffMessage: typed, language: languages.includes(named) ? named : null };
}
