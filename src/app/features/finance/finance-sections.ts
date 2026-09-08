import type { BankBalance, CompanyCost, RecurringCost } from '../../core/api/models';

/** The sections of the Kosten & bank workspace; the address bar carries the one on screen as `view`. */
export type FinanceView = 'overview' | 'costs' | 'open' | 'recurring' | 'bank' | 'analysis';

export interface FinanceSection {
  id: FinanceView;
  label: string;
  /** Compact navigation label. */
  short: string;
  hint: string;
  icon: string;
}

export const FINANCE_SECTIONS: readonly FinanceSection[] = [
  { id: 'overview', label: 'Overzicht', short: 'Overzicht', hint: 'Je saldo, wat nog betaald moet worden en wat je nog ontvangt', icon: 'home' },
  { id: 'costs', label: 'Kosten', short: 'Kosten', hint: 'Bedrijfskosten en gekoppelde containerbetalingen, per maand', icon: 'exchange' },
  { id: 'open', label: 'Te betalen', short: 'Te betalen', hint: 'Open bedrijfskosten, van oud naar nieuw', icon: 'bell' },
  { id: 'recurring', label: 'Vaste kosten', short: 'Vaste kosten', hint: 'Huur, boekhouder, software: automatisch geboekt', icon: 'activity' },
  { id: 'bank', label: 'Bank & betalingen', short: 'Bank', hint: 'Noteer geld in en uit, koppel factuurbetalingen en controleer je saldo', icon: 'stock' },
  { id: 'analysis', label: 'Analyse', short: 'Analyse', hint: 'Per categorie, per maand, per kanaal', icon: 'analytics' },
];

export function financeView(raw: string | null | undefined): FinanceView {
  return FINANCE_SECTIONS.some((section) => section.id === raw) ? (raw as FinanceView) : 'overview';
}

export function financeSection(view: FinanceView): FinanceSection {
  return FINANCE_SECTIONS.find((section) => section.id === view) ?? FINANCE_SECTIONS[0];
}

const pad = (value: number): string => String(value).padStart(2, '0');
const now = new Date();
/** Today in the browser's own calendar, not UTC: a cost booked at one in the morning belongs to that morning. */
export const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const YEAR = Number(TODAY.slice(0, 4));
export const MONTH_START = `${TODAY.slice(0, 7)}-01`;

export function blankCost(): CompanyCost {
  return { id: null, date: TODAY, category: 'ANDERE', description: '', party: '', amountExclEur: 0, vatPct: 21, reference: '', paidOn: null, salesChannel: null, notes: '', recurringCostId: null };
}

export function blankRecurring(): RecurringCost {
  return { id: null, name: '', category: 'HUUR', party: '', amountExclEur: 0, vatPct: 21, salesChannel: null, interval: 'MONTHLY', startDate: TODAY, endDate: null, active: true, autoPaid: false, reference: '', notes: '' };
}

export function blankBalance(account = ''): BankBalance {
  return { id: null, account, date: TODAY, asOfAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Brussels', balanceEur: 0, notes: '' };
}
