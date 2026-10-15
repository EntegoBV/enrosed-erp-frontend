import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { CashChart } from '../../shared/cash-chart';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { Sheet } from '../../shared/ui';
import type { RegisterRow, ScenarioSource } from '../finance/cash-forecast';
import { DEFAULT_CASH_BUFFER_EUR } from '../finance/cash-forecast';
import { dayMon, eur, eurWhole, weekdayDayMonth } from '../finance/cash-format';
import { CashDefaults } from './cash-defaults';
import { CashMonths } from './cash-months';
import { CashPoSheet } from './cash-po-sheet';
import { CashState } from './cash-state';
import {
  adjusted, amountText, chartBuffer, dataQuality, forecastMarkers, forecastSeries, itemLink, kpiCards, lineLink, marginOfMarkup, monthName, parseAmount, phoneKrapBanner,
  phoneRowSub, pct, ruleSummary, ruleSwitches, scenarioOutcome, signedWhole, suggestionText, underBuffer,
} from './cash-view';
import type { CashLink, RuleSwitch } from './cash-view';

const CONTAINER_KINDS = new Set(['SUPPLIER', 'LOGISTICS', 'INSPECTION', 'OTHER_CONTAINER', 'IMPORT_VAT', 'SALES']);
const SHOWN_ROWS = 8;
type PhoneSheet = 'menu' | 'horizon' | 'buffer' | 'how' | 'price' | 'pace' | 'payment' | 'rows' | 'months' | 'rules' | 'recon' | null;

/**
 * Analyses › Kasprognose on the phone (spec §4.3): one iOS page with its own
 * navigation bar and the Analyses tabs as chips (the page renders neither its
 * header nor its tab row then). The bank today, the krap banner, the balance
 * per day, four figures, the scenario, the coming movements and the cells
 * that open the month table, the rules and the reconciliation.
 */
