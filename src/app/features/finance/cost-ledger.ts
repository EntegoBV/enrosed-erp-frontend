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
  /** Invoice including VAT, or the actual EUR amount paid on the container. */
  amountEur: number;
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

export function costLedger(costs: readonly CompanyCost[], payments: readonly PurchasePaymentRow[]): CostLedgerRow[] {
  const rows: CostLedgerRow[] = costs.map((cost, index) => ({
    key: `cost:${cost.id ?? `new-${index}`}`, source: 'company', date: cost.date, category: cost.category,
    description: cost.description, party: cost.party, reference: cost.reference, paidOn: cost.paidOn,
    amountEur: round2(money(cost.amountExclEur) + round2(money(cost.amountExclEur) * Math.max(0, money(cost.vatPct)) / 100)),
    cost, payment: null,
  }));
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
      paidOn: payment.paidOn, amountEur: round2(money(payment.amountEur)), cost: null, payment,
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
  status?: 'all' | 'open' | 'paid';
  source?: 'all' | 'company' | 'container';
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
    && (filter.status !== 'paid' || !!row.paidOn) && (filter.status !== 'open' || !row.paidOn)
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
    paidEur: round2(rows.filter((row) => !!row.paidOn).reduce((sum, row) => sum + row.amountEur, 0)),
  };
}

/**
 * One export with an explicit source; unknown purchase VAT stays empty rather
 * than being reported as 0%. With `documents` a Documenten column follows,
 * holding the file names of each row.
 */
export function costLedgerCsv(rows: readonly CostLedgerRow[], categoryLabel: (code: string) => string,
                              documents?: (row: CostLedgerRow) => string): string {
  const cell = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : value;
    return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = ['Datum', 'Bron', 'Categorie', 'Omschrijving', 'Aan wie / betaalstroom', 'Referentie', 'Bedrag excl. btw', 'Btw %', 'Btw', 'Factuur incl. btw', 'Betaald EUR', 'Betaald op', 'Container-ID', 'Betaling-ID', 'Verkoopkanaal', 'Vaste kost', 'Notities',
    ...(documents ? ['Documenten'] : [])];
  const lines = [...rows].sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key)).map((row) => {
    const cost = row.cost;
    return [row.date, cost ? 'Bedrijfskost' : 'Containerbetaling', categoryLabel(row.category), row.description, row.party, row.reference,
      cost?.amountExclEur, cost?.vatPct, cost ? round2(row.amountEur - money(cost.amountExclEur)) : null, cost ? row.amountEur : null,
      row.paidOn ? row.amountEur : null, row.paidOn, row.payment ? String(row.payment.orderId) : null,
      row.payment ? String(row.payment.id) : null, cost?.salesChannel, cost ? (cost.recurringCostId ? 'ja' : 'nee') : null,
      cost?.notes ?? (row.payment ? 'Automatisch gekoppeld; beheren bij de container. Btw niet uit betaling afgeleid.' : null),
      ...(documents ? [documents(row)] : []),
    ].map(cell).join(';');
  });
  return [header.join(';'), ...lines].join('\r\n');
}
