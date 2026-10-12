import type { BankBalance, CompanyCost, CostParty, Fair, RecurringCost } from '../../core/api/models';

/*
 * The six sections of the Kosten & bank workspace, one daily question each,
 * and the calendar helpers every section shares. Only type imports: the node
 * tests run this file on its own.
 */

/** The sections; the address bar carries the one on screen as `view` (see finance-url.ts). */
export type FinanceView = 'overview' | 'open' | 'incoming' | 'bank' | 'costs' | 'analysis';
export type FinanceGroup = 'Vandaag' | 'Geld' | 'Boekhouding';

export interface FinanceSection {
  id: FinanceView;
  label: string;
  /** The phone tab label and the rail label. */
  short: string;
  group: FinanceGroup;
  icon: string;
  /** The question the section answers; the sidebar tooltip. */
  hint: string;
  /** Analyse lives behind the ⋯ menu on a phone. */
  phoneTab: boolean;
}

/** One order for the sidebar, the phone tab bar and the shortcuts 1-6. */
export const FINANCE_SECTIONS: readonly FinanceSection[] = [
  { id: 'overview', label: 'Overzicht', short: 'Overzicht', group: 'Vandaag', icon: 'home', hint: 'Hoe staan we ervoor en wat vraagt mij nu?', phoneTab: true },
  { id: 'open', label: 'Te betalen', short: 'Betalen', group: 'Geld', icon: 'arrow-out', hint: 'Wat moet er nog betaald worden?', phoneTab: true },
  { id: 'incoming', label: 'Te ontvangen', short: 'Ontvangen', group: 'Geld', icon: 'arrow-in', hint: 'Wie moet ons nog betalen en wat kwam binnen?', phoneTab: true },
  { id: 'bank', label: 'Bank', short: 'Bank', group: 'Geld', icon: 'bank', hint: 'Klopt mijn banksaldo?', phoneTab: true },
  { id: 'costs', label: 'Uitgaven', short: 'Uitgaven', group: 'Boekhouding', icon: 'receipt', hint: 'Waaraan geven we geld uit?', phoneTab: true },
  { id: 'analysis', label: 'Analyse', short: 'Analyse', group: 'Boekhouding', icon: 'analytics', hint: 'Per categorie, per maand, de btw-aangifte', phoneTab: false },
];

export const FINANCE_GROUPS: readonly FinanceGroup[] = ['Vandaag', 'Geld', 'Boekhouding'];

export interface FinanceTab {
  id: string;
  label: string;
  /** Shorter on the phone segmented control and the narrow desk toolbar. */
  short: string;
}

/** The segments per section; the first is the default and never appears in the address. */
export const FINANCE_TABS: Readonly<Record<FinanceView, readonly FinanceTab[]>> = {
  overview: [],
  open: [
    { id: 'all', label: 'Alles', short: 'Alles' },
    { id: 'costs', label: 'Kosten', short: 'Kosten' },
    /* Four segments on a 375px phone: 'Containers' would be cut to 'Contain…'. */
    { id: 'containers', label: 'Containers', short: 'Cont.' },
    { id: 'recurring', label: 'Vaste kosten', short: 'Vast' },
  ],
  incoming: [
    { id: 'open', label: 'Openstaand', short: 'Openstaand' },
    { id: 'received', label: 'Ontvangen', short: 'Ontvangen' },
  ],
  bank: [
    { id: 'accounts', label: 'Rekeningen', short: 'Rekeningen' },
    { id: 'movements', label: 'Bewegingen', short: 'Bewegingen' },
  ],
  costs: [
    { id: 'company', label: 'Bedrijfskosten', short: 'Kosten' },
    /* Four segments here too: 'Cont.' on a 375px phone. */
    { id: 'containers', label: 'Containers', short: 'Cont.' },
    { id: 'recurring', label: 'Vaste kosten', short: 'Vast' },
    { id: 'lists', label: 'Aan wie & beurzen', short: 'Lijsten' },
  ],
  analysis: [
    { id: 'costs', label: 'Kosten', short: 'Kosten' },
    { id: 'vat', label: 'Btw-aangifte', short: 'Btw' },
  ],
};

export function financeSection(view: FinanceView): FinanceSection {
  return FINANCE_SECTIONS.find((section) => section.id === view) ?? FINANCE_SECTIONS[0];
}

/* ---------------------------------------------------------------- calendar */

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * A day in the browser's own calendar, not UTC: a cost booked at one in the
 * morning belongs to that morning. Called at action time, never cached at
 * import, so a tab left open overnight moves on with the clock.
 */
export function localIsoDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type PeriodId = 'month' | 'quarter' | 'year' | 'lastYear' | 'all';

/** A period preset as a day range up to today; 'all' is open on both ends (''). */
export function periodRange(id: PeriodId, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (id) {
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'quarter': return { from: `${year}-${pad(Math.floor((month - 1) / 3) * 3 + 1)}-01`, to: today };
    case 'year': return { from: `${year}-01-01`, to: today };
    case 'lastYear': return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    default: return { from: '', to: '' };
  }
}

/** A new cost starts as a Belgian invoice, fully deductible; the kind follows the category until the form says otherwise. */
export function blankCost(today: string): CompanyCost {
  return { id: null, date: today, category: 'ANDERE', description: '', party: '', amountExclEur: 0, amountInclEur: null, vatPct: 21, reference: '', paidOn: null, salesChannel: null, notes: '', recurringCostId: null,
    vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE', costKind: null, expenseType: 'STANDARD', vatDeductiblePct: 100, taxDeductiblePct: 100, depreciationYears: null, depreciationStart: null };
}

export function blankRecurring(today: string): RecurringCost {
  return { id: null, name: '', category: 'HUUR', party: '', amountExclEur: 0, vatPct: 21, salesChannel: null, interval: 'MONTHLY', startDate: today, endDate: null, active: true, autoPaid: false, reference: '', notes: '',
    vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE', costKind: null, expenseType: 'STANDARD', vatDeductiblePct: 100, taxDeductiblePct: 100 };
}

/** A new name for the Aan wie list, without defaults until the sheet sets them. */
export function blankCostParty(name = ''): CostParty {
  return { id: null, name, category: null, vatPct: null, salesChannel: null, iban: null, country: null, vatNumber: null, vatRegime: null };
}

/** A new fair; the server derives the code from the label. */
export function blankFair(): Fair {
  return { id: null, code: '', label: '', active: true };
}

/** New readings are taken now, in the bank's own zone. */
export function blankBalance(today: string, account = ''): BankBalance {
  return { id: null, account, date: today, asOfAt: new Date().toISOString(), timeZone: 'Europe/Brussels', balanceEur: 0, notes: '' };
}