@Component({
  selector: 'app-cash-phone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CashChart, CashDefaults, CashMonths, CashPoSheet, Icon, IosNav, NgTemplateOutlet, RouterLink, Sheet],
  template: `
    <div class="ios-page cf-phone">
      <app-ios-nav title="Kasprognose" subtitle="Banksaldo vandaag en wat er komt" backLabel="Meer" backUrl="/more">
        <div trail class="ios-glass-group">
          <button class="ios-circle" type="button" aria-label="Link kopiëren" (click)="state.copyLink()"><app-icon name="share" [size]="19" /></button>
          <button class="ios-circle" type="button" aria-label="Meer acties" (click)="sheet.set('menu')"><app-icon name="more" [size]="20" /></button>
        </div>
      </app-ios-nav>
      <nav #chips class="ios-chips cf-phone__tabs" aria-label="Analyseonderdelen">
        @for (tab of tabs(); track tab.id) {
          <a class="ios-chip" [routerLink]="['/analyses', tab.id]" [replaceUrl]="true" [attr.aria-pressed]="tab.id === 'cash'"
             [attr.aria-current]="tab.id === 'cash' ? 'page' : null">{{ tab.label }}</a>
        }
      </nav>

      @if (warnings().length) {
        <div class="ios-banner" role="status"><span>Niet alle actuele cijfers konden laden: {{ warnings().join(', ') }}.</span></div>
      }

      @if (state.sources.bankMissing() && state.sources.state() === 'ready') {
        <div class="ios-card cf-phone__empty">
          <p class="ios-title2">Banksaldo kon niet laden</p>
          <p class="ios-caption">Zonder rekeningen en transacties kan de prognose niet vertrekken van het saldo van vandaag.</p>
          <button class="ios-capsule ios-capsule--accent" type="button" (click)="retry()">Opnieuw</button>
        </div>
      } @else if (forecast(); as f) {
        <a class="ios-hero cf-phone__hero" routerLink="/costs">
          <span class="ios-hero__label">Op de bank vandaag</span>
          <div class="ios-hero__value">{{ f.mode === 'relative' ? '—' : whole(f.startEur) }}</div>
          <div class="ios-hero__sub">{{ accountsLine() }}</div>
          @for (account of staleAccounts(); track account.key) { <div class="ios-hero__sub is-warn">{{ account.label }} {{ account.ageDays }} d niet gecontroleerd</div> }
          <app-icon class="ios-hero__chev" name="chevron-right" [size]="18" />
        </a>

        @if (banner(); as b) {
          <div class="ios-banner" [class.ios-banner--info]="b.kind === 'relative'" role="status">
            <span>{{ b.text }}</span>
            @if (b.kind === 'relative') { <a class="ios-capsule ios-capsule--sm ios-capsule--tinted" routerLink="/costs">Saldo invullen</a> }
            @else { <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" (click)="showPeriod()">Toon</button> }
          </div>
        }

        <section class="ios-card cf-phone__chart" aria-labelledby="cf-phone-chart">
          <header class="cf-phone__chart-head">
            <h2 id="cf-phone-chart" class="cf-phone__h">Saldo per dag</h2>
            <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" (click)="sheet.set('horizon')">{{ location().horizon }} maanden <app-icon name="chevron-down" [size]="14" /></button>
          </header>
          <app-cash-chart [series]="series()" [today]="f.today" [bufferEur]="buffered().bufferEur" [tight]="buffered().tight" [markers]="markers()" [height]="210"
                          variant="compact" [bandBetween]="band" ariaLabel="Saldo per dag" (pick)="openRowsAt($event)" />
        </section>

        <div class="ios-figures cf-phone__figs">
          @for (card of figures(); track card.id) {
            <div [attr.data-kpi]="card.id"><small>{{ card.label }}</small><strong [attr.data-tone]="card.valueTone">{{ card.value }}</strong><span>{{ card.sub }}</span></div>
          }
        </div>

        <section class="ios-section" aria-labelledby="cf-phone-scenario">
          <div class="ios-section__head ios-section__head--prominent">
            <h2 id="cf-phone-scenario">Scenario</h2>
            <button class="ios-section__link" type="button" (click)="state.clearDefaults()">Wissen</button>
          </div>
          <div class="ios-group cf-phone__sources">
            @for (source of f.scenario.sources; track source.id) {
              <div class="ios-cell cf-src-cell" [class.is-off]="!source.included" [class.is-locked]="source.locked">
                <button class="cf-src-cell__check" type="button" role="checkbox" [attr.aria-checked]="source.included" [disabled]="source.locked || (source.id !== 'stock' && state.choicesFailed())"
                        [attr.aria-label]="'Meetellen: ' + source.label" (click)="toggleSource(source)"><span class="ios-check" [class.is-on]="source.included"><app-icon name="tick" [size]="14" /></span></button>
                <button class="cf-src-cell__body" type="button" [disabled]="source.id === 'stock'" (click)="openSource(source)">
                  <span class="ios-cell__title">{{ source.label }}@if (isAdjusted(source)) { <i class="cf-dot" aria-label="aangepast"></i> }</span>
                  <span class="ios-cell__sub">{{ source.locked ? 'Partner · ' + source.lockedText : source.sub }}</span>
                </button>
                <span class="ios-cell__trail">
                  <span class="ios-cell__value ios-cell__value--strong">{{ source.included && !source.locked ? '+ ' + whole(source.cashInHorizonEur) : '—' }}</span>
                  @if (source.included && !source.locked) { <span class="ios-cell__meta">tot {{ day(f.horizonEnd) }}</span> }
                </span>
              </div>
            } @empty { <div class="ios-cell"><span class="ios-cell__sub">Geen voorraad en geen open inkooporders.</span></div> }
          </div>
          <div class="ios-group cf-phone__choices">
            <button class="ios-cell" type="button" (click)="sheet.set('price')"><span class="ios-cell__body"><span class="ios-cell__title">Prijs</span></span>
              <span class="ios-cell__value">{{ priceText() }}</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></button>
            <button class="ios-cell" type="button" (click)="sheet.set('pace')"><span class="ios-cell__body"><span class="ios-cell__title">Verkocht in</span></span>
              <span class="ios-cell__value">{{ weeksText() }}</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></button>
            <button class="ios-cell" type="button" (click)="sheet.set('payment')"><span class="ios-cell__body"><span class="ios-cell__title">Klant betaalt na</span></span>
              <span class="ios-cell__value">{{ daysText() }}</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></button>
          </div>
          <p class="ios-section__foot">{{ choiceFoot() }}</p>
        </section>

        @if (outcome(); as o) {
          <div class="ios-card cf-phone__result">
            <div><span>Binnen tot {{ day(f.horizonEnd) }}</span><b>{{ whole(o.inHorizonEur) }}</b></div>
            <div class="is-sub"><span>{{ o.vatEur > 0 ? '+ Btw minder naar de aangifte' : '− Btw naar de aangifte' }}</span><b>{{ whole(abs(o.vatEur)) }}</b></div>
            <div class="is-sub"><span>Marge op goederen</span><b>{{ whole(o.marginEur) }}</b></div>
          </div>
        }

        @if (state.suggestion(); as hint) {
          <div class="ios-card cf-phone__suggest">
            <app-icon name="calendar" [size]="18" />
            <div><p>{{ suggestion(hint.suggestion, hint.number) }}</p>
              <button class="ios-capsule ios-capsule--sm ios-capsule--accent" type="button" [disabled]="state.choicesFailed()" (click)="state.tryOrderDate(hint.suggestion.orderId, hint.suggestion.suggestedDate)">Probeer {{ day(hint.suggestion.suggestedDate) }}</button></div>
          </div>
        }

        <section class="ios-section" aria-labelledby="cf-phone-moves">
          <div class="ios-section__head"><h2 id="cf-phone-moves">Komende bewegingen</h2><span class="ios-section__trail">{{ futureRows().length }}</span></div>
          <div class="ios-group cf-moves">
            <div class="cf-moves__today"><span>Vandaag · berekend saldo</span><b>{{ f.mode === 'relative' ? '± € 0' : whole(f.startEur) }}</b></div>
            @for (row of shownRows(); track row.key) {
              <ng-container *ngTemplateOutlet="move; context: { $implicit: row }" />
            }
            @if (futureRows().length > shownRows().length) {
              <button class="ios-cell ios-cell--action" type="button" (click)="sheet.set('rows')">Alle {{ futureRows().length }} bewegingen</button>
            }
          </div>
        </section>

        <div class="ios-group cf-phone__more">
          <button class="ios-cell" type="button" (click)="sheet.set('months')"><span class="ios-cell__body"><span class="ios-cell__title">Per maand</span>
            <span class="ios-cell__sub">in, uit, laagste en einde per maand</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></button>
          <button class="ios-cell" type="button" (click)="sheet.set('rules')"><span class="ios-cell__body"><span class="ios-cell__title">Wat telt mee</span>
            <span class="ios-cell__sub">{{ rulesLine() }}</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></button>
          <button class="ios-cell" type="button" (click)="sheet.set('recon')"><span class="ios-cell__body"><span class="ios-cell__title">Aansluiting met de Vooruitblik</span>
            <span class="ios-cell__sub">Kosten &amp; bank · {{ whole(f.reconciliation.startEur) }} → {{ whole(f.reconciliation.endEur) }}</span></span>
            @if (!f.reconciliation.matches) { <span class="ios-cell__value cf-warn">klopt niet</span> }
            <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></button>
        </div>
      } @else {
        <div class="ios-card cf-phone__loading" aria-busy="true"><span></span><b></b><i></i><p>Banksaldo laden…</p></div>
      }
    </div>

    <ng-template #move let-row>
      <button class="ios-cell cf-move" type="button" [class.cf-move--scenario]="row.layer === 'SCENARIO'" [class.cf-move--past]="row.kind === 'past'" (click)="openRow(row)">
        <span class="cf-move__icon" [class.is-in]="row.amountEur > 0"><app-icon [name]="row.amountEur > 0 ? 'arrow-in' : 'arrow-out'" [size]="16" /></span>
        <span class="ios-cell__body">
          <span class="ios-cell__title">{{ moveTitle(row) }}</span>
          <span class="ios-cell__sub">{{ rowSub(row) }}</span>
          @if (row.item) { <span class="cf-move__rule">{{ row.item.ruleText }}</span> }
        </span>
        <span class="ios-cell__trail">
          <span class="ios-cell__value ios-cell__value--strong" [class.cf-in]="row.amountEur > 0">{{ signed(row.amountEur) }}</span>
          <span class="ios-cell__meta" [class.cf-warn]="lowBalance(row.balanceEur)">saldo {{ row.balanceEur === null ? '—' : whole(row.balanceEur) }}</span>
        </span>
      </button>
    </ng-template>

    @switch (sheet()) {
      @case ('menu') {
        <app-sheet title="Kasprognose" variant="ios" (closed)="sheet.set(null)">
          <div body class="ios-group cf-sheet-group">
            <button class="ios-cell" type="button" (click)="refresh()"><app-icon name="refresh" [size]="18" /><span class="ios-cell__body"><span class="ios-cell__title">Vernieuwen</span></span></button>
            <button class="ios-cell" type="button" (click)="openBuffer()"><app-icon name="bank" [size]="18" /><span class="ios-cell__body"><span class="ios-cell__title">Buffer instellen</span>
              <span class="ios-cell__sub">nu {{ whole(buffer()) }}</span></span></button>
            <button class="ios-cell" type="button" (click)="sheet.set('how')"><app-icon name="info" [size]="18" /><span class="ios-cell__body"><span class="ios-cell__title">Hoe rekenen we?</span></span></button>
          </div>
        </app-sheet>
      }
      @case ('horizon') {
        <app-sheet title="Hoe ver vooruit" variant="ios" (closed)="sheet.set(null)">
          <div body class="ios-group cf-sheet-group">
            @for (months of [3, 6, 12]; track months) {
              <button class="ios-cell" type="button" (click)="setHorizon(months)"><span class="ios-cell__body"><span class="ios-cell__title">{{ months }} maanden</span></span>
                @if (location().horizon === months) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }</button>
            }
          </div>
        </app-sheet>
      }
      @case ('buffer') {
        <app-sheet title="Buffer voor 'krap'" variant="ios" (closed)="sheet.set(null)">
          <div body class="cf-sheet-pad">
            @if (state.cashRound()) {
              <label class="cf-buffer__field"><span>Bedrag</span>
                <span class="cf-money"><span>€</span><input class="cf-input" type="text" inputmode="decimal" autocomplete="off" [value]="bufferDraft()"
                  [attr.aria-invalid]="bufferError() ? true : null" (input)="typeBuffer($any($event.target).value)" (keydown.enter)="saveBuffer()" /></span></label>
              @if (bufferError(); as error) { <p class="cf-buffer__error" role="alert">{{ error }}</p> }
              <p class="ios-caption">Eén bedrag voor het bedrijf; ook op de kaslijn in Kosten &amp; bank.</p>
            } @else if (state.choicesFailed()) {
              <p class="ios-caption">Keuzes konden niet laden.</p>
              <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="state.sources.refreshing()" (click)="state.retryChoices()">Opnieuw</button>
            } @else {
              <p class="ios-caption">De buffer staat op {{ whole(buffer()) }}. Bewaren kan zodra de server bijgewerkt is.</p>
            }
          </div>
          @if (state.cashRound()) {
            <div foot class="cf-sheet-foot">
              <button class="btn" type="button" (click)="resetBuffer()">Standaard (€ 10.000)</button>
              <button class="btn btn--primary" type="button" [disabled]="state.bufferSaving()" (click)="saveBuffer()">Bewaren</button>
            </div>
          }
        </app-sheet>
      }
      @case ('how') {
        <app-sheet title="Hoe rekenen we?" variant="ios" (closed)="sheet.set(null)">
          <div body class="cf-sheet-pad cf-how">
            @for (line of howLines; track $index) { <p>{{ line }}</p> }
          </div>
        </app-sheet>
      }
      @case ('price') {
        <app-sheet title="Prijs" variant="ios" (closed)="sheet.set(null)"><div body class="cf-sheet-pad"><app-cash-defaults variant="ios" part="price" /></div></app-sheet>
      }
      @case ('pace') {
        <app-sheet title="Verkocht in" variant="ios" (closed)="sheet.set(null)"><div body class="cf-sheet-pad"><app-cash-defaults variant="ios" part="pace" /></div></app-sheet>
      }
      @case ('payment') {
        <app-sheet title="Klant betaalt na" variant="ios" (closed)="sheet.set(null)"><div body class="cf-sheet-pad"><app-cash-defaults variant="ios" part="payment" /></div></app-sheet>
      }
      @case ('rows') {
        <app-sheet title="Komende bewegingen" variant="ios" (closed)="sheet.set(null)">
          <div body class="cf-rows-sheet">
            @for (group of rowGroups(); track group.key) {
              <h3 class="cf-rows-sheet__head" [id]="'cf-phone-group-' + group.key">{{ group.label }}</h3>
              <div class="ios-group cf-moves">
                @for (row of group.rows; track row.key) { <ng-container *ngTemplateOutlet="move; context: { $implicit: row }" /> }
              </div>
            }
          </div>
        </app-sheet>
      }
      @case ('months') {
        <app-sheet title="Per maand" variant="ios" (closed)="sheet.set(null)"><div body class="cf-sheet-pad cf-sheet-pad--flush"><app-cash-months variant="ios" /></div></app-sheet>
      }
      @case ('rules') {
        <app-sheet title="Wat telt mee" variant="ios" (closed)="sheet.set(null)">
          <div body>
            <div class="ios-group cf-sheet-group">
              @for (rule of rules(); track rule.rule) {
                <label class="ios-cell cf-rule-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ rule.label }}</span>
                  <span class="ios-cell__sub cf-wrap">{{ rule.sub }} · {{ whole(rule.totalEur) }}</span></span>
                  <input class="ios-switch" type="checkbox" [checked]="rule.on" (change)="toggleRule(rule)" [attr.aria-label]="rule.label" /></label>
              }
            </div>
            <p class="ios-section__foot">Niet in de prognose: belastingen, voorafbetalingen en leningen (tenzij als vaste kost), en aftrekbare btw op toekomstige kosten.</p>
          </div>
        </app-sheet>
      }
      @case ('recon') {
        @if (forecast(); as f) {
          <app-sheet title="Aansluiting met de Vooruitblik" variant="ios" (closed)="sheet.set(null)">
            <div body class="cf-sheet-pad">
              <dl class="wk-equation cf-eq">
                <div><dt>{{ f.reconciliation.startLabel }}</dt><dd>{{ eur(f.reconciliation.startEur) }}</dd></div>
                @for (line of f.reconciliation.lines; track line.label) {
                  <div class="is-sub"><dt><span class="wk-equation__op">{{ line.eur < 0 ? '−' : '+' }}</span>{{ line.label }}</dt><dd>{{ eur(abs(line.eur)) }}</dd></div>
                }
                <div class="is-total"><dt><span class="wk-equation__op">=</span>{{ f.reconciliation.endLabel }}</dt><dd>{{ eur(f.reconciliation.endEur) }}</dd></div>
              </dl>
              @if (!f.reconciliation.matches) { <p class="cf-recon__warn" role="alert">De aansluiting klopt niet; meld dit.</p> }
              @for (line of quality(); track line.text) {
                <p class="cf-quality-line" [class.is-warn]="line.warn"><span>{{ line.text }}</span>
                  @if (line.po !== null) { <button class="ios-section__link" type="button" (click)="sheet.set(null); state.openPo(line.po)">{{ line.action }}</button> }
                  @else if (line.link) { <a class="ios-section__link" [routerLink]="line.link.path" [queryParams]="line.link.query">{{ line.action }}</a> }</p>
              }
              <a class="ios-capsule ios-capsule--tinted ios-capsule--block cf-recon__link" routerLink="/costs">Kosten &amp; bank</a>
            </div>
          </app-sheet>
        }
      }
    }

    @if (location().po !== null) {
      <app-sheet [title]="poTitle()" variant="ios" (closed)="state.closePo()">
        <div body><app-cash-po-sheet variant="ios" /></div>
        @if (location().po; as po) {
          <div foot class="cf-sheet-foot">
            <a class="btn" routerLink="/costs" [queryParams]="{ container: po }">Betalingen</a>
            <a class="btn btn--primary" [routerLink]="['/purchasing', po]">Container openen</a>
          </div>
        }
      </app-sheet>
    }
  `,
})
export class CashPhone {
  readonly state = inject(CashState);
  private readonly router = inject(Router);
  private readonly chips = viewChild<ElementRef<HTMLElement>>('chips');

