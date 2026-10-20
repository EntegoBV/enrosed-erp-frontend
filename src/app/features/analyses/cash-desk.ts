import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, Scroll } from '@angular/router';
import { filter } from 'rxjs';
import { CashChart } from '../../shared/cash-chart';
import { Icon } from '../../shared/icon';
import { Segmented, SegmentOption } from '../../shared/segmented';
import type { ForecastRule, Iso, RegisterRow, ScenarioSource } from '../finance/cash-forecast';
import { DEFAULT_CASH_BUFFER_EUR } from '../finance/cash-forecast';
import { dayMon, eur, eurK, eurWhole, weekdayDayMonth } from '../finance/cash-format';
import { CashDefaults } from './cash-defaults';
import { CashMonths } from './cash-months';
import { CashPoSheet } from './cash-po-sheet';
import { CashState } from './cash-state';
import { AnHow, HOW_TEXTS } from './analyses-how';
import {
  RegisterFilter, adjusted, amountText, bankTextShort, chartBuffer, dataQuality, dayItems, filterCounts, forecastMarkers, forecastSeries, groupSummary, itemLink, kpiCards,
  krapBanner, lineLink, monthStrip, parseAmount, periodText, pinLegend, registerCsv, registerGroups, pct, ruleSwitches, scenarioOutcome, suggestionText, underBuffer,
} from './cash-view';
import type { CashLink, KpiCard, RuleSwitch } from './cash-view';
import { cashCommittedView, cashLikelyPaidView, cashLowestView, cashRuleView, cashScenarioSalesView, cashStockPlanView } from './drill-cash';
import type { CashDrillContext } from './drill-cash';
import { AnDrillHost } from './drill-host';

const HORIZONS: SegmentOption[] = [{ id: '3', label: '3 mnd' }, { id: '6', label: '6 mnd' }, { id: '12', label: '12 mnd' }];
const FILTERS: { id: RegisterFilter; label: string; count: boolean }[] = [
  { id: 'all', label: 'Alles', count: true }, { id: 'in', label: 'In', count: false }, { id: 'out', label: 'Uit', count: false },
  { id: 'containers', label: 'Containers', count: false }, { id: 'scenario', label: 'Scenario', count: false }, { id: 'estimated', label: 'Geschat', count: true },
];
const KIND_TONE: Partial<Record<string, string>> = { CUSTOMER: 'tone-ok', PARTNER: 'tone-teal', QUOTE: 'tone-blue', OPEN_QUOTE: 'tone-blue', SALES: 'tone-plum',
  SUPPLIER: 'tone-amber', LOGISTICS: 'tone-amber', INSPECTION: 'tone-amber', OTHER_CONTAINER: 'tone-amber', IMPORT_VAT: 'tone-grey', VAT: 'tone-grey',
  COST: 'tone-accent', RECURRING: 'tone-accent', CREDIT: 'tone-warn' };

/**
 * Analyses › Kasprognose on the desk (spec §4.2): one page in the
 * Analyses frame with the workspace kit inside. Banner, four figures, the
 * balance per day with its month strip, the register running forward, the
 * scenario panel (or a container's sheet) on the right, then what counts
 * and the reconciliation with the Vooruitblik. A figure, a rule amount, the
 * scenario outcome and a month open the page's one drill-down (AnDrillHost,
 * design/analyses2 §B.8); none renders inside this size container.
 */
