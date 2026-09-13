import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Payee, PurchaseDocument, PurchaseOrderView, PurchasePayment } from '../../core/api/models';
import { PAYMENT_TERMS } from '../../core/api/models';
import { CurPipe, DateNlPipe, EurPipe } from '../../shared/pipes';
import { instalmentsOf } from './payment-plan';
import { purchaseGroupSettled, purchaseInstalmentState } from './purchase-instalment-state';

export interface PurchasePaymentAction {
  payee: Payee;
  amount?: number;
  label?: string;
  due?: PurchasePayment['instalmentDue'];
}

/** One presentation of the actual ledger for the phone, desktop and read-only order. */
@Component({
  selector: 'app-purchase-payment-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, CurPipe, DateNlPipe],
  template: `
    <div class="payment-overview">
      <div class="payment-overview__totals" aria-label="Totaal betalingen">
        <div><span>Werkelijk betaald</span><strong>{{ paidTotal() | eur }}</strong></div>
        <div><span>Nog open</span><strong>{{ openTotal() | eur }}</strong></div>
      </div>
      @if (dirty()) {
        <p class="payment-overview__notice" role="status">De afspraak bevat niet-opgeslagen wijzigingen. Sla deze eerst op voordat je een betaling toevoegt. Eerdere betalingen behouden hun geboekte bedrag en omschrijving.</p>
      }
      <div class="payment-overview__groups">
        @for (group of groups(); track group.payee) {
          <section class="payment-group" [class.payment-group--supplier]="group.payee === 'SUPPLIER'" [attr.aria-label]="group.label">
            <header class="payment-group__head">
              <div><span class="payment-group__icon" aria-hidden="true">{{ group.symbol }}</span><h3>{{ group.label }}</h3></div>
              <span class="payment-group__status" [class.is-settled]="group.settled || group.paidInFull">{{ group.settled ? 'Afgerekend' : group.paidInFull ? 'Betaald' : group.payee === 'OTHER' ? 'Extra uitgaven' : group.paid > 0 ? 'Deels betaald' : 'Nog te betalen' }}</span>
            </header>
            <dl class="payment-group__amounts">
              @if (group.payee !== 'OTHER') {
                <div><dt>{{ group.payee === 'SUPPLIER' ? 'Afgesproken bedrag' : 'Verwachte kosten' }}</dt><dd>{{ group.planned | eur }}</dd></div>
              }
              <div><dt>Werkelijk betaald</dt><dd>{{ group.paid | eur }}</dd></div>
              @if (group.payee !== 'OTHER') {
                <div><dt>{{ group.settled ? 'Resterend na afrekening' : 'Nog open' }}</dt><dd>{{ group.open | eur }}</dd></div>
              }
            </dl>
            @if (group.payee === 'SUPPLIER' && terms().length) {
              <ol class="payment-terms" aria-label="Leverancierstermijnen">
                @for (term of terms(); track term.due) {
                  <li class="payment-term" [class.is-settled]="term.state === 'paid'">
                    <div class="payment-term__head"><b>{{ term.label }}</b><span>{{ term.settled ? 'Afgerekend' : term.state === 'paid' ? 'Betaald' : term.state === 'due' ? 'Nu te betalen' : 'Later' }}</span></div>
                    <dl><div><dt>Afgesproken</dt><dd>{{ term.full | eur }}</dd></div><div><dt>Betaald</dt><dd>{{ term.covered | eur }}</dd></div><div><dt>Nog open</dt><dd>{{ term.amount | eur }}</dd></div></dl>
                    @if (term.settled && term.covered < term.full - 0.005) {
                      <p>{{ term.full - term.covered | eur }} minder betaald; deze termijn is afgesloten.</p>
                    } @else if (term.covered > term.full + 0.005) {
                      <p>{{ term.covered - term.full | eur }} meer betaald dan de huidige afspraak.</p>
                    }
                    @if (editable() && term.amount > 0 && !term.settled) {
                      <button class="payment-term__add" type="button" [disabled]="busy() || dirty()"
                              (click)="add.emit({ payee: 'SUPPLIER', amount: term.amount, label: term.label, due: term.due })">Betaling noteren <span aria-hidden="true">＋</span></button>
                    }
                  </li>
                }
              </ol>
            }
            @if (group.settled && group.planned > group.paid + 0.005) {
              <p class="payment-group__difference">{{ group.planned - group.paid | eur }} minder betaald na afrekening.</p>
            } @else if (group.payee !== 'OTHER' && group.paid > group.planned + 0.005) {
              <p class="payment-group__difference is-warning">{{ group.paid - group.planned | eur }} meer betaald. {{ group.settled ? 'Deze groep is afgerekend.' : 'Controleer of een correctie volgt.' }}</p>
            }
            @if (group.payments.length) {
              <details class="payment-ledger">
                <summary>Betalingshistoriek <span>{{ group.payments.length }} {{ group.payments.length === 1 ? 'betaling' : 'betalingen' }}</span></summary>
                <ol>
                  @for (payment of group.payments; track payment.id) {
                    <li class="payment-ledger__entry">
                      <div class="payment-ledger__title"><b>{{ payment.label || 'Betaling' }}</b><strong>{{ payment.amountEur | eur }}</strong></div>
                      <p>{{ payment.paidOn | dateNl }}@if (payment.currency !== 'EUR') { · {{ payment.amount | cur: payment.currency }} }@if (payment.actor) { · {{ actor(payment.actor) }} }</p>
                      @if (payment.instalmentDue || payment.settles) {
                        <p class="payment-ledger__scope">@if (payment.instalmentDue) { {{ dueLabel(payment.instalmentDue) }} }@if (payment.settles) { {{ payment.instalmentDue ? ' · termijn afgerekend' : 'Betaalgroep afgerekend' }} }</p>
                      }
                      @if (proofs(payment.id).length) {
                        <div class="payment-ledger__proofs">
                          @for (document of proofs(payment.id); track document.id) {
                            <button type="button" [disabled]="busy()" (click)="download.emit(document)">↗ {{ document.originalFilename }}</button>
                          }
                        </div>
                      }
                      @if (editable()) {
                        <div class="payment-ledger__actions">
                          <button type="button" [disabled]="busy() || dirty()" (click)="edit.emit(payment)">Aanpassen</button>
                          <button type="button" [disabled]="busy()" (click)="proof.emit(payment)">Bewijs toevoegen</button>
                        </div>
                      }
                    </li>
                  }
                </ol>
              </details>
            }
            @if (editable()) {
              <div class="payment-group__actions">
                <button type="button" [disabled]="busy() || dirty()" (click)="add.emit({ payee: group.payee })">＋ {{ group.payments.length ? 'Betaling toevoegen' : 'Betaling noteren' }}</button>
                @if (group.payments.length && group.payee !== 'OTHER') {
                  <button type="button" class="payment-group__settle" [disabled]="busy() || dirty()" (click)="settle.emit(group.payee)">{{ group.settled ? 'Afrekening aanpassen' : 'Groep afrekenen' }}</button>
                }
              </div>
            }
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .payment-overview { min-width: 0; }
    .payment-overview__totals { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
    .payment-overview__totals > div { display: grid; gap: 7px; padding: 16px; border-radius: 18px; background: var(--surface-2); }
    .payment-overview__totals > div:first-child { background: var(--rose-soft); }
    .payment-overview__totals span { color: var(--muted); font-size: 11px; }
    .payment-overview__totals strong { color: var(--ink); font-size: clamp(19px, 2vw, 25px); letter-spacing: -.03em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .payment-overview__notice { margin: 0 0 14px; padding: 12px; background: var(--warn-soft); border-radius: 12px; color: var(--ink); font-size: 12px; line-height: 1.5; }
    .payment-overview__groups { display: grid; gap: 14px; }
    .payment-group { min-width: 0; padding: 16px; border: 1px solid var(--line); border-radius: 20px; background: var(--surface); }
    .payment-group--supplier { border-color: var(--rose-line); }
    .payment-group__head { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
    .payment-group__head > div { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .payment-group__icon { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; border-radius: 11px; color: var(--rose-dark); background: var(--rose-soft); font-size: 19px; }
    h3 { margin: 0; color: var(--ink); font-size: 14px; line-height: 1.4; }
    .payment-group__status { padding: 5px 8px; border-radius: 999px; color: var(--muted); background: var(--surface-2); font-size: 10px; white-space: nowrap; }
    .payment-group__status.is-settled { color: var(--ok); background: var(--ok-soft); }
    .payment-group__amounts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 16px 0 0; }
    dl > div { min-width: 0; }
    dt { color: var(--muted); font-size: 10px; line-height: 1.5; }
    dd { margin: 5px 0 0; color: var(--ink); font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .payment-terms { display: grid; gap: 8px; list-style: none; margin: 16px 0 0; padding: 0; }
    .payment-term { padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
    .payment-term.is-settled { background: color-mix(in srgb, var(--ok-soft) 45%, var(--surface)); }
    .payment-term__head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: space-between; }
    .payment-term__head b { font-size: 12px; line-height: 1.5; }
    .payment-term__head span { color: var(--muted); font-size: 10px; }
    .payment-term.is-settled .payment-term__head span { color: var(--ok); }
    .payment-term dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin: 10px 0 0; }
    .payment-term dd { font-size: 12px; }
    .payment-term p, .payment-group__difference { margin: 10px 0 0; font-size: 11px; color: var(--ok); line-height: 1.5; }
    .is-warning { color: var(--warn); }
    button { min-height: 44px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); font: inherit; font-size: 11px; font-weight: 650; cursor: pointer; }
    button:disabled { opacity: .45; cursor: default; }
    button:focus-visible, summary:focus-visible { outline: 2px solid var(--rose); outline-offset: 3px; }
    .payment-term__add { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 10px; border-color: var(--rose-line); color: var(--rose-dark); }
    .payment-group__actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; }
    .payment-group__actions > button:first-child { flex: 1; color: var(--rose-dark); border-color: var(--rose-line); background: var(--rose-soft); }
    .payment-group__settle { color: var(--muted); }
    .payment-ledger { margin-top: 14px; border-top: 1px solid var(--line); }
    summary { min-height: 44px; padding: 14px 0 8px; color: var(--ink); font-size: 12px; font-weight: 650; cursor: pointer; }
    summary > span { margin-left: 5px; color: var(--muted); font-size: 10px; font-weight: 400; }
    .payment-ledger ol { list-style: none; margin: 0; padding: 0; }
    .payment-ledger__entry { padding: 12px 0; border-bottom: 1px solid var(--line); }
    .payment-ledger__entry:last-child { padding-bottom: 0; border-bottom: 0; }
    .payment-ledger__title { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; }
    .payment-ledger__title b { min-width: 0; overflow-wrap: anywhere; }
    .payment-ledger__title strong { flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .payment-ledger__entry p { margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
    .payment-ledger__actions, .payment-ledger__proofs { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
    .payment-ledger__proofs button { max-width: 100%; text-align: left; overflow-wrap: anywhere; }
    .payment-ledger__actions button { flex: 1; }
    @media (max-width: 360px) {
      .payment-group { padding: 12px; }
      .payment-overview__totals > div { padding: 13px; }
      .payment-group__amounts, .payment-term dl { gap: 5px; }
      dd { font-size: 12px; }
      .payment-term dd { font-size: 11px; }
    }
  `,
})
export class PurchasePaymentOverview {
  readonly view = input.required<PurchaseOrderView>();
  readonly payments = input<readonly PurchasePayment[] | null>(null);
  readonly documents = input<readonly PurchaseDocument[] | null>(null);
  readonly editable = input(false);
  readonly busy = input(false);
  readonly dirty = input(false);
  readonly add = output<PurchasePaymentAction>();
  readonly edit = output<PurchasePayment>();
  readonly proof = output<PurchasePayment>();
  readonly download = output<PurchaseDocument>();
  readonly settle = output<Payee>();
  readonly terms = computed(() => purchaseInstalmentState(this.view(), instalmentsOf(this.view().order, PAYMENT_TERMS), this.payments()));
  readonly groups = computed(() => {
    const view = this.view();
    const settings: { payee: Payee; label: string; symbol: string; fallback: number }[] = [
      { payee: 'SUPPLIER', label: 'Leverancier', symbol: '↗', fallback: view.payable?.supplierEur ?? view.costing.totals.goodsEur },
      { payee: 'LOGISTICS', label: 'Douane & transport', symbol: '↔', fallback: view.payable?.logisticsEur ?? 0 },
      { payee: 'SEPARATE', label: 'Inspectie & andere kosten', symbol: '✓', fallback: view.costing.totals.separateCostsEur ?? 0 },
      { payee: 'OTHER', label: 'Extra uitgaven', symbol: '+', fallback: 0 },
    ];
    return settings.map(setting => {
      const stream = view.reconciliation?.streams.find(item => item.payee === setting.payee);
      const payments = (this.payments() ?? []).filter(item => (item.payee ?? 'SUPPLIER') === setting.payee)
        .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.id - a.id);
      const planned = stream?.plannedEur ?? setting.fallback;
      const paid = stream?.paidEur ?? payments.reduce((sum, item) => sum + item.amountEur, 0);
      const settled = purchaseGroupSettled(view, this.payments(), setting.payee);
      const open = stream?.remainingEur ?? (settled || setting.payee === 'OTHER' ? 0 : Math.max(0, planned - paid));
      return { ...setting, planned, paid, open, payments, settled, paidInFull: setting.payee !== 'OTHER' && planned > 0 && open === 0 && paid >= planned };
    }).filter(group => group.payee === 'SUPPLIER' || group.planned > 0 || group.payments.length
      || (this.editable() && (group.payee !== 'LOGISTICS' || !view.payable?.ddp)));
  });
  readonly paidTotal = computed(() => this.view().reconciliation?.totals.paidEur ?? this.groups().reduce((sum, group) => sum + group.paid, 0));
  readonly openTotal = computed(() => this.view().reconciliation?.totals.remainingEur ?? this.groups().reduce((sum, group) => sum + group.open, 0));

  proofs(id: number): readonly PurchaseDocument[] { return (this.documents() ?? []).filter(document => document.paymentId === id); }
  dueLabel(due: NonNullable<PurchasePayment['instalmentDue']>): string { return { ORDERED: 'Bij bestelling', SHIPPED: 'Bij vertrek', ARRIVED: 'Bij aankomst' }[due]; }
  actor(value: string): string { return value.replace(/^.*[\\/]/, '').split('@')[0]; }
}
