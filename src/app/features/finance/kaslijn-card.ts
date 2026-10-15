import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CashChart } from '../../shared/cash-chart';
import type { CashChartMarker, CashChartSeries } from '../../shared/cash-chart';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { CERTAINTY_LABEL } from './cash-forecast';
import type { ForecastItem, LikelyPaidMatch } from './cash-forecast';
import { dayMon, dayMonth, eur, eurWhole, weekdayDayMonth } from './cash-format';
import { FinanceState } from './finance-state';

/**
 * The Kaslijn (spec-bank-forecast §3.3): the counted accounts four weeks back
 * and 4 / 8 / 13 weeks ahead, base items only (no sales: those live in
 * Analyses › Kasprognose), the buffer, the lowest point and the largest
 * outflow, and the double-count banner of a transaction that already paid an
 * open item. On a desk the three facts stand beside the chart; the Vooruitblik
 * equation is the cockpit rail's first card (the 1440×900 fold, spec §3.1); a
 * phone shows the three totals and "Vooruitblik ›".
 */
@Component({
  selector: 'app-kaslijn-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CashChart, Icon, EurPipe, Segmented],
  template: `
    @let k = state.kaslijn();
    @if (state.desk()) {
      <section class="wk-card fin-kaslijn" aria-labelledby="fin-kaslijn-title">
        <header class="fin-kaslijn__head">
          <h2 class="wk-card__title" id="fin-kaslijn-title">Kaslijn</h2>
          <span class="fin-kaslijn__sub">alle rekeningen die meetellen · 4 weken terug, {{ state.kaslijnWeeks() }} weken vooruit</span>
          <app-segmented label="Kaslijn" [options]="spans" [value]="'' + state.kaslijnWeeks()" (changed)="setWeeks($event)" />
          <button class="wk-link fin-kaslijn__more" type="button" (click)="toForecast()">Per dag in Kasprognose ›</button>
        </header>
        @if (banner(); as match) {
          <div class="fin-kaslijn__banner" role="status">
            <app-icon name="alert" [size]="15" />
            <span class="fin-kaslijn__banner-text" [attr.title]="bannerText(match)"><b>{{ eurOf(match.amountEur) }} telt mogelijk dubbel:</b> {{ bannerRest(match) }}</span>
            @if (k.likelyPaid.length > 1) { <button class="wk-link" type="button" (click)="others()">+ {{ k.likelyPaid.length - 1 }} andere</button> }
            <button class="wk-btn wk-btn--sm" type="button" (click)="state.dismiss(match.lineId + ':' + match.itemKey)">Niet deze</button>
            <button class="wk-btn wk-btn--sm wk-btn--primary" type="button" (click)="state.openLine(match.lineId)">Koppelen</button>
          </div>
        }
        <div class="fin-kaslijn__grid">
          <div class="fin-kaslijn__plot">
            <app-cash-chart variant="compact" [height]="160" [series]="series()" [today]="state.today()" [bufferEur]="k.bufferEur" [tight]="tight()"
                            [pins]="k.pins" [markers]="markers()" [dayDetail]="detail" ariaLabel="Kaslijn: saldo per dag" emptyText="Nog geen saldo om te tekenen" />
          </div>
          <dl class="fin-kaslijn__facts">
            <div><dt>Laagste stand</dt><dd><b>{{ eurOf(k.lowestBase.eur) }} · {{ weekday(k.lowestBase.day) }}</b>@if (k.lowestBase.causes[0]) { <small>na {{ k.lowestBase.causes[0] }}</small> }</dd></div>
            <div><dt>Onder buffer</dt><dd><b>{{ tightText() }}</b>
              @if (state.cashRound()) { <button class="wk-link" type="button" (click)="state.bufferOpen.set(true)">buffer {{ eurOf(k.bufferEur) }} · aanpassen</button> }
              @else { <small>buffer {{ eurOf(k.bufferEur) }}</small> }</dd></div>
            @if (largest(); as item) {
              <div><dt>Grootste uitgave</dt><dd><b>{{ eurOf(item.amountEur) }} · ± {{ mon(item.date) }}</b><small>{{ item.title }} ({{ certainty(item) }})</small></dd></div>
            } @else { <div><dt>Grootste uitgave</dt><dd><b>Geen</b><small>niets te betalen in deze periode</small></dd></div> }
          </dl>
        </div>
      </section>
    } @else {
      <section class="ios-card fin-kaslijn-phone" aria-label="Kaslijn">
        <div class="fin-kaslijn-phone__head"><h2>Kaslijn <small>· {{ state.kaslijnWeeks() }} weken</small></h2>
          <button class="ios-section__link" type="button" (click)="state.outlookOpen.set(true)">Vooruitblik ›</button></div>
        <app-cash-chart variant="compact" [height]="150" [series]="series()" [today]="state.today()" [bufferEur]="k.bufferEur" [tight]="tight()"
                        [pins]="[]" [markers]="markers()" ariaLabel="Kaslijn: saldo per dag" />
        @if (banner(); as match) {
          <button class="fin-kaslijn-phone__banner" type="button" (click)="state.openLine(match.lineId)"><app-icon name="alert" [size]="15" />
            <span><b>{{ eurOf(match.amountEur) }} telt mogelijk dubbel</b> tot je {{ match.counterparty || 'deze transactie' }} van {{ dayShort(match.day) }} koppelt.</span></button>
        }
        <dl class="fin-kaslijn-phone__rows">
          <div><dt>Laagste stand · {{ weekday(k.lowestBase.day) }}</dt><dd>{{ eurOf(k.lowestBase.eur) }}</dd></div>
          @if (hasReading()) {
            <div><dt>Na wat nu betaald moet worden</dt><dd>{{ eurOf(state.outlook().afterPayablesEur) }}</dd></div>
            <div><dt>Als alles betaald en ontvangen is</dt><dd>{{ eurOf(state.outlook().expectedEur) }}</dd></div>
          } @else { <div><dt>Netto open positie</dt><dd>{{ state.outlook().netOpenEur | eur }}</dd></div> }
        </dl>
      </section>
    }
  `,
})
export class KaslijnCard {
  readonly state = inject(FinanceState);
  private readonly router = inject(Router);
  readonly spans: SegmentOption[] = [{ id: '4', label: '4 w' }, { id: '8', label: '8 w' }, { id: '13', label: '13 w' }];

