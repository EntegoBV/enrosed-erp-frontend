import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { BankPurchasePaymentPart, BankPurchaseSharePart, BankStatementLine } from '../../core/api/banking-api';
import { EurPipe } from '../../shared/pipes';
import { containerName } from '../purchasing/container-name';
import { containerStanding } from '../purchasing/purchase-also-containers';
import { shareEffect } from '../purchasing/purchase-payment-links';
import { splitCents } from '../purchasing/purchase-payment-share';
import {
  SPLIT_FEE_KEY, splitChoiceText, splitChoices, splitNextPart, splitRowPayee, splitSpread, splitStart, splitTarget, splitWeight, type SplitChoice, type SplitContainer,
} from './container-split-rows';
import { FinanceState } from './finance-state';
import type { ContainerPayable } from './payables';
import { FEE_LABEL, feePaymentPart, feeSharePart } from './transaction-fees';

const cents = (value: number): number => Math.round(value * 100);
const normal = (text: string | null | undefined): string => (text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const parse = (text: string): number | null => {
  const clean = text.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const value = Number(clean);
  return clean && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
};
const amountText = (value: number): string => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const PAYEE_WORD: Record<ContainerPayable['payee'], string> = { SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten' };

/** One part of the transaction, by its own id (a container holds several); key: a term's key, 'p:{id}' for an open payment, 'fee' for Transactiekosten. */
interface Row { id: number; orderId: number; key: string; amountInput: string; }
/** How the amounts were set: by Afspraak, equally (1/n), or typed (null). */
type Mode = 'AFSPRAAK' | 'EQUAL' | null;

/**
 * "Splitsen" of an outgoing transaction (owner addition 2026-10-15, real
 * split 2026-10-19): one transfer that paid several containers, several
 * terms or payees of one container, or the goods with their Transactiekosten.
 * The containers of the same supplier come first (others through the
 * search); each ticked one starts on what the transfer paid there
 * (container-split-rows: an open payment of the transfer's payee on its
 * term, else that open term), '+ Deel' adds a part to it (another term,
 * Douane & transport, Transactiekosten), the amounts follow 'Volgens
 * afspraak' (or 'Gelijk verdelen') and stay editable, and one "Koppelen"
 * books every part, all on this transaction (one atomic call).
 * Transactiekosten is a new Bijkomende kosten payment (transaction-fees.ts):
 * it keeps its typed amount and the modes share the rest. Emre, 2026-10-16: a
 * container whose instalment is already noted (not on the bank) starts on
 * that payment ('Bestaand') and it is linked with its part through POST
 * …/purchase-share, never a second one (nor twice); under each row what the
 * part does to it.
 */
@Component({
  selector: 'app-container-split',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe],
  template: `
    <p class="fin-hint">Elk deel wordt een betaling op zijn container, op deze transactie.</p>
    <div class="fin-split">
      @for (container of shown(); track container.orderId) {
        @let parts = rowsOf(container.orderId);
        <div class="fin-split__row" [class.is-on]="parts.length > 0">
          <label class="fin-split__pick"><input type="checkbox" [checked]="parts.length > 0" [disabled]="state.linking() !== null" (change)="toggle(container)" />
            <span><b>{{ container.number }}{{ container.alias ? ' · ' + container.alias : '' }}</b><small>{{ container.supplier || 'Leverancier onbekend' }}
              @if (parts.length && otherSupplier(container)) { <span class="fin-split__warn"> · andere leverancier dan {{ supplierName() }}</span> }</small></span></label>
          @for (row of parts; track row.id; let first = $first) {
            <!-- The shown choice follows the row's key per option: a select's [value] set before its options exist shows the first one. -->
            <select class="select fin-split__term" [attr.aria-label]="'Betaling voor ' + container.number" [disabled]="state.linking() !== null" (change)="setTerm(container, row.id, $any($event.target).value)">
              @for (choice of choicesOf(container, row); track choice.key) {
                <option [value]="choice.key" [selected]="choice.key === row.key">{{ choiceText(container, choice, row.key) }}</option>
              }
            </select>
            <input class="input fin-split__amount" inputmode="decimal" [attr.aria-label]="'Bedrag voor ' + container.number" [disabled]="state.linking() !== null" [value]="row.amountInput" (input)="setAmount(row.id, $any($event.target).value)" />
            <small class="fin-split__effect">{{ effectOf(container, row) }}@if (!first) { · <button class="wk-link" type="button" [disabled]="state.linking() !== null" (click)="dropPart(row.id)">weghalen</button> }</small>
          }
          @if (parts.length) { <button class="wk-link fin-split__add" type="button" [disabled]="state.linking() !== null" (click)="addPart(container)">+ Deel</button> }
        </div>
      } @empty { <p class="fin-hint">Geen container met een open termijn{{ query() ? ' gevonden' : ' van deze leverancier' }}.</p> }
    </div>
    <label class="bank-alloc-search fin-split__search"><span>Andere containers zoeken</span>
      <input class="input" type="search" placeholder="PO-nummer, alias of leverancier" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
    <div class="fin-split__modes" role="group" aria-label="Verdelen">
      <button class="wk-btn wk-btn--sm btn" type="button" [attr.aria-pressed]="mode() === 'AFSPRAAK'" [disabled]="rows().length < 2 || state.linking() !== null" (click)="setMode('AFSPRAAK')">Volgens afspraak</button>
      <button class="wk-btn wk-btn--sm btn" type="button" [attr.aria-pressed]="mode() === 'EQUAL'" [disabled]="rows().length < 2 || state.linking() !== null" (click)="setMode('EQUAL')">Gelijk verdelen</button>
    </div>
    <p class="fin-split__total" [class.is-ok]="matches()" role="status">Samen {{ total() | eur }} van {{ lineEur() | eur }}@if (matches()) { <span> ✓</span> } @else if (rows().length) { <span> · verschil {{ lineEur() - total() | eur }}</span> }</p>
    @if (error()) { <p class="fin-error" role="alert">{{ error() }}</p> }
    <button class="wk-btn wk-btn--primary btn btn--primary" type="button" [disabled]="!ready()" (click)="link()">{{ state.linking() === line().id ? 'Koppelen…' : 'Koppelen' }}</button>
  `,
})
export class ContainerSplit {
  readonly state = inject(FinanceState);
  private readonly destroyRef = inject(DestroyRef);
  readonly line = input.required<BankStatementLine>();
  /** Where the split starts: the container of the best match, else the counterparty's name. */
  readonly hint = input<{ orderId: number | null; counterparty: string; paymentId?: number | null; termKey?: string | null }>({ orderId: null, counterparty: '' });
  readonly done = output<void>();

  readonly query = signal('');
  readonly rows = signal<Row[]>([]);
  private nextId = 1;
  readonly error = signal('');
  /** 'Volgens afspraak' from the second container on; a typed amount makes it null (the amounts then stay as typed). */
  readonly mode = signal<Mode>('AFSPRAAK');

  private readonly suppliers = computed(() => new Map(this.state.suppliers().filter((row) => row.id != null).map((row) => [row.id!, row.name])));
  /** Every container with an open term or stream, as the bank targets know them, or with a payment noted but not on the bank yet. */
  readonly containers = computed<SplitContainer[]>(() => {
    const byOrder = new Map<number, SplitContainer>();
    const of = (orderId: number, number: string, alias: string | null): SplitContainer => {
      const view = this.state.purchaseViews().find((row) => row.order.id === orderId);
      const supplierId = view?.order.supplierId ?? null;
      const container = byOrder.get(orderId) ?? { orderId, number, alias, supplierId, supplier: this.suppliers().get(supplierId ?? -1) ?? '', terms: [], open: [] };
      byOrder.set(orderId, container);
      return container;
    };
    for (const term of this.state.containerPayables()) if (!term.archived) of(term.orderId, term.orderNumber, term.alias).terms.push(term);
    for (const row of this.state.payments()) {
      const view = this.state.purchaseViews().find((item) => item.order.id === row.orderId);
      if (row.bankStatementLineId != null || row.creditOffset || !(cents(row.amountEur) > 0) || !view || view.order.archivedAt) continue;
      of(row.orderId, row.orderNumber ?? view.order.number, row.orderAlias ?? view.order.alias ?? null).open.push({ id: row.id,
        due: (row.payee ?? 'SUPPLIER') === 'SUPPLIER' ? row.instalmentDue ?? null : null, label: row.label, amountEur: cents(row.amountEur) / 100,
        payee: row.payee ?? 'SUPPLIER', currency: row.currency ?? 'EUR', amount: row.amount ?? row.amountEur, paidOn: row.paidOn });
    }
    for (const container of byOrder.values()) container.open.sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id - b.id);
    return [...byOrder.values()];
  });
  /** The supplier the transfer went to: the best match's container, else a supplier whose name the counterparty carries. */
  readonly supplierId = computed<number | null>(() => {
    const hint = this.hint();
    if (hint.orderId != null) return this.containers().find((row) => row.orderId === hint.orderId)?.supplierId ?? null;
    const party = normal(hint.counterparty);
    if (party.length < 4) return null;
    for (const [id, name] of this.suppliers()) { const key = normal(name); if (key.length > 3 && (party.includes(key) || key.includes(party))) return id; }
    return null;
  });
  readonly supplierName = computed(() => this.suppliers().get(this.supplierId() ?? -1) ?? 'de leverancier');
  /** Same supplier first; others only through the search (and every chosen one stays). */
  readonly shown = computed(() => {
    const words = normal(this.query());
    const chosen = new Set(this.rows().map((row) => row.orderId));
    const same = (container: SplitContainer): boolean => this.supplierId() !== null && container.supplierId === this.supplierId();
    return this.containers().filter((container) => chosen.has(container.orderId) || (words ? normal(`${container.number} ${container.alias ?? ''} ${container.supplier}`).includes(words) : same(container) || this.supplierId() === null))
      .sort((a, b) => Number(same(b)) - Number(same(a)) || a.number.localeCompare(b.number, 'nl'));
  });
  readonly lineEur = computed(() => Math.abs(this.line().amountEur));
  private readonly lineDay = computed(() => this.state.lineDay(this.line()));
  readonly total = computed(() => this.rows().reduce((sum, row) => sum + cents(parse(row.amountInput) ?? 0), 0) / 100);
  readonly matches = computed(() => this.rows().length > 0 && Math.abs(cents(this.total()) - cents(this.lineEur())) <= 2);
  /** Every part filled, together the transaction, and no open payment chosen twice. */
  readonly ready = computed(() => {
    const payments = this.rows().filter((row) => row.key.startsWith('p:')).map((row) => row.key);
    return this.matches() && this.rows().every((row) => parse(row.amountInput) !== null) && new Set(payments).size === payments.length && this.state.linking() === null;
  });

  constructor() {
    /* The best match's container starts ticked, on the payment (or term) the transaction was matched to. */
    effect(() => {
      const hint = this.hint();
      const container = this.containers().find((row) => row.orderId === hint.orderId);
      untracked(() => { if (container && !this.rows().length) this.toggle(container, { paymentId: hint.paymentId ?? null, termKey: hint.termKey ?? null }); });
    });
  }

  rowsOf(orderId: number): Row[] { return this.rows().filter((row) => row.orderId === orderId); }
  otherSupplier(container: SplitContainer): boolean { return this.supplierId() !== null && container.supplierId !== this.supplierId(); }
  /** The open payments the other rows stand on: never a second time. */
  private taken(rowId: number | null): string[] { return this.rows().filter((row) => row.id !== rowId && row.key.startsWith('p:')).map((row) => row.key); }

  /** The row's select in order: its payee's open payments, the open terms, other payees' open payments, Transactiekosten. */
  choicesOf(container: SplitContainer, row: Row): SplitChoice[] { return splitChoices(container, row.key, this.taken(row.id)); }
  choiceText(container: SplitContainer, choice: SplitChoice, key: string): string {
    return splitChoiceText(choice, splitChoices(container, key), splitRowPayee(container, key));
  }
  /**
   * Under the row, what it stands on and what the part does to it (the sheet's words):
   * 'bestaande betaling · 30% bij bestelling · € 3.070,20 · nog niet op de bank · betaling wordt € 3.801,13 (was € 3.070,20); de termijn komt € 789,48 boven de afspraak',
   * 'nieuwe betaling · 30% bij bestelling · open € 3.070,20'.
   */
  effectOf(container: SplitContainer, row: Row): string {
    if (row.key === SPLIT_FEE_KEY) return `nieuwe betaling · ${FEE_LABEL} bij Bijkomende kosten`;
    const part = parse(row.amountInput);
    const view = this.state.purchaseViews().find((item) => item.order.id === container.orderId);
    const payment = container.open.find((item) => 'p:' + item.id === row.key);
    if (payment) {
      const booked = payment.currency === 'EUR' ? EURO.format(payment.amountEur)
        : `${payment.amount.toLocaleString('nl-BE', { style: 'currency', currency: payment.currency })} (${EURO.format(payment.amountEur)})`;
      const head = `bestaande betaling · ${payment.label || PAYEE_WORD[payment.payee]} · ${booked} · nog niet op de bank`;
      return part === null ? head : `${head} · ${shareEffect({ paymentEur: payment.amountEur, currency: payment.currency, amount: payment.amount, partEur: part,
        standing: containerStanding(view, payment.payee, payment.due), day: this.lineDay() })}`;
    }
    const term = container.terms.find((item) => item.key === row.key);
    if (!term) return '';
    return shareEffect({ paymentEur: null, partEur: part, standing: containerStanding(view, term.payee, term.due), day: this.lineDay(),
      label: term.termLabel || PAYEE_WORD[term.payee], openEur: term.remainingEur });
  }

  /**
   * A container ticked: it starts on what the transfer paid there (the first
   * row's payee and term; the matched payment or term for the best match's
   * container); from the second row on the amounts follow the mode. Unticked:
   * every part of it goes.
   */
  toggle(container: SplitContainer, prefer?: { paymentId?: number | null; termKey?: string | null }): void {
    if (this.rowsOf(container.orderId).length) { this.withMode(this.rows().filter((row) => row.orderId !== container.orderId)); return; }
    const first = this.rows()[0];
    const start = splitStart(container, first ? splitTarget(this.containers(), first.key) : null, prefer);
    if (!start || this.taken(null).includes(start.key)) return;
    this.withMode([...this.rows(), { id: this.nextId++, orderId: container.orderId, key: start.key, amountInput: amountText(start.amountEur) }]);
  }
  /** '+ Deel': the next part of this container (splitNextPart), on what is left of the transaction. */
  addPart(container: SplitContainer): void {
    const own = this.rowsOf(container.orderId);
    if (!own.length) return;
    const key = splitNextPart(container, own.map((row) => row.key), this.rows().map((row) => row.key));
    this.withMode([...this.rows(), { id: this.nextId++, orderId: container.orderId, key, amountInput: this.startAmount(container, key, null) }]);
  }
  dropPart(rowId: number): void { this.withMode(this.rows().filter((row) => row.id !== rowId)); }
  setTerm(container: SplitContainer, rowId: number, key: string): void {
    if (key !== SPLIT_FEE_KEY && splitWeight(container, key) === null) return;
    this.withMode(this.rows().map((row) => row.id === rowId ? { ...row, key, amountInput: this.startAmount(container, key, rowId) } : row));
  }
  /**
   * A part's amount on its new choice: Transactiekosten take what is left of
   * the transaction (else empty); another part its open payment or term, or
   * when added with the amounts typed (no mode) what is left.
   */
  private startAmount(container: SplitContainer, key: string, rowId: number | null): string {
    const others = this.rows().filter((row) => row.id !== rowId).reduce((sum, row) => sum + cents(parse(row.amountInput) ?? 0), 0);
    const rest = cents(this.lineEur()) - others;
    if (key === SPLIT_FEE_KEY) return rest > 0 ? amountText(rest / 100) : '';
    return amountText(rowId === null && this.mode() === null && rest > 0 ? rest / 100 : splitWeight(container, key) ?? 0);
  }
  /** 'Volgens afspraak' (each part by its open payment or open term) or 'Gelijk verdelen' (1/n), to the cent, together the transaction. */
  setMode(mode: Exclude<Mode, null>): void {
    this.mode.set(mode);
    this.withMode(this.rows());
  }
  /**
   * The rows, their amounts by the mode once there are two (one row keeps its
   * own amount; a missing weight keeps them as they are). Transactiekosten
   * keep what was typed; the other parts share the rest (splitSpread).
   */
  private withMode(rows: Row[]): void {
    const mode = this.mode();
    if (!mode || rows.length < 2) { this.rows.set(rows); return; }
    const amounts = splitSpread(this.lineEur(), rows.map((row) => {
      const container = this.containers().find((item) => item.orderId === row.orderId);
      const fee = row.key === SPLIT_FEE_KEY;
      return { fee, amountEur: parse(row.amountInput), weight: fee ? null : mode === 'EQUAL' ? 1 : container ? splitWeight(container, row.key) : null };
    }), splitCents);
    this.rows.set(amounts ? rows.map((row, index) => row.key === SPLIT_FEE_KEY ? row : { ...row, amountInput: amountText(amounts[index]) }) : rows);
  }
  /** A typed amount: the amounts stay as typed from now on; typed Transactiekosten keep the mode, the other parts share the rest. */
  setAmount(rowId: number, text: string): void {
    const rows = this.rows().map((row) => row.id === rowId ? { ...row, amountInput: text } : row);
    if (rows.find((row) => row.id === rowId)?.key === SPLIT_FEE_KEY && this.mode()) { this.withMode(rows); return; }
    this.mode.set(null);
    this.rows.set(rows);
  }

  async link(): Promise<void> {
    if (!this.ready()) return;
    const line = this.line();
    const terms = this.containers().flatMap((container) => container.terms);
    const numbers = [...new Set(this.rows().map((row) => this.containers().find((container) => container.orderId === row.orderId)?.number ?? '#' + row.orderId))];
    this.error.set('');
    let failure: string;
    if (this.rows().some((row) => row.key.startsWith('p:'))) {
      // An open payment is linked with its part (it follows the line), the others are new: one purchase-share call.
      const open = this.containers().flatMap((container) => container.open);
      const parts: BankPurchaseSharePart[] = this.rows().map((row) => {
        const amountEur = parse(row.amountInput)!;
        if (row.key === SPLIT_FEE_KEY) return feeSharePart(row.orderId, amountEur);
        const payment = open.find((item) => 'p:' + item.id === row.key);
        if (payment) return { paymentId: payment.id, amountEur, expectedAmountEur: payment.amountEur };
        const term = terms.find((item) => item.key === row.key)!;
        return { purchaseOrderId: term.orderId, amountEur, payee: term.payee, instalmentDue: term.due, label: term.termLabel || 'Bankbetaling', settles: false };
      });
      const names = this.rows().map((row) => { const container = this.containers().find((item) => item.orderId === row.orderId);
        return containerName({ id: row.orderId, number: container?.number, alias: container?.alias }); });
      failure = await this.state.shareContainers(line, parts, this.rows().map((row, index) => ({ name: names[index], amountEur: parse(row.amountInput)! })));
    } else {
      const parts: BankPurchasePaymentPart[] = this.rows().map((row) => {
        if (row.key === SPLIT_FEE_KEY) return feePaymentPart(this.lineDay(), parse(row.amountInput)!, row.orderId);
        const term = terms.find((item) => item.key === row.key)!;
        return { ...this.state.termPart(line, { kind: 'term-new', orderId: term.orderId, payable: term, title: term.orderNumber }), amount: parse(row.amountInput)!, purchaseOrderId: term.orderId };
      });
      failure = await this.state.linkContainers(line, parts, numbers);
    }
    /* A successful link usually closes the split itself (the line is linked, the detail shows "Gekoppeld aan"): no emit then (NG0953). */
    if (this.destroyRef.destroyed) return;
    if (failure) this.error.set(failure);
    else { this.rows.set([]); this.done.emit(); }
  }
}
