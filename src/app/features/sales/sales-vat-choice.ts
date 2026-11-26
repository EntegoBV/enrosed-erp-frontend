import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { SalesOrderView } from '../../core/api/models';
import { SalesVatChoiceApi, type SalesVatChoice as Choice, type SalesVatRoute } from '../../core/api/sales-vat-choice-api';
import { messageOf } from '../../core/api/errors';
import { Segmented } from '../../shared/segmented';
import { Ui } from '../../shared/ui';
import { vatRouteHint, vatRouteName, vatRouteOptions } from './sales-vat-choice-state';

/**
 * "Btw-regeling" on a sales document: the customer's standard, or this document's own route. Shown
 * only while there is something to choose on a concept: a customer on the fiscal representative
 * (that route or the plain Belgian one), and a document without product lines (goods or a service).
 * A pick is saved at once and the host takes the repriced document; with unsaved edits on screen
 * the control waits, because the server prices the stored document. An invoice that left concept
 * holds its regime (the customer's settings no longer move it) and shows it read-only; reopened, it
 * stays on that route and a pick first asks.
 */
@Component({
  selector: 'app-sales-vat-choice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented],
  template: `
    @if (shown(); as choice) {
      <div class="field vat-choice">
        <label>Btw-regeling @if (choice.pinned) { <small>{{ choice.editable ? 'van de uitgereikte factuur' : 'vastgelegd bij uitgifte' }}</small> } @else if (choice.chosen) { <small>wijkt af van de klant</small> }</label>
        <app-segmented label="Btw-regeling" semantics="radio" [variant]="variant()" [options]="options()" [value]="pending() ?? choice.route" (changed)="pick($event)" />
        @if (!choice.editable) { <span class="hint">{{ choice.lockedReason }}</span> }
        @else if (blocked()) { <span class="hint">Sla eerst je wijzigingen op om te wisselen.</span> }
        @else if (hint()) { <span class="hint">{{ hint() }}</span> }
        @if (error()) { <span class="hint hint--warn" role="alert">{{ error() }}</span> }
      </div>
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .vat-choice{min-width:0}
    .vat-choice label small{font-weight:500;color:var(--muted);margin-left:6px}
    .vat-choice app-segmented{max-width:100%}
  `,
})
export class SalesVatChoice implements OnDestroy {
  readonly view = input.required<SalesOrderView>();
  /** Unsaved edits or a busy host: the choice waits. */
  readonly blocked = input(false);
  readonly variant = input<'desk' | 'ios'>('desk');
  /**
   * Stores the route and shows the repriced document. The host owns it: this control is destroyed
   * when its tab or step is left, and the answer must still reach the screen.
   */
  readonly save = input.required<(route: SalesVatRoute, confirmed: boolean) => Promise<void>>();

  readonly choice = signal<Choice | null>(null);
  readonly pending = signal<SalesVatRoute | null>(null);
  readonly error = signal('');
  /** Everything the server's answer depends on, as stored: a change of any reads the choice again. */
  private readonly key = computed(() => {
    const { order, priced } = this.view();
    return [order.id, order.status, order.archivedAt ?? '', order.customerId, order.countryCode, order.lines.length,
      priced.totals.vatTreatment].join('|');
  });
  readonly shown = computed(() => {
    const choice = this.choice();
    return choice && choice.options.length > 1 && (choice.editable || choice.pinned) ? choice : null;
  });
  readonly options = computed(() => {
    const choice = this.choice();
    const busy = this.blocked() || this.pending() !== null || !choice?.editable;
    return choice ? vatRouteOptions(choice).map((option) => ({ ...option, disabled: busy && option.id !== (this.pending() ?? choice.route) })) : [];
  });
  readonly hint = computed(() => { const choice = this.choice(); return choice ? vatRouteHint(choice) : ''; });

  private readonly api = inject(SalesVatChoiceApi);
  private readonly ui = inject(Ui);
  private version = 0;

  constructor() {
    /* Read again when a stored fact changes, and when edits were saved (blocked clears): never per keystroke. */
    effect(() => { this.key(); if (this.blocked()) return; untracked(() => void this.load()); });
  }

  private async load(): Promise<void> {
    const version = ++this.version;
    const id = this.view().order.id;
    this.error.set(''); this.pending.set(null);
    if (id == null) { this.choice.set(null); return; }
    try {
      const choice = await this.api.get(id);
      if (version === this.version) this.choice.set(choice);
    } catch {
      /* Nothing to choose is the safe reading: the document keeps its customer's standard. */
      if (version === this.version) this.choice.set(null);
    }
  }

  async pick(id: string): Promise<void> {
    const choice = this.choice();
    const orderId = this.view().order.id;
    const route = id as SalesVatRoute;
    if (!choice || !choice.editable || orderId == null || this.blocked() || this.pending() !== null || route === choice.route
        || !choice.options.includes(route)) return;
    if (choice.needsConfirm) {
      this.ui.confirm({
        title: 'Btw-regeling van een uitgereikte factuur wijzigen?',
        message: `${this.view().order.number} is eerder uitgereikt met btw-regeling “${vatRouteName(choice.route, choice)}”. `
          + `Wijzigen naar “${vatRouteName(route, choice)}” verandert de factuur zoals de klant ze kreeg.`,
        confirmLabel: 'Toch wijzigen', danger: true,
      }, () => { void this.store(route, choice, true); });
      return;
    }
    await this.store(route, choice, false);
  }

  private async store(route: SalesVatRoute, choice: Choice, confirmed: boolean): Promise<void> {
    if (this.pending() !== null) return;
    const version = this.version;
    this.error.set(''); this.pending.set(route);
    try {
      await this.save()(route, confirmed);
      this.ui.toast('Btw-regeling aangepast', 'ok');
      if (version !== this.version) return;
      this.choice.set({ ...choice, route, chosen: route !== choice.customerRoute });
      this.pending.set(null);
    } catch (failure) {
      const message = messageOf(failure, 'De btw-regeling kon niet worden aangepast.');
      /* Left behind by a tab or step change: say it where the user is now. */
      if (version !== this.version) { this.ui.toast(message, 'err'); return; }
      this.pending.set(null);
      this.error.set(message);
    }
  }

  ngOnDestroy(): void { this.version++; }
}
