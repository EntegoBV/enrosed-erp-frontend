import type { BankStatementLine } from '../core/api/banking-api';

export type BankDirection = 'INCOMING' | 'OUTGOING' | 'ANY';
export function bankTransactionAllocated(row: BankStatementLine): boolean {
  return !!row.allocated || row.salesPaymentId != null;
}
export function bankTransactionDay(row: BankStatementLine): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: row.timeZone || 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(row.bookedAt));
    const value = (key: string) => parts.find(part => part.type === key)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  } catch { return row.bookedAt.slice(0, 10); }
}
export function bankTransactionOptions(rows: readonly BankStatementLine[], direction: BankDirection, query = '', amount: number | null = null, exact = false): BankStatementLine[] {
  const cents = amount != null && Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
  const words = query.trim().toLocaleLowerCase('nl-BE').split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    if ((direction === 'INCOMING' && row.amountEur <= 0) || (direction === 'OUTGOING' && row.amountEur >= 0)) return false;
    if (exact && cents !== null && Math.round(Math.abs(row.amountEur) * 100) !== cents) return false;
    const day = bankTransactionDay(row);
    const text = [row.reference, row.counterparty, row.account, row.amountEur.toFixed(2), Math.abs(row.amountEur).toLocaleString('nl-BE', { minimumFractionDigits: 2 }), day, day.split('-').reverse().join('/'), row.source === 'ODOO' ? 'Odoo' : 'Handmatig', row.allocationLabel].join(' ').toLocaleLowerCase('nl-BE');
    return words.every(word => text.includes(word));
  }).sort((left, right) => Number(bankTransactionAllocated(left)) - Number(bankTransactionAllocated(right))
    || (cents === null ? 0 : Number(Math.round(Math.abs(right.amountEur) * 100) === cents) - Number(Math.round(Math.abs(left.amountEur) * 100) === cents))
    || right.bookedAt.localeCompare(left.bookedAt) || right.id - left.id);
}