  /** The eight Analyses tabs as chips (the page passes its list, so the labels stay one). */
  readonly tabs = input<readonly { id: string; label: string }[]>([]);
  readonly pageWarnings = input<string[]>([]);
  /** "Vernieuwen": the page reloads its own data and the bank's. */
  readonly refreshed = output<void>();

  readonly band: ['with', 'slow'] = ['with', 'slow'];
  readonly whole = eurWhole;
  readonly eur = eur;
  readonly day = dayMon;
  readonly wd = weekdayDayMonth;
  readonly signed = signedWhole;
  readonly rowSub = phoneRowSub;
  readonly suggestion = suggestionText;
  readonly abs = Math.abs;
  readonly sheet = signal<PhoneSheet>(null);
  readonly bufferDraft = signal('');
  readonly bufferError = signal<string | null>(null);

  readonly location = this.state.location;
  readonly forecast = this.state.forecast;
  readonly warnings = computed(() => [...new Set([...this.pageWarnings(), ...this.state.sources.warnings()])]);
  readonly buffer = computed(() => this.state.sources.settings()?.cashBufferEur ?? DEFAULT_CASH_BUFFER_EUR);
  readonly banner = computed(() => { const f = this.forecast(); return f ? phoneKrapBanner(f) : null; });
  readonly series = computed(() => { const f = this.forecast(); return f ? forecastSeries(f, 14) : []; });
  /** The four phone figures read the desk cards (one wording), shorter. */
  readonly figures = computed(() => {
    const f = this.forecast();
    if (!f) return [];
    return kpiCards(f).filter((card) => card.id !== 'bank').map((card) => ({ ...card,
      sub: card.id === 'lowest' ? weekdayDayMonth(f.lowestWith.day) : card.id === 'zero' ? (card.sub ? card.sub.replace(' vanaf die dag', '') : card.foot)
        : card.id === 'scenario' ? 'incl. btw' : card.sub }));
  });
  readonly buffered = computed(() => { const f = this.forecast(); return f ? chartBuffer(f) : { bufferEur: null, tight: [] }; });
  readonly markers = computed(() => { const f = this.forecast(); return f ? forecastMarkers(f, false, true) : []; });
  readonly accountsLine = computed(() => {
    const f = this.forecast();
    if (!f) return '';
    if (f.mode === 'relative') return `Saldo ontbreekt: ${f.missingAccounts.join(', ')}`;
    return f.startAccounts.map((account) => `${account.label} ${eurWhole(account.eur)}`).join(' · ');
  });
  readonly staleAccounts = computed(() => (this.forecast()?.startAccounts ?? []).filter((account) => account.stale));
  readonly outcome = computed(() => { const f = this.forecast(); return f ? scenarioOutcome(f) : null; });
  readonly rules = computed(() => {
    const f = this.forecast();
    return f ? ruleSwitches(f, this.location(), this.state.input()?.history.openQuoteConversionPct ?? 0) : [];
  });
  readonly rulesLine = computed(() => ruleSummary(this.rules()));
  readonly quality = computed(() => {
    const input = this.state.input();
    const f = this.forecast();
    return input && f ? dataQuality(input, f) : [];
  });
  readonly futureRows = computed(() => (this.forecast()?.register ?? []).filter((row) => row.kind === 'future'));
  readonly shownRows = computed(() => this.futureRows().slice(0, SHOWN_ROWS));
  readonly rowGroups = computed(() => {
    const f = this.forecast();
    const groups: { key: string; label: string; rows: RegisterRow[] }[] = [];
    if (!f) return groups;
    const past = f.register.filter((row) => row.kind === 'past');
    if (past.length) groups.push({ key: 'past', label: 'Gebeurd · bank', rows: past });
    for (const row of this.futureRows()) {
      const last = groups[groups.length - 1];
      if (last && last.key === row.monthKey) last.rows.push(row);
      else groups.push({ key: row.monthKey, label: monthName(row.monthKey, f.today), rows: [row] });
    }
    return groups;
  });
  readonly poTitle = computed(() => this.state.sheet()?.title ?? 'Container');

