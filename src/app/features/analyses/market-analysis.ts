import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { messageOf } from '../../core/api/errors';
import { Fx } from '../../core/api/fx';
import type { FreightRate, MarketSourceStatus } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { NumPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';

interface MarketRoute {
  code: string;
  label: string;
  source?: string;
}

/**
 * Compact purchasing references only: current ECB crosses, forwarder quotes
 * and two licensed USD market benchmarks. Historical prediction belongs
 * nowhere here; the short log merely shows the observations that were saved.
 */
@Component({
  selector: 'app-market-analysis',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NumPipe, Sheet],
  template: `
    <section class="market-card" aria-labelledby="market-analysis-title"
             [attr.aria-busy]="loading() || saving()">
      <header class="market-head">
        <div>
          <span class="market-eyebrow">Inkoopreferenties</span>
          <h2 id="market-analysis-title">Koersen &amp; containervracht</h2>
          <p>De actuele basis voor een nieuwe inkoopcalculatie.</p>
        </div>
        <div class="market-head__actions">
          <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="load()">
            {{ loading() ? 'Laden…' : 'Vernieuwen' }}
          </button>
          <button class="btn btn--primary btn--sm" type="button" (click)="openAdd()">
            Tarief toevoegen
          </button>
        </div>
      </header>

      @if (loadError()) {
        <div class="market-warning" role="status">{{ loadError() }}</div>
      }

      <div class="market-overview">
        <section class="market-panel" aria-label="ECB-valutareferenties">
          <header class="market-panel__head">
            <div><span>Wisselkoers</span><small>ECB · zonder bankopslag</small></div>
            @if (fx.series(); as rates) { <time>{{ shortDate(rates.asOf) }}</time> }
          </header>
          @if (fx.series(); as rates) {
            <div class="compact-list">
              <div class="compact-row">
                <div><strong>USD → EUR</strong><small>1 Amerikaanse dollar</small></div>
                <b>€ {{ usdToEur(rates.latestUsd) | num: 4 }}</b>
              </div>
              <div class="compact-row">
                <div><strong>CNY → USD</strong><small>1 Chinese yuan</small></div>
                <b>$ {{ cnyToUsd(rates.latestUsd, rates.latestCny) | num: 4 }}</b>
              </div>
            </div>
          } @else if (fx.failed()) {
            <div class="panel-empty">ECB-referenties tijdelijk niet beschikbaar.</div>
          } @else {
            <div class="panel-empty">ECB-referenties laden…</div>
          }
        </section>

        <section class="market-panel" aria-label="Eigen containertarieven">
          <header class="market-panel__head">
            <div><span>Eigen tarieven</span><small>Forwarderofferte · USD per 40ft</small></div>
          </header>
          <div class="compact-list">
            @for (route of ownRoutes; track route.code) {
              <article class="compact-row route-row">
                <div>
                  <strong>{{ route.label }} → Rotterdam</strong>
                  @if (latestFor(route.code); as latest) {
                    <small>{{ shortDate(latest.quotedOn) }}
                      @if (comparisonFor(route.code); as comparison) {
                        · <span class="rate-delta" [class.rate-delta--up]="comparison.value > 0"
                                [class.rate-delta--down]="comparison.value < 0">{{ comparison.label }}</span>
                      }
                    </small>
                  } @else {
                    <small>Nog geen tarief</small>
                  }
                </div>
                <span class="route-row__end">
                  @if (latestFor(route.code); as latest) {
                    <b>$ {{ latest.usdPerContainer | num: 0 }}</b>
                  } @else {
                    <b class="muted">—</b>
                  }
                  <button type="button" aria-label="Tarief voor deze route toevoegen"
                          (click)="openAdd(route.code)">+</button>
                </span>
              </article>
            }
          </div>
        </section>
      </div>

      <div class="market-section market-section--benchmarks">
        <header class="market-section__head">
          <div><span>Marktbenchmark</span><small>Indicatie in USD per 40ft · geen forwarderofferte</small></div>
          @if (marketSources().length) {
            <span class="source-summary">{{ enabledSourceCount() }}/{{ benchmarks.length }} bronnen actief</span>
          }
        </header>
        <div class="benchmark-list">
          @for (benchmark of benchmarks; track benchmark.code) {
            <div class="benchmark-row">
              <div>
                <strong>{{ benchmark.label }}</strong>
                <small>{{ benchmark.source }}</small>
              </div>
              @if (sourceFor(benchmark.code); as source) {
                @if (source.state !== 'CURRENT') {
                  <span class="source-state" [class.source-state--off]="source.state === 'DISABLED'">
                    {{ sourceStateLabel(source.state) }}
                  </span>
                }
              }
              @if (latestFor(benchmark.code); as latest) {
                <span class="benchmark-row__value">
                  <b>$ {{ latest.usdPerContainer | num: 0 }}</b>
                  <small>{{ shortDate(latest.quotedOn) }}</small>
                </span>
                @if (comparisonFor(benchmark.code); as comparison) {
                  <span class="benchmark-row__delta"
                        [class.rate-delta--up]="comparison.value > 0"
                        [class.rate-delta--down]="comparison.value < 0">{{ comparison.label }}</span>
                }
              } @else {
                <span class="benchmark-row__value"><b>—</b><small>Geen meetpunt</small></span>
              }
            </div>
          }
        </div>
      </div>

      <details class="market-history">
        <summary>Korte historiek <span>Laatste vier noteringen per route</span></summary>
        <div class="market-history__body">
          @for (route of historyRoutes; track route.code) {
            @if (historyFor(route.code).length; as count) {
              <section class="history-route">
                <h3>{{ route.label }} <small>{{ count }} meetpunt{{ count === 1 ? '' : 'en' }}</small></h3>
                <div class="history-rate-list">
                  @for (rate of historyFor(route.code).slice(0, 4); track rate.id ?? rate.quotedOn) {
                    <span><b>$ {{ rate.usdPerContainer | num: 0 }}</b><small>{{ shortDate(rate.quotedOn) }}</small></span>
                  }
                </div>
              </section>
            }
          }
          @if (!hasHistory()) {
            <p class="market-history__empty">Nog geen tarieven opgeslagen.</p>
          }
        </div>
      </details>
    </section>

    @if (addOpen()) {
      <app-sheet title="Vrachttarief noteren" (closed)="closeAdd()">
        <div body>
          <div class="field">
            <label for="market-rate-route">Route</label>
            <select class="select" id="market-rate-route" [ngModel]="newRoute()"
                    (ngModelChange)="newRoute.set($event)">
              @for (route of ownRoutes; track route.code) {
                <option [value]="route.code">{{ route.label }} → Rotterdam</option>
              }
            </select>
          </div>
          <div class="field">
            <label class="req" for="market-rate-value">USD per 40ft-container</label>
            <input class="input num" id="market-rate-value" type="number" min="1" step="50"
                   inputmode="decimal" [ngModel]="newRate()"
                   (ngModelChange)="newRate.set(toNumber($event))" />
          </div>
          <div class="field">
            <label for="market-rate-date">Datum</label>
            <input class="input" id="market-rate-date" type="date" [ngModel]="newDate()"
                   (ngModelChange)="newDate.set($event)" />
          </div>
          @if (saveError()) {
            <p class="save-error" role="alert">{{ saveError() }}</p>
          }
        </div>
        <div foot class="market-sheet-foot">
          <button class="btn" type="button" [disabled]="saving()" (click)="closeAdd()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="saving() || newRate() <= 0"
                  (click)="saveRate()">{{ saving() ? 'Bewaren…' : 'Bewaren' }}</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host{display:block}.market-card{overflow:hidden;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);box-shadow:var(--sh-1)}
    .market-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 16px;border-bottom:1px solid var(--line)}
    .market-eyebrow{display:block;color:var(--rose);font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.market-head h2{margin-top:2px;font-size:17px}.market-head p{margin-top:2px;color:var(--muted);font-size:11px}.market-head__actions{display:flex;flex:none;gap:7px}
    .market-warning{margin:10px 12px 0;padding:9px 11px;border:1px solid #eddcb9;border-radius:10px;background:var(--warn-soft);color:var(--ink-2);font-size:11.5px}
    .market-overview{display:grid;grid-template-columns:minmax(0,.78fr) minmax(0,1.22fr);border-bottom:1px solid var(--line)}.market-panel{min-width:0}.market-panel+.market-panel{border-left:1px solid var(--line)}.market-panel__head,.market-section__head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;background:var(--surface-2)}.market-panel__head>div,.market-section__head>div{display:grid;min-width:0}.market-panel__head span,.market-section__head>div>span{font-size:10.5px;font-weight:780}.market-panel__head small,.market-section__head small,.market-panel__head time{color:var(--muted);font-size:9px}.compact-list{display:grid}.compact-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;min-height:48px;padding:8px 14px}.compact-row+.compact-row{border-top:1px solid var(--line)}.compact-row>div{display:grid;min-width:0}.compact-row strong{overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.compact-row small{color:var(--muted);font-size:9px}.compact-row>b{font-size:12.5px;text-align:right}.panel-empty{padding:17px 14px;color:var(--muted);font-size:11px}.route-row__end{display:flex;align-items:center;justify-content:flex-end;gap:8px}.route-row__end>b{font-size:12.5px;white-space:nowrap}.route-row__end button{display:grid;width:25px;height:25px;flex:none;place-items:center;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--rose-dark);font:inherit;font-size:16px;cursor:pointer}.route-row__end button:hover{border-color:var(--rose-line);background:var(--rose-soft)}.rate-delta{color:var(--muted)}.rate-delta--up{color:var(--warn)}.rate-delta--down{color:var(--ok)}
    .market-section{padding:14px 16px}.market-section--benchmarks{padding:0}.market-section__head{margin:0}.source-summary{flex:none;padding:3px 7px;border-radius:99px;background:var(--ok-soft);color:var(--ok);font-size:9px;font-weight:750}.benchmark-list{display:grid;padding:0 14px}.benchmark-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:10px;padding:9px 0}.benchmark-row+.benchmark-row{border-top:1px solid var(--line)}.benchmark-row>div{display:grid;min-width:0}.benchmark-row>div strong{overflow:hidden;font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}.benchmark-row>div small,.benchmark-row__value small{color:var(--muted);font-size:9.5px}.benchmark-row__value{display:grid;text-align:right}.benchmark-row__value b{font-size:12px}.benchmark-row__delta{min-width:48px;font-size:10px;font-weight:700;text-align:right}.source-state{padding:3px 7px;border-radius:99px;background:var(--warn-soft);color:var(--warn);font-size:9px;font-weight:750;white-space:nowrap}.source-state--off{background:var(--danger-soft);color:var(--danger)}
    .market-history{border-top:1px solid var(--line);background:var(--surface-2)}.market-history summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;font-size:11.5px;font-weight:750;cursor:pointer}.market-history summary span{color:var(--muted);font-size:9.5px;font-weight:500}.market-history__body{display:grid;gap:10px;padding:0 16px 14px}.history-route{display:grid;gap:5px}.history-route h3{font-size:10.5px}.history-route h3 small{color:var(--muted);font-weight:500}.history-rate-list{display:flex;flex-wrap:wrap;gap:5px}.history-rate-list>span{display:grid;min-width:92px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.history-rate-list b{font-size:10.5px}.history-rate-list small{color:var(--muted);font-size:9px}.market-history__empty{color:var(--muted);font-size:11px}.save-error{margin-top:9px;padding:8px 10px;border-radius:9px;background:var(--danger-soft);color:var(--danger);font-size:11px}.market-sheet-foot{display:flex;width:100%;justify-content:flex-end;gap:8px}
    @media(max-width:679.98px){.market-head{display:grid}.market-head__actions{width:100%}.market-head__actions .btn{flex:1}.market-overview{grid-template-columns:1fr}.market-panel+.market-panel{border-top:1px solid var(--line);border-left:0}.benchmark-row{grid-template-columns:minmax(0,1fr) auto auto;gap:7px}.source-state{grid-column:1}.benchmark-row__delta{min-width:42px}.market-section__head{align-items:flex-end}.source-summary{margin-bottom:1px}}
  `,
})
export class MarketAnalysis {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  readonly fx = inject(Fx);