@Component({
  selector: 'app-cash-desk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnHow, CashChart, CashDefaults, CashMonths, CashPoSheet, Icon, RouterLink, Segmented],
  host: { class: 'cf' },
  template: `
    <!-- The tool row (design §3.1): the old eyebrow, heading and paragraph went to "Hoe gerekend". -->
    <header class="cf-head an-bar">
      <div class="cf-head__tools">
        <app-segmented label="Horizon" [options]="horizons" [value]="'' + location().horizon" (changed)="setHorizon($event)" />
        <div class="wk-popover-anchor">
          <button class="wk-btn" type="button" [attr.aria-expanded]="bufferOpen()" [disabled]="!state.cashRound()"
                  [title]="state.cashRound() ? 'Bedrag waaronder het saldo krap is' : state.choicesFailed() ? 'Keuzes konden niet laden' : 'De buffer bewaren kan zodra de server bijgewerkt is'"
                  (click)="toggleBuffer()">Buffer {{ whole(buffer()) }}</button>
          @if (bufferOpen()) {
            <form class="wk-popover cf-buffer" novalidate (submit)="$event.preventDefault(); saveBuffer()">
              <label class="cf-buffer__field"><span>Buffer voor 'krap'</span>
                <span class="cf-money"><span>€</span><input class="cf-input" type="text" inputmode="decimal" autocomplete="off" [value]="bufferDraft()"
                  [attr.aria-invalid]="bufferError() ? true : null" (input)="typeBuffer($any($event.target).value)" /></span></label>
              @if (bufferError(); as error) { <p class="cf-buffer__error" role="alert">{{ error }}</p> }
              <p class="cf-buffer__hint">Eén bedrag voor het bedrijf; ook op de kaslijn in Kosten &amp; bank.</p>
              <div class="wk-popover__foot">
                <button class="wk-btn wk-btn--sm" type="button" (click)="resetBuffer()">Standaard (€ 10.000)</button>
                <button class="wk-btn wk-btn--sm wk-btn--primary" type="submit" [disabled]="state.bufferSaving()">Bewaren</button>
              </div>
            </form>
          }
        </div>
      </div>
      <div class="an-bar__end">
        <app-an-how [lines]="howLines" />
        <button class="wk-btn" type="button" (click)="state.copyLink()"><app-icon name="share" [size]="15" />Link kopiëren</button>
      </div>
    </header>

    @if (warnings().length) {
      <div class="wk-banner wk-banner--warn wk-banner--inset" role="status"><app-icon name="alert" [size]="16" />
        <span class="wk-banner__text">Niet alle actuele cijfers konden laden: {{ warnings().join(', ') }}.</span>
        @if (state.choicesFailed()) {
          <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="state.sources.refreshing()" (click)="state.retryChoices()">Opnieuw</button></span>
        }
      </div>
    }

    @if (state.sources.bankMissing() && state.sources.state() === 'ready') {
      <div class="wk-card cf-empty">
        <p class="wk-empty__title">Banksaldo kon niet laden</p>
        <p class="wk-empty__text">Zonder rekeningen en transacties kan de prognose niet vertrekken van het saldo van vandaag.</p>
        <button class="wk-btn wk-btn--primary" type="button" (click)="retry()">Opnieuw</button>
      </div>
    } @else if (forecast(); as f) {
      @if (banner(); as b) {
        <div class="wk-banner wk-banner--inset" [class.wk-banner--warn]="b.kind !== 'relative'" role="status">
          <app-icon [name]="b.kind === 'relative' ? 'info' : 'alert'" [size]="16" />
          <span class="wk-banner__text">{{ b.text }}</span>
          <span class="wk-banner__actions">
            @if (b.kind === 'relative') { <a class="wk-btn wk-btn--sm" routerLink="/costs">Saldo invullen</a> }
            @else { <button class="wk-btn wk-btn--sm" type="button" (click)="showPeriod(b.from!, b.to!)">Toon die dagen</button> }
          </span>
        </div>
      }

      <div class="cf-kpis">
        @for (card of kpis(); track card.id) {
          @if (card.id === 'bank') {
            <article class="cf-kpi" data-kpi="bank">
              <a class="cf-kpi__link" routerLink="/costs" aria-label="Op de bank vandaag, naar Kosten & bank"></a>
              <span class="cf-kpi__label">{{ card.label }}</span>
              <strong class="cf-kpi__value" [attr.data-tone]="card.valueTone" [attr.data-kind]="card.kind ?? null">{{ card.value }}</strong>
              <span class="cf-kpi__sub">{{ card.sub }}</span>
              <span class="cf-kpi__foot" [class.is-warn]="card.footWarn">{{ card.foot }}</span>
            </article>
          } @else {
            <!-- Laagste stand and Zonder verkoop open their list; Op {d} opens Per maand below (design B.8). -->
            <button class="cf-kpi cf-kpi--drill" type="button" [attr.data-kpi]="card.id" [attr.aria-haspopup]="card.id === 'end' ? null : 'dialog'"
                    [attr.aria-expanded]="card.id === 'end' ? monthsOpen() : null" (click)="openKpi(card)">
              <span class="cf-kpi__label">{{ card.label }}</span>
              <strong class="cf-kpi__value" [attr.data-tone]="card.valueTone" [attr.data-kind]="card.kind ?? null">{{ card.value }}</strong>
              <span class="cf-kpi__sub">{{ card.sub }}</span>
              <span class="cf-kpi__foot" [class.is-warn]="card.footWarn">{{ card.foot }}</span>
            </button>
          }
        }
      </div>

      <div class="cf-grid">
        <div class="cf-main">
          <article class="wk-card cf-chart-card" aria-labelledby="cf-chart-title">
            <header class="wk-card__head">
              <h3 class="wk-card__title" id="cf-chart-title">Saldo per dag</h3>
              <span class="cf-card-sub">alle rekeningen die meetellen · {{ chartRange() }}</span>
            </header>
            <div class="wk-card__body">
              <app-cash-chart [series]="series()" [today]="f.today" [bufferEur]="buffered().bufferEur" [tight]="buffered().tight" [pins]="f.pins" [markers]="markers()"
                              [height]="300" variant="full" [bandBetween]="band" [dayDetail]="detail()" (pick)="focusDay($event)" (pinPick)="focusPin($event)"
                              ariaLabel="Saldo per dag: bank, daarna prognose" />
              @if (pins().length) {
                <ol class="cf-pins">
                  @for (pin of pins(); track $index) { <li><button type="button" (click)="focusPin($index + 1)">{{ pin }}</button></li> }
                </ol>
              }
            </div>
            <div class="cf-strip" role="list" aria-label="Per maand" [class.cf-strip--fill]="strip().length <= 5">
              @for (column of strip(); track column.key) {
                <button class="cf-strip__col" type="button" role="listitem" [class.is-current]="column.current" (click)="focusMonth(column.key)"
                        [title]="column.label + ': einde ' + eur(column.endEur) + ' · in ' + eur(column.inEur) + ' · uit ' + eur(column.outEur) + ' · laagst ' + eur(column.lowestEur)">
                  <span class="cf-strip__mon">{{ column.label }}</span>
                  <strong>{{ k(column.endEur) }}</strong>
                  <span><small>in</small>{{ k(column.inEur) }}</span>
                  <span><small>uit</small>{{ k(column.outEur) }}</span>
                  <span [class.is-low]="column.lowWarn"><small>laagst</small>{{ k(column.lowestEur) }}</span>
                </button>
              }
            </div>
            <footer class="cf-strip__foot">
              <button class="wk-link" type="button" [attr.aria-expanded]="monthsOpen()" (click)="monthsOpen.set(!monthsOpen())">Per maand {{ monthsOpen() ? '‹' : '›' }}</button>
            </footer>
            @if (monthsOpen()) { <div class="cf-months-wrap"><app-cash-months variant="desk" /></div> }
          </article>

          <article class="wk-card cf-register" #register aria-labelledby="cf-register-title">
            <header class="wk-card__head"><h3 class="wk-card__title" id="cf-register-title">Komende bewegingen</h3></header>
            <div class="cf-register__tools">
              <div class="wk-chips" role="group" aria-label="Filter">
                @for (chip of filters; track chip.id) {
                  <button class="wk-chip" type="button" [attr.aria-pressed]="filter() === chip.id" (click)="filter.set(chip.id)">
                    {{ chip.label }}@if (chip.count) { <span class="cf-chip-count">{{ counts()[chip.id] }}</span> }</button>
                }
                @if (period(); as p) {
                  <span class="wk-chip tone-warn">Krap {{ periodLabel(p.from, p.to) }}
                    <button class="wk-chip__x" type="button" aria-label="Periode wissen" (click)="period.set(null)"><app-icon name="close" [size]="10" /></button></span>
                }
              </div>
              <button class="wk-btn wk-btn--sm wk-btn--ghost" type="button" (click)="downloadCsv()"><app-icon name="download" [size]="14" />CSV</button>
            </div>
            <div class="wk-table cf-table" role="table" aria-label="Komende bewegingen">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Datum</span><span class="wk-th" role="columnheader">Tegenpartij · omschrijving</span>
                <span class="wk-th" role="columnheader">Soort · zekerheid</span><span class="wk-th wk-th--num" role="columnheader">Bedrag</span>
                <span class="wk-th wk-th--num" role="columnheader">Saldo</span>
              </div>
              @for (row of pastRows(); track row.key) {
                <div class="wk-tr wk-tr--muted wk-tr--link cf-past" role="row" tabindex="0" [id]="'cf-row-' + row.key" [class.is-flash]="flash() === row.key"
                     (click)="openRow(row)" (keydown.enter)="openRow(row)">
                  <span class="wk-td" role="cell">{{ wd(row.date) }}</span>
                  <span class="wk-td" role="cell"><b class="cf-title">{{ row.title }}</b><span class="wk-td__sub" [attr.title]="pastLine(row)?.reference || null">{{ shortBank(pastLine(row)?.reference) || 'Gebeurd' }}</span></span>
                  <span class="wk-td" role="cell"><span class="cf-bank">Bank · {{ pastLine(row)?.account ?? 'rekening' }}</span>
                    @if (row.lineId !== null && unlinked().has(row.lineId)) { <a class="wk-pill tone-warn cf-pill-link" routerLink="/costs" [queryParams]="{ view: 'bank', tab: 'movements', line: row.lineId }" (click)="$event.stopPropagation()">Te koppelen</a> }
                    @else { <span class="wk-td__sub">Gebeurd</span> }</span>
                  <span class="wk-td wk-td--num" role="cell" [class.cf-in]="row.amountEur > 0">{{ signedEur(row.amountEur) }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ row.balanceEur === null ? '—' : eur(row.balanceEur) }}</span>
                </div>
              }
              <div class="cf-today" role="row">
                <span role="cell"><app-icon name="bank" [size]="14" /> Vandaag · {{ wd(f.today) }}</span>
                <span role="cell" class="cf-today__sub">berekend saldo uit Kosten &amp; bank · {{ accountsText() }}</span>
                <strong role="cell">{{ f.mode === 'relative' ? 'verschil t.o.v. vandaag' : eur(f.startEur) }}</strong>
              </div>
              @for (group of groups(); track group.key) {
                <div class="wk-group cf-group" role="row">
                  <span class="wk-group__label">
                    <button class="wk-group__toggle" type="button" [attr.aria-expanded]="isOpen(group.key)" [attr.aria-label]="(isOpen(group.key) ? 'Dichtklappen: ' : 'Openklappen: ') + group.label"
                            (click)="toggleGroup(group.key)"><app-icon name="chevron-down" [size]="14" /></button>
                    <b>{{ group.label }}</b><span class="cf-group__sum">{{ summary(group) }}</span>
                  </span>
                </div>
                @if (isOpen(group.key)) {
                  @for (row of group.rows; track row.key) {
                    <div class="wk-tr wk-tr--link" role="row" tabindex="0" [id]="'cf-row-' + row.key" [class.is-flash]="flash() === row.key"
                         [class.cf-scenario]="row.layer === 'SCENARIO'" (click)="openRow(row)" (keydown.enter)="openRow(row)">
                      <span class="wk-td" role="cell">{{ wd(row.date) }}</span>
                      <span class="wk-td" role="cell"><b class="cf-title">{{ row.title }}</b>@if (row.item?.party && row.item?.party !== row.title) { <span class="wk-td__sub">{{ row.item?.party }}</span> }</span>
                      <span class="wk-td" role="cell"><span [class]="'wk-pill ' + tone(row)">{{ row.kindLabel }}</span>
                        <span class="wk-td__sub" [title]="row.certaintyLabel + ' · ' + (row.item?.ruleText ?? '')">{{ row.certaintyLabel }} · {{ row.item?.ruleText }}</span></span>
                      <span class="wk-td wk-td--num" role="cell" [class.cf-in]="row.amountEur > 0">{{ signedEur(row.amountEur) }}</span>
                      <span class="wk-td wk-td--num" role="cell" [class.cf-low]="low(f, row.balanceEur)" [class.cf-neg]="row.balanceEur !== null && row.balanceEur < 0">{{ eur(row.balanceEur) }}</span>
                    </div>
                  }
                }
              } @empty {
                <p class="wk-empty__text cf-register__empty">Geen bewegingen voor deze selectie.</p>
              }
            </div>
          </article>
        </div>

        <aside class="cf-side" aria-label="Scenario">
          @if (location().po !== null) {
            <app-cash-po-sheet variant="desk" />
          } @else {
            <article class="wk-card cf-panel">
              <header class="wk-card__head">
                <h3 class="wk-card__title">Scenario</h3>
                <span class="wk-pill tone-ok">{{ includedCount() }} {{ includedCount() === 1 ? 'bron' : 'bronnen' }}</span>
                <button class="wk-link cf-panel__clear" type="button" (click)="state.clearDefaults()">Wissen</button>
              </header>
              <section class="cf-panel__sec">
                <h4 class="cf-sec-title">Wat verkopen we?</h4>
                @for (source of f.scenario.sources; track source.id) {
                  <div class="cf-src" [class.is-off]="!source.included" [class.is-locked]="source.locked">
                    <input class="cf-check" type="checkbox" [checked]="source.included" [disabled]="source.locked || (source.id !== 'stock' && state.choicesFailed())"
                           [attr.title]="source.id !== 'stock' && state.choicesFailed() ? 'Keuzes konden niet laden' : null" [attr.aria-label]="'Meetellen: ' + source.label"
                           (change)="toggleSource(source, $any($event.target).checked)" />
                    <button class="cf-src__body" type="button" [disabled]="source.id === 'stock' && !source.products?.length"
                            [attr.aria-haspopup]="source.id === 'stock' ? 'dialog' : null" (click)="openSource(source)">
                      <b><span class="cf-src__name">{{ source.label }}</span>@if (isAdjusted(source)) { <i class="cf-dot" title="aangepast" aria-label="aangepast"></i> }</b>
                      <small>@if (source.status === 'CONCEPT') { <span class="wk-pill tone-amber">Concept</span> }@if (source.locked) { <span class="wk-pill tone-plum">Partner</span> }{{ source.locked ? source.lockedText : source.sub }}</small>
                    </button>
                    <!-- Binnen is cash incl. btw up to the horizon, kost the whole plan's cost excl. btw (design D-K6). -->
                    <span class="cf-src__amt"><span><b>{{ source.included && !source.locked ? whole(source.cashInHorizonEur) : '—' }}</b>
                      @if (source.included && !source.locked) { <small>binnen tot {{ day(f.horizonEnd) }}</small> }</span>
                      @if (!source.locked) { <small>kost {{ whole(source.costEur) }} excl.</small> }</span>
                  </div>
                } @empty { <p class="cf-panel__empty">Geen voorraad en geen open inkooporders.</p> }
              </section>
              <section class="cf-panel__sec">
                <h4 class="cf-sec-title">Prijs en tempo · standaard voor alle containers</h4>
                <app-cash-defaults variant="desk" />
              </section>
              <section class="cf-panel__sec">
                <h4 class="cf-sec-title">Uitkomst tot {{ day(f.horizonEnd) }}</h4>
                @if (outcome(); as o) {
                  <dl class="wk-equation cf-eq">
                    <div><dt>@if (o.salesExclEur > 0) { <button class="wk-link" type="button" aria-haspopup="dialog" (click)="openScenarioSales()">Verkoop excl. btw</button> }
                      @else { Verkoop excl. btw }</dt><dd>{{ whole(o.salesExclEur) }}</dd></div>
                    <div class="is-sub"><dt><span class="wk-equation__op">+</span>Btw op die verkoop</dt><dd>{{ whole(o.salesVatEur) }}</dd></div>
                    <div class="is-total"><dt><span class="wk-equation__op">=</span>Binnen op de bank</dt><dd>{{ whole(o.inHorizonEur) }}</dd></div>
                    @for (vat of o.vatRows; track vat.label) {
                      <div class="is-sub"><dt><span class="wk-equation__op">{{ vat.op }}</span>{{ vat.label }}</dt><dd>{{ whole(vat.eur) }}</dd></div>
                    } @empty {
                      <div class="is-sub"><dt><span class="wk-equation__op">−</span>Btw afgedragen <small>· {{ o.vatNote }}</small></dt><dd>€ 0,00</dd></div>
                    }
                    @let margin = 'Marge op goederen tot ' + day(f.horizonEnd) + (o.marginPct === null ? '' : ' (' + pctText(o.marginPct) + ' %)');
                    <div><dt>@if (o.salesExclEur > 0) { <button class="wk-link" type="button" aria-haspopup="dialog" (click)="openScenarioSales()">{{ margin }}</button> }
                      @else { {{ margin }} }</dt><dd>{{ whole(o.marginEur) }}</dd></div>
                    <div><dt>Komt na {{ day(f.horizonEnd) }} nog binnen</dt><dd>{{ whole(o.afterHorizonEur) }}</dd></div>
                  </dl>
                }
              </section>
              @if (state.suggestion(); as hint) {
                <section class="cf-suggest" aria-label="Besteldatum">
                  <app-icon name="calendar" [size]="16" />
                  <div>
                    <p>{{ suggestion(hint.suggestion, hint.number) }}</p>
                    <button class="wk-btn wk-btn--sm" type="button" [disabled]="state.choicesFailed()" (click)="state.tryOrderDate(hint.suggestion.orderId, hint.suggestion.suggestedDate)">Met besteldatum {{ day(hint.suggestion.suggestedDate) }} proberen</button>
                  </div>
                </section>
              }
            </article>
          }
        </aside>
      </div>

      <div class="cf-bottom">
        <article class="wk-card cf-rules" aria-labelledby="cf-rules-title">
          <header class="wk-card__head"><h3 class="wk-card__title" id="cf-rules-title">Wat telt mee</h3><span class="cf-card-sub">tot {{ day(f.horizonEnd) }} · incl. btw</span></header>
          <div class="wk-card__body">
            <!-- The label goes with its switch; the amount is its own button that opens the items it adds up (design C.7). -->
            @for (rule of rules(); track rule.rule) {
              <div class="cf-rule" [class.is-off]="!rule.on">
                <label class="cf-rule__text" [for]="'cf-rule-' + rule.rule"><b>{{ rule.label }}</b> <small>{{ rule.sub }}</small></label>
                @if (rule.totalEur !== 0) {
                  <button class="wk-link cf-rule__eur" type="button" aria-haspopup="dialog" [attr.aria-label]="rule.label + ' ' + whole(rule.totalEur) + ': de posten'"
                          (click)="openRule(rule)">{{ whole(rule.totalEur) }}</button>
                } @else { <span class="cf-rule__eur">{{ whole(rule.totalEur) }}</span> }
                <input class="cf-toggle" type="checkbox" [id]="'cf-rule-' + rule.rule" [checked]="rule.on" (change)="toggleRule(rule)" [attr.aria-label]="rule.label" />
              </div>
            }
            <p class="cf-rules__foot">Niet in de prognose: belastingen, voorafbetalingen en leningen (tenzij als vaste kost), en aftrekbare btw op toekomstige kosten.</p>
          </div>
        </article>
        <article class="wk-card cf-recon" aria-labelledby="cf-recon-title">
          <!-- A check, not a business figure: folded while it matches, open when it does not (design C.7). -->
          <details class="cf-recon__fold" [open]="!f.reconciliation.matches">
            <summary class="wk-card__head"><h3 class="wk-card__title" id="cf-recon-title">Aansluiting met de Vooruitblik</h3>
              <span class="cf-recon__state" [class.is-warn]="!f.reconciliation.matches">· {{ f.reconciliation.matches ? 'klopt' : 'klopt niet' }}</span>
              <app-icon class="cf-recon__chev" name="chevron-down" [size]="14" /></summary>
            <div class="wk-card__body">
              <dl class="wk-equation cf-eq">
                <div><dt>{{ f.reconciliation.startLabel }}</dt><dd>{{ eur(f.reconciliation.startEur) }}</dd></div>
                @for (line of f.reconciliation.lines; track line.label) {
                  <div class="is-sub"><dt><span class="wk-equation__op">{{ line.eur < 0 ? '−' : '+' }}</span>@if (likelyLine(line.label) && f.likelyPaid.length) {
                    <button class="wk-link" type="button" aria-haspopup="dialog" (click)="openLikelyPaid(line.eur)">{{ line.label }}</button> } @else { {{ line.label }} }</dt>
                    <dd>{{ eur(abs(line.eur)) }}</dd></div>
                }
                <div class="is-total"><dt><span class="wk-equation__op">=</span>{{ f.reconciliation.endLabel }}</dt><dd>{{ eur(f.reconciliation.endEur) }}</dd></div>
              </dl>
              @if (!f.reconciliation.matches) { <p class="cf-recon__warn" role="alert">De aansluiting klopt niet; meld dit.</p> }
              <a class="wk-link cf-recon__link" routerLink="/costs">Kosten &amp; bank ›</a>
            </div>
          </details>
          <!-- What makes the forecast less sure stays in sight, under the folded check. -->
          @if (quality().length) {
            <div class="wk-card__body cf-recon__quality">
              <ul class="cf-quality">
                @for (line of quality(); track line.text) {
                  <li [class.is-warn]="line.warn"><app-icon [name]="line.warn ? 'alert' : 'info'" [size]="14" /><span>{{ line.text }}</span>
                    @if (line.po !== null) { <button class="wk-link" type="button" (click)="openDeparture(line.po)">{{ line.action }}</button> }
                    @else if (line.link) { <a class="wk-link" [routerLink]="line.link.path" [queryParams]="line.link.query">{{ line.action }}</a> }
                  </li>
                }
              </ul>
            </div>
          }
        </article>
      </div>
    } @else {
      <div class="cf-loading" aria-label="Kasprognose laden" aria-busy="true">
        @for (card of [1, 2, 3, 4]; track card) { <div class="cf-kpi cf-kpi--loading"><span></span><b></b><i></i></div> }
        <div class="wk-card cf-loading__chart"><span>Banksaldo laden…</span></div>
      </div>
    }
  `,
})
export class CashDesk {
  /** "Hoe gerekend": the explanation that stood above the page. */
  readonly howLines = HOW_TEXTS.cash;
  readonly shortBank = bankTextShort;
  readonly state = inject(CashState);
  private readonly drill = inject(AnDrillHost);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The page's own load warnings (costs, purchasing, sales) next to the bank's. */
  readonly pageWarnings = input<string[]>([]);