  /* The scenario's link defaults as the three cells read them. */
  private readonly history = computed(() => this.state.input()?.history ?? null);
  private readonly markup = computed(() => this.location().markupPct ?? this.history()?.realisedMarkupPct ?? 50);
  readonly priceText = computed(() => {
    const location = this.location();
    switch (location.priceMode) {
      case 'EUR_PER_UNIT': return `${eur(location.markupEurPerUnit ?? 0)} per stuk`;
      case 'LIST': return 'Lijstprijs';
      case 'HISTORIC': return 'Historisch';
      default: return `Opslag ${pct(this.markup())} % op kost`;
    }
  });
  readonly weeksText = computed(() => {
    const weeks = this.location().sellWeeks;
    if (weeks !== null) return `${weeks} weken`;
    const forecast = this.forecast();
    let weighted = 0;
    let basis = 0;
    for (const source of forecast?.scenario.sources ?? []) {
      if (!source.choice || source.locked || !(source.costEur > 0)) continue;
      weighted += source.costEur * source.choice.defaultSellWeeks;
      basis += source.costEur;
    }
    return basis > 0 ? `tempo · ≈ ${Math.round(weighted / basis)} weken` : 'tempo';
  });
  readonly daysText = computed(() => `${this.location().paymentDays ?? this.history()?.paymentDays ?? 30} dagen`);
  readonly choiceFoot = computed(() => {
    const basis = this.location().costBasis === 'PRICING' ? 'kost met Enrosed-kost' : 'externe kost';
    return `Opslag ${pct(this.markup())} % op ${basis} = marge ${marginOfMarkup(this.markup())}. Verandert niets aan orders of betalingen.`;
  });

