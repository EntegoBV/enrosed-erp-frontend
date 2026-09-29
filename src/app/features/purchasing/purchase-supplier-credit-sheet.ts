import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  Currency, PurchaseOrderView, PurchaseSupplierCredit, SupplierCreditOffsetWrite, SupplierCreditReason, SupplierCreditUpdate,
  SupplierCreditWrite,
} from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { DateField } from '../../shared/date-field';
import { CurPipe, DateNlPipe, EurPipe } from '../../shared/pipes';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { parsePurchasePaymentAmount } from './purchase-payment-amount';
import {
  SUPPLIER_CREDIT_REASON_LABEL, supplierCreditEditBody, supplierCreditKeptEur, supplierCreditPrefill, supplierCreditRefundBody,
  type Due, type SupplierCreditAction,
} from './purchase-payment-ledger';

/** The sheet's own modes; removing and undoing a refund are confirms in the host. */
export type SupplierCreditSheetAction = Extract<SupplierCreditAction, { kind: 'add' }>
  | { kind: 'edit' | 'refund' | 'offset'; credit: PurchaseSupplierCredit };

/** What the host sends once the sheet is confirmed. */
export type SupplierCreditSubmit =
  | { kind: 'add'; body: SupplierCreditWrite }
  | { kind: 'edit' | 'refund'; creditId: number; body: SupplierCreditUpdate }
  | { kind: 'offset'; creditId: number; body: SupplierCreditOffsetWrite; targetNumber: string };

const REASONS: readonly SupplierCreditReason[] = ['SHORTAGE', 'DAMAGE', 'PRICE', 'OTHER'];
let nextSheetId = 0;

/** Today on this device as yyyy-mm-dd. */
function localIsoDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const amountText = (value: number | null | undefined): string =>
  value != null && value > 0 ? value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) : '';

interface CreditForm {
  notedOn: string;
  reason: SupplierCreditReason;
  amountInput: string;
  /** Typed by the buyer: a new reason no longer replaces it with its prefill. */
  amountTouched: boolean;
  currency: Currency;
  amountEurInput: string;
  note: string;
  settledOn: string;
  refundEurInput: string;
  targetOrderId: number | null;
  paidOn: string;
  instalmentDue: Due | null;
}

/**
 * Tegoed leverancier: note what the supplier owes back (a short delivery,
 * damage, a price difference), mark it refunded, or offset it as a payment
 * on another container of the same supplier. The sheet only shows and
 * reports; the host saves first, writes and refreshes.
 */