  readonly horizons = HORIZONS;
  readonly filters = FILTERS;
  readonly band: ['with', 'slow'] = ['with', 'slow'];
  readonly eur = eur;
  readonly whole = eurWhole;
  readonly k = eurK;
  readonly day = dayMon;
  readonly wd = weekdayDayMonth;
  readonly summary = groupSummary;
  readonly low = underBuffer;
  readonly suggestion = suggestionText;
  readonly periodLabel = periodText;
  readonly abs = Math.abs;
  readonly pctText = pct;
  retry(): void { void this.state.sources.reload(this.state.today); }
  setHorizon(value: string): void { this.state.setHorizon(value === '3' ? 3 : value === '12' ? 12 : 6); }

  readonly location = this.state.location;
  readonly forecast = this.state.forecast;
  readonly warnings = computed(() => [...new Set([...this.pageWarnings(), ...this.state.sources.warnings()])]);
  readonly buffer = computed(() => this.state.sources.settings()?.cashBufferEur ?? DEFAULT_CASH_BUFFER_EUR);
  readonly banner = computed(() => { const f = this.forecast(); return f ? krapBanner(f) : null; });
  /** Four figures: "Scenario binnen" is the panel's "Binnen op de bank" on the desk (design C.7). */
  readonly kpis = computed(() => { const f = this.forecast(); return f ? kpiCards(f).filter((card) => card.id !== 'scenario') : []; });
  readonly series = computed(() => { const f = this.forecast(); return f ? forecastSeries(f, 42) : []; });
  readonly buffered = computed(() => { const f = this.forecast(); return f ? chartBuffer(f) : { bufferEur: null, tight: [] }; });
  readonly markers = computed(() => { const f = this.forecast(); return f ? forecastMarkers(f) : []; });
  readonly pins = computed(() => { const f = this.forecast(); return f ? pinLegend(f.pins) : []; });
  readonly strip = computed(() => { const f = this.forecast(); return f ? monthStrip(f) : []; });
  readonly detail = computed(() => { const f = this.forecast(); return (day: string) => (f ? dayItems(f, day) : []); });
  readonly chartRange = computed(() => {
    const f = this.forecast();
    if (!f) return '';
    const first = f.past.find((point) => point.eur !== null)?.day ?? f.today;
    return `${dayMon(first)} tot ${dayMon(f.horizonEnd)}`;
  });
  readonly accountsText = computed(() => (this.forecast()?.startAccounts ?? []).map((account) => account.label).join(' + ') || 'geen rekening');
  readonly includedCount = computed(() => (this.forecast()?.scenario.sources ?? []).filter((source) => source.included && !source.locked).length);
  readonly outcome = computed(() => { const f = this.forecast(); return f ? scenarioOutcome(f) : null; });
  readonly rules = computed(() => {
    const f = this.forecast();
    return f ? ruleSwitches(f, this.location(), this.state.input()?.history.openQuoteConversionPct ?? 0) : [];
  });
  readonly quality = computed(() => {
    const input = this.state.input();
    const f = this.forecast();
    return input && f ? dataQuality(input, f) : [];
  });
  /** The reference and account label of the past rows' bank lines. */
  private readonly pastLines = computed(() => {
    const input = this.state.input();
    const labels = new Map((input?.accounts ?? []).map((account) => [account.key, account.label]));
    return new Map((input?.bankLines ?? []).map((line) => [line.id, { reference: line.reference, account: labels.get(line.account) ?? line.account }]));
  });
  pastLine(row: RegisterRow): { reference: string; account: string } | null {
    return row.lineId !== null ? this.pastLines().get(row.lineId) ?? null : null;
  }
  readonly unlinked = computed(() => new Set((this.state.input()?.bankLines ?? []).filter((line) => !line.allocated && line.classification == null).map((line) => line.id)));

