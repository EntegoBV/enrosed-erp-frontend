/** Empty is intentional: it removes this account's number from the catalogue. */
export function normalizedStaffPhone(phone: string | null | undefined): string | null {
  return phone?.trim() || null;
}

export function staffPhoneError(phone: string): string | null {
  const value = normalizedStaffPhone(phone);
  if (value === null) return null;
  if (value.length > 50) return 'Gebruik maximaal 50 tekens.';
  const digits = value.replace(/\D/g, '').length;
  if (!/^\+?[0-9 ().-]+$/.test(value) || digits < 7 || digits > 15) {
    return 'Gebruik 7 tot 15 cijfers, eventueel met +, spaties, haakjes, punten of streepjes.';
  }
  return null;
}
