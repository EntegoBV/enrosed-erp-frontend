import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { messageOf } from '../../core/api/errors';
import { Fx } from '../../core/api/fx';
import type { FreightRate, MarketSourceStatus } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Icon } from '../../shared/icon';
import { NumPipe } from '../../shared/pipes';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { Sheet, Ui } from '../../shared/ui';
import {
  DatedSeries, FxInsight, MONTH_OPTIONS, Months, SeriesSummary, changeOverMonths, crossOf, freightNarrative, fxInsight,
  invert, lastStep, periodWords, shortDate, sparseHorizons, summarize, weeklyRows, windowOf,
} from './market-math';

type PairId = 'usd' | 'cny' | 'cross';

interface PairDefinition {
  id: PairId;
  base: string;
  quote: string;
  baseName: string;
  quoteName: string;
}

interface PairView extends PairDefinition {
  from: string;
  to: string;
  flipped: boolean;
  latest: number;
  full: DatedSeries;
  window: DatedSeries;
  chart: TrendSeries[];
  change: { pct: number; since: string } | null;
  tone: 'ok' | 'warn' | 'neutral';
  word: string;
  summary: SeriesSummary | null;
  horizons: { label: string; months: Months; pct: number | null; tone: 'ok' | 'warn' | 'neutral' }[];
}

interface FreightDefinition {
  code: string;
  label: string;
  short: string;
  /** Who publishes it, as the tile's second line. */
  source: string;
  /** One plain sentence on what the number covers, shown above the chart. */
  describe: string;
  group: 'own' | 'usd' | 'index';
  unit: 'usd' | 'points';
}

interface HistoryRow {
  rate: FreightRate;
  stepPct: number | null;
}

const PAIRS: readonly PairDefinition[] = [
  { id: 'usd', base: 'EUR', quote: 'USD', baseName: 'euro', quoteName: 'dollar' },
  { id: 'cny', base: 'EUR', quote: 'CNY', baseName: 'euro', quoteName: 'yuan' },
  { id: 'cross', base: 'USD', quote: 'CNY', baseName: 'dollar', quoteName: 'yuan' },
];

const FREIGHT: readonly FreightDefinition[] = [
  { code: 'NINGBO', label: 'Ningbo → Rotterdam', short: 'Ningbo → Rotterdam', source: 'onze forwarder',
    describe: 'Wat onze forwarder ons offreert voor een 40ft-container van Ningbo tot Rotterdam, all-in zeevracht.',
    group: 'own', unit: 'usd' },
  { code: 'GUANGZHOU', label: 'Nansha (Guangzhou) → Rotterdam', short: 'Nansha → Rotterdam', source: 'onze forwarder',
    describe: 'Wat onze forwarder ons offreert voor een 40ft-container van Nansha (Guangzhou) tot Rotterdam.',
    group: 'own', unit: 'usd' },
  { code: 'SHENZHEN', label: 'Yantian (Shenzhen) → Rotterdam', short: 'Yantian → Rotterdam', source: 'onze forwarder',
    describe: 'Wat onze forwarder ons offreert voor een 40ft-container van Yantian (Shenzhen) tot Rotterdam.',
    group: 'own', unit: 'usd' },
  { code: 'WCI SHA-RTM', label: 'Shanghai → Rotterdam', short: 'Shanghai → Rotterdam', source: 'Drewry WCI',
    describe: 'Spotprijs in USD per 40ft van Shanghai naar Rotterdam, wekelijks door Drewry. Dit is de prijs om naast onze offertes te leggen.',
    group: 'usd', unit: 'usd' },
  { code: 'FBX11 CN-NEUR', label: 'China → Noord-Europa', short: 'China → Noord-Europa', source: 'Freightos FBX11',
    describe: 'Spotprijs in USD per 40ft van China en Oost-Azië naar de Noord-Europese havens (Rotterdam, Antwerpen, Hamburg, Felixstowe), wekelijks door Freightos.',
    group: 'usd', unit: 'usd' },
  { code: 'NCFI NGB-EUR', label: 'Ningbo → Europa', short: 'Ningbo → Europa', source: 'NCFI · Ningbo Exchange',
    describe: 'Index van de vracht vanuit Ningbo-Zhoushan naar de Europese basishavens Hamburg en Rotterdam. De exacte route van onze containers, in punten.',
    group: 'index', unit: 'points' },
  { code: 'NCFI NINGBO', label: 'Ningbo → alle routes', short: 'Ningbo → alle routes', source: 'NCFI composiet',
    describe: 'Samengestelde index over alle 21 routes vanuit Ningbo-Zhoushan. Zegt of de haven als geheel duurder of goedkoper wordt.',
    group: 'index', unit: 'points' },
  { code: 'CCFI CN-EUR', label: 'China → Europa', short: 'China → Europa', source: 'CCFI · Shanghai Exchange',
    describe: 'Brede index voor de Europa-route vanuit tien Chinese havens, waaronder Guangzhou en Shenzhen. Contractgebaseerd, beweegt trager dan spot.',
    group: 'index', unit: 'points' },
];

const REFERENCE_CODE = 'WCI SHA-RTM';
const STORAGE_KEY = 'enrosed.market';

/**
 * The purchasing desk's market page: the three currency pairs that price a
 * Chinese container, each readable in either direction and drawn over the
 * chosen period, the buying-power narrative, and the freight log with our
 * own forwarder quotes next to the licensed market benchmarks and indexes.
 */
