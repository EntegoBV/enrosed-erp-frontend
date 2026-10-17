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