  readonly ownRoutes: readonly MarketRoute[] = [
    { code: 'NINGBO', label: 'Ningbo' },
    { code: 'GUANGZHOU', label: 'Nansha' },
    { code: 'SHENZHEN', label: 'Yantian' },
  ];
  readonly benchmarks: readonly MarketRoute[] = [
    { code: 'WCI SHA-RTM', label: 'Shanghai → Rotterdam', source: 'Drewry WCI' },
    { code: 'FBX11 CN-NEUR', label: 'China → Noord-Europa', source: 'Freightos FBX11' },
  ];
  readonly historyRoutes = [...this.ownRoutes, ...this.benchmarks];

  readonly freightRates = signal<FreightRate[]>([]);
  readonly marketSources = signal<MarketSourceStatus[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly addOpen = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal('');
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
      rows.sort((left, right) => left.quotedOn.localeCompare(right.quotedOn)
        || (left.id ?? 0) - (right.id ?? 0));
    }
    return grouped;
  });
  private readonly sourceByCode = computed(() =>
    new Map(this.marketSources().map((source) => [source.code, source])));
  readonly enabledSourceCount = computed(() => this.benchmarks.filter((benchmark) =>
    this.sourceFor(benchmark.code)?.automatedAccessAuthorized === true).length);

  constructor() { void this.load(); }

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
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'De marktreferenties konden niet worden geladen.'));
    } finally {
      await fxLoad;
      this.loading.set(false);
    }
  }

  latestFor(code: string): FreightRate | null {
    return this.ratesByRoute().get(code)?.at(-1) ?? null;
  }

  historyFor(code: string): FreightRate[] {
    return (this.ratesByRoute().get(code) ?? []).slice().reverse();
  }

  changeFor(code: string): number | null {
    const rows = this.ratesByRoute().get(code) ?? [];
    if (rows.length < 2) return null;
    const previous = rows.at(-2)!.usdPerContainer;
    const latest = rows.at(-1)!.usdPerContainer;
    return previous > 0 ? ((latest - previous) / previous) * 100 : null;
  }

  comparisonFor(code: string): { value: number; label: string } | null {
    const value = this.changeFor(code);
    return value === null ? null : { value, label: this.signed(value) };
  }

  sourceFor(code: string): MarketSourceStatus | null {
    return this.sourceByCode().get(code) ?? null;
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

  hasHistory(): boolean {
    return this.historyRoutes.some((route) => this.historyFor(route.code).length > 0);
  }

  usdToEur(usdPerEur: number): number {
    return usdPerEur > 0 ? 1 / usdPerEur : 0;
  }

  cnyToUsd(usdPerEur: number, cnyPerEur: number): number {
    return usdPerEur > 0 && cnyPerEur > 0 ? usdPerEur / cnyPerEur : 0;
  }

  signed(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toLocaleString('nl-BE', {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    })}%`;
  }

  shortDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;
    return new Intl.DateTimeFormat('nl-BE', {
      day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC',
    }).format(new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])));
  }

  openAdd(route = 'NINGBO'): void {
    this.newRoute.set(this.ownRoutes.some((candidate) => candidate.code === route) ? route : 'NINGBO');
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
      const saved = await this.sourcing.addFreightRate(
        this.newRoute(), this.newRate(), this.newDate() || null);
      this.freightRates.update((rows) => [...rows, saved]);
      this.addOpen.set(false);
      this.ui.toast('Vrachttarief bewaard');
    } catch (failure: unknown) {
      this.saveError.set(messageOf(failure, 'Het vrachttarief kon niet worden bewaard.'));
    } finally {
      this.saving.set(false);
    }
  }
}

function localIsoDay(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
