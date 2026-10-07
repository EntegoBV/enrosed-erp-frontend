import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import type { SalesOrderView } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { DateField } from '../../shared/date-field';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { AdvanceChoice, advanceBaseExcl, advancePreview, remainingToInvoiceExcl } from './sales-advance-billing';
import { isWebOrderConflict, webOrderRevision } from './quote-status';

type Mode = 'P30' | 'P50' | 'PCT' | 'AMOUNT';

/**
 * 'Voorschotfactuur maken…' on a regular quote: 30 % · 50 % · Eigen % or an
 * amount excl. btw, an optional due date and the preview (excl., btw, incl.,
 * what stays to invoice). The server creates a concept in the F series and
 * sends nothing; the sheet then opens the new invoice. Desk [wide], phone
 * variant="ios"; styles in src/styles/sales-advance-billing.scss.
 */
@Component({
  selector: 'app-sales-advance-invoice-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, DateField, EurPipe, NumPipe],
  template: `
    <app-sheet title="Voorschotfactuur maken" [wide]="desktop.active()" [variant]="desktop.active() ? 'default' : 'ios'" (closed)="closed.emit()">
      <div body class="adv-sheet">
        <p class="adv-sheet__lead">Op offerte <b>{{ view().order.number }}</b> · {{ base() | eur }} excl. btw · nog {{ remaining() | eur }} te factureren</p>
        <div class="adv-chips" role="radiogroup" aria-label="Hoe groot is het voorschot?">
          @for (choice of modes; track choice.key) {
            <button class="adv-chip" type="button" role="radio" [attr.aria-checked]="mode() === choice.key" [class.adv-chip--on]="mode() === choice.key"
                    [disabled]="busy()" (click)="pick(choice.key)">{{ choice.label }}</button>
          }
        </div>
        @if (mode() === 'PCT') {
          <label class="field adv-field"><span>Percentage van de offerte excl. btw</span>
            <div class="input-affix"><input class="input num" type="number" inputmode="decimal" min="0.0001" max="100" step="0.01" placeholder="bv. 40"
                   [disabled]="busy()" [ngModel]="pctValue()" (ngModelChange)="pctValue.set($event === '' || $event === null ? null : +$event)" /><span class="input-affix__suffix">%</span></div>
          </label>
        } @else if (mode() === 'AMOUNT') {
          <label class="field adv-field"><span>Bedrag excl. btw</span>
            <div class="input-affix"><input class="input num" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0,00"
                   [disabled]="busy()" [ngModel]="amountValue()" (ngModelChange)="amountValue.set($event === '' || $event === null ? null : +$event)" /><span class="input-affix__suffix">€</span></div>
          </label>
        }
        <div class="field adv-field"><span>Vervaldatum <small class="adv-opt">optioneel</small></span>
          <app-date-field [value]="dueDate()" (valueChange)="dueDate.set($event)" />
          <small class="adv-hint">Leeg: volgens de betaalvoorwaarden van de offerte.</small>
        </div>
        <dl class="adv-preview" aria-live="polite">
          <div><dt>Voorschot excl. btw</dt><dd>{{ preview().exclEur | eur }}</dd></div>
          <div><dt>Btw @if (preview().vatPct > 0) { ({{ preview().vatPct | num }} %) } @else { <small>0 % · vrijgesteld of verlegd</small> }</dt><dd>{{ preview().vatEur | eur }}</dd></div>
          <div class="adv-preview__total"><dt>Te betalen incl. btw</dt><dd>{{ preview().inclEur | eur }}</dd></div>
          <div class="adv-preview__rest"><dt>Nog te factureren daarna</dt><dd>{{ preview().remainingAfterEur | eur }}</dd></div>
        </dl>
        @if (preview().error && touched()) { <p class="adv-error" role="alert">{{ preview().error }}</p> }
        <p class="adv-hint">De voorschotfactuur komt als concept in de gewone factuurreeks; er wordt niets verstuurd. De slotfactuur trekt ze later af, met de datum waarop ze betaald is.</p>
      </div>
      <div foot style="display:contents">
        @if (submitError()) { <p class="adv-error adv-error--foot" role="alert">{{ submitError() }}</p> }
        <button class="btn" type="button" [disabled]="busy()" (click)="closed.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !preview().request" (click)="submit()">{{ busy() ? 'Bezig…' : 'Conceptvoorschotfactuur maken' }}</button>
      </div>
    </app-sheet>
  `,
})
export class SalesAdvanceInvoiceSheet {
  readonly view = input.required<SalesOrderView>();
  readonly closed = output<void>();
  readonly created = output<SalesOrderView>();
  /** The customer changed or cancelled the website order meanwhile; the host reloads its view. */
  readonly conflict = output<void>();

  readonly desktop = inject(DesktopViewport);
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);

  readonly modes: readonly { key: Mode; label: string }[] = [
    { key: 'P30', label: '30 %' }, { key: 'P50', label: '50 %' }, { key: 'PCT', label: 'Eigen %' }, { key: 'AMOUNT', label: 'Bedrag' },
  ];
  readonly mode = signal<Mode>('P30');
  readonly pctValue = signal<number | null>(null);
  readonly amountValue = signal<number | null>(null);
  readonly dueDate = signal('');
  readonly busy = signal(false);
  readonly submitError = signal('');
  /** A preset is valid from the start; a typed value only complains once something was typed. */
  readonly touched = computed(() => this.mode() === 'P30' || this.mode() === 'P50'
    || (this.mode() === 'PCT' ? this.pctValue() != null : this.amountValue() != null));

  readonly base = computed(() => advanceBaseExcl(this.view()));
  readonly remaining = computed(() => remainingToInvoiceExcl(this.view()));
  readonly choice = computed<AdvanceChoice>(() => {
    const mode = this.mode();
    if (mode === 'P30') return { kind: 'PERCENT', pct: 30 };
    if (mode === 'P50') return { kind: 'PERCENT', pct: 50 };
    return mode === 'PCT' ? { kind: 'PERCENT', pct: this.pctValue() } : { kind: 'AMOUNT', amountEur: this.amountValue() };
  });
  readonly preview = computed(() => advancePreview(this.view(), this.choice(), this.dueDate()));

  pick(mode: Mode): void {
    if (this.busy()) return;
    this.mode.set(mode);
    this.submitError.set('');
  }

  async submit(): Promise<void> {
    const request = this.preview().request;
    if (this.busy() || !request) return;
    this.busy.set(true); this.submitError.set('');
    try {
      const invoice = await this.sales.createAdvanceInvoice(this.view().order.id, request, webOrderRevision(this.view()));
      this.ui.toast(`${invoice.order.number} aangemaakt · voorschot, niet verstuurd`);
      /* Both outputs fire while the sheet is alive; the navigation may unmount the host. */
      this.created.emit(invoice);
      this.closed.emit();
      await this.router.navigate(['/sales', invoice.order.id]);
    } catch (failure: unknown) {
      if (isWebOrderConflict(failure)) {
        /* Nothing was written and the figures in this sheet are stale: the host shows the latest version. */
        this.ui.toast(messageOf(failure, 'Voorschotfactuur maken mislukt'), 'err');
        this.conflict.emit();
        this.closed.emit();
        return;
      }
      this.submitError.set(messageOf(failure, 'Voorschotfactuur maken mislukt'));
    } finally {
      this.busy.set(false);
    }
  }
}