  /* register */
  readonly filter = signal<RegisterFilter>('all');
  readonly period = signal<{ from: Iso; to: Iso } | null>(null);
  readonly opened = signal<ReadonlySet<string> | null>(null);
  readonly flash = signal<string | null>(null);
  readonly counts = computed(() => { const f = this.forecast(); return f ? filterCounts(f) : { all: 0, in: 0, out: 0, containers: 0, scenario: 0, estimated: 0 }; });
  readonly pastRows = computed(() => (this.filter() === 'all' && !this.period() ? (this.forecast()?.register ?? []).filter((row) => row.kind === 'past') : []));
  readonly groups = computed(() => { const f = this.forecast(); return f ? registerGroups(f, this.filter(), this.period()) : []; });

  /* buffer popover */
  readonly bufferOpen = signal(false);
  readonly bufferDraft = signal('');
  readonly bufferError = signal<string | null>(null);
  readonly monthsOpen = signal(false);
  /** Set when a register row opens a container; used once the router has scrolled after that navigation. */
  private revealAfterScroll = false;

  constructor() {
    /* The router scrolls to the top after every navigation, so the sheet is revealed after that scroll. */
    this.router.events.pipe(filter((event) => event instanceof Scroll), takeUntilDestroyed()).subscribe(() => {
      if (!this.revealAfterScroll) return;
      this.revealAfterScroll = false;
      requestAnimationFrame(() => this.revealSide());
    });
  }

