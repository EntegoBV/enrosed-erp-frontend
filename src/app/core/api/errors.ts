/**
 * Pulling the message out of a failed call.
 *
 * On a refused operation the backend sends an explanation along ("Er
 * bestaat al een verkooporder met nummer X"). That beats "something went
 * wrong", so we show it when present. When there is nothing, we fall back
 * to our own sentence - a technical error tells the user nothing.
 */
export function messageOf(failure: unknown, fallback: string): string {
  const response = failure as {
    status?: number;
    error?: { message?: unknown; detail?: unknown } | string | null;
  };
  const body = response?.error;
  if (body && typeof body === 'object') {
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
    if (typeof body.detail === 'string' && body.detail.trim()) return body.detail.trim();
  }
  if (typeof body === 'string') {
    const text = body.trim();
    /* Never pour an HTML proxy/error page into a compact user-facing alert. */
    if (text && text.length <= 500 && !/<(?:!doctype|html|body)\b/i.test(text)) return text;
  }
  switch (response?.status) {
    case 0: return 'Geen verbinding met de server. Controleer uw internetverbinding en probeer opnieuw.';
    case 401: return 'Uw sessie is verlopen. Meld opnieuw aan en probeer de actie opnieuw.';
    case 403: return 'U heeft geen toegang tot deze actie.';
    case 404: return 'De gevraagde gegevens bestaan niet meer of zijn verplaatst.';
    case 409: return 'Deze wijziging conflicteert met bestaande gegevens. Controleer de invoer en probeer opnieuw.';
    case 422: return 'Controleer de ingevulde gegevens en probeer opnieuw.';
    default: return fallback;
  }
}

/**
 * HTTP 409 is also used for business rules such as duplicate public handles.
 * Only an explicit stale-write code or an unambiguous backend message may show
 * a destructive "load latest" action; status alone is deliberately not enough.
 */
export function isRevisionConflict(failure: unknown): boolean {
  const response = failure as {
    status?: number;
    error?: {
      code?: unknown;
      errorCode?: unknown;
      type?: unknown;
      message?: unknown;
      detail?: unknown;
    } | string | null;
  };
  if (response?.status !== 409) return false;
  const body = response.error;
  if (body && typeof body === 'object') {
    const explicitCodes = [body.code, body.errorCode, body.type]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_'));
    if (explicitCodes.some((code) => [
      'REVISION_CONFLICT',
      'STALE_REVISION',
      'STALE_WRITE',
      'OPTIMISTIC_LOCK',
      'OPTIMISTIC_LOCK_CONFLICT',
    ].includes(code))) return true;
  }
  const message = typeof body === 'string'
    ? body
    : body && typeof body === 'object'
      ? [body.message, body.detail].find((value): value is string => typeof value === 'string') ?? ''
      : '';
  return /\b(?:stale[_ -]?(?:write|revision)|revision[_ -]?conflict|optimistic[_ -]?lock)\b/i.test(message)
    || /(?:intussen|ondertussen).{0,100}(?:gewijzigd|gekoppeld).{0,100}(?:herlaad|laad\s+(?:de\s+)?(?:laatste|nieuwste))/i.test(message)
    || /(?:gewijzigd|gekoppeld).{0,100}(?:herlaad|laad\s+(?:de\s+)?(?:laatste|nieuwste)).{0,100}(?:bewaar|opsla|controleer)/i.test(message);
}
