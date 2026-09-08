import type { BankStatementLine } from '../../core/api/banking-api';
import type { BankBalance, IncomingPaymentRow } from '../../core/api/models';
import { receiptInstant } from '../../shared/received-at';

export const bankAccountKey = (value: string | null | undefined): string => {
  const key = (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return /^[A-Z]{2}[0-9]{2}[A-Z0-9 ]{11,34}$/.test(key) ? key.replace(/ /g, '') : key;
};
const cents = (value: number): number => Math.round(value * 100) / 100;
export function bankCheckpoint(row: BankBalance): number {
  if (row.asOfAt) return Date.parse(row.asOfAt);
  try { return Date.parse(receiptInstant(row.date, '23:59:59', row.timeZone || 'Europe/Brussels')) + 999; }
  catch { return NaN; }
}

/** A linked bank movement replaces its invoice payment; independent account-bound entries remain additive. */
export function reconciledBank(balances: readonly BankBalance[], lines: readonly BankStatementLine[], payments: readonly IncomingPaymentRow[]) {
  const bankRows = [...new Map(lines.map(row => [row.id, row])).values()];
  const receipts = [...new Map(payments.map(row => [row.id, row])).values()];
  const linked = new Set(bankRows.map(row => row.salesPaymentId).filter((id): id is number => id !== null));
  const unlinked = receipts.filter(row => !linked.has(row.id));
  const keys = new Set([...balances.map(b => bankAccountKey(b.account)), ...bankRows.map(b => bankAccountKey(b.account)), ...unlinked.map(p => bankAccountKey(p.bankAccount)).filter(Boolean)]);
  const accounts = [...keys].filter(Boolean).sort().map(account => {
    const reading = balances.filter(row => bankAccountKey(row.account) === account).sort((a, b) => bankCheckpoint(b) - bankCheckpoint(a) || (b.id ?? 0) - (a.id ?? 0))[0];
    const entered = bankRows.filter(row => bankAccountKey(row.account) === account);
    const manual = unlinked.filter(row => bankAccountKey(row.bankAccount) === account);
    const checkpoint = reading ? bankCheckpoint(reading) : NaN;
    const movements = [
      ...entered.filter(row => Date.parse(row.bookedAt) > checkpoint).map(row => ({ key: `bank:${row.id}`, at: row.bookedAt, amountEur: row.amountEur })),
      ...manual.filter(row => Date.parse(row.receivedAt) > checkpoint).map(row => ({ key: `payment:${row.id}`, at: row.receivedAt, amountEur: row.amountEur })),
    ];
    const deltaEur = cents(movements.reduce((sum, row) => sum + row.amountEur, 0));
    return { account, reading: reading ?? null, movements, deltaEur,
      currentEur: reading && Number.isFinite(checkpoint) ? cents(reading.balanceEur + deltaEur) : null,
      unlinkedBookings: manual.length, unallocatedLines: entered.filter(row => !row.salesPaymentId).length };
  });
  return { accounts, totalEur: cents(accounts.reduce((sum, row) => sum + (row.currentEur ?? 0), 0)),
    missingReadings: accounts.filter(row => row.currentEur === null).length,
    unassignedPayments: unlinked.filter(row => !bankAccountKey(row.bankAccount)).length };
}