  readonly howLines = [
    'We vertrekken van het berekende saldo van de rekeningen die meetellen: de laatste saldocontrole plus alle banktransacties daarna.',
    'Open facturen komen binnen op hun vervaldag, plus de dagen die de klant gewoonlijk later betaalt. Wat al vervallen is, staat op vandaag.',
    'Geaccepteerde offertes komen binnen na de leverweek plus de betaalvoorwaarde van de klant; zonder voorwaarde rekenen we 30 dagen.',
    'Partnervoorschotten volgen de vervaldagen van het voorschotschema.',
    'Containertermijnen tellen met hun open bedrag: bij bestelling meteen, bij vertrek op de vertrekdatum (aankomst min de transittijd), bij aankomst op de ETA. Douane en transport volgen twee dagen na aankomst, de inspectie een week voor vertrek.',
    'Btw bij invoer betalen we bij aankomst wanneer de container in België wordt ingeklaard, tenzij de vergunning ET 14000 aan staat.',
    'Kosten vallen op hun vervaldag, of op de kostdatum als er geen is; vaste kosten en domiciliëringen op hun eigen dag.',
    'De btw-aangifte valt op de 25e na het kwartaal: wat de aangifte vandaag al weet, plus de btw op de verwachte verkoop. Een tegoed schuift door naar het volgende kwartaal.',
    'Het scenario verkoopt de aangevinkte containers en de voorraad vanaf een week na aankomst, verspreid over de gekozen weken, tegen de prijs die je kiest. Klanten betalen na de betaaltermijn.',
    'Een banktransactie die een open post al lijkt te betalen, telt niet dubbel: die post blijft uit de prognose tot je koppelt of "Niet deze" kiest.',
  ];