  isOpen(key: string): boolean {
    if (this.filter() !== 'all' || this.period()) return true;
    const opened = this.opened();
    return opened ? opened.has(key) : key === this.groups()[0]?.key;
  }

  toggleGroup(key: string): void {
    const current = new Set(this.opened() ?? (this.groups()[0] ? [this.groups()[0].key] : []));
    if (current.has(key)) current.delete(key); else current.add(key);
    this.opened.set(current);
  }

  tone(row: RegisterRow): string {
    return row.item ? KIND_TONE[row.item.kind] ?? '' : '';
  }

  signedEur(value: number): string {
    return value > 0 ? `+ ${eur(value)}` : eur(value);
  }

  isAdjusted(source: ScenarioSource): boolean {
    return typeof source.id === 'number' && adjusted(this.state.storedFor(source.id));
  }

  toggleSource(source: ScenarioSource, on: boolean): void {
    if (source.id === 'stock') this.state.setStock(on);
    else this.state.changeChoice(source.id, { included: on });
  }

  openSource(source: ScenarioSource): void {
    if (typeof source.id === 'number') this.state.openPo(source.id);
    else if (source.products?.length) this.drill.open([cashStockPlanView(source, this.drillContext)]);
  }

  toggleRule(rule: RuleSwitch): void {
    this.state.toggleRule(rule.rule as ForecastRule);
  }

