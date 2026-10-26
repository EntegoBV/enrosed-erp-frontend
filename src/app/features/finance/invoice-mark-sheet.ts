import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import type { InvoiceRow } from '../../core/api/invoice-finder-api';
import { Sheet } from '../../shared/ui';
import { containerName } from '../purchasing/container-name';
import { FinanceState } from './finance-state';
import { InvoiceFinderState } from './invoice-finder-state';
import { amountText, numberText, partyName } from './invoice-finder';

const MAX_SHOWN = 30;
const fold = (text: string | null | undefined): string => (text ?? '').toLocaleLowerCase('nl-BE').normalize('NFD').replace(/\p{M}/gu, '').trim();

/**
 * "Hoort bij container…": an incoming Odoo bill that belongs to a
 * container's costs (it never becomes a company cost) is marked with that
 * container and an optional note. Money-free: no cost, payment or link.
 */
@Component({
  selector: 'app-invoice-mark-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    <app-sheet variant="ios" title="Hoort bij container" closeLabel="Annuleren" (closed)="close()">
      <div body class="fin-sheet fin-inv-mark">
        <p class="fin-inv-register__doc"><b>{{ party() }}</b> · {{ number() }} · {{ amount() }}</p>
        <label class="fin-field"><span class="fin-sr">Container zoeken</span>
          <input class="input" type="search" autocomplete="off" placeholder="PO-nummer, alias of leverancier" data-initial-focus [value]="query()" (input)="query.set($any($event.target).value)" /></label>
        <div class="fin-inv-mark__list" role="radiogroup" aria-label="Container">
          @for (option of options(); track option.id) {
            <label class="fin-inv-mark__option">
              <input type="radio" name="fin-inv-mark-po" [checked]="chosen() === option.id" (change)="chosen.set(option.id)" />
              <span class="fin-inv-mark__text"><b>{{ option.name }}</b>@if (option.supplier) { <span> · {{ option.supplier }}</span> }</span>
            </label>
          } @empty {
            <p class="fin-hint">{{ state.containersLoading() && !state.purchaseViews().length ? 'Containers laden…' : 'Geen container gevonden' }}</p>
          }
        </div>
        <label class="fin-field"><span>Notitie (optioneel)</span>
          <input class="input" type="text" maxlength="200" autocomplete="off" [value]="note()" (input)="note.set($any($event.target).value)" (keydown.enter)="save()" /></label>
        @if (error()) { <p class="fin-error" role="alert">{{ error() }}</p> }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="!chosen() || busy()" (click)="save()">{{ busy() ? 'Bezig…' : 'Bewaren' }}</button>
      </div>
    </app-sheet>
  `,
})
export class InvoiceMarkSheet {
  readonly row = input.required<InvoiceRow>();
  readonly state = inject(FinanceState);
  private readonly finder = inject(InvoiceFinderState);

  readonly query = signal('');
  /** A row already marked to a container starts on that container and its note. */
  readonly chosen = linkedSignal<number | null>(() => (this.row().odoo?.mark?.resolution === 'CONTAINER' ? this.row().odoo?.mark?.purchaseOrderId ?? null : null));
  readonly note = linkedSignal(() => this.row().odoo?.mark?.note ?? '');
  readonly busy = signal(false);
  readonly error = signal('');

  readonly party = computed(() => partyName(this.row()));
  readonly number = computed(() => numberText(this.row()));
  readonly amount = computed(() => amountText(this.row()));

  /** The containers, newest order first, filtered by number, alias and supplier; at most 30 (the chosen one stays in view). */
  readonly options = computed(() => {
    const suppliers = new Map(this.state.suppliers().map((supplier) => [supplier.id, supplier.name]));
    const words = fold(this.query()).split(/\s+/).filter(Boolean);
    const all = this.state.purchaseViews()
      .map((view) => ({ id: view.order.id, name: containerName(view.order), number: view.order.number, alias: view.order.alias ?? '',
        supplier: suppliers.get(view.order.supplierId) ?? '', date: view.order.orderDate ?? '' }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const matching = words.length ? all.filter((option) => {
      const hay = fold(`${option.number} ${option.alias} ${option.supplier}`);
      return words.every((word) => hay.includes(word));
    }) : all;
    const shown = matching.slice(0, MAX_SHOWN);
    const chosen = this.chosen();
    const kept = chosen && !shown.some((option) => option.id === chosen) ? all.find((option) => option.id === chosen) : undefined;
    return kept ? [kept, ...shown] : shown;
  });

  async save(): Promise<void> {
    const id = this.chosen();
    if (!id || this.busy()) return;
    const option = this.options().find((item) => item.id === id);
    this.busy.set(true);
    this.error.set('');
    try {
      const message = await this.finder.markContainer(this.row(), id, this.note().slice(0, 200), option?.name ?? `Inkoop #${id}`);
      if (message) this.error.set(message);
      else this.finder.marking.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    if (this.busy()) return;
    this.finder.marking.set(null);
  }
}
