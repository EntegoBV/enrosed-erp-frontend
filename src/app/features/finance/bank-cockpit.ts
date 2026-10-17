import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { BankStatementLine } from '../../core/api/banking-api';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { BankAccountCard, type AccountView } from './bank-account-card';
import { BankMovementPanel } from './bank-movement-panel';
import { bankTextOf } from './bank-text';
import { dayEndBalances } from './cash-forecast';
import { containerName, containerNumberHint } from '../purchasing/container-name';
import type { CostLedgerRow } from './cost-ledger';
import { AttentionItem, AttentionKind } from './finance-attention';
import { dayMonth, syncMoment } from './finance-format';
import { periodRange } from './finance-sections';
import { FinanceState } from './finance-state';
import { KaslijnCard } from './kaslijn-card';
import { OdooSyncState } from './odoo-sync-state';
import { VooruitblikEquation } from './vooruitblik-equation';

const ATTENTION_ROWS = 7;
/** One icon per kind of attention row (critique N9). */
const ATTENTION_ICON: Readonly<Record<AttentionKind, string>> = {
  'vat-deadline': 'calendar', 'unlinked-incoming': 'link', 'old-receivables': 'arrow-in', 'receipts-without-account': 'arrow-in',
  'container-due': 'truck', 'overdue-costs': 'receipt', 'open-credits': 'receipt', 'recurring-due': 'repeat',
  'account-without-reading': 'bank', 'stale-reading': 'bank', 'unbanked-payments': 'bank', 'costs-without-document': 'clip', 'unconfirmed-regimes': 'info',
};
const DAY_MS = 86_400_000;
const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
/** '+ € 1.452,00', '− € 86,73', '€ 0,00'. */
const signed = (value: number): string => (Math.round(value * 100) === 0 ? euro.format(0) : `${value > 0 ? '+' : '−'} ${euro.format(Math.abs(value))}`);

/**
 * Bank, the home of Kosten & bank (spec-bank-forecast §3.1, §3.2): the money
 * on each account, the Geld strip (the four tiles of the old Overzicht with
 * every sub-line), the Kaslijn, and the transactions beside the rail:
 * "Vooruitblik" (the equation; on top of the rail so the first transactions
 * stay above the 1440×900 fold, §3.1), "Vraagt aandacht" and "Laatst
 * geboekt". The phone Bank tab shows the same in iOS form. Every figure of the
 * old Overzicht is here (§3.15).
 */