@Component({
  selector: 'app-purchase-supplier-credit-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, Segmented, DateField, EurPipe, CurPipe, DateNlPipe],
  template: `
    @let form = state();
    @let act = action();
    <app-sheet [title]="title()" variant="ios" [wide]="act.kind === 'add' || act.kind === 'edit'" (closed)="cancel.emit()">
      <div body class="pay-sheet credit-sheet" [attr.inert]="busy() ? '' : null">
        @if (act.kind === 'add' || act.kind === 'edit') {
          <div class="pay-sheet__who">
            <span class="pay-sheet__label">Reden</span>
            <app-segmented label="Reden" [variant]="desk() ? 'desk' : 'ios'" [options]="reasons" [value]="form.reason" (changed)="pickReason($any($event))" />
          </div>
          <div class="form-grid pay-sheet__grid">
            <div class="field pay-sheet__amount">
              <label [for]="ids + '-amount'">Bedrag</label>
              <div class="input-affix">
                <input class="input num right" [id]="ids + '-amount'" type="text" inputmode="decimal" autocomplete="off"
                       [ngModel]="form.amountInput" (ngModelChange)="patch({ amountInput: $event, amountTouched: true })" />
                <select class="input-affix__suffix" aria-label="Munt" [ngModel]="form.currency" (ngModelChange)="pickCurrency($event)">
                  <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
                </select>
              </div>
              @if (form.amountInput && amount() === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, bijvoorbeeld 1.046,95.</span> }
              @else if (prefillHint(); as hint) { <span class="hint">{{ hint }}</span> }
            </div>
            @if (act.kind === 'add') {
              <div class="field">
                <label [for]="ids + '-date'">Datum</label>
                <app-date-field [fieldId]="ids + '-date'" [value]="form.notedOn" (valueChange)="patch({ notedOn: $event })" />
              </div>
            } @else {
              <div class="field">
                <span class="label">Genoteerd op</span>
                <p class="pay-sheet__note">{{ form.notedOn | dateNl }}</p>
              </div>
            }
            @if (form.currency !== 'EUR') {
              <div class="field span-2">
                <label [for]="ids + '-eur'">Afgeschreven in euro <span class="opt"></span></label>
                <div class="input-affix">
                  <input class="input num right" [id]="ids + '-eur'" type="text" inputmode="decimal" autocomplete="off"
                         [ngModel]="form.amountEurInput" (ngModelChange)="patch({ amountEurInput: $event })" />
                  <span class="input-affix__suffix">EUR</span>
                </div>
                @if (form.amountEurInput && amountEur() === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, bijvoorbeeld 480,00.</span> }
                @else if (keptEur(); as kept) { <span class="hint">Leeg laten = blijft {{ kept | eur }}. Vul het echte eurobedrag in als je het kent.</span> }
                @else { <span class="hint">Leeg laten = orderkoers. Vul het echte eurobedrag in als je het kent.</span> }
              </div>
            }
            <div class="field span-2">
              <label [for]="ids + '-note'">Notitie <span class="opt"></span></label>
              <textarea class="textarea" [id]="ids + '-note'" rows="2" maxlength="500" placeholder="Bijv. 40 dozen minder geleverd, bevestigd per mail"
                        [ngModel]="form.note" (ngModelChange)="patch({ note: $event })"></textarea>
            </div>
          </div>
          <p class="pay-sheet__note">Het tegoed verlaagt de eindkost van de leverancier; Betaald en Open blijven zoals ze zijn. Nadien noteer je de terugbetaling of verreken je het met een andere container.</p>
          @if (supplierOpenEur() > 0 && act.kind === 'add') {
            <p class="pay-sheet__note pay-sheet__note--warn">Er staat nog {{ supplierOpenEur() | eur }} open bij de leverancier: je kunt ook lager afrekenen in plaats van een tegoed te noteren.</p>
          }
        } @else {
          @let credit = act.credit;
          <dl class="wk-equation settle-sheet__receipt">
            <div><dt>Tegoed · {{ reasonLabel(credit.reason) }}</dt><dd>{{ credit.amountEur | eur }}</dd></div>
            @if (credit.currency !== 'EUR') { <div class="is-sub"><dt>in {{ credit.currency }}</dt><dd>{{ credit.amount | cur: credit.currency }}</dd></div> }
            <div class="is-sub"><dt>genoteerd</dt><dd>{{ credit.notedOn | dateNl }}</dd></div>
          </dl>
          @if (act.kind === 'refund') {
            <div class="form-grid pay-sheet__grid">
              <div class="field">
                <label [for]="ids + '-refunded'">Terugbetaald op</label>
                <app-date-field [fieldId]="ids + '-refunded'" [value]="form.settledOn" (valueChange)="patch({ settledOn: $event })" />
              </div>
              <div class="field">
                <label [for]="ids + '-refund-eur'">Ontvangen in euro</label>
                <div class="input-affix">
                  <input class="input num right" [id]="ids + '-refund-eur'" type="text" inputmode="decimal" autocomplete="off"
                         [ngModel]="form.refundEurInput" (ngModelChange)="patch({ refundEurInput: $event })" />
                  <span class="input-affix__suffix">EUR</span>
                </div>
                @if (form.refundEurInput && refundEur() === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in.</span> }
                @else { <span class="hint">Wat er op de bank binnenkwam; het tegoed telt daarna voor dit bedrag.</span> }
              </div>
            </div>
          } @else {
            <div class="form-grid pay-sheet__grid">
              <div class="field span-2">
                <label [for]="ids + '-target'">Verrekenen met container</label>
                @if (targets(); as list) {
                  @if (list.length) {
                    <select class="select" [id]="ids + '-target'" [ngModel]="form.targetOrderId" (ngModelChange)="patch({ targetOrderId: +$event, instalmentDue: null })">
                      <option [ngValue]="null" disabled>Kies een container…</option>
                      @for (target of list; track target.order.id) { <option [ngValue]="target.order.id">{{ targetLabel(target) }}</option> }
                    </select>
                  } @else {
                    <p class="pay-sheet__note pay-sheet__note--warn">Er is geen andere bestelde container van deze leverancier om mee te verrekenen.</p>
                  }
                } @else {
                  <p class="pay-sheet__note">Containers van deze leverancier laden…</p>
                }
              </div>
              <div class="field">
                <label [for]="ids + '-paid'">Datum</label>
                <app-date-field [fieldId]="ids + '-paid'" [value]="form.paidOn" (valueChange)="patch({ paidOn: $event })" />
              </div>
              @if (targetTerms().length) {
                <div class="field">
                  <label [for]="ids + '-term'">Voor termijn <span class="opt"></span></label>
                  <select class="select" [id]="ids + '-term'" [ngModel]="form.instalmentDue" (ngModelChange)="patch({ instalmentDue: $event })">
                    <option [ngValue]="null">Automatisch verdelen</option>
                    @for (term of targetTerms(); track term.due) { <option [ngValue]="term.due">{{ term.label }}</option> }
                  </select>
                </div>
              }
            </div>
            <p class="pay-sheet__note">Op die container komt een betaling aan de leverancier van {{ credit.amount | cur: credit.currency }} met omschrijving ‘Verrekend tegoed {{ orderNumber() }}’. Verwijder je die betaling, dan staat het tegoed hier weer open.</p>
          }
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="cancel.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !submission()" (click)="confirm()">{{ busy() ? 'Bezig…' : confirmLabel() }}</button>
      </div>
    </app-sheet>
  `,
})
export class PurchaseSupplierCreditSheet {
  private readonly viewport = inject(DesktopViewport);
  readonly action = input.required<SupplierCreditSheetAction>();
  readonly view = input.required<PurchaseOrderView>();
  /** Offset only: the other containers of the supplier; null while they load. */
  readonly targets = input<readonly PurchaseOrderView[] | null>(null);
  /** What is still open at the supplier: a lower settlement may fit better than a credit. */
  readonly supplierOpenEur = input(0);
  readonly busy = input(false);
  readonly submit = output<SupplierCreditSubmit>();
  readonly cancel = output<void>();