@Component({
  selector: 'app-market-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NumPipe, Sheet, Icon, TrendChart],
  template: `
    <div class="mk" [attr.aria-busy]="loading() || saving()">
      <div class="mk-toolbar">
        <div class="mk-seg" role="group" aria-label="Periode van de grafieken en vergelijkingen">
          <span class="mk-seg__label">Periode</span>
          @for (option of monthOptions; track option.months) {
            <button type="button" [class.is-on]="months() === option.months"
                    [attr.aria-pressed]="months() === option.months" (click)="setMonths(option.months)">{{ option.label }}</button>
          }
        </div>
        <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="load()">
          {{ loading() ? 'Laden…' : 'Vernieuwen' }}
        </button>
      </div>

      @if (loadError()) {
        <div class="mk-warning" role="status">{{ loadError() }}</div>
      }

      <!-- ── Currency ─────────────────────────────────────────────── -->
      <section class="mk-card" aria-labelledby="mk-fx-title">
        <header class="mk-card__head">
          <div>
            <span class="mk-eyebrow">Wisselkoersen</span>
            <h2 id="mk-fx-title">Valuta</h2>
            <p>ECB-referentiekoersen zonder bankopslag
              @if (fx.series(); as rates) { · bijgewerkt {{ shortDate(rates.asOf) }} }
              · tik op een paar om de richting om te keren</p>
          </div>
        </header>

        @if (pairs(); as pairs) {
          <div class="fx-grid">
            @for (pair of pairs; track pair.id) {
              <article class="fx-pair" [attr.aria-label]="pair.from + ' naar ' + pair.to">
                <button class="fx-pair__flip" type="button" (click)="flip(pair.id)"
                        [attr.aria-label]="'Richting omkeren naar ' + pair.to + ' → ' + pair.from">
                  <b>{{ pair.from }}</b><app-icon name="exchange" [size]="14" /><b>{{ pair.to }}</b>
                  <small>omkeren</small>
                </button>
                <div class="fx-pair__now">
                  <strong>{{ pair.latest | num: 4 }}</strong>
                  <span>{{ pair.to }} voor 1 {{ pair.from }}</span>
                </div>
                @if (pair.change; as change) {
                  <div class="fx-pair__delta">
                    <span class="mk-badge" [class]="'mk-badge mk-badge--' + pair.tone">
                      {{ change.pct >= 0 ? '+' : '' }}{{ change.pct | num: 2 }}%</span>
                    <span>{{ pair.word }} sinds {{ shortDate(change.since) }}</span>
                  </div>
                } @else {
                  <div class="fx-pair__delta"><span>Nog geen volledige {{ periodWords(months()) }} historiek</span></div>
                }
                <app-trend-chart [series]="pair.chart" [decimals]="4" [height]="164"
                                 [ariaLabel]="pair.from + ' naar ' + pair.to + ', verloop over ' + periodWords(months())" />
                @if (pair.summary; as summary) {
                  <dl class="fx-pair__range">
                    <div><dt>Hoog</dt><dd>{{ summary.max | num: 4 }}<small>{{ shortDate(summary.maxOn) }}</small></dd></div>
                    <div><dt>Gemiddeld</dt><dd>{{ summary.mean | num: 4 }}<small>{{ periodWords(months()) }}</small></dd></div>
                    <div><dt>Laag</dt><dd>{{ summary.min | num: 4 }}<small>{{ shortDate(summary.minOn) }}</small></dd></div>
                  </dl>
                }
                <div class="mk-horizons" aria-label="Verandering per periode">
                  @for (horizon of pair.horizons; track horizon.months) {
                    <button type="button" [class.is-on]="months() === horizon.months" (click)="setMonths(horizon.months)">
                      <span>{{ horizon.label }}</span>
                      @if (horizon.pct !== null) {
                        <b [class]="'tone-' + horizon.tone">{{ horizon.pct >= 0 ? '+' : '' }}{{ horizon.pct | num: 1 }}%</b>
                      } @else { <b class="tone-neutral">—</b> }
                    </button>
                  }
                </div>
              </article>
            }
          </div>

          @if (insight(); as insight) {
            <section class="fx-insight" aria-labelledby="mk-insight-title">
              <header>
                <div><span class="mk-eyebrow">Koopkracht</span><h3 id="mk-insight-title">Wat dit betekent voor inkoop</h3></div>
                <span class="mk-badge mk-badge--lg" [class]="'mk-badge mk-badge--lg mk-badge--' + insight.tone">{{ insight.verdict }}</span>
              </header>
              <p class="fx-insight__lead">{{ insight.lead }}</p>
              <ul>
                @for (line of insight.lines; track line) { <li>{{ line }}</li> }
              </ul>
              <div class="fx-insight__grid" role="group" aria-label="Koopkracht per periode">
                @for (horizon of insight.horizons; track horizon.months) {
                  <button type="button" [class.is-on]="months() === horizon.months" [disabled]="horizon.pct === null"
                          (click)="setMonths(horizon.months)">
                    <span>{{ horizon.label }}</span>
                    @if (horizon.pct !== null) {
                      <b [class]="horizon.pct >= 0 ? 'tone-ok' : 'tone-warn'">{{ horizon.pct >= 0 ? '↑' : '↓' }}{{ abs(horizon.pct) | num: 1 }}%</b>
                      <small>{{ horizon.pct >= 0 ? 'sterker' : 'zwakker' }}</small>
                    } @else { <b class="tone-neutral">—</b><small>geen data</small> }
                  </button>
                }
              </div>
            </section>
          }

          <details class="mk-table">
            <summary>Koersen als tabel <span>laatste koers per week · {{ periodWords(months()) }}</span></summary>
            <div class="mk-table__scroll">
              <table>
                <thead><tr><th>Week van</th>@for (pair of pairs; track pair.id) { <th>{{ pair.from }} → {{ pair.to }}</th> }</tr></thead>
                <tbody>
                  @for (row of fxTable(); track row.date) {
                    <tr><td>{{ shortDate(row.date) }}</td>@for (value of row.values; track $index) { <td>{{ value | num: 4 }}</td> }</tr>
                  }
                </tbody>
              </table>
            </div>
          </details>
        } @else if (fx.failed()) {
          <div class="mk-empty">
            <strong>ECB-koersen tijdelijk niet beschikbaar</strong>
            <p>De referentiekoersen komen rechtstreeks van de ECB-feed. Probeer het zo opnieuw.</p>
            <button class="btn btn--sm" type="button" (click)="load()">Opnieuw proberen</button>
          </div>
        } @else {
          <div class="mk-empty"><p>ECB-koersen laden…</p></div>
        }
      </section>

      <!-- ── Container freight ─────────────────────────────────────── -->
      <section class="mk-card" aria-labelledby="mk-freight-title">
        <header class="mk-card__head">
          <div>
            <span class="mk-eyebrow">Containervracht</span>
            <h2 id="mk-freight-title">Zeevracht China → Rotterdam</h2>
            <p>Wat wij betalen, wat de markt betaalt en welke kant het op gaat · tik op een tegel voor het verloop en de uitleg</p>
          </div>
          <button class="btn btn--primary btn--sm" type="button" (click)="openAdd()">Tarief toevoegen</button>
        </header>

        @for (group of freightGroups; track group.id) {
          <div class="fr-group">
            <div class="fr-group__head">
              <span>{{ group.title }}</span>
              <i class="mk-chip mk-chip--unit">{{ group.unit }}</i>
              <small>{{ group.hint }}</small>
            </div>
            <div class="fr-tiles" role="group" [attr.aria-label]="group.title">
              @for (tile of tilesFor(group.id); track tile.code) {
                <button class="fr-tile" type="button" [class.is-on]="selected() === tile.code"
                        [attr.aria-pressed]="selected() === tile.code" (click)="select(tile.code)">
                  <span class="fr-tile__name">{{ tile.short }}
                    @if (tile.state && tile.state !== 'CURRENT') {
                      <i class="mk-chip" [class.mk-chip--off]="tile.state === 'DISABLED'">{{ sourceStateLabel(tile.state) }}</i>
                    }
                  </span>
                  <span class="fr-tile__source">{{ tile.source }}</span>
                  @if (tile.latest; as latest) {
                    <strong>{{ tile.unit === 'usd' ? '$ ' : '' }}{{ latest.usdPerContainer | num: tile.unit === 'usd' ? 0 : 1 }}
                      @if (tile.unit === 'points') { <small>ptn</small> }</strong>
                    <span class="fr-tile__meta">{{ shortDate(latest.quotedOn) }}
                      @if (tile.step; as step) {
                        · <b [class]="'tone-' + freightTone(step.pct)">{{ step.pct > 0 ? '+' : '' }}{{ step.pct | num: 1 }}%</b>
                      }
                    </span>
                  } @else {
                    <strong class="is-empty">—</strong>
                    <span class="fr-tile__meta">{{ tile.group === 'own' ? 'nog geen offerte' : 'nog geen meetpunt' }}</span>
                  }
                </button>
              }
            </div>
          </div>
        }

        @if (detail(); as d) {
          <section class="fr-detail" [attr.aria-label]="'Verloop ' + d.definition.label">
            <header class="fr-detail__head">
              <div>
                <span class="mk-eyebrow">{{ d.definition.source }}</span>
                <h3>{{ d.definition.label }}</h3>
                <p class="fr-detail__what">{{ d.definition.describe }}</p>
                <p>{{ d.definition.unit === 'usd' ? 'USD per 40ft-container' : 'indexpunten, geen prijs' }}
                  · {{ d.all.dates.length }} {{ d.all.dates.length === 1 ? 'notering' : 'noteringen' }}
                  @if (d.definition.group !== 'own') { · wekelijks automatisch opgehaald }
                  @if (d.definition.group === 'own') { · door ons genoteerd }</p>
              </div>
              @if (d.latest; as latest) {
                <div class="fr-detail__now">
                  <strong>{{ d.definition.unit === 'usd' ? '$ ' : '' }}{{ latest.usdPerContainer | num: d.definition.unit === 'usd' ? 0 : 1 }}</strong>
                  <span>{{ shortDate(latest.quotedOn) }}
                    @if (d.step; as step) {
                      · <b [class]="'tone-' + freightTone(step.pct)">{{ step.pct > 0 ? '+' : '' }}{{ step.pct | num: 1 }}%</b> vs vorige
                    }
                  </span>
                </div>
              }
            </header>

            @if (d.referenceAvailable) {
              <label class="fr-reference">
                <input type="checkbox" [ngModel]="showReference()" (ngModelChange)="showReference.set($event)" />
                Drewry Shanghai → Rotterdam als marktreferentie tonen
              </label>
            }

            <app-trend-chart [series]="d.chart" [decimals]="d.definition.unit === 'usd' ? 0 : 1"
                             [prefix]="d.definition.unit === 'usd' ? '$ ' : ''" [height]="220"
                             [ariaLabel]="d.definition.label + ', verloop over ' + periodWords(months())"
                             [emptyText]="d.all.dates.length ? 'Slechts één notering in deze periode · kies een langere periode' : (d.definition.group === 'own' ? 'Nog geen offerte genoteerd voor deze route' : 'Nog geen meetpunten van deze bron')" />

            <div class="fr-horizons" aria-label="Verschil per periode">
              @for (horizon of d.horizons; track horizon.months) {
                <div class="fr-horizon">
                  <span>{{ horizon.label }}</span>
                  @if (horizon.pct !== null) {
                    <b [class]="'tone-' + freightTone(horizon.pct)">{{ horizon.pct > 0 ? '↑' : '↓' }}{{ abs(horizon.pct) | num: 1 }}%</b>
                    <small>{{ horizonWord(d.definition.unit, horizon.pct) }} · vs {{ shortDate(horizon.comparedOn!) }}</small>
                  } @else {
                    <b class="tone-neutral">—</b><small>nog geen data</small>
                  }
                </div>
              }
            </div>

            <div class="fr-analysis">
              <span class="mk-eyebrow">Analyse</span>
              @for (line of d.narrative; track line) { <p>{{ line }}</p> }
            </div>

            @if (d.source; as source) {
              <div class="fr-source" role="note" [class.fr-source--attention]="sourceNeedsAttention(source)">
                <div class="fr-source__row">
                  <strong>{{ source.metric === 'INDEX_POINTS' ? 'Marktindex, geen prijs' : 'USD-marktbenchmark' }}</strong>
                  <i class="mk-chip" [class.mk-chip--ok]="source.state === 'CURRENT'" [class.mk-chip--off]="source.state === 'DISABLED'">{{ sourceStateLabel(source.state) }}</i>
                </div>
                <p>{{ source.scope }}</p>
                <div class="fr-source__meta">
                  <span>{{ source.sourceName }}</span>
                  @if (source.latestPublishedOn) { <span>publicatie {{ shortDate(source.latestPublishedOn) }}</span> }
                  @if (source.lastCheckedAt) { <span>gecontroleerd {{ checkedOn(source.lastCheckedAt) }}</span> }
                  <a [href]="source.sourceUrl" target="_blank" rel="noopener noreferrer">Bron ↗</a>
                  <button class="linklike" type="button" [disabled]="refreshingSource() === source.code"
                          (click)="refreshSource(source.code)">
                    {{ refreshingSource() === source.code ? 'Bron ophalen…' : 'Bron nu ophalen' }}</button>
                </div>
                @if (sourceNeedsAttention(source)) { <p class="fr-source__detail">{{ sourceGuidance(source) }}</p> }
              </div>
            }

            @if (d.history.length) {
              <div class="fr-history">
                <div class="fr-history__head"><span>Alle noteringen</span><small>nieuwste eerst · verschil met de vorige</small></div>
                <div class="mk-table__scroll">
                  <table>
                    <thead><tr><th>Datum</th><th class="num">{{ d.definition.unit === 'usd' ? 'USD / 40ft' : 'Punten' }}</th><th class="num">Verschil</th>@if (d.definition.group === 'own') { <th></th> }</tr></thead>
                    <tbody>
                      @for (row of visibleHistory(); track row.rate.id ?? row.rate.quotedOn) {
                        <tr>
                          <td>{{ shortDate(row.rate.quotedOn) }}</td>
                          <td class="num">{{ d.definition.unit === 'usd' ? '$ ' : '' }}{{ row.rate.usdPerContainer | num: d.definition.unit === 'usd' ? 0 : 1 }}</td>
                          <td class="num">@if (row.stepPct !== null) { <b [class]="'tone-' + freightTone(row.stepPct)">{{ row.stepPct > 0 ? '+' : '' }}{{ row.stepPct | num: 1 }}%</b> } @else { <span class="tone-neutral">—</span> }</td>
                          @if (d.definition.group === 'own') {
                            <td class="num"><button class="linklike" type="button" [disabled]="deletingId() === row.rate.id" (click)="remove(row.rate)">Verwijderen</button></td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (d.history.length > historyLimit) {
                  <button class="linklike fr-history__more" type="button" (click)="historyExpanded.set(!historyExpanded())">
                    {{ historyExpanded() ? 'Toon minder' : 'Toon alle ' + d.history.length + ' noteringen' }}
                  </button>
                }
              </div>
            }
          </section>
        }
      </section>
    </div>

    @if (addOpen()) {
      <app-sheet title="Vrachttarief noteren" (closed)="closeAdd()">
        <div body>
          <div class="field">
            <label for="market-rate-route">Route</label>
            <select class="select" id="market-rate-route" [ngModel]="newRoute()" (ngModelChange)="newRoute.set($event)">
              @for (route of ownRoutes; track route.code) {
                <option [value]="route.code">{{ route.label }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label class="req" for="market-rate-value">USD per 40ft-container</label>
            <input class="input num" id="market-rate-value" type="number" min="1" step="50" inputmode="decimal"
                   [ngModel]="newRate()" (ngModelChange)="newRate.set(toNumber($event))" />
            <span class="hint">Wat de forwarder offreert, all-in tot Rotterdam. Het verloop bouwt zichzelf op.</span>
          </div>
          <div class="field">
            <label for="market-rate-date">Datum</label>
            <input class="input" id="market-rate-date" type="date" [ngModel]="newDate()" (ngModelChange)="newDate.set($event)" />
            <span class="hint">Laat op vandaag staan, of noteer een oudere offerte om de historiek aan te vullen.</span>
          </div>
          @if (recentFor(newRoute()); as recent) {
            @if (recent.length) {
              <div class="sheet-recent">
                <span class="mk-eyebrow">Eerdere offertes</span>
                @for (rate of recent; track rate.id ?? rate.quotedOn) {
                  <div class="sheet-recent__row">
                    <b>$ {{ rate.usdPerContainer | num: 0 }}</b><span>{{ shortDate(rate.quotedOn) }}</span>
                    <button class="linklike" type="button" [disabled]="deletingId() === rate.id" (click)="remove(rate)">Verwijderen</button>
                  </div>
                }
              </div>
            }
          }
          @if (saveError()) { <p class="save-error" role="alert">{{ saveError() }}</p> }
        </div>
        <div foot class="market-sheet-foot">
          <button class="btn" type="button" [disabled]="saving()" (click)="closeAdd()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="saving() || newRate() <= 0" (click)="saveRate()">
            {{ saving() ? 'Bewaren…' : 'Bewaren' }}</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host{display:block}.mk{display:grid;gap:18px}
    .mk-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}
    .mk-seg{display:inline-flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--line);border-radius:99px;background:var(--surface)}
    .mk-seg__label{padding:0 8px 0 10px;color:var(--muted);font-size:10.5px;font-weight:750;letter-spacing:.04em;text-transform:uppercase}
    .mk-seg button{padding:6px 12px;border:0;border-radius:99px;background:transparent;color:var(--muted);font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}
    .mk-seg button:hover{color:var(--ink)}.mk-seg button.is-on{background:var(--rose-soft);color:var(--rose-dark)}
    .mk-warning{padding:9px 12px;border:1px solid #eddcb9;border-radius:10px;background:var(--warn-soft);color:var(--ink-2);font-size:12px}
    .mk-card{overflow:hidden;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);box-shadow:var(--sh-1)}
    .mk-card__head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px 14px;padding:16px 18px 14px;border-bottom:1px solid var(--line)}
    .mk-card__head h2{margin:2px 0 0;font-size:18px}.mk-card__head p{margin:3px 0 0;color:var(--muted);font-size:12px;line-height:1.45}
    .mk-eyebrow{display:block;color:var(--rose);font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
    .mk-badge{display:inline-block;padding:3px 8px;border-radius:99px;background:var(--surface-2);color:var(--ink-2);font-size:11px;font-weight:750;white-space:nowrap}
    .mk-badge--ok{background:var(--ok-soft);color:var(--ok)}.mk-badge--warn{background:var(--warn-soft);color:var(--warn)}.mk-badge--lg{padding:5px 11px;font-size:12px}
    .mk-chip{display:inline-block;padding:2px 7px;border-radius:99px;background:var(--warn-soft);color:var(--warn);font-size:9.5px;font-style:normal;font-weight:750;white-space:nowrap}
    .mk-chip--ok{background:var(--ok-soft);color:var(--ok)}.mk-chip--off{background:var(--surface-2);color:var(--muted)}
    .tone-ok{color:var(--ok)}.tone-warn{color:var(--warn)}.tone-neutral{color:var(--muted)}
    .mk-empty{display:grid;gap:6px;justify-items:start;padding:22px 18px;color:var(--muted);font-size:12.5px}.mk-empty strong{color:var(--ink)}.mk-empty p{margin:0}
    /* currency pairs */
    .fx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
    .fx-pair{display:grid;gap:10px;min-width:0;padding:16px 18px 14px}
    .fx-pair+.fx-pair{border-left:1px solid var(--line)}
    .fx-pair__flip{display:inline-flex;align-items:center;gap:7px;justify-self:start;padding:7px 12px;border:1px solid var(--line);border-radius:99px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;cursor:pointer;transition:border-color .15s,background .15s}
    .fx-pair__flip:hover{border-color:var(--rose-line);background:var(--rose-soft)}.fx-pair__flip app-icon{color:var(--rose)}
    .fx-pair__flip small{margin-left:2px;color:var(--muted);font-size:10.5px}
    .fx-pair__now{display:grid;gap:1px}.fx-pair__now strong{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.1}.fx-pair__now span{color:var(--muted);font-size:11.5px}
    .fx-pair__delta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--muted);font-size:11.5px}
    .fx-pair__range{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0;padding:10px 0 0;border-top:1px solid var(--line)}
    .fx-pair__range div{display:grid;gap:1px;min-width:0}.fx-pair__range dt{color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
    .fx-pair__range dd{display:grid;margin:0;font-size:13px;font-weight:650;font-variant-numeric:tabular-nums}.fx-pair__range small{color:var(--muted);font-size:10px;font-weight:500}
    .mk-horizons{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
    .mk-horizons button{display:grid;gap:2px;padding:7px 4px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font:inherit;text-align:center;cursor:pointer}
    .mk-horizons button:hover{border-color:var(--rose-line)}.mk-horizons button.is-on{border-color:var(--rose);background:var(--rose-soft)}
    .mk-horizons span{color:var(--muted);font-size:10px;font-weight:700}.mk-horizons b{font-size:12px;font-variant-numeric:tabular-nums}
    /* buying power */
    .fx-insight{display:grid;gap:10px;padding:16px 18px;border-top:1px solid var(--line);background:var(--surface-2)}
    .fx-insight header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}.fx-insight h3{margin:2px 0 0;font-size:15px}
    .fx-insight__lead{margin:0;font-size:13.5px;font-weight:600;line-height:1.45}
    .fx-insight ul{display:grid;gap:6px;margin:0;padding-left:18px;color:var(--ink-2);font-size:12.5px;line-height:1.5}
    .fx-insight__grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:4px}
    .fx-insight__grid button{display:grid;gap:1px;padding:9px 6px;border:1px solid var(--line);border-radius:12px;background:var(--surface);font:inherit;text-align:center;cursor:pointer}
    .fx-insight__grid button:disabled{cursor:default;opacity:.6}.fx-insight__grid button.is-on{border-color:var(--rose);box-shadow:0 0 0 1px var(--rose)}
    .fx-insight__grid span{color:var(--muted);font-size:10px;font-weight:700}.fx-insight__grid b{font-size:15px;font-variant-numeric:tabular-nums}.fx-insight__grid small{color:var(--muted);font-size:10px}
    /* tables */
    .mk-table{border-top:1px solid var(--line)}.mk-table summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 18px;font-size:12px;font-weight:750;cursor:pointer}
    .mk-table summary span{color:var(--muted);font-size:10.5px;font-weight:500}
    .mk-table__scroll{overflow-x:auto}.mk-table__scroll table{width:100%;border-collapse:collapse;font-size:12px}
    .mk-table__scroll th,.mk-table__scroll td{padding:7px 18px;border-top:1px solid var(--line);text-align:left;white-space:nowrap}
    .mk-table__scroll th{color:var(--muted);font-size:10.5px;font-weight:700}.mk-table__scroll td{font-variant-numeric:tabular-nums}
    .mk-table__scroll .num{text-align:right}.mk-table__scroll th:not(:first-child),.mk-table__scroll td:not(:first-child){text-align:right}
    /* freight */
    .fr-group{padding:14px 18px 0}.fr-group__head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-bottom:8px;font-size:12px;font-weight:780}.fr-group__head small{flex-basis:100%;color:var(--muted);font-size:10.5px;font-weight:500}
    .mk-chip--unit{background:var(--surface-2);color:var(--ink-2);font-variant-numeric:tabular-nums}
    .fr-tile__source{color:var(--muted);font-size:10.5px;line-height:1.3}
    .fr-detail__what{margin:4px 0 2px;color:var(--ink-2);font-size:12.5px;line-height:1.45}
    .fr-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,160px),224px));gap:8px}
    .fr-tile{display:grid;gap:3px;min-width:0;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s}
    .fr-tile:hover{border-color:var(--rose-line)}.fr-tile.is-on{border-color:var(--rose);background:var(--rose-soft);box-shadow:0 0 0 1px var(--rose)}
    .fr-tile__name{display:flex;flex-wrap:wrap;align-items:center;gap:6px;color:var(--ink-2);font-size:11.5px;font-weight:700}
    .fr-tile strong{font-size:19px;font-weight:700;letter-spacing:-.01em}.fr-tile strong small{margin-left:2px;color:var(--muted);font-size:11px;font-weight:600}.fr-tile strong.is-empty{color:var(--muted-2)}
    .fr-tile__meta{color:var(--muted);font-size:10.5px}.fr-tile__meta b{font-weight:750}
    .fr-detail{display:grid;gap:14px;margin-top:14px;padding:16px 18px 18px;border-top:1px solid var(--line)}
    .fr-detail__head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 16px}
    .fr-detail__head h3{margin:0;font-size:15px}.fr-detail__head p{margin:3px 0 0;color:var(--muted);font-size:11.5px}
    .fr-detail__now{display:grid;justify-items:end;text-align:right}.fr-detail__now strong{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.1}.fr-detail__now span{color:var(--muted);font-size:11.5px}
    .fr-reference{display:inline-flex;align-items:center;gap:8px;color:var(--ink-2);font-size:12px;cursor:pointer}.fr-reference input{accent-color:var(--rose)}
    .fr-horizons{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
    .fr-horizon{display:grid;gap:2px;padding:9px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .fr-horizon span{color:var(--muted);font-size:10px;font-weight:700}.fr-horizon b{font-size:15px;font-variant-numeric:tabular-nums}.fr-horizon small{color:var(--muted);font-size:10px}
    .fr-analysis{display:grid;gap:5px}.fr-analysis p{margin:0;color:var(--ink-2);font-size:12.5px;line-height:1.5}
    .fr-source{display:grid;gap:5px;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);font-size:11.5px}
    .fr-source--attention{border-color:#eddcb9;background:var(--warn-soft)}
    .fr-source__row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px}.fr-source strong{font-size:12px}
    .fr-source p{margin:0;color:var(--ink-2)}.fr-source__meta{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--muted);font-size:10.5px}.fr-source__meta a{color:var(--rose-dark);font-weight:700}
    .fr-source__detail{color:var(--warn)}
    .fr-history{display:grid;gap:8px}.fr-history__head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;font-size:11px;font-weight:780}.fr-history__head small{color:var(--muted);font-weight:500}
    .fr-history .mk-table__scroll{border:1px solid var(--line);border-radius:12px}.fr-history th,.fr-history td{padding:7px 12px}.fr-history tr:first-child th{border-top:0}
    .fr-history__more{justify-self:start}
    .sheet-recent{display:grid;gap:6px;margin-top:14px}.sheet-recent__row{display:flex;align-items:center;gap:10px;padding:7px 10px;border:1px solid var(--line);border-radius:10px;font-size:12px}
    .sheet-recent__row span{flex:1;color:var(--muted)}
    .save-error{margin-top:9px;padding:8px 10px;border-radius:9px;background:var(--danger-soft);color:var(--danger);font-size:11px}
    .market-sheet-foot{display:flex;width:100%;justify-content:flex-end;gap:8px}
    @media(max-width:899.98px){.fx-pair+.fx-pair{border-top:1px solid var(--line);border-left:0}}
    @media(max-width:679.98px){.mk-card__head,.fx-pair,.fx-insight,.fr-detail{padding-left:14px;padding-right:14px}.fr-group{padding-left:14px;padding-right:14px}
      .mk-table summary,.mk-table__scroll th,.mk-table__scroll td{padding-left:14px;padding-right:14px}.fr-horizons,.fx-insight__grid{grid-template-columns:repeat(2,1fr)}
      .mk-toolbar .btn{order:-1;margin-left:auto}.mk-seg{max-width:100%;overflow-x:auto;scrollbar-width:none}.fx-pair__now strong{font-size:26px}}
  `,
})
export class MarketAnalysis {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  readonly fx = inject(Fx);