@Component({
  selector: 'app-bank-cockpit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, EurPipe, Segmented, Sheet, BankAccountCard, BankMovementPanel, KaslijnCard, VooruitblikEquation],
  template: `
    @if (state.desk()) {
      <div class="fin-cockpit">
        @if (single(); as a) {
          <!-- One active account: one light band (account, balance, 30 days, what moved, where it comes from, Beheer) instead of the dark tile and a card. -->
          <section class="wk-card fin-band" aria-label="Rekening">
            <div class="fin-band__id"><span class="fin-acct__icon"><app-icon name="bank" [size]="18" /></span>
              <span><b>{{ a.label }}</b><small>{{ iban(a.account) }}</small></span></div>
            <div class="fin-band__balance">
              <button class="fin-band__open" type="button" [attr.title]="computedSub()" (click)="totalTile()">
                <span class="fin-band__label">Op de bank</span>
                <strong class="fin-band__value">{{ a.currentEur !== null ? (a.currentEur | eur) : 'Nog geen saldo' }}</strong>
              </button>
              <span class="fin-band__age" [class.is-warn]="bankStale()">{{ bandAge() }}@if (bankStale()) { · <button class="wk-link fin-band__check" type="button" (click)="state.checkOrFill(a.account)">controleren</button> }</span>
            </div>
            @if (spark(); as path) {
              <svg class="fin-band__spark" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true"><path class="is-area" [attr.d]="path.area" /><path [attr.d]="path.line" /></svg>
            } @else { <span class="fin-band__spark" aria-hidden="true"></span> }
            <div class="fin-band__moves"><span><small>Vandaag</small><b>{{ signedEur(moves().today) }}</b></span><span><small>Deze week</small><b>{{ signedEur(moves().week) }}</b></span></div>
            <div class="fin-band__status">
              <small>{{ source(a) }}</small>
              <span class="fin-band__pills">
                @if (unlinkedCount()) { <button class="wk-pill tone-warn" type="button" (click)="toTransactions(true)">{{ unlinkedCount() }} te koppelen</button> }
                @else if (activeLines().length) { <span class="wk-pill tone-ok">Alles gekoppeld</span> }
                <button class="wk-link" type="button" (click)="toTransactions(false)">{{ activeLines().length }} {{ activeLines().length === 1 ? 'transactie' : 'transacties' }}</button>
                @if (!a.countsInCash) { <span class="wk-pill wk-pill--outline">telt niet mee in de kasprognose</span> }
                @if (a.currentEur === null) { <button class="wk-link" type="button" (click)="state.checkOrFill(a.account)">Saldo invullen ›</button> }
              </span>
            </div>
            <button class="wk-btn wk-btn--ghost wk-btn--sm fin-band__more" type="button" [attr.aria-label]="a.label + ' beheren'" aria-haspopup="menu" (click)="manage(a, $event)">
              <app-icon name="more" [size]="16" /><span>Beheer</span></button>
          </section>
        } @else {
          <div class="fin-accounts" role="list" aria-label="Bankrekeningen">
            <button class="fin-total" type="button" role="listitem" (click)="totalTile()">
              <span class="fin-total__top"><span>Op de bank</span><small>{{ accountCount() }}</small></span>
              <strong class="fin-total__value">{{ bankKnown() ? (state.currentBankEur() | eur) : 'Nog niet ingesteld' }}</strong>
              @if (bankKnown()) { <span class="fin-total__sub" [class.is-warn]="bankStale() || bankPartial()">{{ bankSub() }}</span> }
              @else { <span class="fin-total__sub fin-total__action">Saldo invullen ›</span> }
              <span class="fin-total__sub" [class.is-warn]="bankStale()">{{ computedSub() }}</span>
              <span class="fin-total__moves"><span><small>Vandaag</small><b>{{ signedEur(moves().today) }}</b></span><span><small>Deze week</small><b>{{ signedEur(moves().week) }}</b></span></span>
            </button>
            @for (account of state.accountsView(); track account.account) {
              <app-bank-account-card role="listitem" [account]="account" />
            } @empty {
              <div class="fin-acct fin-acct--empty"><p>Nog geen actieve rekening</p><button class="wk-btn wk-btn--sm wk-btn--primary" type="button" (click)="state.openBank(null)">Rekening toevoegen</button></div>
            }
          </div>
        }

        <section class="wk-card fin-geld" aria-label="Geld">
          <button class="fin-geld__cell" type="button" (click)="state.go({ view: 'open' }, 'push')">
            <span class="fin-geld__label">Te betalen @if (payWarn()) { <i class="wk-dot tone-warn" aria-label="Er staat een oude kost open"></i> }<app-icon name="chevron-right" [size]="14" /></span>
            <strong class="fin-geld__value">Nu {{ state.payableTotals().nowEur | eur }}</strong>
            <span class="fin-geld__sub">+ {{ state.payableTotals().soonEur | eur }} binnenkort · {{ state.payableTotals().laterEur | eur }} later{{ containersExpected() ? ' (verwacht)' : '' }}</span>
            @if (state.containersLoading()) { <span class="fin-geld__sub">Containers worden geladen…</span> }
          </button>
          <button class="fin-geld__cell" type="button" (click)="state.go({ view: 'incoming' }, 'push')">
            <span class="fin-geld__label">Te ontvangen<app-icon name="chevron-right" [size]="14" /></span>
            <strong class="fin-geld__value">{{ state.openInvoices().totalEur | eur }}</strong>
            <span class="fin-geld__sub">{{ state.openInvoices().count }} {{ state.openInvoices().count === 1 ? 'factuur' : 'facturen' }} · {{ state.incomingThisMonth().receivedEur | eur }} ontvangen deze maand</span>
            @if (state.openInvoices().creditNoteEur > 0) { <span class="fin-geld__sub fin-geld__sub--credit">{{ state.openInvoices().creditNoteEur | eur: 0 }} tegoed af te handelen</span> }
          </button>
          <button class="fin-geld__cell" type="button" (click)="state.go({ view: 'costs', period: 'month' }, 'push')">
            <span class="fin-geld__label">Uitgegeven deze maand<app-icon name="chevron-right" [size]="14" /></span>
            <strong class="fin-geld__value">{{ spent().monthEur | eur }}</strong>
            <span class="fin-geld__sub">excl. btw · {{ spent().yearEur | eur }} dit jaar</span>
          </button>
          <button class="fin-geld__cell" type="button" (click)="state.openVatReturn(vatTile().year, vatTile().quarter)">
            <span class="fin-geld__label">Btw dit kwartaal<app-icon name="chevron-right" [size]="14" /></span>
            <strong class="fin-geld__value">{{ vatTile().amount | eur }}</strong>
            <span class="fin-geld__sub" [class.is-warn]="vatTile().pending > 0">{{ vatTile().sub }}</span>
          </button>
        </section>

        <!--
          The work: Vraagt aandacht first in the DOM (it leads the rail at 1440 and the page at 1100), then the Kaslijn and
          the transactions, then the Vooruitblik and Laatst geboekt; the grid places them, so the tab order is the reading order.
        -->
        <div class="fin-cockpit__cols">
          <div class="fin-cockpit__attn">
            <section class="wk-card fin-attention" aria-labelledby="fin-attention-title">
              <header class="wk-card__head"><h2 class="wk-card__title" id="fin-attention-title">Vraagt aandacht</h2>@if (state.attention().length) { <span class="wk-pill">{{ state.attention().length }}</span> }</header>
              @if (state.attention().length) {
                <ul class="fin-attention__list">
                  @for (item of attention(); track item.id) {
                    <li class="fin-attention__row" [class.has-action]="!!trailVerb(item)">
                      <button class="fin-attention__open" type="button" [attr.aria-label]="item.title" (click)="open(item)"></button>
                      <span [class]="'fin-attention__icon ' + toneClass(item)"><app-icon [name]="iconOf(item)" [size]="16" /></span>
                      <span class="fin-attention__text"><b>{{ item.title }}</b><small>{{ item.detail }}</small>
                        @if (item.split) { <small class="fin-attention__amount">{{ splitText(item) }}</small> }
                        @else if (item.amountEur !== null) { <small class="fin-attention__amount">{{ item.amountEur | eur }}</small> }</span>
                      @if (trailVerb(item); as verb) {
                        <button class="wk-btn wk-btn--sm fin-attention__act" type="button" [disabled]="item.action === 'book' && state.booking()" (click)="act(item)">{{ verb }}</button>
                      } @else { <app-icon class="fin-attention__chev" name="chevron-right" [size]="15" /> }
                    </li>
                  }
                </ul>
                @if (state.attention().length > limit()) { <button class="wk-link fin-attention__more" type="button" (click)="expanded.set(true)">Toon alle {{ state.attention().length }}</button> }
              } @else {
                <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="tick" [size]="22" /></span><p class="wk-empty__title">Alles bijgewerkt</p><p class="wk-empty__text">Niets vraagt nu je aandacht.</p></div>
              }
            </section>
          </div>
          <div class="fin-cockpit__main">
            <app-kaslijn-card />
            <section class="wk-card fin-cockpit__tx" aria-labelledby="fin-cockpit-tx">
              <header class="fin-cockpit__tx-head">
                <h2 class="wk-card__title" id="fin-cockpit-tx">Transacties</h2>
                <app-segmented label="Transacties" [options]="streamOptions()" [value]="streamValue()" (changed)="pickStream($event)" />
                @if (exactCount(); as count) { <button class="wk-btn wk-btn--sm fin-cockpit__exact" type="button" (click)="state.exactLinksOpen.set(true)"><app-icon name="link" [size]="14" />{{ count }} {{ count === 1 ? 'exacte suggestie' : 'exacte suggesties' }} koppelen</button> }
                @else { <button class="wk-link fin-cockpit__exact" type="button" (click)="toTransactions(false)">Alle transacties ›</button> }
              </header>
              <app-bank-movement-panel mode="compact" />
            </section>
          </div>
          <div class="fin-cockpit__rail">
            <section class="wk-card fin-outlook" aria-labelledby="fin-outlook-title">
              <header class="wk-card__head"><h2 class="wk-card__title" id="fin-outlook-title">Vooruitblik</h2>
                <span class="wk-pill" [class.tone-warn]="!outlookComplete()" [class.tone-ok]="outlookComplete()">{{ outlookComplete() ? 'volledig' : 'onvolledig' }}</span></header>
              <div class="fin-outlook__body"><app-vooruitblik-equation [compact]="true" /></div>
            </section>
            <section class="wk-card fin-recent" aria-labelledby="fin-recent-title">
              <header class="wk-card__head"><h2 class="wk-card__title" id="fin-recent-title">Laatst geboekt</h2><button class="wk-link wk-card__trail" type="button" (click)="state.go({ view: 'costs' }, 'push')">Alle uitgaven ›</button></header>
              @for (row of recent(); track row.key) {
                <button class="fin-recent__row" type="button" (click)="openRow(row)">
                  <span class="fin-recent__day">{{ day(row.date) }}</span>
                  <span class="fin-recent__text"><b>{{ recentTitle(row) }}</b><small>{{ recentSub(row) }}</small></span>
                  <span class="fin-recent__amount">{{ row.amountEur | eur }}</span>
                </button>
              } @empty { <p class="wk-empty__text fin-recent__empty">Nog niets geboekt. Boek de beurs, de boekhouder of de huur met Kost boeken.</p> }
            </section>
          </div>
        </div>
      </div>
    } @else {
      @if (single(); as a) {
        <!-- One account: the account lives in the hero; the full-cover button opens Transacties, the ⋯ and the capsule sit above it. -->
        <div class="ios-hero fin-hero fin-hero--one">
          <button class="fin-hero__open" type="button" [attr.aria-label]="'Transacties van ' + a.label" (click)="totalTile()"></button>
          <div class="fin-hero__acct"><span>{{ a.label }}</span><small>{{ iban(a.account) }}</small></div>
          <div class="ios-hero__value">{{ a.currentEur !== null ? (a.currentEur | eur) : 'Nog niet ingesteld' }}</div>
          <div class="ios-hero__sub" [class.is-warn]="bankStale()">{{ a.currentEur !== null ? 'Op de bank · ' + bandAge() : 'Tik om je saldo in te vullen' }}</div>
          <div class="fin-hero__moves"><span><small>Vandaag</small><b>{{ signedEur(moves().today) }}</b></span><span><small>Deze week</small><b>{{ signedEur(moves().week) }}</b></span>
            <span><small>Transacties</small><b>{{ activeLines().length }}</b></span></div>
          <div class="fin-hero__foot"><small>{{ source(a) }}</small>
            @if (unlinkedCount()) { <button class="fin-hero__link fin-hero__tap" type="button" (click)="toTransactions(true)"><b>{{ unlinkedCount() }}</b> te koppelen<app-icon name="chevron-right" [size]="14" /></button> }</div>
          <button class="fin-hero__more" type="button" aria-label="Rekening beheren" aria-haspopup="menu" (click)="manage(a, null)"><app-icon name="more" [size]="18" /></button>
        </div>
      } @else {
        <button class="ios-hero fin-hero" type="button" (click)="totalTile()">
          <span class="ios-hero__label">Op de bank · {{ accountCount() }}</span>
          <div class="ios-hero__value">{{ bankKnown() ? (state.currentBankEur() | eur) : 'Nog niet ingesteld' }}</div>
          <div class="ios-hero__sub" [class.is-warn]="bankStale() || bankPartial()">{{ bankKnown() ? bankSub() : 'Tik om je saldo in te vullen' }}</div>
          <div class="fin-hero__moves"><span><small>Vandaag</small><b>{{ signedEur(moves().today) }}</b></span><span><small>Deze week</small><b>{{ signedEur(moves().week) }}</b></span></div>
          <app-icon class="ios-hero__chev" name="chevron-right" [size]="18" />
        </button>
        <div class="fin-carousel" role="list" aria-label="Bankrekeningen">
          @for (account of state.accountsView(); track account.account) { <app-bank-account-card role="listitem" [account]="account" /> }
        </div>
      }
      <div class="ios-widgets fin-widgets">
        <button class="ios-widget" type="button" (click)="state.go({ view: 'open' }, 'push')">
          <span class="ios-widget__label"><span class="ios-tile ios-tile--soft tone-warn"><app-icon name="arrow-out" [size]="14" /></span>Nu te betalen</span>
          <span class="ios-widget__value fin-widget__value">{{ state.payableTotals().nowEur | eur }}</span>
          <span class="fin-widget__sub">{{ state.containersLoading() ? 'Containers worden geladen…' : '+ ' + (state.payableTotals().soonEur | eur: 0) + ' binnenkort · ' + (state.payableTotals().laterEur | eur: 0) + ' later' + (containersExpected() ? ' (verwacht)' : '') }}</span>
        </button>
        <button class="ios-widget" type="button" (click)="state.go({ view: 'incoming' }, 'push')">
          <span class="ios-widget__label"><span class="ios-tile ios-tile--soft tone-ok"><app-icon name="arrow-in" [size]="14" /></span>Te ontvangen</span>
          <span class="ios-widget__value fin-widget__value">{{ state.openInvoices().totalEur | eur }}</span>
          <span class="fin-widget__sub">{{ state.openInvoices().count }} {{ state.openInvoices().count === 1 ? 'factuur' : 'facturen' }} · {{ state.incomingThisMonth().receivedEur | eur: 0 }} ontvangen deze maand@if (state.openInvoices().creditNoteEur > 0) { · {{ state.openInvoices().creditNoteEur | eur: 0 }} tegoed af te handelen }</span>
        </button>
        <button class="ios-widget" type="button" (click)="state.go({ view: 'costs', period: 'month' }, 'push')">
          <span class="ios-widget__label"><span class="ios-tile ios-tile--soft tone-teal"><app-icon name="receipt" [size]="14" /></span>Uitgegeven</span>
          <span class="ios-widget__value fin-widget__value">{{ spent().monthEur | eur }}</span>
          <span class="fin-widget__sub">deze maand excl. btw · {{ spent().yearEur | eur: 0 }} dit jaar</span>
        </button>
        <button class="ios-widget" type="button" (click)="state.openVatReturn(vatTile().year, vatTile().quarter)">
          <span class="ios-widget__label"><span class="ios-tile ios-tile--soft tone-plum"><app-icon name="analytics" [size]="14" /></span>Btw dit kwartaal</span>
          <span class="ios-widget__value fin-widget__value">{{ vatTile().amount | eur }}</span>
          <span class="fin-widget__sub" [class.fin-warn-text]="vatTile().pending > 0">{{ vatTile().sub }}</span>
        </button>
      </div>
      <section class="ios-section">
        <div class="ios-section__head"><h2>Vraagt aandacht</h2></div>
        <div class="ios-group ios-group--icons fin-attention-phone">
          @for (item of phoneAttention(); track item.id) {
            <button class="ios-cell ios-cell--tall" type="button" [disabled]="item.action === 'book' && state.booking()" (click)="act(item)">
              <span class="ios-cell__lead"><span [class]="'ios-tile ios-tile--lg ios-tile--soft ' + toneClass(item)"><app-icon [name]="iconOf(item)" [size]="18" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ item.title }}</span><span class="ios-cell__sub fin-wrap">{{ item.split ? splitText(item) : item.detail }}</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ phoneTrail(item) }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </button>
          } @empty {
            <div class="ios-cell"><span class="ios-cell__lead"><span class="ios-tile ios-tile--lg tone-ok"><app-icon name="tick" [size]="18" /></span></span><span class="ios-cell__body"><span class="ios-cell__title">Alles bijgewerkt</span></span></div>
          }
          @if (state.attention().length > phoneLimit()) { <button class="ios-cell ios-cell--action" type="button" (click)="expanded.set(true)">Toon alle {{ state.attention().length }}</button> }
        </div>
      </section>
      <app-kaslijn-card />
      @if (toLink().length) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>Te koppelen · {{ unlinkedCount() }}</h2><button class="ios-section__link" type="button" (click)="toTransactions(true)">Alle</button></div>
          <div class="ios-group">
            @for (line of toLink(); track line.id) {
              @let c = capsule(line);
              <div class="fin-txrow" [class.fin-txrow--action]="c.label !== 'Bekijk'" animate.leave="mo-leave">
                <button class="fin-txrow__open" type="button" (click)="state.openLine(line.id)" [attr.aria-label]="lineTitle(line) + ', ' + (c.suggested ? 'suggestie' : 'te koppelen') + ': openen'">
                  <span class="fin-txrow__title">{{ lineTitle(line) }}</span>
                  <span class="fin-txrow__amount" [class.wk-amount--in]="line.amountEur > 0">{{ line.amountEur > 0 ? '+' : '−' }} {{ abs(line.amountEur) | eur }}</span>
                  <span class="fin-txrow__sub"><b [class]="'fin-txrow__st ' + (c.suggested ? 'is-sug' : 'is-open')">{{ c.suggested ? 'Suggestie' : 'Te koppelen' }}</b> · {{ c.target }}</span>
                </button>
                @if (c.label !== 'Bekijk') {
                  <button class="ios-capsule ios-capsule--sm ios-capsule--accent" type="button" [disabled]="state.linking() !== null" (click)="runCapsule(line)">{{ c.label }}</button>
                }
              </div>
            }
            @if (exactCount(); as count) { <button class="ios-cell ios-cell--action" type="button" (click)="state.exactLinksOpen.set(true)">{{ count }} {{ count === 1 ? 'exacte suggestie' : 'exacte suggesties' }} koppelen</button> }
          </div>
        </section>
      }
      <section class="ios-section">
        <div class="ios-section__head"><h2>Laatst geboekt</h2></div>
        <div class="ios-group">
          @for (row of recent().slice(0, 5); track row.key) {
            <button class="ios-cell fin-recent-cell" type="button" (click)="openRow(row)">
              <span class="ios-cell__body"><span class="ios-cell__title fin-wrap">{{ recentTitle(row) }}</span><span class="ios-cell__sub fin-wrap">{{ day(row.date) }} · {{ recentSub(row) }}</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ row.amountEur | eur }}</span></span>
            </button>
          }
          <button class="ios-cell ios-cell--action" type="button" (click)="state.go({ view: 'costs' }, 'push')">Alle uitgaven</button>
        </div>
      </section>
      <div class="ios-group fin-ios-single">
        <button class="ios-cell" type="button" (click)="state.openAnalysis()">
          <span class="ios-cell__body"><span class="ios-cell__title">Rapportage</span><span class="ios-cell__sub">Per categorie, per maand, de btw-aangifte</span></span>
          <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
        </button>
      </div>
      @if (state.outlookOpen()) {
        <app-sheet variant="ios" title="Vooruitblik" (closed)="state.outlookOpen.set(false)">
          <div body class="fin-sheet">
            <app-vooruitblik-equation />
            <button class="ios-capsule ios-capsule--tinted fin-sheet__link" type="button" (click)="toForecast()">Per dag in Kasprognose ›</button>
          </div>
        </app-sheet>
      }
    }
  `,
})
export class BankCockpit {
  readonly state = inject(FinanceState);
  private readonly sync = inject(OdooSyncState);
  private readonly router = inject(Router);
  readonly movementPanel = viewChild(BankMovementPanel);
  readonly expanded = signal(false);
  readonly limit = computed(() => (this.expanded() ? Infinity : ATTENTION_ROWS));
  readonly phoneLimit = computed(() => (this.expanded() ? Infinity : 3));
  readonly attention = computed(() => this.state.attention().slice(0, this.limit()));
  readonly phoneAttention = computed(() => this.state.attention().slice(0, this.phoneLimit()));

