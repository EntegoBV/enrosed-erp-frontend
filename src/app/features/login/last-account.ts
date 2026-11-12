/**
 * The login page remembers which of the two accounts signed in last on this
 * device and preselects it. Only the username is kept, never the password
 * or a token. A blocked or empty store behaves as before (nothing
 * preselected). Pure and import-free: node-tested with a fake store.
 */

export type LoginAccount = 'emre' | 'berat';

export const LAST_ACCOUNT_KEY = 'enrosed.login.last';

export interface AccountStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isAccount(value: unknown): value is LoginAccount {
  return value === 'emre' || value === 'berat';
}

export function readLastAccount(store: AccountStore | null | undefined): LoginAccount | '' {
  try {
    const value = store?.getItem(LAST_ACCOUNT_KEY);
    return isAccount(value) ? value : '';
  } catch {
    return '';
  }
}

export function rememberLastAccount(store: AccountStore | null | undefined, account: string): void {
  if (!isAccount(account)) return;
  try {
    store?.setItem(LAST_ACCOUNT_KEY, account);
  } catch {
    /* private mode or blocked storage: nothing is remembered */
  }
}

/*
 * The partner portal (Verhoeven) remembers its own sign-in apart: when the
 * last sign-in on this device was a partner, the login page opens in partner
 * mode with that username filled in. A partner's Afmelden keeps it; a staff
 * sign-in or "Ander account" clears it. `enrosed.login.last` stays the staff
 * key, untouched by partners.
 */

export const LAST_PARTNER_KEY = 'enrosed.login.lastPartner';

export interface PartnerAccountStore extends AccountStore {
  removeItem(key: string): void;
}

/** What the server accepts as a partner username (lowercase). */
function isPartnerUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9._-]{3,64}$/.test(value);
}

/** The username as it is sent: trimmed and lowercased (iOS capitalises the first letter). */
export function partnerUsername(typed: string): string {
  return typed.trim().toLowerCase();
}

export function readLastPartner(store: AccountStore | null | undefined): string {
  try {
    const value = store?.getItem(LAST_PARTNER_KEY);
    return isPartnerUsername(value) ? value : '';
  } catch {
    return '';
  }
}

export function rememberLastPartner(store: AccountStore | null | undefined, username: string): void {
  if (!isPartnerUsername(username)) return;
  try {
    store?.setItem(LAST_PARTNER_KEY, username);
  } catch {
    /* private mode or blocked storage: nothing is remembered */
  }
}

export function forgetLastPartner(store: PartnerAccountStore | null | undefined): void {
  try {
    store?.removeItem(LAST_PARTNER_KEY);
  } catch {
    /* blocked storage: nothing was kept */
  }
}
