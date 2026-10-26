/** Price entry shared by the scenario defaults and a container's saved choices. */
export type CashPercentageBasis = 'markup' | 'margin';
export type CashNumberResult = { value: number; error: null } | { value: null; error: string };

export const MAX_CASH_MARKUP = 1000;
export const MAX_CASH_PER_UNIT = 100000;

/** Strict decimal entry: blanks, exponent notation and grouping never become an accidental amount. */
export function parseCashAmount(raw: string, max = MAX_CASH_PER_UNIT, decimals = 4): CashNumberResult {
  const text = String(raw).trim().replace(',', '.');
  if (!text) return { value: null, error: 'Vul een bedrag in.' };
  if (!/^\d+(?:\.\d+)?$/.test(text)) return { value: null, error: 'Gebruik een getal, bijvoorbeeld 2,50.' };
  if ((text.split('.')[1]?.length ?? 0) > decimals) return { value: null, error: `Gebruik maximaal ${decimals} decimalen.` };
  const value = Number(text);
  if (!Number.isFinite(value) || value > max) return { value: null, error: `Kies een bedrag tussen 0 en ${max.toLocaleString('nl-BE')}.` };
  return { value, error: null };
}

export function marginFromMarkup(markup: number): number {
  return markup / (100 + markup) * 100;
}

/** Stored markup stays at one decimal, the precision shared by saved choices and shareable links. */
export function markupFromPriceInput(raw: string, basis: CashPercentageBasis): CashNumberResult {
  const parsed = parseCashAmount(raw, MAX_CASH_MARKUP, 4);
  if (parsed.error !== null) {
    return { value: null, error: parsed.error === 'Vul een bedrag in.' ? 'Vul een percentage in.'
      : basis === 'margin' ? 'Gebruik een marge van 0 tot 90,9 %, met maximaal vier decimalen.'
      : 'Gebruik een opslag van 0 tot 1.000 %, met maximaal vier decimalen.' };
  }
  if (basis === 'margin' && parsed.value > marginFromMarkup(MAX_CASH_MARKUP)) {
    return { value: null, error: 'Kies een marge van 0 tot 90,9 %. Dat is maximaal 1.000 % opslag.' };
  }
  const markup = basis === 'margin' ? parsed.value / (100 - parsed.value) * 100 : parsed.value;
  return { value: Math.round(markup * 10) / 10, error: null };
}

export function cashPercentText(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString('nl-BE', { maximumFractionDigits: 1 });
}
