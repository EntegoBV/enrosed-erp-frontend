import type { SalesPaymentRequest } from '../core/api/models';

export function receiptLocalParts(instant: string | number, timeZone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((row) => row.type === type)?.value ?? '';
  return { day: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}:${part('second')}` };
}

/** Convert a bank's local timestamp to an instant, rejecting gaps/ambiguity at clock changes. */
export function receiptInstant(day: string, time: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) throw new Error('Vul een geldige datum en tijd in.');
  try { new Intl.DateTimeFormat('nl-BE', { timeZone }).format(); }
  catch { throw new Error('Kies een geldige tijdzone, bijvoorbeeld Europe/Brussels.'); }
  const local = `${day}T${time.length === 5 ? time + ':00' : time}`;
  const utcGuess = Date.parse(`${local}Z`);
  if (!Number.isFinite(utcGuess) || new Date(utcGuess).toISOString().slice(0, 19) !== local) throw new Error('Deze datum of tijd bestaat niet.');
  // Time zones can change offset that day. Inspect offsets on both sides of the instant.
  const offsets = new Set<number>();
  for (const hours of [-36, 0, 36]) {
    const at = utcGuess + hours * 3_600_000;
    const zoned = receiptLocalParts(at, timeZone);
    offsets.add(Date.parse(`${zoned.day}T${zoned.time}Z`) - at);
  }
  const matches = [...offsets].map((offset) => utcGuess - offset).filter((candidate) => {
    const zoned = receiptLocalParts(candidate, timeZone);
    return `${zoned.day}T${zoned.time}` === local;
  });
  if (!matches.length) throw new Error('Deze lokale tijd bestaat niet door de omschakeling naar zomertijd. Controleer het bankafschrift.');
  if (matches.length > 1) throw new Error('Deze tijd komt tweemaal voor door wintertijd. Gebruik UTC met het exacte tijdstip van de bank.');
  return new Date(matches[0]).toISOString();
}


export interface ReceiptDraft {
  direction?: 'RECEIPT' | 'REFUND';
  bankAccount?: string;
  id?: number;
  amount: number;
  day: string;
  time: string;
  timeZone: string;
  reference: string;
}

export function receiptRequest(draft: ReceiptDraft, now = Date.now()): SalesPaymentRequest {
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) throw new Error('Vul een ontvangen bedrag groter dan nul in.');
  if (Math.abs(draft.amount * 100 - Math.round(draft.amount * 100)) > 0.00001) throw new Error('Gebruik maximaal twee decimalen voor het ontvangen bedrag.');
  const receivedAt = receiptInstant(draft.day, draft.time, draft.timeZone.trim());
  if (Date.parse(receivedAt) > now + 300_000) throw new Error('Een ontvangen betaling kan niet in de toekomst liggen.');
  return { ...(draft.direction ? { direction: draft.direction } : {}), ...(draft.bankAccount !== undefined ? { bankAccount: draft.bankAccount.trim() || null } : {}), amountEur: Math.round(draft.amount * 100) / 100, receivedAt, timeZone: draft.timeZone.trim(), reference: draft.reference.trim() || null };
}