  /**
   * The rail's Vooruitblik pill: every account has a reading, the containers are in, nothing failed to load, and no
   * transaction probably paid an open item already (it would count twice until it is linked).
   */
  readonly outlookComplete = computed(() => this.bankKnown() && !this.state.accountsView().some((account) => !account.reading)
    && !this.state.containersLoading() && !this.state.loadErrors().length && !this.state.kaslijn().likelyPaid.length);
  /** The one active account (the band on a desk, the hero on a phone); null with none or several. */
  readonly single = computed<AccountView | null>(() => { const accounts = this.state.accountsView(); return accounts.length === 1 ? accounts[0] : null; });
  /** "gecontroleerd vandaag | gisteren | n dagen geleden"; "nog geen saldo" without a reading. */
  readonly bandAge = computed(() => {
    const age = this.single()?.ageDays;
    if (age === null || age === undefined) return 'nog geen saldo';
    return `gecontroleerd ${age === 0 ? 'vandaag' : age === 1 ? 'gisteren' : age + ' dagen geleden'}`;
  });
  /** The band's 30-day sparkline: the line and the area under it (the account card's data). */
  readonly spark = computed<{ line: string; area: string } | null>(() => {
    const account = this.single();
    if (!account) return null;
    const input = this.state.cashInput();
    const today = this.state.today();
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
    const values = [...dayEndBalances(input.movements, input.accounts, [account.account], from, today).values()];
    const known = values.filter((value): value is number => value !== null);
    if (known.length < 2) return null;
    const low = Math.min(...known), high = Math.max(...known), span = high - low || 1;
    const points = values.map((value, index) => value === null ? null : [(index / (values.length - 1)) * 120, 37 - ((value - low) / span) * 33] as const);
    let line = '', pen = false, first: number | null = null, last = 0;
    points.forEach((point) => {
      if (!point) { pen = false; return; }
      line += `${pen ? 'L' : 'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`;
      pen = true; first ??= point[0]; last = point[0];
    });
    const area = `${line.replace(/M/g, (match, offset) => (offset === 0 ? 'M' : 'L'))}L${last.toFixed(1)},40L${(first ?? 0).toFixed(1)},40Z`;
    return { line, area };
  });
  /** Te betalen holds expected container amounts: soon (dated by the Kaslijn) or later. */
  readonly containersExpected = computed(() => !!(this.state.payableTotals().containerSoonEur || this.state.payableTotals().containerLaterEur));
  readonly bankKnown = computed(() => this.state.bankLedger().accounts.some((account) => account.currentEur !== null));
  readonly bankStale = computed(() => this.state.accountsView().some((account) => account.ageDays !== null && account.ageDays > 14));
  /** "deels bekend": an active account still has no reading, so the total leaves it out. */
  readonly bankPartial = computed(() => this.bankKnown() && this.state.accountsView().some((account) => !account.reading));
  readonly accountCount = computed(() => { const n = this.state.accountsView().length; return `${n} ${n === 1 ? 'rekening' : 'rekeningen'}`; });
  /** Today's Overzicht sub-line, verbatim. */
  readonly bankSub = computed(() => {
    const accounts = this.state.accountsView();
    if (!accounts.length || !this.bankKnown()) return 'Saldo invullen';
    const missing = accounts.filter((account) => !account.reading).length;
    if (missing) return `deels bekend · ${missing} ${missing === 1 ? 'rekening' : 'rekeningen'} zonder saldo`;
    const newest = Math.min(...accounts.map((account) => account.ageDays ?? 999));
    const when = newest === 0 ? 'vandaag' : newest === 1 ? 'gisteren' : `${newest} dagen geleden`;
    return `${accounts.length} ${accounts.length === 1 ? 'rekening' : 'rekeningen'} · gecontroleerd ${when}`;
  });
  /** The account home's "Berekend uit je saldo's en bewegingen", in today's words. */
  readonly computedSub = computed(() => {
    const ages = this.state.accountsView().map((account) => account.ageDays).filter((age): age is number => age !== null);
    if (!ages.length) return 'Nog geen saldo ingevuld';
    const newest = Math.min(...ages);
    return `Berekend uit je saldo's en transacties · laatst gecontroleerd ${newest === 0 ? 'vandaag' : newest === 1 ? 'gisteren' : newest + ' dagen geleden'}`;
  });
  /** What moved today and since Monday on the active accounts. */
  readonly moves = computed(() => {
    const today = this.state.today();
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const monday = new Date(Date.parse(`${today}T00:00:00Z`) - weekday * 86_400_000).toISOString().slice(0, 10);
    const active = new Set(this.state.accountsView().map((account) => account.account));
    let day = 0, week = 0;
    for (const move of this.state.cashInput().movements) {
      if (!active.has(move.account)) continue;
      const cents = Math.round(move.amountEur * 100);
      if (move.day === today) day += cents;
      if (move.day >= monday && move.day <= today) week += cents;
    }
    return { today: day / 100, week: week / 100 };
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
  /** The running quarter's return, in today's words: "{in je voordeel|te betalen} · Q{q} · indienen vóór {d mmm}{ · {n} te bevestigen}". */
  readonly vatTile = computed(() => {
    const result = this.state.vatReturnCurrent();
    const favour = result.totals.refundEur > 0;
    const pending = result.unconfirmedCount + result.unknown.length + result.openClearanceCount;
    return {
      year: result.year, quarter: result.quarter, pending,
      amount: favour ? result.totals.refundEur : result.totals.payableEur,
      sub: `${favour ? 'in je voordeel' : 'te betalen'} · Q${result.quarter} · indienen vóór ${dayMonth(result.filingDeadline)}${pending ? ` · ${pending} te bevestigen` : ''}`,
    };
  });
  /** Company costs and container payments dated today or earlier, newest first. */
  readonly recent = computed(() => this.state.ledger().filter((row) => row.date <= this.state.today()).slice(0, 6));

  /* the transactions beside the rail */
  readonly activeLines = computed(() => this.state.bankStatements().filter((line) => this.state.officialBankLine(line) && !this.state.archivedBankLine(line)));
  readonly unlinkedCount = computed(() => this.activeLines().filter((line) => !line.allocated && line.salesPaymentId == null).length);
  readonly exactCount = computed(() => this.activeLines().filter((line) => this.state.suggestions().get(line.id)?.exact).length);
  /** The compact list's filter; "Te koppelen" carries its warn dot only (its count is on the sidebar and the status bar), so the head stays one line. */
  readonly streamOptions = computed<SegmentOption[]>(() => [{ id: '', label: 'Alles' }, { id: 'in', label: 'In', ariaLabel: 'Inkomend' }, { id: 'out', label: 'Uit', ariaLabel: 'Uitgaand' },
    { id: 'unlinked', label: 'Te koppelen', dot: this.unlinkedCount() ? 'warn' : null }]);
  readonly streamValue = computed(() => {
    const panel = this.movementPanel();
    if (!panel) return '';
    return panel.linkFilter() === 'UNLINKED_IN' ? 'unlinked' : panel.directionFilter() === 'INCOMING' ? 'in' : panel.directionFilter() === 'OUTGOING' ? 'out' : '';
  });
  pickStream(value: string): void {
    const panel = this.movementPanel();
    if (!panel) return;
    panel.linkFilter.set(value === 'unlinked' ? 'UNLINKED_IN' : 'ALL');
    panel.directionFilter.set(value === 'in' ? 'INCOMING' : value === 'out' ? 'OUTGOING' : 'ALL');
  }
  /** Phone "Te koppelen": the four newest lines still to link. */
  readonly toLink = computed(() => this.activeLines().filter((line) => !line.allocated && line.salesPaymentId == null)
    .sort((a, b) => Date.parse(b.bookedAt) - Date.parse(a.bookedAt) || b.id - a.id).slice(0, 4));
  /** The phone capsule of a line: Koppel (a match that changes nothing but the date), Bekijk, Boek (a cost pattern); Bekijk without a match. */
  capsule(line: BankStatementLine): { label: 'Koppel' | 'Bekijk' | 'Boek'; suggested: boolean; target: string } {
    const suggestion = this.state.suggestions().get(line.id);
    if (!suggestion) return { label: 'Bekijk', suggested: false, target: bankTextOf(line).sub || 'nog geen match' };
    if (suggestion.target.kind === 'cost-pattern') return { label: 'Boek', suggested: true, target: suggestion.target.label };
    const quick = !suggestion.changesAmount && !suggestion.others.some((other) => other.score >= 50);
    return { label: quick ? 'Koppel' : 'Bekijk', suggested: true, target: suggestion.target.title };
  }
  runCapsule(line: BankStatementLine): void {
    const suggestion = this.state.suggestions().get(line.id);
    const capsule = this.capsule(line);
    if (!suggestion || capsule.label === 'Bekijk') { this.state.openLine(line.id); return; }
    if (suggestion.target.kind === 'cost-pattern') { this.state.bookPattern(line, suggestion.target.costId); return; }
    void this.state.linkLine(line, suggestion.target);
  }

  /** "{n} rekeningen · {m} te koppelen · {k} met exacte suggestie · {a} punten vragen aandacht · Odoo opgehaald 08:12". */
  readonly status = computed(() => {
    const n = this.state.accountsView().length, attention = this.state.attention().length;
    const at = this.sync.status()?.lastSyncAt;
    return [`${n} ${n === 1 ? 'rekening' : 'rekeningen'}`, `${this.unlinkedCount()} te koppelen`, `${this.exactCount()} met exacte suggestie`,
      `${attention} ${attention === 1 ? 'punt vraagt' : 'punten vragen'} aandacht`,
      ...(this.state.hasOdooAccounts() && at ? [`Odoo opgehaald ${syncMoment(at, this.state.today())}`] : []),
    ].join(' · ');
  });

  totalTile(): void {
    if (this.bankKnown()) this.toTransactions(false);
    else this.state.openBank(null);
  }
  toTransactions(unlinked: boolean): void {
    this.state.go({ view: 'bank', tab: 'movements', account: '', link: unlinked ? 'unlinked' : '', dir: '', q: '', period: 'all', from: '', to: '' }, 'push');
  }
  toForecast(): void { this.state.outlookOpen.set(false); void this.router.navigate(['/analyses/cash']); }

  act(item: AttentionItem): void {
    if (item.kind === 'vat-deadline') { this.state.openVatReturn(Number(item.target.year), Number(item.target.quarter)); return; }
    switch (item.action) {
      case 'book': void this.state.bookNow(); break;
      case 'check': if (item.accountKey) this.state.checkOrFill(item.accountKey); break;
      case 'fill': this.state.openBank(null, item.accountKey ?? ''); break;
      case 'unbanked': this.state.go(item.target, 'push'); this.state.unbankedOpen.set(true); break;
      default: this.state.go(item.target, 'push');
    }
  }
  phoneLabel(item: AttentionItem): string {
    return item.action === 'book' ? 'Nu boeken' : item.action === 'link' ? 'Koppel' : item.action === 'check' ? 'Controleer' : item.actionLabel;
  }
  /**
   * The phone row's trail: the verb of a row that does something (book, link, check, fill); null for a row that only
   * opens its list (no action, or 'unbanked'), which shows its figure there as before (the whole row stays the button).
   */
  phoneVerb(item: AttentionItem): string | null {
    return item.action === null || item.action === 'unbanked' ? null : this.phoneLabel(item);
  }
  /** A desk row's own button: only a row whose action does something (Koppelen, Nu boeken, Controleren, Saldo invullen). */
  trailVerb(item: AttentionItem): string | null {
    return item.action === 'link' ? 'Koppelen' : item.action === 'book' ? 'Nu boeken' : item.action === 'check' ? 'Controleren' : item.action === 'fill' ? 'Saldo invullen' : null;
  }
  /** The whole row: it opens the row's list (a booking row opens Vaste kosten; its button books). */
  open(item: AttentionItem): void {
    if (item.action === 'book') this.state.go(item.target, 'push');
    else this.act(item);
  }
  iconOf(item: AttentionItem): string { return ATTENTION_ICON[item.kind] ?? 'info'; }
  /** "in € 19.077,13 · uit € 203.349,07", a zero side left out. */
  splitText(item: AttentionItem): string {
    const split = item.split;
    if (!split) return '';
    return [split.inEur ? `in ${euro.format(split.inEur)}` : '', split.outEur ? `uit ${euro.format(split.outEur)}` : ''].filter(Boolean).join(' · ');
  }
  /** The phone trail: the verb, or "nog 9 d" for the VAT deadline, or the figure, or the count. */
  phoneTrail(item: AttentionItem): string {
    const verb = this.phoneVerb(item);
    if (verb) return verb;
    if (item.kind === 'vat-deadline') return item.dueInDays ? `nog ${item.dueInDays} d` : 'vandaag';
    return item.amountEur !== null ? euro.format(item.amountEur) : String(item.count);
  }
  toneClass(item: AttentionItem): string {
    return item.tone === 'danger' ? 'tone-danger' : item.tone === 'warn' ? 'tone-warn' : 'tone-blue';
  }
  openRow(row: CostLedgerRow): void {
    if (row.cost?.id) this.state.inspectItem({ kind: 'cost', id: row.cost.id });
    else if (row.payment) this.state.inspectItem({ kind: 'container', id: row.payment.orderId });
  }
  day(date: string): string { return dayMonth(date); }
  iban(key: string): string { return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(key) ? key.match(/.{1,4}/g)!.join(' ') : key; }
  /** "Via Odoo · opgehaald 15 okt" or "Handmatig · saldo 2 d geleden gecontroleerd" (the account card's words). */
  source(a: AccountView): string {
    if (a.source === 'ODOO') {
      const at = this.sync.status()?.lastSyncAt;
      if (!at) return 'Via Odoo · nog niet opgehaald';
      const moment = syncMoment(at, this.state.today());
      return `Via Odoo · opgehaald ${/^\d{2}:\d{2}$/.test(moment) ? 'vandaag ' + moment : moment}`;
    }
    if (!a.reading || a.ageDays === null) return 'Handmatig · nog geen saldo gecontroleerd';
    return `Handmatig · saldo ${a.ageDays === 0 ? 'vandaag' : a.ageDays + ' d geleden'} gecontroleerd`;
  }
  /** The account's ⋯ (Beheer): the card's menu, anchored under the button on a desk. */
  manage(a: AccountView, event: MouseEvent | null): void {
    const rect = event ? (event.currentTarget as HTMLElement).getBoundingClientRect() : null;
    this.state.accountMenu(a, rect && this.state.desk() ? { x: rect.left, y: rect.bottom + 6 } : null);
  }
  /** A bank line's clean title (bankTextOf): the merchant or the counterparty. */
  lineTitle(line: BankStatementLine): string { return bankTextOf(line).title; }
  /** Laatst geboekt: a container payment under its container's name; a cost under its description. */
  recentTitle(row: CostLedgerRow): string {
    const payment = row.payment;
    return payment ? containerName({ id: payment.orderId, number: payment.orderNumber, alias: payment.orderAlias }) : row.description;
  }
  /** "Container · Leverancier · 30% bij bestelling · PO-2026-011" or "Kost · Linc & Partners". */
  recentSub(row: CostLedgerRow): string {
    const payment = row.payment;
    if (!payment) return ['Kost', row.party].filter(Boolean).join(' · ');
    return ['Container', row.party, payment.label?.trim(), containerNumberHint(this.recentTitle(row), payment.orderNumber)].filter(Boolean).join(' · ');
  }
  abs(value: number): number { return Math.abs(value); }
  signedEur(value: number): string { return signed(value); }
}
