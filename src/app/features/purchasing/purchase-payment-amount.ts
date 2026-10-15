/** Accept the bank's Dutch formatting and plain API decimals without coercing an empty field to zero. */
export function parsePurchasePaymentAmount(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 && Math.abs(raw * 100 - Math.round(raw * 100)) < 0.000001 ? raw : null;
  const value = (raw ?? '').trim().replace(/[\s\u00a0\u202f]/g, '').replace(/^€/, '');
  if (!value) return null;
  let normalized: string;
  if (value.includes(',')) {
    if (!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(value)) return null;
    normalized = value.replaceAll('.', '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) {
    normalized = value.replaceAll('.', '');
  } else {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
    normalized = value;
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * An amount as a payment field shows it, the way the owner reads money:
 * '4.320,00', '12.000,00', '0,50'. parsePurchasePaymentAmount reads it back.
 * Empty for nothing or a non-positive value.
 */
export function amountInputText(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) && value > 0
    ? value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }) : '';
}

/** Editing replaces one ledger entry; it does not add the entire amount for a second time. */
export function purchasePaymentOverage(planned: number, paid: number, enteredEur: number, previousEur = 0): number {
  if (!(planned > 0) || ![planned, paid, enteredEur, previousEur].every(Number.isFinite)) return 0;
  return Math.max(0, Math.round((paid - previousEur + enteredEur - planned) * 100) / 100);
}