  /* drill-downs (design/analyses2 §B.8): the dialog renders at page level, outside this size container */
  private readonly drillContext: CashDrillContext = { day: dayMon, whole: eurWhole, itemLink, lineLink, openPo: (orderId) => this.openContainer(orderId) };

  openKpi(card: KpiCard): void {
    const f = this.forecast();
    if (!f) return;
    if (card.id === 'lowest') this.drill.open([cashLowestView(f, this.drillContext)]);
    else if (card.id === 'zero') this.drill.open([cashCommittedView(f, this.drillContext)]);
    else if (card.id === 'end') this.showMonths();
  }

  /** "Op {d}": Per maand under the chart, opened and brought into view. */
  showMonths(): void {
    this.monthsOpen.set(true);
    this.scrollTo('.cf-months-wrap');
  }

  openRule(rule: RuleSwitch): void {
    const f = this.forecast();
    if (f) this.drill.open([cashRuleView(f, rule, this.drillContext)]);
  }

  openScenarioSales(): void {
    const f = this.forecast();
    if (f) this.drill.open([cashScenarioSalesView(f, this.drillContext)]);
  }

  /** The reconciliation line "Lijkt al betaald (niet dubbel geteld)". */
  likelyLine(label: string): boolean {
    return label.startsWith('Lijkt al betaald');
  }

