import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { BankPurchasePaymentPart, BankStatementLine } from '../../core/api/banking-api';
import { EurPipe } from '../../shared/pipes';
import { FinanceState } from './finance-state';
import type { ContainerPayable } from './payables';

const cents = (value: number): number => Math.round(value * 100);
const normal = (text: string | null | undefined): string => (text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const parse = (text: string): number | null => {
  const clean = text.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const value = Number(clean);
  return clean && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
};
const amountText = (value: number): string => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Container { orderId: number; number: string; alias: string | null; supplier: string; supplierId: number | null; terms: ContainerPayable[]; }
interface Row { orderId: number; key: string; amountInput: string; }

/**
 * "Verdelen over containers" (owner addition 2026-10-15): one supplier
 * transfer that paid a term of several containers at once. The containers of
 * the same supplier come first (others through the search); each row starts
 * at that container's open amount of the chosen term (the earliest open
 * term, or the term of the first row), the amounts stay editable, and one
 * "Koppelen" books every part on its own container, all on this transaction
 * (one atomic call).
 */
@Component({
  selector: 'app-container-split',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe],
  template: `
    <p class="fin-hint">Kies de containers die deze transactie betaalde. Elk deel wordt een betaling op zijn container, op dezelfde banktransactie.</p>
    <div class="fin-split">
      @for (container of shown(); track container.orderId) {
        @let row = rowOf(container.orderId);
        <div class="fin-split__row" [class.is-on]="!!row">
          <label class="fin-split__pick"><input type="checkbox" [checked]="!!row" [disabled]="state.linking() !== null" (change)="toggle(container)" />
            <span><b>{{ container.number }}{{ container.alias ? ' · ' + container.alias : '' }}</b><small>{{ container.supplier || 'Leverancier onbekend' }}
              @if (row && otherSupplier(container)) { <span class="fin-split__warn"> · andere leverancier dan {{ supplierName() }}</span> }</small></span></label>
          @if (row) {
            <select class="select fin-split__term" [value]="row.key" aria-label="Termijn (open bedrag)" (change)="setTerm(container, $any($event.target).value)">
              @for (term of container.terms; track term.key) { <option [value]="term.key">{{ termLabel(term) }} · {{ term.remainingEur | eur }}</option> }
            </select>
            <input class="input fin-split__amount" inputmode="decimal" aria-label="Bedrag" [value]="row.amountInput" (input)="setAmount(container.orderId, $any($event.target).value)" />
          }
        </div>
      } @empty { <p class="fin-hint">Geen container met een open termijn{{ query() ? ' gevonden' : ' van deze leverancier' }}.</p> }
    </div>
    <label class="bank-alloc-search fin-split__search"><span>Andere containers zoeken</span>
      <input class="input" type="search" placeholder="PO-nummer, alias of leverancier" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
    <p class="fin-split__total" [class.is-ok]="matches()">Samen {{ total() | eur }} van {{ lineEur() | eur }}@if (matches()) { <span> ✓</span> } @else if (rows().length) { <span> · verschil {{ lineEur() - total() | eur }}</span> }</p>
    @if (error()) { <p class="fin-error" role="alert">{{ error() }}</p> }
    <button class="wk-btn wk-btn--primary btn btn--primary" type="button" [disabled]="!ready()" (click)="link()">{{ state.linking() === line().id ? 'Koppelen…' : 'Koppelen' }}</button>
  `,
})
export class ContainerSplit {
  readonly state = inject(FinanceState);
  readonly line = input.required<BankStatementLine>();
  /** Where the split starts: the container of the best match, else the counterparty's name. */
  readonly hint = input<{ orderId: number | null; counterparty: string }>({ orderId: null, counterparty: '' });
  readonly done = output<void>();

  readonly query = signal('');
  readonly rows = signal<Row[]>([]);
  readonly error = signal('');

