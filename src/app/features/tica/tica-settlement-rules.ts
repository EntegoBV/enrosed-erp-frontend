import type { BankStatementLine } from '../../core/api/banking-api';

export type SettlementAmounts = {
  salesExcl: number | null; salesVat: number | null; commissionExcl: number | null;
  commissionVat: number | null; netReceivable: number | null;
};
const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100);
export function settlementDifference(value: SettlementAmounts): number | null {
  if ([value.salesExcl, value.salesVat, value.commissionExcl, value.commissionVat, value.netReceivable]
    .some(amount => typeof amount !== 'number' || !Number.isFinite(amount))) return null;
  return (cents(value.salesExcl!) + cents(value.salesVat!) - cents(value.commissionExcl!) - cents(value.commissionVat!) - cents(value.netReceivable!)) / 100;
}

/** An unallocated positive bank receipt; stale candidates are revalidated by the server. */
export function ticaBankCandidates(lines: readonly BankStatementLine[], expected: number, query = ''): BankStatementLine[] {
  const terms = query.toLocaleLowerCase('nl').trim().split(/\s+/).filter(Boolean);
  return lines.filter(line => line.amountEur > 0 && !line.allocated && !line.salesPaymentId && !line.salesOrderId && !line.allocatedAt && !line.classification && !line.ticaSettlementId)
    .filter(line => Math.abs(cents(line.amountEur) - cents(expected)) <= 2)
    .filter(line => terms.every(term => `${line.counterparty} ${line.reference} ${line.account} ${line.bookedAt}`.toLocaleLowerCase('nl').includes(term)))
    .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt) || b.id - a.id);
}