  openLikelyPaid(lineEur: number): void {
    const f = this.forecast();
    if (f) this.drill.open([cashLikelyPaidView(f, lineEur, this.drillContext)]);
  }

  openRow(row: RegisterRow): void {
    const link: CashLink | null = row.kind === 'past' ? (row.lineId !== null ? lineLink(row.lineId) : null) : row.item ? itemLink(row.item) : null;
    if (!link) return;
    if (link.po !== null) { this.openContainer(link.po); return; }
    void this.router.navigate(link.path, link.query ? { queryParams: link.query } : {});
  }

  /** A container's sheet in the side column, brought into view when the page is narrow. */
  private openContainer(orderId: number): void {
    if (this.location().po === orderId) this.revealSide();
    else { this.revealAfterScroll = true; this.state.openPo(orderId); }
  }

  /**
   * A container opened from the register on a narrow page: its sheet sits beside the chart there, above the
   * register and not sticky, so it is brought into view when it is not fully in sight.
   */
  private revealSide(): void {
    const side = this.host.nativeElement.querySelector<HTMLElement>('.cf-side');
    if (!side || getComputedStyle(side).position === 'sticky') return;
    const rect = side.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > innerHeight) side.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  showPeriod(from: Iso, to: Iso): void {
    this.filter.set('all');
    this.period.set({ from, to });
    this.scrollTo('.cf-register');
  }