  private readonly suppliers = computed(() => new Map(this.state.suppliers().filter((row) => row.id != null).map((row) => [row.id!, row.name])));
  /** Every container with an open term or stream, as the bank targets know them. */
  readonly containers = computed<Container[]>(() => {
    const byOrder = new Map<number, Container>();
    for (const term of this.state.containerPayables()) {
      if (term.archived) continue;
      const view = this.state.purchaseViews().find((row) => row.order.id === term.orderId);
      const supplierId = view?.order.supplierId ?? null;
      const container = byOrder.get(term.orderId) ?? { orderId: term.orderId, number: term.orderNumber, alias: term.alias, supplierId,
        supplier: this.suppliers().get(supplierId ?? -1) ?? '', terms: [] };
      container.terms.push(term);
      byOrder.set(term.orderId, container);
    }
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
    const same = (container: Container): boolean => this.supplierId() !== null && container.supplierId === this.supplierId();
    return this.containers().filter((container) => chosen.has(container.orderId) || (words ? normal(`${container.number} ${container.alias ?? ''} ${container.supplier}`).includes(words) : same(container) || this.supplierId() === null))
      .sort((a, b) => Number(same(b)) - Number(same(a)) || a.number.localeCompare(b.number, 'nl'));
  });
  readonly lineEur = computed(() => Math.abs(this.line().amountEur));
  readonly total = computed(() => this.rows().reduce((sum, row) => sum + cents(parse(row.amountInput) ?? 0), 0) / 100);
  readonly matches = computed(() => this.rows().length > 0 && Math.abs(cents(this.total()) - cents(this.lineEur())) <= 2);
  readonly ready = computed(() => this.matches() && this.rows().every((row) => parse(row.amountInput) !== null) && this.state.linking() === null);

  constructor() {
    /* The best match's container starts ticked. */
    effect(() => {
      const orderId = this.hint().orderId;
      const container = this.containers().find((row) => row.orderId === orderId);
      untracked(() => { if (container && !this.rows().length) this.toggle(container); });
    });
  }

  rowOf(orderId: number): Row | null { return this.rows().find((row) => row.orderId === orderId) ?? null; }
  otherSupplier(container: Container): boolean { return this.supplierId() !== null && container.supplierId !== this.supplierId(); }
  termLabel(term: ContainerPayable): string { return term.termLabel ?? ({ SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten' }[term.payee]); }

  toggle(container: Container): void {
    if (this.rowOf(container.orderId)) { this.rows.update((rows) => rows.filter((row) => row.orderId !== container.orderId)); return; }
    // The term of the first row when this container has it (30% of all three), else its earliest open term.
    const firstDue = this.rows().length ? this.containers().flatMap((item) => item.terms).find((term) => term.key === this.rows()[0].key)?.due ?? null : null;
    const term = container.terms.find((item) => firstDue && item.due === firstDue) ?? container.terms[0];
    this.rows.update((rows) => [...rows, { orderId: container.orderId, key: term.key, amountInput: amountText(term.remainingEur) }]);
  }
  setTerm(container: Container, key: string): void {
    const term = container.terms.find((item) => item.key === key);
    if (term) this.rows.update((rows) => rows.map((row) => row.orderId === container.orderId ? { ...row, key, amountInput: amountText(term.remainingEur) } : row));
  }
  setAmount(orderId: number, text: string): void { this.rows.update((rows) => rows.map((row) => row.orderId === orderId ? { ...row, amountInput: text } : row)); }

  async link(): Promise<void> {
    if (!this.ready()) return;
    const line = this.line();
    const terms = this.containers().flatMap((container) => container.terms);
    const parts: BankPurchasePaymentPart[] = this.rows().map((row) => {
      const term = terms.find((item) => item.key === row.key)!;
      return { ...this.state.termPart(line, { kind: 'term-new', orderId: term.orderId, payable: term, title: term.orderNumber }), amount: parse(row.amountInput)!, purchaseOrderId: term.orderId };
    });
    const numbers = this.rows().map((row) => this.containers().find((container) => container.orderId === row.orderId)?.number ?? '#' + row.orderId);
    this.error.set('');
    const failure = await this.state.linkContainers(line, parts, numbers);
    if (failure) this.error.set(failure);
    else { this.rows.set([]); this.done.emit(); }
  }
}
