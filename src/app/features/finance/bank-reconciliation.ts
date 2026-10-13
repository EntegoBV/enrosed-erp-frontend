import type { BankAccount, BankStatementLine } from '../../core/api/banking-api';
import type { BankBalance, IncomingPaymentRow } from '../../core/api/models';
import { receiptInstant } from '../../shared/received-at';

export const bankAccountKey = (value: string | null | undefined): string => {
  const key = (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return /^[A-Z]{2}[0-9]{2}[A-Z0-9 ]{11,34}$/.test(key) ? key.replace(/ /g, '') : key;
};
/** Only aliases explicitly registered by staff merge account identities. */
export function canonicalBankAccount(value: string | null | undefined, accounts: readonly BankAccount[]): string {
  const key = bankAccountKey(value);
  return accounts.find(account => bankAccountKey(account.key) === key || account.aliases.some(alias => bankAccountKey(alias) === key))?.key ?? key;
}
const cents = (value: number): number => Math.round(value * 100) / 100;
const readable = (value: string | null | undefined): string => (value ?? '').trim().replace(/\s+/g, ' ');
export function bankCheckpoint(row: BankBalance): number {
  if (row.asOfAt) return Date.parse(row.asOfAt);
  try { return Date.parse(receiptInstant(row.date, '23:59:59', row.timeZone || 'Europe/Brussels')) + 999; }
  catch { return NaN; }
}

/** A linked bank movement replaces its invoice payment; independent account-bound entries remain additive. */
export function reconciledBank(balances: readonly BankBalance[], lines: readonly BankStatementLine[], payments: readonly IncomingPaymentRow[], registry: readonly BankAccount[] = []) {
  const keyOf = (value: string | null | undefined) => canonicalBankAccount(value, registry);
  const bankRows = [...new Map(lines.map(row => [row.id, row])).values()];
  const receipts = [...new Map(payments.map(row => [row.id, row])).values()];
  const linked = new Set(bankRows.map(row => row.salesPaymentId).filter((id): id is number => id !== null));
  const unlinked = receipts.filter(row => !linked.has(row.id));
  const keys = new Set([...registry.map(row => keyOf(row.key)), ...balances.map(b => keyOf(b.account)), ...bankRows.map(b => keyOf(b.account)), ...unlinked.map(p => keyOf(p.bankAccount)).filter(Boolean)]);
  const accounts = [...keys].filter(Boolean).sort().map(account => {
    const reading = balances.filter(row => keyOf(row.account) === account).sort((a, b) => bankCheckpoint(b) - bankCheckpoint(a) || (b.id ?? 0) - (a.id ?? 0))[0];
    const entered = bankRows.filter(row => keyOf(row.account) === account);
    const manual = unlinked.filter(row => keyOf(row.bankAccount) === account);
    const metadata = registry.find(row => bankAccountKey(row.key) === account);
    const source = metadata?.source === 'ODOO' || entered.some(row => row.source === 'ODOO') ? 'ODOO' as const : 'MANUAL' as const;
    const official = source === 'ODOO' ? entered.filter(row => row.source === 'ODOO') : entered;
    const checkpoint = reading ? bankCheckpoint(reading) : NaN;
    const movements = [
      ...official.filter(row => Date.parse(row.bookedAt) > checkpoint).map(row => ({ key: `bank:${row.id}`, at: row.bookedAt, amountEur: row.amountEur })),
      ...(source === 'ODOO' ? [] : manual).filter(row => Date.parse(row.receivedAt) > checkpoint).map(row => ({ key: `payment:${row.id}`, at: row.receivedAt, amountEur: row.amountEur })),
    ];
    const deltaEur = cents(movements.reduce((sum, row) => sum + row.amountEur, 0));
    /* Keys are upper case; people read the name as last typed on a reading, else as the line or receipt had it. */
    const label = readable(metadata?.label) || readable(reading?.account) || readable(entered[0]?.account) || readable(manual[0]?.bankAccount) || account;
    const checkedAt = reading && Number.isFinite(checkpoint) ? new Date(checkpoint).toISOString() : null;
    return { account, label, source, archived: metadata?.archived ?? false,
      aliases: metadata?.aliases ?? [], odooJournalId: metadata?.odooJournalId ?? null,
      manualMovementsAllowed: source !== 'ODOO' && !metadata?.archived && metadata?.manualMovementsAllowed !== false,
      historicalManualLines: entered.length - official.length, checkedAt, reading: reading ?? null, movements, deltaEur,
      currentEur: reading && Number.isFinite(checkpoint) ? cents(reading.balanceEur + deltaEur) : null,
      unlinkedBookings: manual.length, unallocatedLines: official.filter(row => !row.allocated && !row.salesPaymentId).length };
  });
  const active = accounts.filter(row => !row.archived);
  return { accounts, totalEur: cents(active.reduce((sum, row) => sum + (row.currentEur ?? 0), 0)),
    missingReadings: active.filter(row => row.currentEur === null).length,
    unassignedPayments: unlinked.filter(row => !keyOf(row.bankAccount)).length };
}
