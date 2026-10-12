import type { CompanyCost, Payee, PurchasePaymentRow } from '../../core/api/models';

/** The shared list keeps invoices and container cash distinct: a payment does not establish deductible VAT or a second operating expense. */
export interface CostLedgerRow {
  key: string;
  source: 'company' | 'container';
  date: string;
  category: string;
  description: string;
  party: string | null;
  reference: string | null;
  paidOn: string | null;
  /** What the bank pays for the cost (the cash total), or the actual EUR amount paid on the container. */
  amountEur: number;
  /** What is still to pay; 0 on container rows. */
  openEur: number;
  /** 'partial' once a payment is in but the cost is not settled; container rows are 'paid'. */
  status: 'open' | 'partial' | 'paid';
  cost: CompanyCost | null;
  payment: PurchasePaymentRow | null;
}

/*
 * Payee wording shared with Inkoop: keep these four in step with PAYEE_LABEL
 * in purchasing/purchase-payment-ledger.ts (both tests assert the words).
 */
export const CONTAINER_PAYMENT_CATEGORIES = [
  { code: 'CONTAINER_SUPPLIER', label: 'Container · leverancier' },
  { code: 'CONTAINER_LOGISTICS', label: 'Container · douane & transport' },
  { code: 'CONTAINER_SEPARATE', label: 'Container · inspectie & andere kosten' },
  { code: 'CONTAINER_OTHER', label: 'Container · bijkomende kosten' },
] as const;