  readonly ids = `credit-sheet-${++nextSheetId}`;
  readonly desk = computed(() => this.viewport.active());
  readonly reasons: SegmentOption[] = REASONS.map(reason => ({ id: reason, label: SUPPLIER_CREDIT_REASON_LABEL[reason] }));
  readonly orderNumber = computed(() => this.view().order.number);

  readonly state = linkedSignal<SupplierCreditSheetAction, CreditForm>({
    source: () => this.action(),
    // Only a new action resets the form; a refreshed order underneath it does not.
    computation: action => untracked(() => {
      const today = localIsoDay();
      if (action.kind === 'add') {
        const variance = this.view().receiptVariance;
        const reason = action.reason ?? (!variance?.missingPieces && variance?.damagedPieces ? 'DAMAGE' : 'SHORTAGE');
        return { notedOn: today, reason, amountInput: amountText(supplierCreditPrefill(this.view(), reason)), amountTouched: false,
          currency: 'EUR', amountEurInput: '', note: '', settledOn: today, refundEurInput: '', targetOrderId: null, paidOn: today, instalmentDue: null };
      }
      const credit = action.credit;
      // The euro field starts empty: filled with the stored euro, a new amount would keep the old euro value.
      return { notedOn: credit.notedOn, reason: credit.reason, amountInput: amountText(credit.amount), amountTouched: true,
        currency: credit.currency, amountEurInput: '', note: credit.note ?? '',
        settledOn: today, refundEurInput: amountText(credit.amountEur), targetOrderId: null, paidOn: today, instalmentDue: null };
    }),
  });

