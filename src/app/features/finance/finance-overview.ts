import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, signal } from '@angular/core';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { AttentionItem } from './finance-attention';
import { dayMonth } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi } from './finance-section';
import { periodRange } from './finance-sections';
import { FinanceState } from './finance-state';
import { CostLedgerRow } from './cost-ledger';

const ATTENTION_ROWS = 7;

/**
 * Overzicht: how we stand and what needs me now. Four answers (bank, to pay,
 * to receive, spent this month), one attention queue with direct actions,
 * the outlook with the container terms in it, and what was booked last.
 */
@Component({
  selector: 'app-finance-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => FinanceOverview) }],
  imports: [NgTemplateOutlet, Icon, EurPipe, Sheet],
  template: `
    @if (state.desk()) {
      <div class="fin-tiles">
        <button class="fin-tile fin-tile--ink" type="button" (click)="bankTile()">
          <span class="fin-tile__label">Op de bank</span>
          <strong class="fin-tile__value">{{ bankKnown() ? (state.currentBankEur() | eur) : 'Nog niet ingesteld' }}</strong>
          @if (bankKnown()) { <span class="fin-tile__sub" [class.is-warn]="bankStale()">{{ bankSub() }}</span> }
          @else { <span class="fin-tile__sub fin-tile__action">Saldo invullen ›</span> }
        </button>
        <button class="fin-tile" type="button" (click)="state.go({ view: 'open' }, 'push')">
          <span class="fin-tile__label">Te betalen @if (payWarn()) { <i class="wk-dot tone-warn" aria-label="Er staat een oude kost open"></i> }</span>
          <strong class="fin-tile__value">{{ state.payableTotals().nowEur | eur }}</strong>
          <span class="fin-tile__sub">+ {{ state.payableTotals().soonEur | eur }} binnenkort · {{ state.payableTotals().laterEur | eur }} later{{ state.payableTotals().containerLaterEur ? ' (verwacht)' : '' }}</span>
          @if (state.containersLoading()) { <span class="fin-tile__sub">Containers worden geladen…</span> }
        </button>
        <button class="fin-tile" type="button" (click)="state.go({ view: 'incoming' }, 'push')">
          <span class="fin-tile__label">Te ontvangen</span>
          <strong class="fin-tile__value">{{ state.openInvoices().totalEur | eur }}</strong>
          <span class="fin-tile__sub">{{ state.openInvoices().count }} {{ state.openInvoices().count === 1 ? 'factuur' : 'facturen' }} · {{ state.incomingThisMonth().receivedEur | eur }} ontvangen deze maand</span>
        </button>
        <button class="fin-tile" type="button" (click)="state.go({ view: 'costs', period: 'month' }, 'push')">
          <span class="fin-tile__label">Uitgegeven deze maand</span>
          <strong class="fin-tile__value">{{ spent().monthEur | eur }}</strong>
          <span class="fin-tile__sub">excl. btw · {{ spent().yearEur | eur }} dit jaar</span>
        </button>
      </div>

      <div class="fin-ov-grid">
        <section class="fin-card fin-attention">
          <header class="wk-card__head"><h2 class="wk-card__title">Vraagt aandacht</h2>@if (state.attention().length) { <span class="wk-pill">{{ state.attention().length }}</span> }</header>
          @if (state.attention().length) {
            <ul class="fin-attention__list">
              @for (item of attention(); track item.id) {
                <li class="fin-attention__row">
                  <span [class]="'fin-attention__icon ' + toneClass(item)"><app-icon [name]="item.tone === 'info' ? 'info' : 'alert'" [size]="16" /></span>
                  <span class="fin-attention__text"><b>{{ item.title }}</b><small>{{ item.detail }}</small></span>
                  <span class="fin-attention__amount">@if (item.amountEur !== null) { {{ item.amountEur | eur }} }</span>
                  @if (item.action) {
                    <button class="wk-btn wk-btn--sm" type="button" [disabled]="item.action === 'book' && state.booking()" (click)="act(item)">{{ item.actionLabel }}</button>
                  } @else {
                    <button class="wk-btn wk-btn--sm wk-btn--ghost" type="button" [attr.aria-label]="item.actionLabel + ': ' + item.title" (click)="act(item)">{{ item.actionLabel }} <app-icon name="chevron-right" [size]="14" /></button>
                  }
                </li>
              }
            </ul>
            @if (state.attention().length > limit()) {
              <button class="wk-link fin-attention__more" type="button" (click)="expanded.set(true)">Toon alle {{ state.attention().length }}</button>
            }
          } @else {
            <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="tick" [size]="22" /></span><p class="wk-empty__title">Alles bijgewerkt</p><p class="wk-empty__text">Niets vraagt nu je aandacht.</p></div>
          }
        </section>

        <section class="fin-card fin-outlook">
          <header class="wk-card__head"><h2 class="wk-card__title">Vooruitblik</h2>
            @if (incomplete()) { <span class="wk-pill tone-warn wk-card__trail" [title]="incomplete()">onvolledig</span> }</header>
          <div class="wk-card__body"><ng-container [ngTemplateOutlet]="equation" /></div>
        </section>
      </div>

      <section class="wk-card fin-recent">
        <header class="wk-card__head"><h2 class="wk-card__title">Laatst geboekt</h2><button class="wk-link wk-card__trail" type="button" (click)="state.go({ view: 'costs' }, 'push')">Alle uitgaven ›</button></header>
        @if (recent().length) {
          <div class="wk-table fin-table fin-table--recent" role="table">
            <div class="wk-thead" role="row"><span class="wk-th">Datum</span><span class="wk-th">Omschrijving</span><span class="wk-th">Soort</span><span class="wk-th wk-th--num">Bedrag</span></div>
            @for (row of recent(); track row.key) {
              <div class="wk-tr wk-tr--link" role="row" tabindex="0" (click)="openRow(row)" (keydown.enter)="openRow(row)">
                <span class="wk-td">{{ day(row.date) }}</span>
                <span class="wk-td">{{ row.description }}@if (row.party) { <span class="wk-td__sub">{{ row.party }}</span> }</span>
                <span class="wk-td"><span class="wk-pill" [class.tone-teal]="!!row.cost" [class.tone-blue]="!row.cost">{{ row.cost ? 'Kost' : 'Container' }}</span></span>
                <span class="wk-td wk-td--num"><b>{{ row.amountEur | eur }}</b></span>
              </div>
            }
          </div>
        } @else {
          <div class="wk-empty"><p class="wk-empty__title">Nog niets geboekt</p><p class="wk-empty__text">Boek de beurs, de boekhouder of de huur met Kost boeken.</p></div>
        }
      </section>
    } @else {
      <button class="ios-hero" type="button" (click)="bankKnown() ? state.go({ view: 'bank' }, 'push') : state.openBank(null)">
        <span class="ios-hero__label">Op de bank</span>
        <div class="ios-hero__value">{{ bankKnown() ? (state.currentBankEur() | eur) : 'Nog niet ingesteld' }}</div>
        <div class="ios-hero__sub" [class.is-warn]="bankStale()">{{ bankKnown() ? bankSub() : 'Tik om je saldo in te vullen' }}</div>
        <app-icon class="ios-hero__chev" name="chevron-right" [size]="18" />
      </button>
      <section class="ios-section">
        <div class="ios-section__head"><h2>Geld</h2></div>
        <div class="ios-group ios-group--icons">
          <button class="ios-cell ios-cell--tall" type="button" (click)="state.go({ view: 'open' }, 'push')">
            <span class="ios-cell__lead"><span class="ios-tile ios-tile--lg tone-warn"><app-icon name="arrow-out" [size]="18" /></span></span>
            <span class="ios-cell__body"><span class="ios-cell__title">Te betalen</span><span class="ios-cell__sub">{{ state.containersLoading() ? 'Containers worden geladen…' : '+ ' + (state.payableTotals().soonEur | eur) + ' binnenkort · ' + (state.payableTotals().laterEur | eur) + ' later' }}</span></span>
            <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">Nu {{ state.payableTotals().nowEur | eur }}</span></span>
            <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
          </button>
          <button class="ios-cell ios-cell--tall" type="button" (click)="state.go({ view: 'incoming' }, 'push')">
            <span class="ios-cell__lead"><span class="ios-tile ios-tile--lg tone-ok"><app-icon name="arrow-in" [size]="18" /></span></span>
            <span class="ios-cell__body"><span class="ios-cell__title">Te ontvangen</span><span class="ios-cell__sub">{{ state.openInvoices().count }} {{ state.openInvoices().count === 1 ? 'factuur' : 'facturen' }}</span></span>
            <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ state.openInvoices().totalEur | eur }}</span></span>
            <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
          </button>
          <button class="ios-cell ios-cell--tall" type="button" (click)="state.go({ view: 'costs', period: 'month' }, 'push')">
            <span class="ios-cell__lead"><span class="ios-tile ios-tile--lg tone-teal"><app-icon name="receipt" [size]="18" /></span></span>
            <span class="ios-cell__body"><span class="ios-cell__title">Uitgegeven deze maand</span><span class="ios-cell__sub">excl. btw · {{ spent().yearEur | eur }} dit jaar</span></span>
            <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ spent().monthEur | eur }}</span></span>
            <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
          </button>
        </div>
      </section>
      <section class="ios-section">
        <div class="ios-section__head"><h2>Vraagt aandacht</h2></div>
        <div class="ios-group ios-group--icons">
          @for (item of attention(); track item.id) {
            @if (item.action) {
              <div class="ios-cell ios-cell--tall">
                <span class="ios-cell__lead"><span [class]="'ios-tile ios-tile--lg ios-tile--soft ' + toneClass(item)"><app-icon [name]="item.tone === 'info' ? 'info' : 'alert'" [size]="18" /></span></span>
                <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ item.title }}</span><span class="ios-cell__sub">{{ item.detail }}</span></span>
                <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" [disabled]="item.action === 'book' && state.booking()" (click)="act(item)">{{ phoneLabel(item) }}</button>
              </div>
            } @else {
              <button class="ios-cell ios-cell--tall" type="button" (click)="act(item)">
                <span class="ios-cell__lead"><span [class]="'ios-tile ios-tile--lg ios-tile--soft ' + toneClass(item)"><app-icon [name]="item.tone === 'info' ? 'info' : 'alert'" [size]="18" /></span></span>
                <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ item.title }}</span><span class="ios-cell__sub">{{ item.detail }}</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value">{{ item.amountEur !== null ? (item.amountEur | eur) : item.count }}</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
            }
          } @empty {
            <div class="ios-cell"><span class="ios-cell__lead"><span class="ios-tile ios-tile--lg tone-ok"><app-icon name="tick" [size]="18" /></span></span><span class="ios-cell__body"><span class="ios-cell__title">Alles bijgewerkt</span></span></div>
          }
          @if (state.attention().length > limit()) {
            <button class="ios-cell ios-cell--action" type="button" (click)="expanded.set(true)">Toon alle {{ state.attention().length }}</button>
          }
        </div>
      </section>
      <div class="ios-group fin-ios-single">
        <button class="ios-cell" type="button" (click)="state.outlookOpen.set(true)">
          <span class="ios-cell__body"><span class="ios-cell__title">Vooruitblik</span>@if (incomplete()) { <span class="ios-cell__sub fin-warn-text">Onvolledig: {{ incomplete() }}</span> }</span>
          <span class="ios-cell__trail"><span class="ios-cell__value">{{ hasReading() ? 'Blijft over ' + (state.outlook().expectedEur | eur) : 'Netto open ' + (state.outlook().netOpenEur | eur) }}</span></span>
          <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
        </button>
      </div>
      <section class="ios-section">
        <div class="ios-section__head"><h2>Laatst geboekt</h2></div>
        <div class="ios-group">
          @for (row of recent().slice(0, 5); track row.key) {
            <button class="ios-cell" type="button" (click)="openRow(row)">
              <span class="ios-cell__body"><span class="ios-cell__title">{{ row.description }}</span><span class="ios-cell__sub">{{ day(row.date) }} · {{ row.cost ? 'Kost' : 'Container' }}{{ row.party ? ' · ' + row.party : '' }}</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ row.amountEur | eur }}</span></span>
            </button>
          }
          <button class="ios-cell ios-cell--action" type="button" (click)="state.go({ view: 'costs' }, 'push')">Alle uitgaven</button>
        </div>
      </section>
      <div class="ios-group fin-ios-single">
        <button class="ios-cell" type="button" (click)="state.openAnalysis()">
          <span class="ios-cell__body"><span class="ios-cell__title">Analyse</span><span class="ios-cell__sub">Per categorie, btw per kwartaal</span></span>
          <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
        </button>
      </div>
      @if (state.outlookOpen()) {
        <app-sheet variant="ios" title="Vooruitblik" (closed)="state.outlookOpen.set(false)">
          <div body class="fin-sheet"><ng-container [ngTemplateOutlet]="equation" /></div>
        </app-sheet>
      }
    }

    <ng-template #equation>
      @let o = state.outlook();
      <dl class="wk-equation">
        <div><dt>Op de bank</dt><dd>@if (hasReading()) { {{ o.bankEur | eur }} } @else { onbekend · <button class="wk-link" type="button" (click)="state.openBank(null)">Saldo invullen</button> }</dd></div>
        <div class="is-sub"><dt><span class="wk-equation__op">−</span>Open kosten (incl. btw)</dt><dd>{{ o.openCostsEur | eur }}</dd></div>
        @if (state.purchaseFiguresVisible()) { <div class="is-sub"><dt><span class="wk-equation__op">−</span>Containers · nu te betalen (verwacht)</dt><dd>{{ o.containerNowEur | eur }}</dd></div> }
        <div class="is-sub"><dt><span class="wk-equation__op">−</span>Vaste kosten · komende 30 dagen</dt><dd>{{ o.upcomingEur | eur }}</dd></div>
        @if (hasReading()) {
          <div class="is-total"><dt><span class="wk-equation__op">=</span>Na wat nu betaald moet worden</dt><dd [class.wk-amount--warn]="o.afterPayablesEur < 0">{{ o.afterPayablesEur | eur }}</dd></div>
        }
        <div class="is-sub"><dt><span class="wk-equation__op">+</span>Nog te ontvangen (klant &amp; partner)</dt><dd>{{ o.openInvoicesEur | eur }}</dd></div>
        @if (state.purchaseFiguresVisible()) { <div class="is-sub"><dt><span class="wk-equation__op">−</span>Containers · later (verwacht)</dt><dd>{{ o.containerLaterEur | eur }}</dd></div> }
        @if (hasReading()) {
          <div class="is-total is-grand"><dt><span class="wk-equation__op">=</span>Als alles betaald en ontvangen is</dt><dd [class.wk-amount--warn]="o.expectedEur < 0">{{ o.expectedEur | eur }}</dd></div>
        } @else {
          <div class="is-total is-grand"><dt><span class="wk-equation__op">=</span>Netto open positie</dt><dd>{{ o.netOpenEur | eur }}</dd></div>
        }
      </dl>
      @if (!hasReading()) { <p class="fin-hint fin-hint--warn">Banksaldo onbekend: vul eerst een saldo in.</p> }
      @else if (incomplete()) { <p class="fin-hint fin-hint--warn">Onvolledig: {{ incomplete() }}</p> }
      <p class="fin-hint">Containerbedragen volgen de afspraak bij de container en zijn verwacht. Toekomstige verkopen tellen niet mee.</p>
    </ng-template>
  `,
})
export class FinanceOverview implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  readonly expanded = signal(false);
  readonly limit = computed(() => (this.expanded() ? Infinity : ATTENTION_ROWS));
  readonly attention = computed(() => this.state.attention().slice(0, this.limit()));

  readonly bankKnown = computed(() => this.state.bankLedger().accounts.some((account) => account.currentEur !== null));
  readonly hasReading = this.bankKnown;
  readonly bankStale = computed(() => this.state.accountsView().some((account) => account.ageDays !== null && account.ageDays > 14));
  readonly bankSub = computed(() => {
    const accounts = this.state.accountsView();
    if (!accounts.length || !this.bankKnown()) return 'Saldo invullen';
    const missing = accounts.filter((account) => !account.reading).length;
    if (missing) return `deels bekend · ${missing} ${missing === 1 ? 'rekening' : 'rekeningen'} zonder saldo`;
    const newest = Math.min(...accounts.map((account) => account.ageDays ?? 999));
    const when = newest === 0 ? 'vandaag' : newest === 1 ? 'gisteren' : `${newest} dagen geleden`;
    return `${accounts.length} ${accounts.length === 1 ? 'rekening' : 'rekeningen'} · gecontroleerd ${when}`;
  });
  readonly payWarn = computed(() => (this.state.payableTotals().oldestCostAgeDays ?? 0) > 30);
  readonly spent = computed(() => {
    const today = this.state.today();
    const month = periodRange('month', today).from;
    const year = periodRange('year', today).from;
    const sum = (from: string): number => Math.round(this.state.costs().filter((cost) => cost.date >= from && cost.date <= today)
      .reduce((total, cost) => total + (cost.amountExclEur || 0) * 100, 0)) / 100;
    return { monthEur: sum(month), yearEur: sum(year) };
  });
  /** Why the totals may not be the whole story; containers still loading count, their terms are not in yet. */
  readonly incomplete = computed(() => {
    const missing = this.state.accountsView().filter((account) => !account.reading).length;
    const reasons = [
      ...(missing ? [`${missing} ${missing === 1 ? 'rekening' : 'rekeningen'} zonder saldo`] : []),
      ...(this.state.containersLoading() && this.state.purchaseFiguresVisible() ? ['containers worden geladen'] : []),
      ...(this.state.loadErrors().length ? [`niet geladen: ${this.state.failedSources().join(', ')}`] : []),
    ];
    return reasons.join('; ');
  });
  /** Company costs and container payments dated today or earlier, newest first. */
  readonly recent = computed(() => this.state.ledger().filter((row) => row.date <= this.state.today()).slice(0, 6));

  readonly strip = signal(null).asReadonly();
  readonly status = computed(() => `${this.state.attention().length} ${this.state.attention().length === 1 ? 'punt vraagt' : 'punten vragen'} aandacht`);

  handle(): boolean {
    return false;
  }

  bankTile(): void {
    if (this.bankKnown()) this.state.go({ view: 'bank' }, 'push');
    else this.state.openBank(null);
  }

  act(item: AttentionItem): void {
    switch (item.action) {
      case 'book': void this.state.bookNow(); break;
      case 'check': if (item.accountKey) this.state.checkOrFill(item.accountKey); break;
      case 'fill': this.state.openBank(null, item.accountKey ?? ''); break;
      default: this.state.go(item.target, 'push');
    }
  }

  phoneLabel(item: AttentionItem): string {
    return item.action === 'book' ? 'Nu boeken' : item.action === 'link' ? 'Koppel' : item.action === 'check' ? 'Controleer' : item.actionLabel;
  }

  toneClass(item: AttentionItem): string {
    return item.tone === 'danger' ? 'tone-danger' : item.tone === 'warn' ? 'tone-warn' : 'tone-blue';
  }

  openRow(row: CostLedgerRow): void {
    if (row.cost?.id) this.state.inspectItem({ kind: 'cost', id: row.cost.id });
    else if (row.payment) this.state.inspectItem({ kind: 'container', id: row.payment.orderId });
  }

  day(date: string): string { return dayMonth(date); }
}
