import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { messageOf } from '../../core/api/errors';
import type { Customer, SalesOrderView } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { EurPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { isPartnerDocument } from './sales-payment-state';
import { euro } from './sales-credit-note';

interface OffsetTarget { id: number; number: string; openEur: number; customer: string; original: boolean }

const ISSUED = new Set(['UITGEREIKT', 'VERZONDEN', 'BEKEKEN', 'BETAALD']);
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * 'Verrekenen': the open tegoed of an issued credit note against an open
 * invoice of the same customer (a partner credit note: the container's own
 * documents). The server books the atomic pair; no money moves on the bank.
 */
@Component({
  selector: 'app-sales-offset-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, EurPipe],
  template: `
    <app-sheet title="Verrekenen" [variant]="desktop.active() ? 'default' : 'ios'" (closed)="closed.emit()">
      <div body class="cn-sheet cn-offset">
        <p class="cn-hint">{{ credit().order.number }} · tegoed {{ tegoedEur() | eur }} incl. btw</p>
        @if (loading()) {
          <p class="cn-hint" role="status">Openstaande facturen laden…</p>
        } @else if (loadError()) {
          <p class="cn-error" role="alert">{{ loadError() }}</p>
        } @else if (!targets().length) {
          <p class="cn-hint cn-hint--warn">{{ partner() ? 'Er staat geen document van deze container open.' : 'Er staat geen andere factuur van deze klant open.' }} Verreken de rest met een volgende factuur of noteer een terugbetaling.</p>
        } @else {
          <div class="cn-targets" role="radiogroup" aria-label="Factuur om mee te verrekenen" (keydown)="targetKey($event)">
            @for (target of targets(); track target.id) {
              <button type="button" class="cn-target" role="radio" [attr.aria-checked]="chosen() === target.id" [tabindex]="chosen() === target.id ? 0 : -1" [class.cn-target--on]="chosen() === target.id" [disabled]="busy()" (click)="choose(target.id)">
                <span class="cn-target__copy"><b>{{ target.number }}</b><small>{{ target.original ? 'de gecrediteerde factuur' : target.customer }}</small></span>
                <span class="cn-target__open">{{ target.openEur | eur }} open</span>
              </button>
            }
          </div>
          <label class="field cn-offset__amount"><span>Te verrekenen bedrag</span>
            <div class="input-affix"><input class="input num" type="number" inputmode="decimal" min="0.01" step="0.01" [max]="maxEur()" [disabled]="busy()" [ngModel]="amountText() ?? amount()" (ngModelChange)="setAmount($event)" /><span class="input-affix__suffix">€</span></div>
            <small class="cn-hint">hoogstens {{ maxEur() | eur }}</small>
          </label>
          @if (chosenTarget(); as target) {
            <p class="cn-sentence">{{ euro(amount() ?? 0) }} van {{ credit().order.number }} wordt verrekend met {{ target.number }}. Er beweegt geen geld op de bank.</p>
          }
        }
        @if (error()) { <p class="cn-error" role="alert">{{ error() }}</p> }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" [disabled]="busy()" (click)="closed.emit()">Annuleren</button>
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" [disabled]="!canApply()" (click)="apply()">{{ busy() ? 'Bezig…' : 'Verrekenen' }}</button>
      </div>
    </app-sheet>
  `,
})
export class SalesOffsetSheet {
  readonly credit = input.required<SalesOrderView>();
  /** Preselected invoice; null lists the customer's open invoices with the original first. */
  readonly targetId = input<number | null>(null);
  readonly closed = output<void>();
  readonly changed = output<SalesOrderView>();

  readonly desktop = inject(DesktopViewport);
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly targets = signal<OffsetTarget[]>([]);
  readonly chosen = signal<number | null>(null);
  readonly amount = signal<number | null>(null);
  /** The prefilled amount with two decimals ('220.20'); null once the owner types, so the field never fights the keyboard. */
  readonly amountText = signal<string | null>(null);
  private version = 0;

  readonly partner = computed(() => isPartnerDocument(this.credit().order));
  readonly tegoedEur = computed(() => round2(Math.max(0, this.credit().paymentSummary?.creditEur ?? 0)));
  readonly chosenTarget = computed(() => this.targets().find((target) => target.id === this.chosen()) ?? null);
  readonly maxEur = computed(() => round2(Math.min(this.tegoedEur(), this.chosenTarget()?.openEur ?? 0)));
  readonly canApply = computed(() => !this.busy() && !this.loading() && !!this.chosenTarget() && (this.amount() ?? 0) > 0 && (this.amount() ?? 0) <= this.maxEur() + 0.005);

  constructor() {
    effect(() => {
      const credit = this.credit();
      const preselect = this.targetId();
      untracked(() => { void this.load(credit, preselect); });
    });
  }

  private async load(credit: SalesOrderView, preselect: number | null): Promise<void> {
    const version = ++this.version;
    this.loading.set(true); this.loadError.set(''); this.error.set('');
    try {
      const originalId = credit.order.creditedInvoiceId ?? credit.creditedInvoiceId ?? null;
      let targets: OffsetTarget[];
      const container = credit.order.partnerPurchaseOrderId ?? null;
      if (this.partner() && container != null) {
        const financing = await this.sourcing.partnerFinancing(container);
        targets = financing.documents
          .filter((doc) => doc.docType === 'FACTUUR' && ISSUED.has(doc.status) && doc.remainingEur > 0.005)
          .map((doc) => ({ id: doc.id, number: doc.number, openEur: round2(doc.remainingEur), customer: financing.partnerName ?? '', original: doc.id === originalId }));
      } else {
        const [orders, customers] = await Promise.all([this.sales.orders(), this.sales.customers().catch(() => [] as Customer[])]);
        const names = new Map(customers.map((customer) => [customer.id, customer.company]));
        targets = orders
          .filter((view) => view.order.docType === 'FACTUUR' && view.order.customerId === credit.order.customerId && ISSUED.has(view.order.status)
            && !isPartnerDocument(view.order) && (view.paymentSummary?.remainingEur ?? 0) > 0.005)
          .map((view) => ({ id: view.order.id, number: view.order.number, openEur: round2(view.paymentSummary!.remainingEur), customer: names.get(view.order.customerId) ?? '', original: view.order.id === originalId }));
      }
      targets.sort((left, right) => Number(right.original) - Number(left.original) || left.number.localeCompare(right.number, 'nl'));
      if (version !== this.version) return;
      this.targets.set(targets);
      const first = targets.find((target) => target.id === preselect) ?? targets.find((target) => target.original) ?? targets[0] ?? null;
      this.choose(first?.id ?? null);
    } catch (failure: unknown) {
      if (version === this.version) this.loadError.set(messageOf(failure, 'De openstaande facturen konden niet worden geladen.'));
    } finally {
      if (version === this.version) this.loading.set(false);
    }
  }

  choose(id: number | null): void {
    this.chosen.set(id);
    this.error.set('');
    const max = this.maxEur();
    this.amount.set(max > 0 ? max : null);
    this.amountText.set(max > 0 ? max.toFixed(2) : null);
  }

  /** Arrow keys walk the invoices like a radio group. */
  targetKey(event: KeyboardEvent): void {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    const targets = this.targets();
    if (!delta || !targets.length || this.busy()) return;
    event.preventDefault();
    const index = targets.findIndex((target) => target.id === this.chosen());
    const next = targets[(index + delta + targets.length) % targets.length];
    this.choose(next.id);
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.cn-target')[targets.indexOf(next)]?.focus();
  }

  setAmount(raw: number | string | null): void {
    const value = raw === null || raw === '' ? Number.NaN : Number(raw);
    this.amount.set(Number.isFinite(value) ? round2(value) : null);
    this.amountText.set(null);
    this.error.set('');
  }

  async apply(): Promise<void> {
    const target = this.chosenTarget();
    const amount = this.amount();
    if (!target || !this.canApply() || amount === null) return;
    this.busy.set(true); this.error.set('');
    try {
      const fresh = await this.sales.applyCredit(this.credit().order.id, target.id, amount);
      this.ui.toast(`Verrekend ${euro(amount)} met ${target.number}`, 'ok');
      this.changed.emit(fresh);
      this.closed.emit();
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'Verrekenen mislukt'));
    } finally {
      this.busy.set(false);
    }
  }

  euro(value: number): string { return euro(value); }
}
