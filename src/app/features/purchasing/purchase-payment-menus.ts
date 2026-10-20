import { paymentOriginLabel } from './purchase-payment-origin';
import type { ContextMenuItem } from '../../shared/context-menu';
import {
  PAYEE_ICON, PAYEE_LABEL, PAYEE_ORDER, nettedCarrierDue, type LedgerCredit, type LedgerRow, type LedgerTerm, type LedgerTodo, type PayeeLedger,
  type PaymentLedger, type PurchaseSettleRequest,
} from './purchase-payment-ledger';

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });

/** Euro the way the pipes write it, for menu hints and confirm messages built in code. */
export function formatEur(value: number): string {
  return EURO.format(Number.isFinite(value) ? value : 0);
}

/** An amount with its sign in front of the euro: '− € 0,01', never '€ -0,01' (bridge rows, F25). */
export function signedEur(value: number): string {
  const cents = Math.round((Number.isFinite(value) ? value : 0) * 100) || 0;
  return cents < 0 ? '− ' + formatEur(Math.abs(cents) / 100) : formatEur(cents / 100);
}

/**
 * One 'Te doen' item in words: the title, the detail line and the verb of its
 * button. The Betalingen overview, the workbench and the Nacalculatie's action
 * cell all read the same three strings; the read view only asks for a
 * betaalbewijs. The bank transaction is the proof: it is linked in 'Aanpassen'.
 */
export function todoCopy(todo: LedgerTodo, mode: 'read' | 'edit' = 'edit'): { title: string; detail: string; action: string } {
  const action = { pay: 'Noteer', settle: 'Afrekenen', review: 'Nakijken', budget: 'Afrekenen', incomplete: 'Bekijken', credit: 'Bekijken', proof: 'Toon' }[todo.kind];
  switch (todo.kind) {
    case 'pay': return { title: todo.label, action,
      detail: `${formatEur(todo.amountEur)} · nu te betalen${todo.due ? ' · ' + PAYEE_LABEL[todo.payee] : ''}` };
    case 'settle': return { title: `Klein verschil bij ${PAYEE_LABEL[todo.payee]}`, action, detail: `${formatEur(todo.amountEur)} open · bijv. bankkosten of afronding` };
    case 'review': return { title: `Te veel betaald aan ${PAYEE_LABEL[todo.payee]}`, action, detail: `${formatEur(todo.amountEur)} meer dan afgesproken` };
    case 'budget': return { title: `Betaald zonder afspraak: ${PAYEE_LABEL[todo.payee]}`, action, detail: `${formatEur(todo.amountEur)} betaald zonder bedrag in Kosten` };
    case 'incomplete': return { title: `Betaling zonder eurowaarde bij ${PAYEE_LABEL[todo.payee]}`, action, detail: 'Controleer het bedrag van deze betaling' };
    case 'credit': return { title: `Tegoed open bij ${PAYEE_LABEL[todo.payee]}`, action,
      detail: `${formatEur(todo.amountEur)} te ontvangen · terugbetaling of verrekening` };
    case 'proof': return { title: `${todo.count} ${todo.count === 1 ? 'betaling' : 'betalingen'} zonder betaalbewijs`, action,
      detail: mode === 'edit' ? 'Koppel de banktransactie' : 'Banktransactie ontbreekt' };
  }
}

/** 'Betaling aan…': always all four payees, with what is still open at each. */
export function payeeMenuItems(ledger: PaymentLedger | null): ContextMenuItem[] {
  return PAYEE_ORDER.map(payee => {
    const item = ledger?.payees.find(candidate => candidate.payee === payee);
    const hint = payee === 'OTHER' ? 'zonder afspraak' : !item?.agreedEur ? 'geen afspraak' : `${formatEur(item.openEur)} open`;
    return { id: payee, label: PAYEE_LABEL[payee], hint, iconName: PAYEE_ICON[payee] };
  });
}

/**
 * The row menu of one payee on the desk. 'Factuur toevoegen…' for every payee
 * (a courier under Andere kosten has an invoice too) and the inspection's
 * 'Inspectie via leverancier' switch, both only when the server knows invoices.
 */
export function payeeRowMenuItems(payee: PayeeLedger, busy: boolean, invoices = false): ContextMenuItem[] {
  return [
    { id: 'add', label: 'Betaling noteren', iconName: 'plus', disabled: busy },
    ...(payee.canSettle ? [{ id: 'settle', label: 'Afrekenen…', iconName: 'tick', disabled: busy }] : []),
    ...(payee.canUndoSettle ? [{ id: 'undo', label: 'Afrekening ongedaan maken', iconName: 'restore', disabled: busy }] : []),
    ...(payee.payee === 'SUPPLIER' ? [{ id: 'plan', label: 'Betaalplan wijzigen', iconName: 'calendar', disabled: busy },
      { id: 'credit', label: 'Tegoed noteren…', iconName: 'receipt', disabled: busy }] : []),
    ...(invoices ? [{ id: 'invoice', label: 'Factuur toevoegen…', iconName: 'document', disabled: busy }] : []),
    ...(invoices && payee.payee === 'SEPARATE'
      ? [{ id: 'inspection-via', label: 'Inspectie via leverancier', hint: payee.viaSupplier ? 'aan' : 'uit', iconName: 'search', disabled: busy }] : []),
    { id: 'show', label: 'Toon betalingen', iconName: 'list', divider: true },
  ];
}