  /** A day on the chart: the register opens its month and shows the first row from that day. */
  focusDay(day: Iso): void {
    const f = this.forecast();
    if (!f) return;
    this.filter.set('all');
    this.period.set(null);
    const row = day < f.today ? f.register.filter((candidate) => candidate.kind === 'past' && candidate.date <= day).pop()
      : f.register.find((candidate) => candidate.kind === 'future' && candidate.date >= day);
    if (!row) return;
    if (row.kind === 'future') this.opened.update((opened) => new Set([...(opened ?? this.groups().slice(0, 1).map((group) => group.key)), row.monthKey]));
    this.flash.set(row.key);
    this.scrollTo(`[id="cf-row-${row.key}"]`);
    setTimeout(() => { if (this.flash() === row.key) this.flash.set(null); }, 2400);
  }

  /** "Datum" of a data-quality line: the container's sheet, scrolled to "Vertrek". */
  openDeparture(orderId: number): void {
    this.state.openPo(orderId);
    setTimeout(() => this.host.nativeElement.querySelector('#cf-po-departure')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
  }

  focusPin(n: number): void {
    const pin = this.forecast()?.pins.find((row) => row.n === n);
    if (pin) this.focusDay(pin.from);
  }

  focusMonth(key: string): void {
    const f = this.forecast();
    if (!f) return;
    const first = f.register.find((row) => row.kind === 'future' && row.monthKey === key);
    if (first) this.focusDay(first.date);
  }

  toggleBuffer(): void {
    this.bufferDraft.set(amountText(this.buffer()));
    this.bufferError.set(null);
    this.bufferOpen.set(!this.bufferOpen());
  }

  typeBuffer(value: string): void {
    this.bufferDraft.set(value);
    this.bufferError.set(null);
  }

  /** Any amount in Dutch or plain form; an empty or unreadable field is refused here, never saved as € 0. */
  async saveBuffer(): Promise<void> {
    const value = parseAmount(this.bufferDraft());
    if (value === null) { this.bufferError.set('Geef een bedrag'); return; }
    if (await this.state.saveBuffer(Math.round(value * 100) / 100)) this.bufferOpen.set(false);
  }

  async resetBuffer(): Promise<void> {
    if (await this.state.saveBuffer(null)) this.bufferOpen.set(false);
  }

  downloadCsv(): void {
    const f = this.forecast();
    if (!f) return;
    const rows = [...this.pastRows(), ...this.groups().flatMap((group) => group.rows)];
    const blob = new Blob([`﻿${registerCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kasprognose-${f.today}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private scrollTo(selector: string): void {
    afterNextRender(() => {
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, { injector: this.injector });
  }
}