  constructor() {
    afterNextRender(() => {
      const nav = this.chips()?.nativeElement;
      const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (nav && active) nav.scrollTo({ left: active.offsetLeft - 16, behavior: 'instant' });
    });
  }

  retry(): void { void this.state.sources.reload(this.state.today); }

  refresh(): void {
    this.sheet.set(null);
    this.refreshed.emit();
  }

  setHorizon(months: number): void {
    this.sheet.set(null);
    this.state.setHorizon(months as 3 | 6 | 12);
  }

  openBuffer(): void {
    this.bufferDraft.set(amountText(this.buffer()));
    this.bufferError.set(null);
    this.sheet.set('buffer');
  }

  typeBuffer(value: string): void {
    this.bufferDraft.set(value);
    this.bufferError.set(null);
  }

  /** Any amount in Dutch or plain form ('12.500'); an empty or unreadable field is refused here, never saved as € 0. */
  async saveBuffer(): Promise<void> {
    const value = parseAmount(this.bufferDraft());
    if (value === null) { this.bufferError.set('Geef een bedrag'); return; }
    if (await this.state.saveBuffer(Math.round(value * 100) / 100)) this.sheet.set(null);
  }

  /** A saldo under the buffer (amber); never in relative mode. */
  lowBalance(eur: number | null): boolean {
    const forecast = this.forecast();
    return !!forecast && underBuffer(forecast, eur);
  }