export function paymentPayeeLabel(payee?: Payee | null): string {
  return payee === 'LOGISTICS' ? 'Douane & transport' : payee === 'SEPARATE' ? 'Inspectie & andere kosten'
    : payee === 'OTHER' ? 'Bijkomende kosten' : 'Leverancier';
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const money = (value: number | null | undefined): number => Number.isFinite(value) ? value as number : 0;
const cents = (value: number): number => Math.round(value * 100);

/** The open amount of a cost: the server's figure, else the whole cash total until a paid date (older responses). */
function openOf(cost: CompanyCost, cash: number): number {
  if (Number.isFinite(cost.openEur as number)) return Math.max(0, cents(cost.openEur as number)) / 100;
  return cost.paidOn ? 0 : cash;
}

/**
 * The cash of a cost comes in through `cash` (cashTotalOf of
 * finance-metrics.ts): the money rule lives there, this file imports nothing
 * at runtime.
 */
export function costLedger(costs: readonly CompanyCost[], payments: readonly PurchasePaymentRow[], cash: (cost: CompanyCost) => number): CostLedgerRow[] {
  const rows: CostLedgerRow[] = costs.map((cost, index) => {
    const amountEur = round2(money(cash(cost)));
    const openEur = openOf(cost, amountEur);
    return {
      key: `cost:${cost.id ?? `new-${index}`}`, source: 'company', date: cost.date, category: cost.category,
      description: cost.description, party: cost.party, reference: cost.reference, paidOn: cost.paidOn,
      amountEur, openEur, status: openEur <= 0 ? 'paid' : cents(openEur) < cents(amountEur) ? 'partial' : 'open',
      cost, payment: null,
    };
  });
  // PurchasePayment is the source of truth. Reloading reflects additions, edits and deletions without a backfill or copied cost.
  const seen = new Set<number>();
  for (const payment of payments) {
    if (seen.has(payment.id)) continue;
    seen.add(payment.id);
    rows.push({
      key: `payment:${payment.id}`, source: 'container', date: payment.paidOn,
      category: `CONTAINER_${payment.payee ?? 'SUPPLIER'}`,
      description: payment.label?.trim() || `${paymentPayeeLabel(payment.payee)} · containerbetaling`,
      party: paymentPayeeLabel(payment.payee), reference: [payment.orderNumber, payment.orderAlias].filter(Boolean).join(' · ') || `Container #${payment.orderId}`,
      paidOn: payment.paidOn, amountEur: round2(money(payment.amountEur)), openEur: 0, status: 'paid', cost: null, payment,
    });
  }
  return rows.sort((left, right) => right.date.localeCompare(left.date) || left.key.localeCompare(right.key));
}

/**
 * Whether a company cost still waits for its invoice or receipt: no file on
 * it, and not booked by a recurring definition (rent or a subscription has
 * its contract, not a document per period). One rule for the 'Zonder
 * document' filter, Analyse and the accountant package; the attention queue
 * (finance-attention.ts, type-only imports) applies the same test to its input.
 */
export function missingDocument(cost: Pick<CompanyCost, 'id' | 'recurringCostId'>, documentedIds?: ReadonlySet<number>): boolean {
  return !cost.recurringCostId && !(cost.id !== null && !!documentedIds?.has(cost.id));
}

export interface CostLedgerFilter {
  from?: string | null;
  to?: string | null;
  query?: string;
  category?: string;
  /** 'open' includes partly paid costs. */
  status?: 'all' | 'open' | 'paid';
  source?: 'all' | 'company' | 'container';
  /** A regime code, or 'unconfirmed' for costs whose regime is derived or unknown; '' is every regime. */
  regime?: string;
  containerId?: number | null;
  /** 'missing' keeps only company costs that miss their document (see missingDocument; container rows never qualify). */
  docs?: 'missing' | null;
  /** The ids of company costs that have at least one document. */
  documentedIds?: ReadonlySet<number>;
}

export function containerFilterId(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function filterCostLedger(rows: readonly CostLedgerRow[], filter: CostLedgerFilter = {},
                                 categoryLabel: (code: string) => string = (code) => code,
                                 channelLabel: (code: string) => string = (code) => code): CostLedgerRow[] {
  const needle = filter.query?.trim().toLocaleLowerCase();
  return rows.filter((row) => (!filter.from || row.date >= filter.from) && (!filter.to || row.date <= filter.to)
    && (!filter.containerId || row.payment?.orderId === filter.containerId)
    && (!filter.source || filter.source === 'all' || row.source === filter.source)
    && (!filter.category || row.category.toUpperCase() === filter.category.toUpperCase())
    && (filter.status !== 'paid' || row.status === 'paid') && (filter.status !== 'open' || row.status !== 'paid')
    && (!filter.regime || (!!row.cost && (filter.regime === 'unconfirmed' ? !row.cost.vatRegimeConfirmed || !row.cost.vatRegime : row.cost.vatRegime === filter.regime)))
    && (filter.docs !== 'missing' || (!!row.cost && missingDocument(row.cost, filter.documentedIds)))
    && (!needle || [row.description, row.party, row.reference, row.cost?.notes, row.cost?.salesChannel,
      categoryLabel(row.category), row.cost?.salesChannel ? channelLabel(row.cost.salesChannel) : null,
      row.source === 'container' ? 'containerbetaling automatisch gekoppeld' : 'bedrijfskost']
      .some((part) => part?.toLocaleLowerCase().includes(needle))));
}

export function costLedgerTotals(rows: readonly CostLedgerRow[]): { containerCount: number; containerPaidEur: number; paidEur: number } {
  const container = rows.filter((row) => row.source === 'container');
  return {
    containerCount: container.length,
    containerPaidEur: round2(container.reduce((sum, row) => sum + row.amountEur, 0)),
    paidEur: round2(rows.reduce((sum, row) => sum + row.amountEur - row.openEur, 0)),
  };
}

/** The six regime columns without the labels of finance-metrics (costRegimeCells there gives the labelled form). */
const rawRegimeCells = (cost: CompanyCost): (string | number | null)[] => [cost.vatRegime ?? null, cost.supplierCountry ?? null, cost.costKind ?? null,
  money(cost.vatDeductiblePct ?? 100), money(cost.taxDeductiblePct ?? 100), cost.costKind === 'INVESTMENT' && cost.depreciationYears ? String(cost.depreciationYears) : null];

/**
 * One export with an explicit source; unknown purchase VAT stays empty rather
 * than being reported as 0%. With `documents` a Documenten column follows,
 * holding the file names of each row. 'Btw' is what the return shows, which
 * `vat` (returnVatOf) supplies; without it the difference to the cash total.
 */
export function costLedgerCsv(rows: readonly CostLedgerRow[], categoryLabel: (code: string) => string,
                              documents?: (row: CostLedgerRow) => string, channelLabel: (code: string) => string = (code) => code,
                              vat?: (cost: CompanyCost) => number, regimeCells: (cost: CompanyCost) => (string | number | null)[] = rawRegimeCells): string {
  const cell = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : value;
    return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = ['Datum', 'Bron', 'Categorie', 'Omschrijving', 'Aan wie / betaalstroom', 'Referentie', 'Bedrag excl. btw', 'Btw %', 'Btw', 'Factuur incl. btw', 'Betaald EUR', 'Betaald op', 'Container-ID', 'Betaling-ID', 'Verkoopkanaal', 'Vaste kost',
    'Btw-regeling', 'Land', 'Soort', 'Btw aftrekbaar %', 'Fiscaal aftrekbaar %', 'Investering (jaren)', 'Notities',
    ...(documents ? ['Documenten'] : [])];
  const lines = [...rows].sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key)).map((row) => {
    const cost = row.cost;
    const paidEur = round2(row.amountEur - row.openEur);
    return [row.date, cost ? 'Bedrijfskost' : 'Containerbetaling', categoryLabel(row.category), row.description, row.party, row.reference,
      cost?.amountExclEur, cost?.vatPct, cost ? (vat ? round2(vat(cost)) : round2(row.amountEur - money(cost.amountExclEur))) : null, cost ? row.amountEur : null,
      paidEur > 0 ? paidEur : null, row.paidOn, row.payment ? String(row.payment.orderId) : null,
      row.payment ? String(row.payment.id) : null, cost?.salesChannel ? channelLabel(cost.salesChannel) : null, cost ? (cost.recurringCostId ? 'ja' : 'nee') : null,
      ...(cost ? regimeCells(cost) : [null, null, null, null, null, null]),
      cost?.notes ?? (row.payment ? 'Automatisch gekoppeld; beheren bij de container. Btw niet uit betaling afgeleid.' : null),
      ...(documents ? [documents(row)] : []),
    ].map(cell).join(';');
  });
  return [header.join(';'), ...lines].join('\r\n');
}
