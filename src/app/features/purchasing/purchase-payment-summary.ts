import type { Currency } from '../../core/api/models';

/**
 * The read-only line in the payment sheet's foot (Inkoop redesign §2.5, 2026-10-17):
 * what the save will record, in one sentence, just above the buttons.
 *
 *   '€ 11.421,38 aan Leverancier · 1/3 bij bestelling · banktransactie 16/10/2026'
 *   'US$ 12.500,00 aan Leverancier (≈ € 11.421,38) · nog geen banktransactie'
 *   '€ 34.264,14 verdeeld over 3 containers · banktransactie 16/10/2026'
 *
 * Pure and node tested: the sheet hands in the words it already has (the payee
 * label, the chosen term, the share and the bank state); this module imports types only.
 */
export interface PurchaseSheetSummaryDraft {
  amount: number | null;
  currency: Currency;
}

export interface PurchaseSheetSummaryContext {
  /** 'Leverancier', 'Douane & transport', … (PAYEE_LABEL of the draft's payee). */
  payeeLabel: string;
  /** The chosen instalment's label ('1/3 bij bestelling'); null without one. */
  termLabel: string | null;
  /** The euro of a USD/CNY transfer when it is known; ignored for a euro payment. */
  amountEur: number | null;
  /** One transaction shared over containers: the whole transaction and how many containers take a part. */
  share: { totalEur: number; containers: number } | null;
  /** The transaction the save links: its booking day (YYYY-MM-DD…), 'linked' when the payment already sits on the bank, null when none. */
  bank: { day: string } | 'linked' | null;
}

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });

/** As the cur pipe writes it: '€ 1.234,50', 'US$ 12.500,00'. */
function money(value: number, currency: Currency): string {
  return currency === 'EUR' ? EURO.format(value) : new Intl.NumberFormat('nl-BE', { style: 'currency', currency }).format(value);
}

function day(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** The summary line, or null while there is no amount to describe. Every amount sits in one no-break run. */
export function purchaseSheetSummary(draft: PurchaseSheetSummaryDraft, ctx: PurchaseSheetSummaryContext): string | null {
  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const bank = ctx.bank === 'linked' ? ' · op de bank'
    : ctx.bank ? ` · banktransactie ${day(ctx.bank.day)}` : ' · nog geen banktransactie';
  if (ctx.share && ctx.share.containers > 1 && ctx.share.totalEur > 0) {
    return `${EURO.format(ctx.share.totalEur)} verdeeld over ${ctx.share.containers} containers${bank}`;
  }
  const euro = draft.currency !== 'EUR' && ctx.amountEur !== null && Number.isFinite(ctx.amountEur) && ctx.amountEur > 0
    ? ` (≈ ${EURO.format(ctx.amountEur)})` : '';
  const term = ctx.termLabel ? ` · ${ctx.termLabel}` : '';
  return `${money(amount, draft.currency)} aan ${ctx.payeeLabel}${euro}${term}${bank}`;
}
