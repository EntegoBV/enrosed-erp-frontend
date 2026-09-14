import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { GoogleAnalyticsSource, GoogleSearchData, SearchPerformance } from '../../core/api/analytics-api';
import { googleDate, googleMetric, googlePageLabel, googlePercentage, googleTimeline, visibleGoogleData } from './google-analytics-display';
import { deriveSearchConsoleInsights, searchInsightPriorityLabel } from './search-console-insights';

type SearchMetric = 'clicks' | 'impressions';
type SearchSort = 'clicks' | 'impressions' | 'ctr' | 'position';

@Component({
  selector: 'app-search-console-report',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as d) {
      <div class="sc-report">
        <div class="sc-kpis">
          <article class="sc-kpi sc-kpi--clicks"><span>Klikken</span><strong>{{ metric(d.totals.clicks) }}</strong><small>Van Google naar je website</small>@if (insights().trend; as trend) { <span class="sc-change" [class.sc-change--up]="trend.clicks.delta > 0">{{ countChange(trend.clicks) }}</span><small>Vorige periode: {{ metric(trend.clicks.previous) }}</small> }</article>
          <article class="sc-kpi sc-kpi--impressions"><span>Vertoningen</span><strong>{{ metric(d.totals.impressions) }}</strong><small>Getoond in zoekresultaten</small>@if (insights().trend; as trend) { <span class="sc-change" [class.sc-change--up]="trend.impressions.delta > 0">{{ countChange(trend.impressions) }}</span><small>Vorige periode: {{ metric(trend.impressions.previous) }}</small> }</article>
          <article class="sc-kpi"><span>Klikratio</span><strong>{{ d.totals.impressions > 0 ? percentage(d.totals.ctr) : '—' }}</strong><small>Deel dat doorklikt</small>@if (insights().trend; as trend) { <span class="sc-change" [class.sc-change--up]="(trend.ctr.percentagePoints ?? 0) > 0">{{ signed(trend.ctr.percentagePoints, 2) }} procentpunt</span><small>Vorige periode: {{ trend.impressions.previous > 0 ? percentage(trend.ctr.previous) : '—' }}</small> }</article>
          <article class="sc-kpi"><span>Gemiddelde positie</span><strong>{{ d.totals.impressions > 0 ? metric(d.totals.position, 1) : '—' }}</strong><small>Lager is beter · geen vaste ranking</small>@if (insights().trend; as trend) { <span class="sc-change" [class.sc-change--up]="trend.position.direction === 'better'">{{ signed(trend.position.delta, 1) }} positie</span><small>Vorige periode: {{ trend.impressions.previous > 0 && trend.position.previous > 0 ? metric(trend.position.previous, 1) : '—' }}</small> }</article>
        </div>

        @if (insights().trend; as trend) {
          <p class="sc-comparison">Vergeleken met {{ date(trend.previousFrom) }} – {{ date(trend.previousTo) }}: de aansluitende periode van evenveel dagen.</p>
        } @else {
          <p class="sc-comparison">{{ d.comparison?.message || 'Er is geen bruikbare vergelijking met de vorige periode beschikbaar.' }}</p>
        }
        @if (d.issues?.length) {
          <div class="sc-partial" role="status"><div><b>Een deel van het rapport ontbreekt</b><p>De beschikbare totalen blijven zichtbaar. Ontbrekende onderdelen worden hieronder gemarkeerd.</p></div><button type="button" (click)="reloadRequested.emit()">Opnieuw ophalen</button></div>
        }

        <section class="sc-card sc-trend" aria-labelledby="sc-trend-title">
          <div class="sc-section-head"><div><span class="sc-eyebrow">Door de tijd</span><h4 id="sc-trend-title">Zoekprestaties</h4></div>
            <div class="sc-segmented" role="group" aria-label="Cijfer in de grafiek">
              <button type="button" [attr.aria-pressed]="chartMetric() === 'clicks'" (click)="chartMetric.set('clicks')">Klikken</button>
              <button type="button" [attr.aria-pressed]="chartMetric() === 'impressions'" (click)="chartMetric.set('impressions')">Vertoningen</button>
            </div>
          </div>
          @if (issueMessage('PER_DAY'); as issue) { <p class="sc-empty">Dagverdeling niet beschikbaar. {{ issue }}</p> }
          @else if (timeline().length) {
            <div class="sc-chart" [class.sc-chart--impressions]="chartMetric() === 'impressions'">
              <svg viewBox="0 0 600 150" preserveAspectRatio="none" role="img" [attr.aria-label]="chartLabel()">
                <path class="sc-chart__grid" d="M 0 10 H 600 M 0 75 H 600 M 0 140 H 600" />
                <path class="sc-chart__line" [attr.d]="chartPath()" />
                @for (point of observedPoints(); track point.x) { <ellipse class="sc-chart__sample" [attr.cx]="point.x" [attr.cy]="point.y" rx="2" ry="2" /> }
                @if (selectedPoint(); as point) {
                  <path class="sc-chart__guide" [attr.d]="'M ' + point.x + ' 8 V 142'" />
                  <ellipse class="sc-chart__point" [attr.cx]="point.x" [attr.cy]="point.y" rx="5" ry="4" />
                }
              </svg>
              <label class="sc-sr-only" for="sc-chart-day">Kies een dag in de grafiek</label>
              <input id="sc-chart-day" class="sc-chart__range" type="range" min="0" [max]="timeline().length - 1" step="1" [value]="selectedDayIndex()" [attr.aria-valuetext]="selectedDayLabel()" (input)="selectDay($any($event.target).value)" />
              <div class="sc-chart__axis"><span>{{ date(source().from) }}</span><span>{{ date(source().to) }}</span></div>
            </div>
            @if (selectedDay(); as day) {
              <div class="sc-day" aria-live="polite" aria-atomic="true"><b>{{ date(day.date) }}</b><span>{{ day.value === null ? 'Geen daggegevens beschikbaar' : metric(day.value) + (chartMetric() === 'clicks' ? ' klikken' : ' vertoningen') }}</span></div>
            }
            <p class="sc-caption">Sleep om een dag te bekijken. Ontbrekende daggegevens worden niet als nul ingevuld.</p>
          } @else { <p class="sc-empty">Voor deze periode is geen bruikbare dagverdeling beschikbaar.</p> }
        </section>

        <section class="sc-observation" aria-labelledby="sc-observation-title">
          <div class="sc-section-head"><div><span class="sc-eyebrow">Van cijfers naar keuzes</span><h4 id="sc-observation-title">Wat valt op</h4></div>
            @if (insights().lowVolume) { <span class="sc-tag">Nog weinig gegevens</span> }
          </div>
          <p>{{ insights().summary }}</p>
        </section>

        @if (insights().insights.length) {
          <section class="sc-actions" aria-labelledby="sc-actions-title">
            <div class="sc-section-head"><h4 id="sc-actions-title">Jouw aandachtspunten</h4><span class="sc-caption">Op volgorde van aandacht</span></div>
            @for (item of insights().insights; track item.id; let index = $index) {
              <details class="sc-action" [class.sc-action--focus]="item.priority === 'focus'">
                <summary><span class="sc-action__number" aria-hidden="true">{{ index + 1 }}</span><span><small>{{ priorityLabel(item.priority) }}</small><b>{{ item.title }}</b></span><span class="sc-chevron" aria-hidden="true">⌄</span></summary>
                <div class="sc-action__body"><p>{{ item.explanation }}</p><ul>@for (evidence of item.evidence; track $index) { <li>{{ evidence }}</li> }</ul>
                  @if (item.action.routerLink) { <a class="sc-action__link" [routerLink]="item.action.routerLink">{{ item.action.label }} <span aria-hidden="true">↗</span></a> }
                  @else if (item.action.href) { <a class="sc-action__link" [href]="item.action.href" target="_blank" rel="noopener noreferrer">{{ item.action.label }} <span aria-hidden="true">↗</span><span class="sc-sr-only"> (nieuw tabblad)</span></a> }
                  @else { <p class="sc-action__next"><b>Volgende stap</b>{{ item.action.label }}</p> }
                </div>
              </details>
            }
          </section>
        }

        <div class="sc-details-grid">
          <details class="sc-card sc-breakdown">
            <summary><span><b>Zoekopdrachten</b><small>{{ issueMessage('QUERIES') ? 'Tijdelijk niet beschikbaar' : metric(d.queries.length) + ' gerapporteerde zoektermen' }}</small></span><span class="sc-chevron" aria-hidden="true">⌄</span></summary>
            <div class="sc-tools"><label>Zoeken<input type="search" placeholder="Zoek een zoekterm" [value]="queryFilter()" (input)="queryFilter.set($any($event.target).value)" /></label><label>Sorteren<select [value]="querySort()" (change)="setSort('query', $any($event.target).value)"><option value="clicks">Meeste klikken</option><option value="impressions">Meeste vertoningen</option><option value="ctr">Hoogste klikratio</option><option value="position">Beste gemiddelde positie</option></select></label></div>
            @if (issueMessage('QUERIES'); as issue) { <p class="sc-empty">Zoekopdrachten niet beschikbaar. {{ issue }}</p> }
            <ol class="sc-rows">
              @for (query of queryRows(); track query.query) { <li><b class="sc-rows__name" [title]="query.query">{{ query.query }}</b><dl><div><dt>Klikken</dt><dd>{{ metric(query.clicks) }}</dd></div><div><dt>Vertoningen</dt><dd>{{ metric(query.impressions) }}</dd></div><div><dt>CTR</dt><dd>{{ query.impressions > 0 ? percentage(query.ctr) : '—' }}</dd></div><div><dt>Positie</dt><dd>{{ query.impressions > 0 ? metric(query.position, 1) : '—' }}</dd></div></dl></li> }
              @empty { <li class="sc-empty">{{ issueMessage('QUERIES') ? 'De lijst kan nu niet worden getoond.' : queryFilter() ? 'Geen zoekterm komt overeen met je zoekopdracht.' : 'Google geeft voor deze periode geen afzonderlijke zoekopdrachten terug.' }}</li> }
            </ol>
            <p class="sc-caption">Alleen de door Google gerapporteerde zoektermen. Afgeschermde en ontbrekende zoektermen tellen niet mee in deze lijst.</p>
          </details>
          <details class="sc-card sc-breakdown">
            <summary><span><b>Pagina’s in Google</b><small>{{ issueMessage('PAGES') ? 'Tijdelijk niet beschikbaar' : metric(d.pages.length) + ' gerapporteerde pagina’s' }}</small></span><span class="sc-chevron" aria-hidden="true">⌄</span></summary>
            <div class="sc-tools"><label>Zoeken<input type="search" placeholder="Zoek een paginapad" [value]="pageFilter()" (input)="pageFilter.set($any($event.target).value)" /></label><label>Sorteren<select [value]="pageSort()" (change)="setSort('page', $any($event.target).value)"><option value="clicks">Meeste klikken</option><option value="impressions">Meeste vertoningen</option><option value="ctr">Hoogste klikratio</option><option value="position">Beste gemiddelde positie</option></select></label></div>
            @if (issueMessage('PAGES'); as issue) { <p class="sc-empty">Paginaverdeling niet beschikbaar. {{ issue }}</p> }
            <ol class="sc-rows">
              @for (page of pageRows(); track page.page) { <li><b class="sc-rows__name" [title]="pageLabel(page.page)">{{ pageLabel(page.page) }}</b><dl><div><dt>Klikken</dt><dd>{{ metric(page.clicks) }}</dd></div><div><dt>Vertoningen</dt><dd>{{ metric(page.impressions) }}</dd></div><div><dt>CTR</dt><dd>{{ page.impressions > 0 ? percentage(page.ctr) : '—' }}</dd></div><div><dt>Positie</dt><dd>{{ page.impressions > 0 ? metric(page.position, 1) : '—' }}</dd></div></dl></li> }
              @empty { <li class="sc-empty">{{ issueMessage('PAGES') ? 'De lijst kan nu niet worden getoond.' : pageFilter() ? 'Geen pagina komt overeen met je zoekopdracht.' : 'Google geeft voor deze periode geen afzonderlijke pagina’s terug.' }}</li> }
            </ol>
            <p class="sc-caption">Dit is de gerapporteerde selectie, geen overzicht van alle geïndexeerde pagina’s. Verschillende hostnamen blijven apart herkenbaar.</p>
          </details>
        </div>

        <div class="sc-details-grid">
          <details class="sc-card sc-breakdown">
            <summary><span><b>Talen van pagina’s</b><small>Afgeleid van gerapporteerde URL’s</small></span><span class="sc-chevron" aria-hidden="true">⌄</span></summary>
            <ol class="sc-rows sc-language-rows">
              @for (language of insights().languages; track language.locale) {
                <li><b class="sc-rows__name">{{ language.label }}</b>
                  @if (language.coverage === 'reported-pages') { <dl><div><dt>Klikken</dt><dd>{{ metric(language.clicks) }}</dd></div><div><dt>Vertoningen</dt><dd>{{ metric(language.impressions) }}</dd></div><div><dt>Pagina’s</dt><dd>{{ metric(language.reportedPages) }}</dd></div><div><dt>CTR</dt><dd>{{ percentage(language.ctr) }}</dd></div></dl> }
                  @else { <p class="sc-caption">Niet afzonderlijk gerapporteerd</p> }
                </li>
              }
            </ol>
            <p class="sc-caption">Alleen herkenbare taalpaden in de gerapporteerde pagina’s. Dit meet geen land of taal van bezoekers. Niet gerapporteerd betekent niet nul verkeer.</p>
          </details>
          <details class="sc-card sc-breakdown">
            <summary><span><b>Apparaten</b><small>Waarop je zoekresultaten verschijnen</small></span><span class="sc-chevron" aria-hidden="true">⌄</span></summary>
            @if (d.devices?.status === 'ERROR') { <p class="sc-empty">{{ d.devices?.message || 'De apparaatverdeling is tijdelijk niet beschikbaar.' }}</p> }
            @else if (d.devices?.rows; as rows) {
              <ol class="sc-rows">
                @for (device of rows; track device.device) { <li><b class="sc-rows__name">{{ deviceLabel(device.device) }}</b><dl><div><dt>Klikken</dt><dd>{{ metric(device.clicks) }}</dd></div><div><dt>Vertoningen</dt><dd>{{ metric(device.impressions) }}</dd></div><div><dt>CTR</dt><dd>{{ device.impressions > 0 ? percentage(device.ctr) : '—' }}</dd></div><div><dt>Positie</dt><dd>{{ device.impressions > 0 ? metric(device.position, 1) : '—' }}</dd></div></dl></li> }
                @empty { <li class="sc-empty">Geen apparaatverdeling gerapporteerd.</li> }
              </ol>
            } @else { <p class="sc-empty">Voor deze periode is geen apparaatverdeling beschikbaar.</p> }
          </details>
        </div>

        <details class="sc-card sc-breakdown sc-method">
          <summary><span><b>Over deze cijfers</b><small>Periode, dekking en verwerking</small></span><span class="sc-chevron" aria-hidden="true">⌄</span></summary>
          <p>Dit zijn zoekprestaties, geen bezoekersaantallen. De totalen komen rechtstreeks van Google en zijn niet de optelsom van de beperkte lijsten in dit rapport.</p>
          <p>Property: <b>{{ source().property }}</b> · Rapporttijdzone: {{ d.timeZone }}.</p>
          <p>{{ d.periodBasis === 'GOOGLE_FINAL_BOUNDARY' ? 'Definitieve rapportgrens' : 'Laatste gerapporteerde definitieve dag' }}: {{ date(d.availableThrough) }}.</p>
          @for (limitation of insights().limitations; track $index) { <p>{{ limitation }}</p> }
          @for (warning of d.warnings; track $index) { <p>{{ warning }}</p> }
        </details>
      </div>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .sc-report { --sc-blue: #376ba9; --sc-purple: #7960b1; display: grid; gap: 16px; min-width: 0; }
    .sc-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .sc-kpi { display: grid; gap: 7px; align-content: start; min-width: 0; padding: 18px; border: 1px solid var(--line); border-radius: 21px; background: var(--surface); }
    .sc-kpi > span { font-size: 12px; color: var(--muted); }
    .sc-kpi > strong { font-size: clamp(26px, 3vw, 35px); letter-spacing: -.045em; line-height: 1.12; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .sc-kpi > small { color: var(--muted); font-size: 10px; line-height: 1.5; }
    .sc-kpi > .sc-change { margin-top: 3px; font-size: 12px; font-weight: 650; color: var(--muted); }
    .sc-kpi > .sc-change--up { color: var(--ok); }
    .sc-comparison { margin: -4px 2px 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
    .sc-partial { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 15px 16px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 17px; font-size: 12px; }
    .sc-partial > div { flex: 1; min-width: 180px; }
    .sc-partial p { margin: 4px 0 0; color: var(--muted); line-height: 1.6; }
    .sc-partial button { min-height: 44px; padding: 0 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); color: var(--sc-blue); font: inherit; cursor: pointer; }
    .sc-kpi--clicks { border-top: 3px solid var(--sc-blue); }
    .sc-kpi--impressions { border-top: 3px solid var(--sc-purple); }
    .sc-card { min-width: 0; padding: 20px; border: 1px solid var(--line); border-radius: 22px; background: var(--surface); }
    .sc-section-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
    .sc-section-head h4 { margin: 0; font-size: 16px; letter-spacing: -.02em; }
    .sc-eyebrow { display: block; margin-bottom: 4px; font-size: 10px; font-weight: 650; color: var(--muted); }
    .sc-segmented { display: flex; padding: 3px; border: 1px solid var(--line); border-radius: 14px; background: color-mix(in srgb, var(--surface-2) 85%, transparent); }
    .sc-segmented button { min-height: 40px; padding: 0 14px; border: 0; border-radius: 11px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
    .sc-segmented button[aria-pressed=true] { background: var(--surface); color: var(--sc-blue); box-shadow: 0 1px 5px #0000000d; }
    .sc-chart { position: relative; margin-top: 20px; color: var(--sc-blue); }
    .sc-chart--impressions { color: var(--sc-purple); }
    .sc-chart svg { display: block; width: 100%; height: 155px; overflow: visible; }
    .sc-chart__grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 3 5; fill: none; }
    .sc-chart__line { stroke: currentColor; stroke-width: 2.5; fill: none; vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round; }
    .sc-chart__guide { stroke: currentColor; stroke-width: 1; stroke-dasharray: 3 4; fill: none; opacity: .4; }
    .sc-chart__sample { fill: currentColor; }
    .sc-chart__point { fill: currentColor; stroke: var(--surface); stroke-width: 2; vector-effect: non-scaling-stroke; }
    .sc-chart__range { display: block; width: 100%; height: 44px; margin: 0; accent-color: var(--sc-blue); cursor: pointer; }
    .sc-chart--impressions .sc-chart__range { accent-color: var(--sc-purple); }
    .sc-chart__axis { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 10px; }
    .sc-day { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 15px; padding: 12px 14px; border-radius: 13px; background: var(--surface-2); font-size: 12px; font-variant-numeric: tabular-nums; }
    .sc-day > span { color: var(--muted); }
    .sc-caption { margin: 12px 0 0; color: var(--muted); font-size: 11px; line-height: 1.65; }
    .sc-section-head > .sc-caption { margin: 0; }
    .sc-observation { padding: 4px 2px; }
    .sc-observation > p { margin: 10px 0 0; font-size: 14px; line-height: 1.7; max-width: 80ch; }
    .sc-tag { display: inline-flex; padding: 6px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); background: var(--surface-2); font-size: 10px; }
    .sc-actions { display: grid; gap: 10px; }
    .sc-actions > .sc-section-head { padding: 2px; }
    .sc-action { border: 1px solid var(--line); border-radius: 19px; background: var(--surface); overflow: hidden; }
    .sc-action--focus { border-color: color-mix(in srgb, var(--sc-blue) 27%, var(--line)); }
    .sc-action > summary { display: flex; align-items: center; gap: 12px; min-height: 76px; padding: 14px 16px; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    .sc-action__number { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 11px; background: var(--surface-2); color: var(--muted); font-size: 12px; font-weight: 700; }
    .sc-action--focus .sc-action__number { background: color-mix(in srgb, var(--sc-blue) 10%, var(--surface)); color: var(--sc-blue); }
    .sc-action summary > span:nth-child(2) { min-width: 0; }
    .sc-action summary small { display: block; margin-bottom: 4px; color: var(--muted); font-size: 10px; }
    .sc-action summary b { display: block; font-size: 13px; line-height: 1.5; }
    .sc-chevron { margin-left: auto; flex: none; color: var(--muted); font-size: 18px; }
    details[open] > summary > .sc-chevron { transform: rotate(180deg); }
    .sc-action__body { padding: 0 16px 17px; border-top: 1px solid var(--line); }
    .sc-action__body p, .sc-action__body li { color: var(--muted); font-size: 12px; line-height: 1.65; }
    .sc-action__body ul { padding-left: 18px; margin: 10px 0 14px; }
    .sc-action__body li + li { margin-top: 4px; }
    .sc-action__link { display: inline-flex; min-height: 44px; align-items: center; gap: 8px; padding: 0 13px; border-radius: 12px; background: color-mix(in srgb, var(--sc-blue) 9%, var(--surface)); color: var(--sc-blue); font-size: 12px; font-weight: 650; text-decoration: none; }
    .sc-action__next b { display: block; margin-bottom: 3px; color: var(--ink); }
    .sc-details-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
    .sc-breakdown > summary { display: flex; align-items: center; gap: 12px; min-height: 48px; cursor: pointer; list-style: none; }
    .sc-breakdown summary b { font-size: 14px; }
    .sc-breakdown summary small { display: block; margin-top: 5px; font-size: 10px; color: var(--muted); }
    .sc-tools { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; margin: 16px 0; }
    .sc-tools label { display: grid; gap: 5px; min-width: 0; font-size: 10px; color: var(--muted); }
    .sc-tools input, .sc-tools select { box-sizing: border-box; min-width: 0; width: 100%; min-height: 44px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; }
    .sc-rows { list-style: none; margin: 0; padding: 0; max-height: 430px; overflow-y: auto; overscroll-behavior: contain; }
    .sc-rows > li { padding: 13px 0; border-bottom: 1px solid var(--line); }
    .sc-rows > li:last-child { border-bottom: 0; }
    .sc-rows__name { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; font-size: 12px; line-height: 1.5; font-weight: 600; }
    .sc-rows dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; margin: 9px 0 0; }
    .sc-rows dt { color: var(--muted); font-size: 9px; }
    .sc-rows dd { margin: 3px 0 0; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .sc-empty { color: var(--muted); font-size: 12px; line-height: 1.6; }
    .sc-method p { color: var(--muted); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
    .sc-method p:last-child { margin-bottom: 0; }
    button:focus-visible, summary:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--sc-blue); outline-offset: 3px; }
    .sc-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    @media (max-width: 679px) {
      .sc-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
      .sc-kpi { padding: 14px; border-radius: 18px; }
      .sc-kpi > strong { font-size: 27px; }
      .sc-card { padding: 16px; border-radius: 20px; }
      .sc-segmented { width: 100%; }
      .sc-segmented button { flex: 1; min-height: 44px; }
      .sc-chart svg { height: 125px; }
      .sc-details-grid { grid-template-columns: 1fr; }
      .sc-tools { grid-template-columns: 1fr; }
      .sc-tools input, .sc-tools select { font-size: 16px; }
      .sc-action > summary { gap: 10px; padding: 13px; }
      .sc-action__body { padding-inline: 13px; }
    }
  `,
})
export class SearchConsoleReport {
  readonly source = input.required<GoogleAnalyticsSource<GoogleSearchData>>();
  readonly reloadRequested = output<void>();
  readonly data = computed(() => visibleGoogleData(this.source()));
  readonly insights = computed(() => deriveSearchConsoleInsights(this.source()));
  readonly chartMetric = signal<SearchMetric>('clicks');
  readonly dayIndex = signal<number | null>(null);
  readonly queryFilter = signal('');
  readonly pageFilter = signal('');
  readonly querySort = signal<SearchSort>('clicks');
  readonly pageSort = signal<SearchSort>('clicks');
  readonly timeline = computed(() => googleTimeline(this.source().from, this.source().to, this.data()?.perDay ?? [], day => day[this.chartMetric()]));
  readonly selectedDayIndex = computed(() => Math.max(0, Math.min(this.timeline().length - 1, this.dayIndex() ?? this.timeline().length - 1)));
  readonly selectedDay = computed(() => this.timeline()[this.selectedDayIndex()] ?? null);
  readonly chartMaximum = computed(() => Math.max(1, ...this.timeline().map(day => day.value ?? 0)));
  readonly observedPoints = computed(() => this.timeline().flatMap((day, index) => day.value === null ? [] : [this.chartPoint(index, day.value)]));
  readonly selectedPoint = computed(() => this.selectedDay()?.value === null || !this.selectedDay() ? null : this.chartPoint(this.selectedDayIndex(), this.selectedDay()!.value!));
  readonly chartPath = computed(() => {
    let start = true;
    return this.timeline().map((day, index) => {
      if (day.value === null) { start = true; return ''; }
      const point = this.chartPoint(index, day.value);
      const part = `${start ? 'M' : 'L'} ${point.x} ${point.y}`;
      start = false;
      return part;
    }).join(' ');
  });
  readonly selectedDayLabel = computed(() => {
    const day = this.selectedDay();
    return day ? `${googleDate(day.date)}: ${day.value === null ? 'geen gegevens' : googleMetric(day.value) + (this.chartMetric() === 'clicks' ? ' klikken' : ' vertoningen')}` : 'Geen daggegevens';
  });
  readonly chartLabel = computed(() => `${this.chartMetric() === 'clicks' ? 'Klikken' : 'Vertoningen'} vanuit Google per dag, ${googleDate(this.source().from)} tot ${googleDate(this.source().to)}. Kies een dag met de schuifregelaar.`);
  readonly queryRows = computed(() => this.sortedRows(this.issueMessage('QUERIES') ? [] : this.data()?.queries ?? [], 'query', this.queryFilter(), this.querySort()));
  readonly pageRows = computed(() => this.sortedRows(this.issueMessage('PAGES') ? [] : this.data()?.pages ?? [], 'page', this.pageFilter(), this.pageSort()));
  readonly metric = googleMetric;
  readonly percentage = googlePercentage;
  readonly date = googleDate;
  readonly pageLabel = googlePageLabel;
  readonly priorityLabel = searchInsightPriorityLabel;

  constructor() {
    effect(() => { this.source().from; this.source().to; this.dayIndex.set(null); });
  }

  signed(value: number | null, decimals = 1): string {
    if (value === null || !Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${googleMetric(Math.abs(value), decimals)}`;
  }

  countChange(change: { delta: number; percent: number | null }): string {
    return change.percent === null ? `${this.signed(change.delta, 0)} · vorige periode nul` : `${this.signed(change.percent, 1)} %`;
  }

  issueMessage(section: 'PER_DAY' | 'QUERIES' | 'PAGES'): string | null {
    return this.data()?.issues?.find(issue => issue.section === section)?.message ?? null;
  }

  deviceLabel(value: string): string {
    return ({ MOBILE: 'Mobiel', DESKTOP: 'Computer', TABLET: 'Tablet' } as Record<string, string>)[value.toUpperCase()] ?? value;
  }

  selectDay(raw: string): void {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= this.timeline().length) return;
    this.dayIndex.set(index);
  }

  chartPoint(index: number, value: number): { x: number; y: number } {
    return { x: this.timeline().length > 1 ? index / (this.timeline().length - 1) * 590 + 5 : 300, y: 140 - value / this.chartMaximum() * 130 };
  }

  setSort(kind: 'query' | 'page', value: string): void {
    if (!['clicks', 'impressions', 'ctr', 'position'].includes(value)) return;
    (kind === 'query' ? this.querySort : this.pageSort).set(value as SearchSort);
  }

  sortedRows<T extends SearchPerformance>(rows: readonly T[], key: keyof T, filter: string, sort: SearchSort): T[] {
    const label = (row: T) => key === 'page' ? googlePageLabel(String(row[key])) : String(row[key]);
    const needle = filter.trim().toLocaleLowerCase('nl-BE');
    return rows.filter(row => label(row).toLocaleLowerCase('nl-BE').includes(needle)).sort((a, b) => {
      const usable = (row: T) => Number.isFinite(row[sort]) && row[sort] >= 0
        && (!['position', 'ctr'].includes(sort) || row.impressions > 0)
        && (sort !== 'position' || row.position > 0);
      const aKnown = usable(a), bKnown = usable(b);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      const difference = aKnown ? (sort === 'position' ? a[sort] - b[sort] : b[sort] - a[sort]) : 0;
      return difference || label(a).localeCompare(label(b), 'nl-BE');
    });
  }
}