/** The menu of one invoice line on the desk: correct it, assign it to every payment of its payee, open its file, remove its data. */
export function invoiceMenuItems(invoice: { documentId: number | null }, busy: boolean, assignable = false): ContextMenuItem[] {
  return [
    { id: 'edit', label: 'Aanpassen…', iconName: 'pencil', disabled: busy },
    ...(assignable ? [{ id: 'assign', label: 'Toewijzen aan alle betalingen', iconName: 'link', disabled: busy }] : []),
    ...(invoice.documentId != null ? [{ id: 'file', label: 'Bestand openen', iconName: 'document' }] : []),
    { id: 'remove', label: 'Verwijderen', iconName: 'trash', danger: true, divider: true, disabled: busy },
  ];
}

/** A supplier term that still takes money: it shows 'Noteer' and its open amount. */
export function termOpen(term: LedgerTerm): boolean {
  return term.openEur > 0 && !term.settled;
}

/**
 * Whether a term row offers its ⋯ menu (desk) or opens one on a tap (phone
 * editor): something to pay, to settle or confirm, to undo, or a tied payment
 * to correct. A paid term stays reachable this way, so a payment entered
 * wrongly, or a settlement undone, never leaves the row without a way out.
 */
export function termHasMenu(term: LedgerTerm): boolean {
  return termOpen(term) || term.canSettle || term.canConfirm || term.canUndo || term.paymentIds.length > 0;
}

/** The menu of one supplier term, the same on the desk and in the phone payee sheet. */
export function termMenuItems(term: LedgerTerm, busy: boolean): ContextMenuItem[] {
  return [
    ...(termOpen(term) ? [{ id: 'add', label: 'Betaling noteren voor deze termijn', iconName: 'plus', disabled: busy }] : []),
    ...(term.canSettle || term.canConfirm ? [{ id: 'settle', label: 'Termijn afrekenen', iconName: 'tick', disabled: busy }] : []),
    ...(term.canUndo ? [{ id: 'undo', label: 'Afrekening ongedaan maken', iconName: 'restore', disabled: busy }] : []),
    ...(term.paymentIds.length ? [{ id: 'edit', label: 'Betaling aanpassen…', iconName: 'pencil', disabled: busy }] : []),
  ];
}

/** The payment 'Betaling aanpassen…' opens from a term: the newest one tied to it (a payment paid in parts as one row). */
export function termPayment(term: LedgerTerm, rows: readonly LedgerRow[]): LedgerRow | null {
  const id = term.paymentIds[0];
  return id === undefined ? null : rows.find(row => row.id === id) ?? null;
}

/**
 * The payment to link to a term when the settle sheet finds none tied to it:
 * the newest one of the payee without a term (a whole-supplier settlement
 * strips it), else the newest payment at all.
 */
export function relinkPayment(payee: Pick<PayeeLedger, 'rows'>): LedgerRow | null {
  return payee.rows.find(row => row.due === null) ?? payee.rows[0] ?? null;
}

/**
 * The menu of one supplier credit: an open one is refunded, offset on
 * another container, corrected or removed; a refunded one can be opened
 * again; an offset one is undone on the other container (its payment).
 */
export function creditMenuItems(credit: LedgerCredit, busy: boolean): ContextMenuItem[] {
  if (credit.status === 'OPEN') return [
    { id: 'refund', label: 'Terugbetaald noteren…', iconName: 'bank', disabled: busy },
    { id: 'offset', label: 'Verrekenen met…', iconName: 'exchange', disabled: busy },
    { id: 'edit', label: 'Aanpassen…', iconName: 'pencil', disabled: busy },
    { id: 'remove', label: 'Verwijderen', iconName: 'trash', danger: true, divider: true, disabled: busy },
  ];
  if (credit.status === 'REFUNDED') return [{ id: 'undo-refund', label: 'Terugbetaling ongedaan maken', iconName: 'restore', disabled: busy }];
  return credit.credit.offsetOrderId != null
    ? [{ id: 'open-offset', label: `Naar ${credit.credit.offsetOrderNumber ?? 'de andere container'} ›`, iconName: 'purchase' }] : [];
}

/**
 * A payment whose every transfer is linked to its bank line (the hard link,
 * not the old marker), never a credit offset: one more transaction makes it
 * grow ('Transactie toevoegen…', the server's addTransfer).
 */
export function transferAddable(row: Pick<LedgerRow, 'creditOffset' | 'parts'>): boolean {
  return !row.creditOffset && row.parts.length > 0 && row.parts.every(part => part.bankStatementLineId != null);
}

/**
 * The menu of one payment. Only the desk moves a payment to another payee from
 * here; the phone does it in the sheet. Files and bank transactions are added
 * in 'Aanpassen'; a payment fully on the bank also offers 'Transactie
 * toevoegen…' (with `addTransfer`, the server knows it); a payment paid in
 * parts is removed per transaction in 'Aanpassen'.
 */