  readonly title = computed(() => {
    switch (this.action().kind) {
      case 'add': return 'Tegoed noteren';
      case 'edit': return 'Tegoed aanpassen';
      case 'refund': return 'Terugbetaald noteren';
      default: return 'Verrekenen met…';
    }
  });
  readonly confirmLabel = computed(() => {
    switch (this.action().kind) {
      case 'add': return 'Tegoed bewaren';
      case 'edit': return 'Wijziging bewaren';
      case 'refund': return 'Terugbetaling bewaren';
      default: return 'Verrekenen';
    }
  });
  readonly amount = computed(() => parsePurchasePaymentAmount(this.state().amountInput));
  readonly amountEur = computed(() => parsePurchasePaymentAmount(this.state().amountEurInput));
  readonly refundEur = computed(() => parsePurchasePaymentAmount(this.state().refundEurInput));
  /** Where the proposed amount comes from, while it is still the proposal. */
  readonly prefillHint = computed(() => {
    const form = this.state();
    if (this.action().kind !== 'add' || form.amountTouched) return null;
    const value = supplierCreditPrefill(this.view(), form.reason);
    if (value === null) return null;
    if (form.currency !== 'EUR') return `Het voorstel staat in euro: vul het bedrag in ${form.currency} in, of kies EUR.`;
    return form.reason === 'SHORTAGE' ? 'Voorstel: inkoopwaarde van de ontbrekende stuks bij ontvangst.'
      : 'Voorstel: inkoopwaarde van de beschadigde stuks bij ontvangst.';
  });
  /** Edit only: the stored euro an empty euro field keeps, while amount and currency stay. */
  readonly keptEur = computed(() => {
    const action = this.action();
    return action.kind === 'edit' ? supplierCreditKeptEur(action.credit, this.amount(), this.state().currency) : null;
  });
  readonly target = computed(() => this.targets()?.find(view => view.order.id === this.state().targetOrderId) ?? null);
  readonly targetTerms = computed(() => (this.target()?.reconciliation?.supplierInstalments ?? []).filter(term => term.plannedEur > 0));
  /** The write the host sends, or null while something is missing. */
  readonly submission = computed<SupplierCreditSubmit | null>(() => {
    const action = this.action();
    const form = this.state();
    if (action.kind === 'add' || action.kind === 'edit') {
      const amount = this.amount();
      const foreign = form.currency !== 'EUR';
      if (amount === null || !form.notedOn || (foreign && form.amountEurInput.trim() && this.amountEur() === null)) return null;
      const amountEur = foreign ? this.amountEur() : null;
      if (action.kind === 'add') {
        return { kind: 'add', body: { notedOn: form.notedOn, amount, currency: form.currency, reason: form.reason, note: form.note.trim() || null,
          ...(amountEur !== null ? { amountEur } : {}) } };
      }
      return { kind: 'edit', creditId: action.credit.id,
        body: supplierCreditEditBody({ amount, currency: form.currency, amountEur, reason: form.reason, note: form.note }) };
    }
    if (action.kind === 'refund') {
      const refund = this.refundEur();
      if (!form.settledOn || refund === null) return null;
      return { kind: 'refund', creditId: action.credit.id, body: supplierCreditRefundBody(action.credit, form.settledOn, refund) };
    }
    const target = this.target();
    if (!target || !form.paidOn) return null;
    return { kind: 'offset', creditId: action.credit.id, targetNumber: target.order.number,
      body: { targetOrderId: target.order.id, paidOn: form.paidOn, instalmentDue: form.instalmentDue } };
  });

  reasonLabel(reason: SupplierCreditReason): string { return SUPPLIER_CREDIT_REASON_LABEL[reason] ?? reason; }

  targetLabel(target: PurchaseOrderView): string {
    const status = { CONCEPT: 'concept', BESTELD: 'besteld', ONDERWEG: 'vertrokken', ONTVANGEN: 'ontvangen' }[target.order.status];
    return [target.order.number, target.order.alias, status].filter(Boolean).join(' · ');
  }

  patch(changes: Partial<CreditForm>): void {
    this.state.update(form => ({ ...form, ...changes }));
  }

  /** A new reason brings its own proposal, until the buyer typed an amount of their own. */
  pickReason(reason: SupplierCreditReason): void {
    const form = this.state();
    const next: Partial<CreditForm> = { reason };
    if (this.action().kind === 'add' && !form.amountTouched && form.currency === 'EUR') {
      next.amountInput = amountText(supplierCreditPrefill(this.view(), reason));
    }
    this.patch(next);
  }

  /**
   * The proposal is in euro: another currency empties the untouched amount
   * rather than read it as USD or CNY, and back to EUR brings it again.
   */
  pickCurrency(currency: Currency): void {
    const form = this.state();
    const next: Partial<CreditForm> = { currency, amountEurInput: '' };
    if (this.action().kind === 'add' && !form.amountTouched) {
      next.amountInput = currency === 'EUR' ? amountText(supplierCreditPrefill(this.view(), form.reason)) : '';
    }
    this.patch(next);
  }

  confirm(): void {
    const submission = this.submission();
    if (submission && !this.busy()) this.submit.emit(submission);
  }
}
