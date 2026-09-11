import type { CompanyProfile } from '../../core/api/models';

export interface ReceiptBankAccount { value: string; label: string; }

/** Match Bank's IBAN identity; names and display spacing never become account keys. */
export function companyReceiptAccount(company: Pick<CompanyProfile, 'iban' | 'bic' | 'legalName' | 'name'>): ReceiptBankAccount | null {
  const iban = (company.iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  const bic = (company.bic ?? '').replace(/\s+/g, '').toUpperCase();
  const bank = bic === 'KREDBEBB' || bic === 'KREDBEBBXXX' ? 'KBC' : bic;
  const owner = company.legalName?.trim() || company.name?.trim();
  return { value: iban, label: [owner, bank, iban.match(/.{1,4}/g)!.join(' ')].filter(Boolean).join(' · ') };
}

export function receiptAccountChoices(account: ReceiptBankAccount | null, original: string | null): ReceiptBankAccount[] {
  const choices = account ? [account] : [];
  if (original !== null && original !== account?.value) {
    choices.unshift({ value: original, label: original ? `${original} · huidige registratie` : 'Niet opgegeven · huidige registratie' });
  }
  return choices;
}

/** Only an explicit choice can retag an existing payment to the configured IBAN. */
export function receiptAccountValue(selected: string | undefined, account: ReceiptBankAccount | null, original: string | null): string | null {
  const value = selected ?? '';
  if (original !== null && value === original) return original || null;
  if (account && value === account.value) return account.value;
  throw new Error('Kies een beschikbare bankrekening voordat je de bankbeweging bewaart.');
}
