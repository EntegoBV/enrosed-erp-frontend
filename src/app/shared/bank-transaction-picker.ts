import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { BankingApi, type BankStatementLine } from '../core/api/banking-api';
import { messageOf } from '../core/api/errors';
import { bankTransactionAllocated, bankTransactionDay, bankTransactionOptions, type BankDirection } from './bank-transaction-options';
import { bankAmountDifference } from './bank-transaction-options';
import { EurPipe } from './pipes';
import { Skeleton } from './skeleton';

/** Inline in payment sheets: no nested modal or fixed-position container. */
@Component({
  selector: 'app-bank-transaction-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, Skeleton],
  template: `
    <section class="bank-picker" aria-label="Bestaande banktransactie">
      <header><div><b>Banktransactie koppelen</b><small>Kies een bestaande beweging; datum en rekening komen van de bank; bestaande betaalbedragen blijven behouden.</small></div>
        <button type="button" class="btn btn--sm" [disabled]="disabled()" [attr.aria-expanded]="expanded()" (click)="toggle()">{{ expanded() ? 'Sluiten' : selected() ? 'Andere kiezen' : 'Transactie kiezen' }}</button>
      </header>
      @if (selected(); as row) {
        <div class="bank-picker__selected" role="status"><div><b>{{ row.amountEur | eur }}</b><span>{{ day(row) }} · {{ row.counterparty || 'Geen tegenpartij' }}</span><small>{{ row.reference || 'Geen mededeling' }}</small><small>{{ row.account }} · {{ row.source === 'ODOO' ? 'Odoo' : 'Handmatig' }}</small>@if (difference(row) !== null && difference(row) !== 0) { <small>Verschil bank − geboekt: {{ difference(row)! | eur }}. Maximaal € 0,02 bij koppelen aan een bestaande betaling.</small> }</div>
          <button type="button" class="btn btn--sm" [disabled]="disabled()" (click)="selectedChange.emit(null)">Selectie wissen</button></div>
      }
      @if (expanded()) {
        <div class="bank-picker__filters">
          <label><span>Zoeken</span><input class="input" type="search" placeholder="Referentie, bedrag, tegenpartij of datum" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
          @if (direction() === 'ANY') { <label><span>Richting</span><select class="select" [value]="filterDirection()" (change)="filterDirection.set($any($event.target).value)"><option value="ANY">Inkomend en uitgaand</option><option value="INCOMING">Inkomend</option><option value="OUTGOING">Uitgaand</option></select></label> }
          @if ((amount() ?? 0) > 0) { <label class="bank-picker__exact"><input type="checkbox" [checked]="exact()" (change)="exact.set($any($event.target).checked)" /> Rond {{ amount()! | eur }} (± € 0,02)</label> }
          <button type="button" class="btn btn--sm" [disabled]="loading() || disabled()" (click)="load()">Vernieuwen</button>
        </div>
        @if (loading()) { <div aria-label="Banktransacties laden" role="status"><app-skeleton kind="list" [rows]="3" /></div> }
        @else if (error()) { <p class="bank-picker__error" role="alert">{{ error() }} <button class="btn btn--sm" type="button" (click)="load()">Opnieuw proberen</button></p> }
        @else {
          <div class="bank-picker__results" role="group" aria-label="Banktransacties">
            @for (row of matches(); track row.id) {
              <button class="bank-picker__row" type="button" [disabled]="disabled() || allocated(row)" [attr.aria-pressed]="selected()?.id === row.id" (click)="choose(row)">
                <span class="bank-picker__main"><b>{{ row.counterparty || row.reference || 'Banktransactie' }}</b><small>{{ day(row) }} · {{ row.reference || 'Geen mededeling' }}</small><small>{{ row.account }}</small></span>
                <span class="bank-picker__money"><b>{{ row.amountEur | eur }}</b><small>{{ row.source === 'ODOO' ? 'Odoo' : 'Handmatig' }}</small><small>{{ allocated(row) ? (row.allocationLabel || 'Al gekoppeld') : 'Vrij om te koppelen' }}</small></span>
              </button>
            } @empty { <p class="bank-picker__empty">{{ rows().length ? 'Geen transacties bij deze filters. Pas de zoekterm of het bedragfilter aan.' : 'Er zijn nog geen banktransacties beschikbaar. Synchroniseer bij Kosten & bank of registreer de betaling handmatig.' }}</p> }
          </div>
        }
      }
    </section>
  `,
  styles: [`
    :host{display:block;margin:12px 0;min-width:0}.bank-picker{border:1px solid var(--border,#ddd);border-radius:16px;padding:14px;background:var(--surface,#fff)}
    header,.bank-picker__selected{display:flex;align-items:center;justify-content:space-between;gap:12px}header div,.bank-picker__selected div{display:grid;gap:4px;min-width:0}small{font-size:12px;color:var(--muted,#666);overflow-wrap:anywhere}header b{font-size:14px}header button{flex-shrink:0}
    .bank-picker__selected{padding:12px;margin-top:12px;border-radius:12px;background:var(--accent-soft,#eef7f0)}.bank-picker__selected span{font-size:13px}
    .bank-picker__filters{display:flex;flex-wrap:wrap;align-items:end;gap:10px;margin:14px 0}.bank-picker__filters>label:first-child{flex:1 1 220px}.bank-picker__filters label{display:grid;gap:4px;font-size:12px}.bank-picker__filters .bank-picker__exact{display:flex;align-items:center;padding:10px 0;gap:6px}.bank-picker__results{max-height:340px;overflow:auto;overscroll-behavior:contain}
    .bank-picker__row{display:flex;justify-content:space-between;gap:14px;width:100%;padding:12px 3px;text-align:left;color:inherit;background:none;border:0;border-top:1px solid var(--border,#ddd);cursor:pointer}.bank-picker__row:focus-visible{outline:2px solid var(--accent,#248149);outline-offset:-2px}.bank-picker__row:disabled{opacity:.5;cursor:default}.bank-picker__main,.bank-picker__money{display:grid;gap:4px;min-width:0}.bank-picker__main{flex:1}.bank-picker__main b{font-size:13px;overflow-wrap:anywhere}.bank-picker__money{text-align:right;max-width:44%;flex-shrink:0}.bank-picker__money>b{white-space:nowrap;font-size:14px;font-variant-numeric:tabular-nums}.bank-picker__error{color:var(--danger,#b3261e)}.bank-picker__empty{font-size:13px;color:var(--muted,#666);line-height:1.5;margin:14px 0}
    @media(max-width:480px){.bank-picker{padding:12px}header{align-items:start;flex-wrap:wrap}.bank-picker__filters{gap:8px}.bank-picker__selected{align-items:start;flex-wrap:wrap}}
  `],
})
export class BankTransactionPicker implements OnInit {
  private readonly api = inject(BankingApi);
  readonly direction = input<BankDirection>('ANY');
  readonly amount = input<number | null>(null);
  readonly selected = input<BankStatementLine | null>(null);
  readonly disabled = input(false);
  /** Lines not offered: those already linked to a part of this payment and those already picked. */
  readonly exclude = input<readonly number[]>([]);
  /** Open the list at once (the sheet's 'Koppelen' already asked for it). */
  readonly startOpen = input(false);
  readonly selectedChange = output<BankStatementLine | null>();
  readonly expanded = signal(false);
  readonly rows = signal<BankStatementLine[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly query = signal('');
  readonly exact = signal(false);
  readonly filterDirection = signal<BankDirection>('ANY');
  readonly matches = computed(() => {
    const excluded = new Set(this.exclude());
    return bankTransactionOptions(this.rows().filter(row => !excluded.has(row.id)), this.direction() === 'ANY' ? this.filterDirection() : this.direction(), this.query(), this.amount(), this.exact());
  });
  ngOnInit(): void { if (this.startOpen()) { this.expanded.set(true); void this.load(); } }
  readonly allocated = bankTransactionAllocated;
  difference(row: BankStatementLine): number | null { const amount = this.amount(); return amount != null && amount > 0 ? bankAmountDifference(row.amountEur, Math.sign(row.amountEur) * amount) : null; }
  day(row: BankStatementLine): string { return bankTransactionDay(row).split('-').reverse().join('/'); }
  toggle(): void { this.expanded.update(open => !open); if (this.expanded()) void this.load(); }
  choose(row: BankStatementLine): void { if (this.disabled() || this.allocated(row)) return; this.selectedChange.emit(row); this.expanded.set(false); }
  async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true); this.error.set('');
    try { this.rows.set(await this.api.list()); }
    catch (failure) { this.error.set(messageOf(failure, 'Banktransacties laden mislukt.')); }
    finally { this.loading.set(false); }
  }
}
