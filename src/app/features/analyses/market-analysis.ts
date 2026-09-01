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
          <span class="market-eyebrow">Marktreferenties</span>
          <h2 id="market-analysis-title">Valuta en zeevracht</h2>
          <p>Actuele referenties voor nieuwe inkoopcalculaties.</p>
        </div>
        <div class="market-head__actions">
          <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="load()">
            {{ loading() ? 'Laden…' : 'Vernieuwen' }}
          </button>
          <button class="btn btn--primary btn--sm" type="button" (click)="openAdd()">
            + Tarief
          </button>
        </div>
      </header>

      @if (loadError()) {
        <div class="market-warning" role="status">{{ loadError() }}</div>
      }

      <div class="fx-strip" aria-label="ECB-valutareferenties">
        @if (fx.series(); as rates) {
          <div class="fx-reference">
            <span>USD → EUR</span>
            <strong>$ 1 = € {{ usdToEur(rates.latestUsd) | num: 4 }}</strong>
          </div>
          <div class="fx-reference">
            <span>CNY → USD</span>
            <strong>¥ 1 = $ {{ cnyToUsd(rates.latestUsd, rates.latestCny) | num: 4 }}</strong>
          </div>
          <small>ECB-referentie {{ shortDate(rates.asOf) }} · zonder bankopslag</small>
        } @else if (fx.failed()) {
          <div class="fx-unavailable">ECB-referenties tijdelijk niet beschikbaar.</div>
        } @else {
          <div class="fx-unavailable">ECB-referenties laden…</div>
        }
      </div>

      <div class="market-section">
        <div class="market-section__head">
          <div><span>Eigen routes</span><small>Laatste forwarderofferte · USD per 40ft</small></div>
        </div>
        <div class="rate-grid">
          @for (route of ownRoutes; track route.code) {
            <article class="rate-tile">
              <div class="rate-tile__head">
                <span>{{ route.label }} → Rotterdam</span>
                <button type="button" aria-label="Tarief voor deze route toevoegen"
                        (click)="openAdd(route.code)">+</button>
              </div>
              @if (latestFor(route.code); as latest) {
                <strong>$ {{ latest.usdPerContainer | num: 0 }}</strong>
                <small>{{ shortDate(latest.quotedOn) }}</small>
                @if (comparisonFor(route.code); as comparison) {
                  <span class="rate-delta" [class.rate-delta--up]="comparison.value > 0"
                        [class.rate-delta--down]="comparison.value < 0">
                    {{ comparison.label }} vs vorige notering
                  </span>
                } @else {
                  <span class="rate-delta">eerste notering</span>
                }
              } @else {
                <strong class="muted">—</strong>
                <small>Nog geen forwarderofferte</small>
              }
            </article>
          }
        </div>
      </div>

      <div class="market-section market-section--benchmarks">
        <div class="market-section__head">
          <div><span>USD-marktbenchmarks</span><small>Referentie, niet de prijs van onze forwarder</small></div>
        </div>
        <div class="benchmark-list">
          @for (benchmark of benchmarks; track benchmark.code) {
            <div class="benchmark-row">
              <div>
                <strong>{{ benchmark.label }}</strong>
                <small>{{ benchmark.source }}
                  @if (sourceFor(benchmark.code); as source) {
                    · {{ sourceStateLabel(source.state) }}
                  }
                </small>
              </div>
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
    .market-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px;border-bottom:1px solid var(--line)}
    .market-eyebrow{display:block;color:var(--rose);font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.market-head h2{margin-top:2px;font-size:18px}.market-head p{margin-top:3px;color:var(--muted);font-size:11.5px}.market-head__actions{display:flex;flex:none;gap:7px}
    .market-warning{margin:10px 12px 0;padding:9px 11px;border:1px solid #eddcb9;border-radius:10px;background:var(--warn-soft);color:var(--ink-2);font-size:11.5px}
    .fx-strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;border-bottom:1px solid var(--line);background:var(--surface-2)}.fx-reference{display:grid;gap:2px;padding:12px 16px}.fx-reference+.fx-reference{border-left:1px solid var(--line)}.fx-reference span{color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.05em}.fx-reference strong{font-size:15px}.fx-strip>small{grid-column:1/-1;padding:0 16px 10px;color:var(--muted);font-size:9.5px}.fx-unavailable{grid-column:1/-1;padding:14px 16px;color:var(--muted);font-size:11.5px}
    .market-section{padding:14px 16px}.market-section+.market-section{border-top:1px solid var(--line)}.market-section__head{display:flex;align-items:end;justify-content:space-between;margin-bottom:8px}.market-section__head div{display:grid}.market-section__head span{font-size:11px;font-weight:780}.market-section__head small{color:var(--muted);font-size:9.5px}
    .rate-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.rate-tile{display:grid;align-content:start;min-width:0;padding:11px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2)}.rate-tile__head{display:flex;align-items:start;justify-content:space-between;gap:5px}.rate-tile__head>span{overflow:hidden;color:var(--muted);font-size:9.5px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.rate-tile__head button{display:grid;width:22px;height:22px;flex:none;margin:-5px -5px 0 0;place-items:center;border:0;border-radius:50%;background:transparent;color:var(--rose);font:inherit;font-size:17px;cursor:pointer}.rate-tile>strong{margin-top:3px;font-size:17px}.rate-tile>small{color:var(--muted);font-size:9.5px}.rate-delta{margin-top:7px;color:var(--muted);font-size:9.5px}.rate-delta--up{color:var(--warn)}.rate-delta--down{color:var(--ok)}
    .market-section--benchmarks{padding-top:12px}.benchmark-list{display:grid}.benchmark-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:9px 0}.benchmark-row+.benchmark-row{border-top:1px solid var(--line)}.benchmark-row>div{display:grid;min-width:0}.benchmark-row>div strong{overflow:hidden;font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}.benchmark-row>div small,.benchmark-row__value small{color:var(--muted);font-size:9.5px}.benchmark-row__value{display:grid;text-align:right}.benchmark-row__value b{font-size:12px}.benchmark-row__delta{min-width:48px;font-size:10px;font-weight:700;text-align:right}
    .market-history{border-top:1px solid var(--line);background:var(--surface-2)}.market-history summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;font-size:11.5px;font-weight:750;cursor:pointer}.market-history summary span{color:var(--muted);font-size:9.5px;font-weight:500}.market-history__body{display:grid;gap:10px;padding:0 16px 14px}.history-route{display:grid;gap:5px}.history-route h3{font-size:10.5px}.history-route h3 small{color:var(--muted);font-weight:500}.history-rate-list{display:flex;flex-wrap:wrap;gap:5px}.history-rate-list>span{display:grid;min-width:92px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.history-rate-list b{font-size:10.5px}.history-rate-list small{color:var(--muted);font-size:9px}.market-history__empty{color:var(--muted);font-size:11px}.save-error{margin-top:9px;padding:8px 10px;border-radius:9px;background:var(--danger-soft);color:var(--danger);font-size:11px}.market-sheet-foot{display:flex;width:100%;justify-content:flex-end;gap:8px}
    @media(max-width:679.98px){.market-head{display:grid}.market-head__actions{width:100%}.market-head__actions .btn{flex:1}.rate-grid{grid-template-columns:1fr}.rate-tile{grid-template-columns:minmax(0,1fr) auto;align-items:center}.rate-tile__head{grid-row:1/span 3}.rate-tile>strong,.rate-tile>small,.rate-tile>.rate-delta{grid-column:2;text-align:right}.rate-tile>strong{margin-top:0}.rate-tile>.rate-delta{margin-top:2px}.fx-reference{padding-inline:12px}.benchmark-row{gap:7px}.benchmark-row__delta{min-width:42px}}
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
