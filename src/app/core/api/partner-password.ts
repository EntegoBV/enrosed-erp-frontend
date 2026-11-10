/**
 * The partner portal password rule, as the server checks it: 10 to 72
 * characters, printable ASCII only (0x20-0x7E). The login sends the password
 * through btoa, which throws on anything above U+00FF, and bcrypt reads at
 * most 72 bytes. For the staff field that sets a partner's password
 * (Instellingen › Partnerportaal). Pure and import-free.
 */

export const PARTNER_PASSWORD_MIN = 10;
export const PARTNER_PASSWORD_MAX = 72;
export const PARTNER_PASSWORD_HINT = 'Gebruik letters zonder accenten, cijfers en leestekens';

/** Why this password cannot be used, or null when it can. */
export function partnerPasswordProblem(password: string): string | null {
  if (!/^[\x20-\x7E]*$/.test(password)) return PARTNER_PASSWORD_HINT;
  if (password.length < PARTNER_PASSWORD_MIN) return `Minstens ${PARTNER_PASSWORD_MIN} tekens`;
  if (password.length > PARTNER_PASSWORD_MAX) return `Hoogstens ${PARTNER_PASSWORD_MAX} tekens`;
  return null;
}