  async resetBuffer(): Promise<void> {
    if (await this.state.saveBuffer(null)) this.sheet.set(null);
  }

  isAdjusted(source: ScenarioSource): boolean {
    return typeof source.id === 'number' && adjusted(this.state.storedFor(source.id));
  }

  toggleSource(source: ScenarioSource): void {
    if (source.id === 'stock') this.state.setStock(!source.included);
    else this.state.changeChoice(source.id, { included: !source.included });
  }

  openSource(source: ScenarioSource): void {
    if (typeof source.id === 'number') this.state.openPo(source.id);
  }

  toggleRule(rule: RuleSwitch): void {
    this.state.toggleRule(rule.rule);
  }

  moveTitle(row: RegisterRow): string {
    if (!row.item) return row.title;
    return CONTAINER_KINDS.has(row.item.kind) ? row.title : row.item.party ?? row.title;
  }

  openRow(row: RegisterRow): void {
    const link: CashLink | null = row.kind === 'past' ? (row.lineId !== null ? lineLink(row.lineId) : null) : row.item ? itemLink(row.item) : null;
    if (!link) return;
    this.sheet.set(null);
    if (link.po !== null) { this.state.openPo(link.po); return; }
    void this.router.navigate(link.path, link.query ? { queryParams: link.query } : {});
  }

  showPeriod(): void {
    const b = this.banner();
    if (b?.from) this.openRowsAt(b.from);
  }

  /** The full list, scrolled to the month of a day. */
  openRowsAt(day: string): void {
    this.sheet.set('rows');
    const key = day.slice(0, 7);
    setTimeout(() => document.getElementById(`cf-phone-group-${key}`)?.scrollIntoView({ block: 'start' }), 60);
  }
}