  readonly monthOptions = MONTH_OPTIONS;
  readonly periodWords = periodWords;
  readonly shortDate = shortDate;
  readonly historyLimit = 8;
  readonly freightGroups = [
    { id: 'own' as const, title: 'Wat wij betalen', unit: 'USD per 40ft',
      hint: 'offertes van onze forwarder, all-in tot Rotterdam, door ons genoteerd' },
    { id: 'usd' as const, title: 'Wat de markt betaalt', unit: 'USD per 40ft',
      hint: 'spotprijzen van de markt, dezelfde eenheid als onze offertes, wekelijks automatisch' },
    { id: 'index' as const, title: 'Welke kant de markt op gaat', unit: 'indexpunten',
      hint: 'geen prijs maar een peil: alleen het stijgen of dalen telt, wekelijks automatisch' },
  ];
  readonly ownRoutes = FREIGHT.filter((definition) => definition.group === 'own');

  readonly freightRates = signal<FreightRate[]>([]);
  readonly marketSources = signal<MarketSourceStatus[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly months = signal<Months>(6);
  readonly flipped = signal<Record<PairId, boolean>>({ usd: false, cny: false, cross: false });
  readonly selected = signal<string>('');
  readonly showReference = signal(true);
  readonly historyExpanded = signal(false);
  readonly addOpen = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly deletingId = signal<number | null>(null);
  readonly refreshingSource = signal<string | null>(null);
  readonly newRoute = signal('NINGBO');
  readonly newRate = signal(0);
  readonly newDate = signal(localIsoDay());

  private readonly ratesByRoute = computed(() => {
    const grouped = new Map<string, FreightRate[]>();
    for (const rate of this.freightRates()) {
      const rows = grouped.get(rate.route) ?? [];
      rows.push(rate);
      grouped.set(rate.route, rows);
    }
    for (const rows of grouped.values()) {
      rows.sort((left, right) => left.quotedOn.localeCompare(right.quotedOn) || (left.id ?? 0) - (right.id ?? 0));
    }
    return grouped;
  });
  private readonly sourceByCode = computed(() => new Map(this.marketSources().map((source) => [source.code, source])));

  /** The three pairs in their chosen direction, windowed to the period. */
  readonly pairs = computed<PairView[] | null>(() => {
    const rates = this.fx.series();
    if (!rates) return null;
    const months = this.months();
    const flipped = this.flipped();
    return PAIRS.map((pair) => {
      const natural = pair.id === 'usd' ? rates.usd : pair.id === 'cny' ? rates.cny : crossOf(rates.cny, rates.usd);
      const isFlipped = flipped[pair.id];
      const values = isFlipped ? invert(natural) : natural;
      const full: DatedSeries = { dates: rates.dates, values };
      const window = windowOf(full, months);
      const change = changeOverMonths(full, months);
      const from = isFlipped ? pair.quote : pair.base;
      const to = isFlipped ? pair.base : pair.quote;
      const horizons = MONTH_OPTIONS.map((option) => {
        const result = changeOverMonths(full, option.months);
        return { label: option.label, months: option.months, pct: result?.pct ?? null,
          tone: result ? this.toneFor(pair, isFlipped, result.pct) : 'neutral' as const };
      });
      return {
        ...pair, from, to, flipped: isFlipped,
        latest: values[values.length - 1],
        full, window,
        chart: [{ label: `${from} → ${to}`, dates: window.dates, values: window.values, tone: 'accent' }],
        change: change ? { pct: change.pct, since: rates.dates[change.baselineIndex] } : null,
        tone: change ? this.toneFor(pair, isFlipped, change.pct) : 'neutral',
        word: change ? this.wordFor(pair, isFlipped, change.pct) : '',
        summary: summarize(window),
        horizons,
      };
    });
  });

  readonly insight = computed<FxInsight | null>(() => {
    const rates = this.fx.series();
    return rates ? fxInsight(rates, this.months()) : null;
  });

  /** Weekly table twin of the three charts, in the directions on screen. */
  readonly fxTable = computed(() => {
    const pairs = this.pairs();
    if (!pairs) return [];
    const rows = weeklyRows(pairs[0].window);
    return rows.map((row) => {
      const index = pairs[0].full.dates.indexOf(row.date);
      return { date: row.date, values: pairs.map((pair) => pair.full.values[index]) };
    }).reverse();
  });

  readonly tiles = computed(() => FREIGHT.map((definition) => {
    const rows = this.ratesByRoute().get(definition.code) ?? [];
    const series = toSeries(rows);
    return {
      ...definition,
      latest: rows[rows.length - 1] ?? null,
      step: lastStep(series),
      state: this.sourceByCode().get(definition.code)?.state ?? null,
    };
  }));

  readonly detail = computed(() => {
    const code = this.selected();
    const definition = FREIGHT.find((candidate) => candidate.code === code);
    if (!definition) return null;
    const rows = this.ratesByRoute().get(code) ?? [];
    const all = toSeries(rows);
    const window = windowOf(all, this.months());
    const chart: TrendSeries[] = [{ label: definition.short, dates: window.dates, values: window.values, tone: 'accent' }];
    const referenceRows = code !== REFERENCE_CODE && definition.unit === 'usd'
      ? windowOf(toSeries(this.ratesByRoute().get(REFERENCE_CODE) ?? []), this.months()) : null;
    const referenceAvailable = !!referenceRows && referenceRows.dates.length > 1 && window.dates.length > 1;
    if (referenceAvailable && this.showReference() && referenceRows) {
      chart.push({ label: 'Drewry Shanghai → Rotterdam', dates: referenceRows.dates, values: referenceRows.values, tone: 'muted' });
    }
    const history: HistoryRow[] = rows.map((rate, index) => {
      const previous = rows[index - 1]?.usdPerContainer;
      return { rate, stepPct: previous && previous > 0 ? ((rate.usdPerContainer - previous) / previous) * 100 : null };
    }).reverse();
    return {
      definition, all, window, chart, referenceAvailable,
      latest: rows[rows.length - 1] ?? null,
      step: lastStep(all),
      horizons: sparseHorizons(all),
      narrative: freightNarrative(all, definition.unit),
      source: this.sourceByCode().get(code) ?? null,
      history,
    };
  });

  readonly visibleHistory = computed(() => {
    const history = this.detail()?.history ?? [];
    return this.historyExpanded() ? history : history.slice(0, this.historyLimit);
  });

  constructor() {
    this.restorePreferences();
    void this.load();
  }

  async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.loadError.set('');
    this.fx.failed.set(false);
    const fxLoad = this.fx.load();
    try {
      const [rates, sources] = await Promise.allSettled([
        this.sourcing.freightRates(),
        this.sourcing.marketSourceStatuses(),
      ] as const);
      const missing: string[] = [];
      if (rates.status === 'fulfilled') this.freightRates.set(rates.value);
      else missing.push('vrachttarieven');
      if (sources.status === 'fulfilled') this.marketSources.set(sources.value);
      else missing.push('bronstatus');
      if (missing.length) this.loadError.set(`Niet bijgewerkt: ${missing.join(' en ')}.`);
      if (!this.selected()) this.selected.set(this.defaultSelection());
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'De marktreferenties konden niet worden geladen.'));
    } finally {
      await fxLoad;
      this.loading.set(false);
    }
  }

  /** Our own lane with data first, then the dollar benchmark, then any series with a trend. */
  private defaultSelection(): string {
    const withTrend = (group?: FreightDefinition['group']) => FREIGHT.find((definition) =>
      (!group || definition.group === group) && (this.ratesByRoute().get(definition.code)?.length ?? 0) > 1);
    return withTrend('own')?.code ?? withTrend('usd')?.code ?? withTrend()?.code ?? FREIGHT[0].code;
  }

  tilesFor(group: FreightDefinition['group']) {
    return this.tiles().filter((tile) => tile.group === group);
  }

  select(code: string): void {
    this.selected.set(code);
    this.historyExpanded.set(false);
  }

  setMonths(months: Months): void {
    this.months.set(months);
    this.storePreferences();
  }

  flip(id: PairId): void {
    this.flipped.update((state) => ({ ...state, [id]: !state[id] }));
    this.storePreferences();
  }

  private toneFor(pair: PairDefinition, flipped: boolean, pct: number): 'ok' | 'warn' | 'neutral' {
    if (pair.id === 'cross') return 'neutral';
    const euroStronger = flipped ? pct < 0 : pct > 0;
    return Math.abs(pct) < 0.05 ? 'neutral' : euroStronger ? 'ok' : 'warn';
  }

  private wordFor(pair: PairDefinition, flipped: boolean, pct: number): string {
    if (Math.abs(pct) < 0.05) return 'vrijwel onveranderd';
    if (pair.id === 'cross') {
      const yuanWeaker = flipped ? pct < 0 : pct > 0;
      return yuanWeaker ? 'yuan zwakker tegenover de dollar' : 'yuan sterker tegenover de dollar';
    }
    if (flipped) return `${pair.quoteName} ${pct > 0 ? 'duurder' : 'goedkoper'} in euro`;
    return `euro ${pct > 0 ? 'sterker' : 'zwakker'} tegenover de ${pair.quoteName}`;
  }

  freightTone(pct: number): 'ok' | 'warn' | 'neutral' {
    return Math.abs(pct) < 0.05 ? 'neutral' : pct > 0 ? 'warn' : 'ok';
  }

  horizonWord(unit: 'usd' | 'points', pct: number): string {
    if (unit === 'points') return pct > 0 ? 'hoger' : 'lager';
    return pct > 0 ? 'duurder' : 'goedkoper';
  }

  abs(value: number): number {
    return Math.abs(value);
  }

  sourceStateLabel(state: MarketSourceStatus['state']): string {
    if (state === 'CURRENT') return 'actueel';
    if (state === 'CACHE_AFTER_FAILURE') return 'cache';
    if (state === 'CACHE_AFTER_ACCESS_BLOCK') return 'cache · toegang nodig';
    if (state === 'STALE') return 'verouderd';
    if (state === 'PROVIDER_ACCESS_REQUIRED') return 'toegang nodig';
    if (state === 'FAILED') return 'bronfout';
    if (state === 'DISABLED') return 'uitgeschakeld';
    return 'geen data';
  }

  sourceNeedsAttention(source: MarketSourceStatus): boolean {
    return source.state === 'FAILED' || source.state === 'STALE' || source.state === 'CACHE_AFTER_FAILURE' ||
      source.state === 'PROVIDER_ACCESS_REQUIRED' || source.state === 'CACHE_AFTER_ACCESS_BLOCK';
  }

  sourceGuidance(source: MarketSourceStatus): string {
    if (source.state === 'PROVIDER_ACCESS_REQUIRED') {
      return 'De provider blokkeert de automatische bronoproep. Koppel de toegestane feed, credentials of ' +
        'IP-allowlist; er is nog geen geldige cache.';
    }
    if (source.state === 'CACHE_AFTER_ACCESS_BLOCK') {
      return 'De provider blokkeert de nieuwe bronoproep. De laatst geldige cache blijft zichtbaar; controleer ' +
        'de feed, credentials of IP-allowlist.';
    }
    return source.detail;
  }

  checkedOn(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  /** One extra lookup of this source, then the log and the status again. */
  async refreshSource(code: string): Promise<void> {
    if (this.refreshingSource()) return;
    this.refreshingSource.set(code);
    try {
      const status = await this.sourcing.refreshMarketSource(code);
      const [rates, sources] = await Promise.all([this.sourcing.freightRates(), this.sourcing.marketSourceStatuses()]);
      this.freightRates.set(rates);
      this.marketSources.set(sources);
      this.ui.toast(status.state === 'CURRENT'
        ? `${status.label} bijgewerkt · publicatie ${status.latestPublishedOn ? shortDate(status.latestPublishedOn) : '—'}`
        : `${status.label}: ${this.sourceStateLabel(status.state)}`, status.state === 'CURRENT' ? 'ok' : 'err');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bron ophalen mislukt'), 'err');
    } finally {
      this.refreshingSource.set(null);
    }
  }

  recentFor(code: string): FreightRate[] {
    return (this.ratesByRoute().get(code) ?? []).slice(-4).reverse();
  }

  openAdd(): void {
    const selected = this.selected();
    this.newRoute.set(this.ownRoutes.some((route) => route.code === selected) ? selected : 'NINGBO');
    this.newRate.set(0);
    this.newDate.set(localIsoDay());
    this.saveError.set('');
    this.addOpen.set(true);
  }

  closeAdd(): void {
    if (!this.saving()) this.addOpen.set(false);
  }

  toNumber(value: string | number | null): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async saveRate(): Promise<void> {
    if (this.saving()) return;
    if (!Number.isFinite(this.newRate()) || this.newRate() <= 0) {
      this.saveError.set('Vul een geldig bedrag boven nul in.');
      return;
    }
    this.saving.set(true);
    this.saveError.set('');
    try {
      const saved = await this.sourcing.addFreightRate(this.newRoute(), this.newRate(), this.newDate() || null);
      this.freightRates.update((rows) => [...rows, saved]);
      this.addOpen.set(false);
      this.selected.set(saved.route);
      this.ui.toast('Vrachttarief bewaard');
    } catch (failure: unknown) {
      this.saveError.set(messageOf(failure, 'Het vrachttarief kon niet worden bewaard.'));
    } finally {
      this.saving.set(false);
    }
  }

  remove(rate: FreightRate): void {
    if (rate.id === null) return;
    const id = rate.id;
    this.ui.confirm({
      title: 'Notering verwijderen',
      message: `$ ${rate.usdPerContainer.toLocaleString('nl-BE', { maximumFractionDigits: 0 })} van ${shortDate(rate.quotedOn)} verdwijnt uit de historiek van deze route.`,
      confirmLabel: 'Verwijderen',
      danger: true,
    }, async () => {
      this.deletingId.set(id);
      try {
        await this.sourcing.deleteFreightRate(id);
        this.freightRates.update((rows) => rows.filter((row) => row.id !== id));
        this.ui.toast('Notering verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      } finally {
        this.deletingId.set(null);
      }
    });
  }

  /** Direction and period are personal reading habits: keep them on this device. */
  private restorePreferences(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { months?: number; flipped?: Partial<Record<PairId, boolean>> };
      if (MONTH_OPTIONS.some((option) => option.months === stored.months)) this.months.set(stored.months as Months);
      if (stored.flipped) this.flipped.update((state) => ({ ...state, ...stored.flipped }));
    } catch {
      /* Private mode or blocked storage: defaults are fine. */
    }
  }

  private storePreferences(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ months: this.months(), flipped: this.flipped() }));
    } catch {
      /* Not worth a message. */
    }
  }
}

function toSeries(rows: FreightRate[]): DatedSeries {
  return { dates: rows.map((row) => row.quotedOn), values: rows.map((row) => row.usdPerContainer) };
}

function localIsoDay(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