  readonly hasReading = computed(() => this.state.bankLedger().accounts.some((account) => account.currentEur !== null));
  /** The bank so far (to today's start) solid, then what is fixed or expected dashed. */
  readonly series = computed<CashChartSeries[]>(() => {
    const k = this.state.kaslijn();
    const past = [...k.past, { day: k.today, eur: k.mode === 'absolute' ? k.startEur : null }];
    return [
      { id: 'past', label: 'Saldo uit transacties', style: 'solid', tone: 'accent', points: past },
      { id: 'base', label: 'Verwacht (open facturen, kosten, termijnen, btw)', style: 'dashed', tone: 'muted', points: k.days.map((day) => ({ day: day.day, eur: day.baseEur })) },
    ];
  });
  readonly markers = computed<CashChartMarker[]>(() => {
    const k = this.state.kaslijn();
    const last = k.days[k.days.length - 1];
    return [
      { day: k.lowestBase.day, eur: k.lowestBase.eur, kind: 'lowest', label: `Laagste ${eurWhole(k.lowestBase.eur)}` },
      ...(last ? [{ day: last.day, eur: last.baseEur, kind: 'end' as const, label: `Verwacht ${eurWhole(last.baseEur)}` }] : []),
    ];
  });
  readonly tight = computed(() => this.state.kaslijn().tightWith.map((period) => ({ from: period.from, to: period.to })));
  readonly tightText = computed(() => {
    const first = this.state.kaslijn().tightWith[0];
    return first ? `${dayMon(first.from)}–${dayMon(first.to)}` : 'geen week';
  });
  /** The most negative item of the window. */
  readonly largest = computed<ForecastItem | null>(() => this.state.kaslijn().items.filter((item) => item.amountEur < 0)
    .reduce<ForecastItem | null>((worst, item) => (!worst || item.amountEur < worst.amountEur ? item : worst), null));
  readonly banner = computed<LikelyPaidMatch | null>(() => this.state.kaslijn().likelyPaid[0] ?? null);
  /** A day's items under the chart's tooltip. */
  readonly detail = (day: string): string[] => this.state.kaslijn().items.filter((item) => item.date === day)
    .map((item) => `${item.title} ${eur(item.amountEur)}`).slice(0, 4);

  setWeeks(value: string): void {
    const weeks = Number(value);
    this.state.go({ weeks: weeks === 4 || weeks === 13 ? weeks : null });
  }
  toForecast(): void { void this.router.navigate(['/analyses/cash']); }
  others(): void { this.state.go({ view: 'bank', tab: 'movements', link: 'unlinked', dir: '', account: '', q: '', period: 'all', from: '', to: '' }, 'push'); }

  /** "{counterparty} staat op {dd/mm} al op {account}, {item title} staat nog open. Tot je koppelt, telt de kaslijn hem als betaald." */
  bannerRest(match: LikelyPaidMatch): string {
    return `${match.counterparty || 'Een transactie'} staat op ${dayMonth(match.day)} al op ${match.account}, ${match.title} staat nog open. Tot je koppelt, telt de kaslijn hem als betaald.`;
  }
  bannerText(match: LikelyPaidMatch): string { return `${this.eurOf(match.amountEur)} telt mogelijk dubbel: ${this.bannerRest(match)}`; }
  eurOf(value: number): string { return eur(value); }
  weekday(day: string): string { return weekdayDayMonth(day); }
  mon(day: string): string { return dayMon(day); }
  dayShort(day: string): string { return dayMonth(day); }
  certainty(item: ForecastItem): string { return CERTAINTY_LABEL[item.certainty].toLowerCase(); }
}
