import type { ContextMenuItem } from '../../shared/context-menu';
import {
  PAYEE_ICON, PAYEE_LABEL, PAYEE_ORDER, type LedgerRow, type PayeeLedger, type PaymentLedger, type PurchaseSettleRequest,
} from './purchase-payment-ledger';

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });

/** Euro the way the pipes write it, for menu hints and confirm messages built in code. */
export function formatEur(value: number): string {
  return EURO.format(Number.isFinite(value) ? value : 0);
}

/** 'Betaling aan…': always all four payees, with what is still open at each. */
export function payeeMenuItems(ledger: PaymentLedger | null): ContextMenuItem[] {
  return PAYEE_ORDER.map(payee => {
    const item = ledger?.payees.find(candidate => candidate.payee === payee);
    const hint = payee === 'OTHER' ? 'zonder afspraak' : !item?.agreedEur ? 'geen afspraak' : `${formatEur(item.openEur)} open`;
    return { id: payee, label: PAYEE_LABEL[payee], hint, iconName: PAYEE_ICON[payee] };
  });
}

/** The row menu of one payee on the desk. */
export function payeeRowMenuItems(payee: PayeeLedger, busy: boolean): ContextMenuItem[] {
  return [
    { id: 'add', label: 'Betaling noteren', iconName: 'plus', disabled: busy },
    ...(payee.canSettle ? [{ id: 'settle', label: 'Afrekenen…', iconName: 'tick', disabled: busy }] : []),
    ...(payee.canUndoSettle ? [{ id: 'undo', label: 'Afrekening ongedaan maken', iconName: 'restore', disabled: busy }] : []),
    ...(payee.payee === 'SUPPLIER' ? [{ id: 'plan', label: 'Betaalplan wijzigen', iconName: 'calendar', disabled: busy }] : []),
    { id: 'show', label: 'Toon betalingen', iconName: 'list', divider: true },
  ];
}

/** The menu of one payment. Only the desk moves a payment to another payee from here; the phone does it in the sheet. */
export function paymentMenuItems(row: LedgerRow, options: { move: boolean; busy: boolean }): ContextMenuItem[] {
  const busy = options.busy;
  const proofs = row.proofs ?? [];
  const items: ContextMenuItem[] = [
    { id: 'edit', label: 'Aanpassen', iconName: 'pencil', disabled: busy },
    { id: 'proof', label: 'Bewijs toevoegen', iconName: 'clip', disabled: busy },
    ...proofs.map(proof => ({ id: 'open:' + proof.id, iconName: 'document',
      label: proofs.length === 1 ? 'Bewijs openen' : 'Bewijs openen · ' + proof.originalFilename })),
  ];
  if (options.move) {
    PAYEE_ORDER.filter(payee => payee !== row.payee).forEach((payee, index) => items.push({
      id: 'move:' + payee, label: 'Verplaatsen naar ' + PAYEE_LABEL[payee], iconName: PAYEE_ICON[payee], divider: index === 0, disabled: busy,
    }));
  }
  if (row.payee !== 'OTHER') items.push({ id: 'settle', label: 'Afrekenen met deze betaling', iconName: 'tick', disabled: busy });
  items.push({ id: 'remove', label: options.move ? 'Verwijderen…' : 'Verwijderen', iconName: 'trash', danger: true, divider: true, disabled: busy });
  return items;
}

/** Settle on this very payment: its own term when it is tied to one, else the whole payee. */
export function settleWith(row: LedgerRow): PurchaseSettleRequest {
  return { payee: row.payee, scope: row.payee === 'SUPPLIER' && row.due ? 'TERM' : 'GROUP', due: row.payee === 'SUPPLIER' ? row.due : null, paymentId: row.id };
}

/** Status text colour through the kit's amount classes: warn, ok (green) or muted. */
export function toneClass(tone: 'warn' | 'ok' | 'neutral'): string {
  return tone === 'warn' ? 'wk-amount--warn' : tone === 'ok' ? 'wk-amount--in' : 'wk-amount--muted';
}

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** The date block of a phone ledger row: the day over the month, e.g. 14 / aug. */
export function dayOf(iso: string): string { return String(Number(iso.slice(8, 10)) || ''); }
export function monthOf(iso: string): string { return MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''; }

/** The sub-label of 'Betalingen' in the phone section navigation. */
export function paymentsNavLabel(ledger: PaymentLedger | null, state: { error: boolean; loading: boolean; concept: boolean }): string {
  if (state.error) return 'Opnieuw laden';
  if (state.loading || !ledger) return 'Bijwerken…';
  const summary = ledger.summary;
  if (state.concept) return 'Gepland';
  if (summary.dueNowEur > 0) return `${formatEur(summary.dueNowEur)} nu`;
  if (summary.openEur > 0) return `${formatEur(summary.openEur)} open`;
  return summary.paidTotalEur > 0 ? 'Betaald' : 'Nog niets';
}
