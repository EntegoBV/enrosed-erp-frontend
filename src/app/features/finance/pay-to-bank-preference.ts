/*
 * The account this device remembered for 'Bankbeweging noteren' (Kosten &
 * bank's movement form starts on it). The key once also held the "Ook als
 * bankbeweging noteren" switch of the payment sheets; that switch is gone
 * since 2026-10-16 (a picked bank transaction is the movement), so the
 * stored `on` is read but ignored. Pure: node-tested; the storage is handed
 * in (localStorage in the app, a map in tests) and a missing or throwing
 * storage reads as nothing remembered.
 */

export const PAY_TO_BANK_KEY = 'enrosed.finance.payToBank';

export interface PayToBankPreference {
  on: boolean;
  accountKey: string;
}

/** The part of Storage the preference needs; null when the browser has none. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readPayToBank(storage: PreferenceStorage | null | undefined): PayToBankPreference {
  try {
    const raw = storage?.getItem(PAY_TO_BANK_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<PayToBankPreference> : null;
    return { on: parsed?.on === true, accountKey: typeof parsed?.accountKey === 'string' ? parsed.accountKey : '' };
  } catch {
    return { on: false, accountKey: '' };
  }
}

export function writePayToBank(storage: PreferenceStorage | null | undefined, preference: PayToBankPreference): void {
  try { storage?.setItem(PAY_TO_BANK_KEY, JSON.stringify({ on: preference.on, accountKey: preference.accountKey })); }
  catch { /* private mode: this visit only */ }
}

/**
 * The account the chips start on: the one chosen in the form when it is
 * still offered, else the remembered one, else the only one there is.
 */
export function defaultBankAccount(options: readonly { key: string }[], chosen: string, remembered: string): string {
  const known = (key: string) => !!key && options.some((option) => option.key === key);
  return known(chosen) ? chosen : known(remembered) ? remembered : options.length === 1 ? options[0].key : '';
}