export function paymentMenuItems(row: LedgerRow, options: { move: boolean; busy: boolean; addTransfer?: boolean }): ContextMenuItem[] {
  const busy = options.busy;
  const proofs = row.proofs ?? [];
  const files = row.invoiceFiles ?? [];
  const items: ContextMenuItem[] = [
    { id: 'edit', label: 'Aanpassen', iconName: 'pencil', disabled: busy },
    ...(options.addTransfer && transferAddable(row) ? [{ id: 'add-transfer', label: 'Transactie toevoegen…', iconName: 'bank', disabled: busy }] : []),
    ...proofs.map(proof => ({ id: 'open:' + proof.id, iconName: 'document',
      label: proofs.length === 1 ? 'Bewijs openen' : 'Bewijs openen · ' + proof.originalFilename })),
    ...(row.invoice?.documentId != null ? [{ id: 'invoice-file', label: 'Factuur openen', iconName: 'document' }] : []),
    ...files.map(file => ({ id: 'invoice-file:' + file.id, iconName: 'document',
      label: files.length === 1 ? 'Factuurbestand openen' : 'Factuurbestand openen · ' + file.originalFilename })),
  ];
  // A verrekend tegoed stays with the supplier: its amount and payee belong to the credit on the other container.
  if (options.move && !row.creditOffset) {
    PAYEE_ORDER.filter(payee => payee !== row.payee).forEach((payee, index) => items.push({
      id: 'move:' + payee, label: 'Verplaatsen naar ' + PAYEE_LABEL[payee], iconName: PAYEE_ICON[payee], divider: index === 0, disabled: busy,
    }));
  }
  if (row.payee !== 'OTHER') items.push({ id: 'settle', label: 'Afrekenen met deze betaling', iconName: 'tick', disabled: busy });
  items.push((row.parts?.length ?? 1) > 1
    ? { id: 'remove', label: 'Verwijderen kan per transactie in Aanpassen', iconName: 'trash', divider: true, disabled: true }
    : { id: 'remove', label: options.move ? 'Verwijderen…' : 'Verwijderen', iconName: 'trash', danger: true, divider: true, disabled: busy });
  return items;
}

/**
 * Settle on this very payment: its own term when it is tied to one, else the
 * whole payee. A term netted with another one is settled with the whole
 * supplier: alone it would leave the netting and reopen the other term. The
 * flag unties the payment, so it carries that settlement only when it
 * belongs to the term nettedCarrierDue names; any other payment of a netted
 * term would move money between the terms and wipe out their own + / −, and
 * the sheet picks the carrier instead.
 */
export function settleWith(row: LedgerRow, terms: readonly Pick<LedgerTerm, 'due' | 'offsetEur'>[] = []): PurchaseSettleRequest {
  const netted = terms.some(term => term.due === row.due && term.offsetEur !== 0);
  const term = row.payee === 'SUPPLIER' && !!row.due && !netted;
  const carries = !netted || row.due === nettedCarrierDue(terms);
  return { payee: row.payee, scope: term ? 'TERM' : 'GROUP', due: term ? row.due : null, ...(carries ? { paymentId: row.payment.id } : {}) };
}

/**
 * The betaalbewijs of one payment in words. The bank transaction is the proof:
 * 'op de bank', '2 transacties op de bank', '1 van 2 op de bank'; without it
 * the file name or how many files; else 'geen betaalbewijs'. A credit offset
 * needs none. An inspection on the same bank line as a goods payment says so.
 * Null while the documents load and nothing is on the bank.
 */
export function bankProofLine(row: LedgerRow): string | null {
  if (row.creditOffset) return 'verrekend tegoed';
  if (row.parts?.length && row.parts.every(part => part.payment?.origin)) return [...new Set(row.parts.map(part => paymentOriginLabel(part.payment?.origin)))].join(' · ');
  const parts = row.bank?.total ?? 1;
  const linked = row.bank?.linked ?? (row.onBank ? 1 : 0);
  let text: string | null;
  if (linked > 0) text = linked === parts ? (parts === 1 ? 'op de bank' : `${parts} transacties op de bank`) : `${linked} van ${parts} op de bank`;
  else if (row.hasProof === null) text = null;
  else if (row.hasProof) text = row.proofCount === 1 ? row.proofs![0].originalFilename : `${row.proofCount} bewijzen`;
  else text = 'geen betaalbewijs';
  if (text && row.payee === 'SEPARATE' && row.bank?.sharedWith.includes('SUPPLIER')) text += ' · zelfde transactie als de goederen';
  return text;
}

/**
 * The proof line under a phone ledger row: only when it says something the
 * row's trailing 'geen betaalbewijs' does not (on the bank, a file, an
 * offset, or part of a payment in parts on the bank).
 */
export function bankProofSub(row: LedgerRow): string | null {
  return row.creditOffset || row.parts?.some(part => !!part.payment?.origin) || (row.bank?.linked ?? 0) > 0 || row.hasProof ? bankProofLine(row) : null;
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
