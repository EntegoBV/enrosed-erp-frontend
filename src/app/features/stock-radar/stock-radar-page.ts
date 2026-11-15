import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  StockRadarApi, type StockRadarCheck, type StockRadarFamily, type StockRadarFeed, type StockRadarItem, type StockRadarShop, type StockRadarWatch,
} from '../../core/api/stock-radar-api';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';

type Tone = 'on' | 'later' | 'off' | 'wait' | 'err' | 'none';

interface Cell {
  watch: StockRadarWatch | null;
  tone: Tone;
  text: string;
  label: string;
  /** The shop has not given a good answer for three of its rhythms: the cell shows an older state. */
  stale: boolean;
}

/**
 * The stock radar: the products Emre wants (the iPhone Duo in white and blue,
 * 256 and 512 GB; the PS5 Pro) at the shops the backend reads every minute.
 * One table per product, shops by variants; a cell opens its details below.
 * The shops that refuse automatic reads are listed under their product with a
 * link, for their own "stuur mij een bericht". Personal: the backend only
 * answers it for the person it notifies.
 */
@Component({
  selector: 'app-stock-radar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, NgTemplateOutlet, PageHeader, RouterLink, Skeleton],
  template: `
    <app-page-header title="Voorraadradar" [subtitle]="subtitle()" />
    <div class="content sr">
      @if (loadError(); as error) { <div class="sr-panel"><app-load-error title="Radar kon niet worden geladen" [message]="error" [busy]="loading()" (retry)="load()" /></div> }
      @if (loading() && !feed()) { <div class="sr-panel" role="status" aria-label="Voorraadradar laden"><app-skeleton kind="table" [rows]="5" /></div> }
      @if (feed(); as data) {
        <section class="sr-hero" [class.sr-hero--on]="data.enabled && open().length > 0" [class.sr-hero--off]="!data.enabled">
          <div aria-live="polite">
          @if (!data.enabled) {
            <h2 class="sr-hero-title">Radar staat uit</h2>
          } @else if (open().length > 0) {
            <h2 class="sr-hero-title">Nu te krijgen</h2>
            <div class="sr-hero-links">
              @for (watch of open(); track watch.key) {
                <a class="btn btn--primary" [href]="watch.orderUrl" target="_blank" rel="noopener">
                  <span>{{ shopShort(watch.shop) }} · {{ itemTitle(watch) }}</span> <app-icon name="external" [size]="15" />
                </a>
              }
            </div>
          } @else {
            <h2 class="sr-hero-title">Nergens binnen {{ data.maxDeliveryDays }} dagen te krijgen</h2>
            @if (unanswered() > 0) { <p class="sr-hero-soon">bij de winkels die antwoorden · {{ unanswered() }} {{ unanswered() === 1 ? 'pagina' : "pagina's" }} nog zonder antwoord</p> }
            @if (soonest(); as first) {
              <p class="sr-hero-soon">Vroegste levering {{ day(first.deliveryBy!) }} · {{ shopName(first.shop) }} · {{ itemTitle(first) }}</p>
            }
          }
          </div>
          <p class="sr-hero-meta">
            {{ pace(data.intervalSeconds) }} · laatste ronde {{ ago(data.lastRoundAt) }}
            · push naar <strong>{{ data.notifyUser }}</strong> ({{ data.devices }} {{ data.devices === 1 ? 'toestel' : 'toestellen' }})
            · mail naar <strong>{{ data.mailTo }}</strong>@if (data.extraMailTo?.length) { + {{ data.extraMailTo!.length }} }
            @if (!data.pushEnabled) { · <span class="sr-warn">push uit</span> }
            @if (!data.mailEnabled) { · <span class="sr-warn">mail uit</span> }
            @if (data.devices === 0 && data.pushEnabled) { · <span class="sr-warn">geen toestel voor push:</span> <a routerLink="/settings" [queryParams]="{ sectie: 'notifications' }">zet Meldingen aan</a> in de ERP-webapp op je gsm }
          </p>
          <div class="sr-hero-tests">
            <button class="btn btn--sm" type="button" (click)="sendTestPush()" [disabled]="busy()" title="Stuurt een testpush naar je toestellen">
              <app-icon name="bell" [size]="16" /><span>Testpush</span>
            </button>
            <button class="btn btn--sm" type="button" (click)="sendTestMail()" [disabled]="busy()" title="Stuurt een testmail naar {{ data.mailTo }}">
              <app-icon name="arrow-out" [size]="16" /><span>Testmail</span>
            </button>
            @if (lastTest(); as note) { <span class="sr-test-note" [class.sr-warn]="!note.ok">{{ note.text }}</span> }
          </div>
          @if (data.extraMailTo; as extra) {
          <div class="sr-mail" role="group" aria-label="Extra mailadressen">
            <span class="sr-mail-label">Mail ook naar</span>
            @for (address of extra; track address) {
              <span class="sr-chip">{{ address }}<button type="button" class="sr-chip-x" (click)="removeMail(address)" [disabled]="busy()"
                [attr.aria-label]="'Verwijder ' + address" title="Verwijder">×</button></span>
            }
            @if (extra.length < 5) {
              <form class="sr-mail-add" (submit)="addMail($event, extraMail)">
                <input #extraMail type="email" inputmode="email" autocomplete="off" spellcheck="false" maxlength="254"
                  placeholder="extra mailadres" aria-label="Extra mailadres" />
                <button class="btn btn--sm" type="submit" [disabled]="busy()">Toevoegen</button>
              </form>
            }
          </div>
          }
        </section>

        @for (table of tables(); track table.family.key) {
          <section class="sr-family" [attr.aria-labelledby]="'sr-family-' + table.family.key">
            <h2 class="sr-family-title" [id]="'sr-family-' + table.family.key">{{ table.family.label }}<span>{{ table.family.subtitle }}</span></h2>
            <div class="sr-table-wrap">
              <table class="sr-table">
                <caption class="sr-only">Beschikbaarheid van {{ table.family.label }} per winkel</caption>
                <thead>
                  <tr>
                    <th scope="col" class="sr-shop-col">Winkel</th>
                    @for (item of table.family.items; track item.key) {
                      <th scope="col" [attr.aria-label]="item.label">
                        @if (swatch(item); as tint) { <span class="sr-swatch" [class.sr-swatch--blue]="tint === 'blue'" aria-hidden="true"></span> }
                        <span class="sr-head-colour">{{ headWord(item, 0) }}</span><span class="sr-head-size">{{ headWord(item, 1) }}</span>
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of table.rows; track row.shop.key) {
                    <tr>
                      <th scope="row" class="sr-shop-col">
                        <span class="sr-shop-name sr-shop-name--long">{{ row.shop.name }}</span>
                        <span class="sr-shop-name sr-shop-name--short">{{ row.shop.shortName }}</span>
                        <span class="sr-shop-kind">{{ row.shop.kind }}</span>
                      </th>
                      @for (cell of row.cells; track $index) {
                        <td>
                          <button type="button" [class]="'sr-cell sr-cell--' + cell.tone" [class.sr-cell--picked]="cell.watch?.key === picked()"
                            [class.sr-cell--stale]="cell.stale" [disabled]="!cell.watch" (click)="pick(cell.watch)" [attr.aria-label]="cell.label"
                            [attr.aria-pressed]="cell.watch?.key === picked()">
                            {{ cell.text }}
                          </button>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (pickedWatch(); as watch) {
              @if (watch.family === table.family.key) { <ng-container *ngTemplateOutlet="detail; context: { $implicit: watch }" /> }
            }
            @if (table.family.manual.length > 0) {
              <div class="sr-manual">
                <p class="sr-manual-lead"><strong>Niet automatisch gevolgd.</strong> De reden staat per winkel; waar de winkel zelf een melding heeft, zet die daar aan.</p>
                <ul class="sr-manual-list">
                  @for (shop of table.family.manual; track shop.key) {
                    <li>
                      <div class="sr-manual-text"><strong>{{ shop.name }}</strong><span>{{ shop.reason }}</span></div>
                      <a class="btn btn--sm" [href]="shop.url" target="_blank" rel="noopener" [attr.aria-label]="'Open ' + shop.name">Open <app-icon name="external" [size]="14" /></a>
                    </li>
                  }
                </ul>
              </div>
            }
          </section>
        }

        <ng-template #detail let-watch>
          <section class="sr-detail" [id]="'sr-detail-' + watch.key">
            <header class="sr-detail-head">
              <div>
                <h3>{{ shopName(watch.shop) }} · {{ itemTitle(watch) }}</h3>
                <p class="sr-kind">{{ shopKind(watch.shop) }}</p>
              </div>
              <span [class]="'sr-pill sr-pill--' + tone(watch)">{{ stateLabel(watch) }}</span>
            </header>
            <p class="sr-status">{{ watch.statusText || (watch.lastError ?? 'Nog niet gecontroleerd') }}</p>
            @if (watch.lastError) {
              <p class="sr-status sr-status--muted">
                {{ watch.refused ? 'De winkel weigert even' : 'Laatste poging mislukt' }}: {{ watch.lastError }}@if (watch.errorCount > 1) { ({{ watch.errorCount }} keer na elkaar) }
                @if (watch.goodAt) { · laatste goede controle {{ ago(watch.goodAt) }} }
              </p>
            }
            <dl class="sr-facts">
              <div><dt>Prijs</dt><dd>{{ watch.priceEur === null ? '–' : euro(watch.priceEur) }}</dd></div>
              <div><dt>Levering</dt><dd>{{ watch.deliveryBy ? longDay(watch.deliveryBy) : (watch.inStock ? 'geen datum' : '–') }}</dd></div>
              <div><dt>Gecontroleerd</dt><dd>{{ ago(watch.checkedAt) }} · {{ watch.checkCount }} keer</dd></div>
              <div><dt>Volgende</dt><dd>@if (feed()?.enabled) { {{ until(watch.nextCheckAt) }} · @if (watch.errorCount > 0) { {{ watch.refused ? 'de winkel wacht na een weigering' : 'wacht na een fout' }} } @else { {{ rhythm(watch) }} } } @else { radar staat uit }</dd></div>
              <div><dt>Laatste melding</dt><dd>
                @if (alertFailed(watch)) { <span class="sr-warn">niet aangekomen</span> }
                @else { {{ watch.notifiedAt ? ago(watch.notifiedAt) : '–' }} }
                @if (watch.lastPushStatus !== null) { <span class="sr-muted"> · push {{ watch.lastPushStatus }}</span> }
                @if (watch.lastMailStatus !== null) { <span class="sr-muted"> · mail {{ watch.lastMailStatus }}</span> }
              </dd></div>
              @if (watch.places) { <div><dt>In de winkel</dt><dd>{{ watch.places }}</dd></div> }
            </dl>
            <footer class="sr-detail-foot">
              <a class="btn btn--sm" [href]="watch.orderUrl" target="_blank" rel="noopener">Open winkel <app-icon name="external" [size]="14" /></a>
              @if (feed()?.enabled && (watch.errorCount > 0 || stale(watch))) {
                <button class="btn btn--sm" type="button" (click)="checkOne(watch.key)" [disabled]="busy()">Nu opnieuw proberen</button>
              }
            </footer>
          </section>
        </ng-template>
        @if (!pickedWatch()) { <p class="sr-hint">Tik op een vak voor de details van die winkel.</p> }

        <p class="sr-foot">
          Beschikbaar = levering of afhaling binnen {{ data.maxDeliveryDays }} dagen, of op voorraad in een Coolblue-winkel.
          @if (parts()) { Apple {{ parts() }} · }dit scherm ververst elke minuut.
        </p>
      }
    </div>
  `,
  styles: [`
    :host{display:block}.sr{max-width:1080px}.sr-panel{border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:22px;margin-bottom:18px}
    .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    .sr-hero{border:1px solid var(--line);border-radius:18px;background:var(--surface);padding:20px 22px;margin-bottom:16px}
    .sr-hero--on{border-color:color-mix(in srgb,var(--ok) 55%,var(--line));background:color-mix(in srgb,var(--ok) 7%,var(--surface))}.sr-hero--off{opacity:.75}
    .sr-hero-title{margin:0;font-size:22px;line-height:1.25;font-weight:800}.sr-hero--on .sr-hero-title{color:var(--ok)}
    .sr-hero-soon{margin:6px 0 0;font-size:14px;font-weight:600;color:var(--ink-2,var(--ink))}
    .sr-hero-meta{margin:8px 0 0;font-size:13px;line-height:1.6;color:var(--muted)}.sr-hero-meta strong{color:var(--ink);font-weight:600}
    .sr-hero-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
    .sr-hero-links .btn{display:inline-flex;align-items:center;gap:6px;max-width:100%;white-space:normal;text-align:left;line-height:1.3;height:auto;min-height:40px}
    .sr-hero-tests{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}.sr-hero-tests .btn{display:inline-flex;align-items:center;gap:6px}
    .sr-test-note{font-size:12px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}
    .sr-mail{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-top:12px;font-size:13px}
    .sr-mail-label{color:var(--muted);font-weight:600}
    .sr-chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;padding:3px 4px 3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);overflow-wrap:anywhere}
    .sr-chip-x{border:0;background:transparent;color:var(--muted);font-size:16px;line-height:1;width:24px;height:24px;border-radius:50%;cursor:pointer}
    .sr-chip-x:hover{background:var(--surface-2);color:var(--ink)}
    .sr-mail-add{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
    .sr-mail-add input{min-width:0;width:220px;max-width:100%;height:32px;padding:0 10px;border:1px solid var(--line-strong,var(--line));border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:14px}
    .sr-warn{color:var(--danger);font-weight:600}.sr-muted{color:var(--muted)}
    .sr-family{margin-top:18px}.sr-family-title{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;margin:0 2px 10px;font-size:17px;font-weight:800}
    .sr-family-title span{font-size:13px;font-weight:500;color:var(--muted)}
    .sr-table-wrap{border:1px solid var(--line);border-radius:16px;background:var(--surface);overflow:hidden}
    .sr-table{width:100%;border-collapse:collapse;table-layout:fixed}
    .sr-table th,.sr-table td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:center;vertical-align:middle}
    .sr-table tbody tr:last-child th,.sr-table tbody tr:last-child td{border-bottom:0}
    .sr-table thead th{font-size:12px;font-weight:700;color:var(--muted);background:var(--surface-2)}
    .sr-head-size{margin-left:4px}
    .sr-shop-col{width:30%;text-align:left!important;padding-left:16px!important}
    .sr-shop-name{display:block;font-size:14px;font-weight:700;color:var(--ink);line-height:1.3}.sr-shop-name--short{display:none}
    .sr-shop-kind{display:block;font-size:11px;font-weight:500;color:var(--muted);margin-top:1px}
    .sr-swatch{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:0;background:#f4f1ea;border:1px solid var(--line-strong,var(--line))}
    .sr-swatch--blue{background:#1f2a44;border-color:#1f2a44}
    .sr-cell{width:100%;min-height:40px;border:1px solid transparent;border-radius:10px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;padding:6px 4px;line-height:1.2;background:var(--surface-2);color:var(--ink)}
    .sr-cell:disabled{cursor:default}
    .sr-cell--on{background:var(--ok);color:#fff}
    .sr-cell--later{background:var(--surface-2);color:var(--ink)}
    .sr-cell--off{background:transparent;color:var(--muted);font-weight:600}
    .sr-cell--err{background:var(--warn-soft,var(--surface-2));color:var(--warn,var(--danger))}
    .sr-cell--none{background:transparent;color:var(--muted)}
    .sr-cell--wait{background:transparent;color:var(--muted);font-weight:600;border:1px dashed var(--line-strong,var(--line))}
    .sr-cell--stale{opacity:.55}
    .sr-cell--picked{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink) inset}
    @media (hover:hover){.sr-cell:not(:disabled):hover{border-color:var(--line-strong,var(--line))}.sr-cell--picked:hover{border-color:var(--ink)}}
    .sr-detail{display:flex;flex-direction:column;gap:10px;border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:16px 18px;margin-top:14px}
    .sr-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.sr-detail-head h3{margin:0;font-size:15px;font-weight:700;line-height:1.3}
    .sr-kind{margin:2px 0 0;font-size:11px;color:var(--muted)}
    .sr-pill{flex:none;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;background:var(--surface-2);color:var(--muted);white-space:nowrap}
    .sr-pill--on{background:var(--ok-soft,color-mix(in srgb,var(--ok) 16%,var(--surface)));color:var(--ok)}
    .sr-pill--err{background:var(--warn-soft,var(--surface-2));color:var(--warn,var(--danger))}
    .sr-pill--later{color:var(--ink)}
    .sr-status{margin:0;font-size:14px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}.sr-status--muted{font-weight:400;font-size:12px;color:var(--muted)}
    .sr-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 14px;margin:0}.sr-facts div{min-width:0}
    .sr-facts dt{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:700}.sr-facts dd{margin:1px 0 0;font-size:13px;line-height:1.4;overflow-wrap:anywhere}
    .sr-detail-foot{display:flex;flex-wrap:wrap;gap:8px;padding-top:2px}.sr-detail-foot .btn{display:inline-flex;align-items:center;gap:5px}
    .sr-hint{margin:12px 4px 0;font-size:12px;color:var(--muted)}
    .sr-manual{margin-top:12px}.sr-manual-lead{margin:0 2px 8px;font-size:13px;line-height:1.5;color:var(--muted)}.sr-manual-lead strong{color:var(--ink);font-weight:700}
    .sr-manual-list{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
    .sr-manual-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px 10px 16px;border-bottom:1px solid var(--line)}.sr-manual-list li:last-child{border-bottom:0}
    .sr-manual-text{display:flex;flex-direction:column;min-width:0}.sr-manual-text strong{font-size:14px}.sr-manual-text span{font-size:12px;color:var(--muted);line-height:1.4}
    .sr-manual-list .btn{flex:none;display:inline-flex;align-items:center;gap:5px}
    .sr-foot{font-size:12px;color:var(--muted);line-height:1.6;margin:16px 2px 0}
    .sr :is(button,a):focus-visible{outline:2px solid var(--rose);outline-offset:2px}
    @media(max-width:679px){
      .sr{padding-top:12px}.sr-hero{padding:16px;border-radius:16px}.sr-hero-title{font-size:19px}
      .sr-table th,.sr-table td{padding:6px 3px}.sr-shop-col{width:27%;padding-left:10px!important}
      .sr-shop-name--long{display:none}.sr-shop-name--short{display:block;font-size:13px}.sr-shop-kind{display:none}
      .sr-head-colour,.sr-head-size{display:block;margin:0}.sr-swatch{margin:0 0 3px}
      .sr-cell{font-size:12px;min-height:44px;padding:4px 2px;border-radius:9px}
      .sr-detail{padding:14px 15px}.sr-facts{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
  `],
})
export class StockRadarPage {
  private readonly api = inject(StockRadarApi);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);
  readonly feed = signal<StockRadarFeed | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly lastTest = signal<{ ok: boolean; text: string } | null>(null);
  readonly picked = signal<string | null>(null);
  /** Moves the "x s geleden" texts on between loads. */
  private readonly clock = signal(Date.now());
  private request = 0;
  private followUps: ReturnType<typeof setTimeout>[] = [];
  /** The first load opens what is to be had; after that, a closed panel stays closed. */
  private autoPicked = false;

  /** What is to be had now: available, the latest read agrees, and that read is not old (a shop that refuses for long keeps an older state). */
  readonly open = computed(() => (this.feed()?.watches ?? []).filter((watch) => this.tone(watch) === 'on' && !this.staleGood(watch)));
  /** The earliest promised date of an item that is orderable but not within reach yet. */
  readonly soonest = computed(() => (this.feed()?.watches ?? [])
    .filter((watch) => watch.inStock && watch.available !== true && !!watch.deliveryBy && watch.errorCount < 3)
    .sort((a, b) => (a.deliveryBy ?? '').localeCompare(b.deliveryBy ?? ''))[0] ?? null);
  /** One table per product: its shops as rows, its variants as columns. */
  readonly tables = computed(() => {
    const data = this.feed();
    if (!data) return [];
    const byKey = new Map(data.watches.map((watch) => [watch.key, watch]));
    return data.families.map((family) => ({
      family,
      rows: family.shops.map((shop) => ({
        shop,
        cells: family.items.map((item) => this.cell(shop, item, byKey.get(`${shop.key}:${item.key}`) ?? null)),
      })),
    }));
  });
  /** "iPhone Duo en PS5 Pro". */
  readonly subtitle = computed(() => {
    const labels = (this.feed()?.families ?? []).map((family) => family.label);
    return labels.length <= 1 ? (labels[0] ?? '') : labels.slice(0, -1).join(', ') + ' en ' + labels[labels.length - 1];
  });
  readonly pickedWatch = computed(() => {
    const key = this.picked();
    return key ? (this.feed()?.watches ?? []).find((watch) => watch.key === key) ?? null : null;
  });
  /** Pages that gave no usable answer yet (refused, broken, never read): "nergens" is only about the others. */
  readonly unanswered = computed(() => (this.feed()?.watches ?? []).filter((watch) => {
    const tone = this.tone(watch);
    return tone === 'none' || tone === 'wait' || tone === 'err' || this.staleGood(watch);
  }).length);
  readonly parts = computed(() => (this.feed()?.families ?? []).flatMap((family) => family.items)
    .map((item) => item.applePart).filter((part): part is string => !!part).join(', '));

  constructor() {
    void this.load();
    const timer = setInterval(() => { if (!document.hidden && !this.loading() && !this.busy()) void this.load(); }, 60_000);
    const tick = setInterval(() => this.clock.set(Date.now()), 10_000);
    // Back on the tab: the verdict of the moment, not the one from before it was hidden.
    const visible = () => { if (!document.hidden && !this.loading() && !this.busy()) void this.load(); };
    document.addEventListener('visibilitychange', visible);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer); clearInterval(tick); this.followUps.forEach(clearTimeout); this.request++;
      document.removeEventListener('visibilitychange', visible);
    });
  }

  async load(): Promise<void> {
    if (this.loading()) return;
    const request = ++this.request;
    this.loading.set(true);
    try {
      const data = await this.api.feed();
      if (this.destroyRef.destroyed || request !== this.request) return;
      this.apply(data);
      this.loadError.set(null);
    } catch (error) {
      if (this.destroyRef.destroyed || request !== this.request) return;
      this.loadError.set(messageOf(error, 'De radargegevens konden niet worden opgehaald. Probeer opnieuw.'));
    } finally {
      if (request === this.request && !this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  private apply(data: StockRadarFeed): void {
    this.feed.set(data);
    this.clock.set(Date.now());
    // The first visit opens what is to be had; a pick that no longer exists closes.
    const picked = this.picked();
    if (picked && !data.watches.some((watch) => watch.key === picked)) this.picked.set(null);
    if (!picked && !this.autoPicked) {
      const first = data.watches.find((watch) => this.tone(watch) === 'on');
      if (first) this.picked.set(first.key);
    }
    this.autoPicked = true;
  }

  pick(watch: StockRadarWatch | null): void {
    if (!watch) return;
    const opening = this.picked() !== watch.key;
    this.picked.set(opening ? watch.key : null);
    // On the phone the details open under a long table: bring them into view.
    if (opening) setTimeout(() => document.getElementById('sr-detail-' + watch.key)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
  }

  /** The last alert of this page did not get out (no door answered); its statuses say why. */
  alertFailed(watch: StockRadarWatch): boolean {
    if (watch.lastPushStatus === null && watch.lastMailStatus === null) return false;
    // Only while the page is still available: "weer weg" moves changedAt on without an alert of its own.
    if (watch.available !== true) return false;
    return !watch.notifiedAt || (!!watch.changedAt && new Date(watch.notifiedAt).getTime() < new Date(watch.changedAt).getTime());
  }

  /** One phone at one shop; Apple's page answers for all four phones at once. */
  async checkOne(key: string): Promise<void> {
    await this.run(() => this.api.checkOne(key));
  }

  private async run(action: () => Promise<StockRadarCheck>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.request++;
    this.loading.set(false);
    try {
      const result = await action();
      if (this.destroyRef.destroyed) return;
      this.apply(result.feed);
      this.loadError.set(null);
      if (result.started > 0) {
        this.ui.toast(`Controle gestart (${result.started} ${result.started === 1 ? 'pagina' : "pagina's"}); het antwoord volgt binnen een halve minuut.`);
        this.followUps.forEach(clearTimeout);
        this.followUps = [8_000, 20_000].map((wait) => setTimeout(() => { if (!this.busy()) void this.load(); }, wait));
      } else if (result.queuedSeconds > 0) {
        this.ui.toast(`Deze winkel is net gevraagd; deze pagina komt als volgende, binnen ${result.queuedSeconds} s.`);
        this.followUps.forEach(clearTimeout);
        this.followUps = [(result.queuedSeconds + 15) * 1000].map((wait) => setTimeout(() => { if (!this.busy()) void this.load(); }, wait));
      } else if (!result.feed.enabled) {
        this.ui.toast('De radar staat uit.', 'err');
      } else {
        this.ui.toast('Deze pagina is net bekeken of wordt nu bekeken; de volgende ronde komt vanzelf.');
      }
    } catch (error) {
      this.ui.toast(messageOf(error, 'De controle is mislukt.'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  async sendTestPush(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.api.sendTestPush();
      if (this.destroyRef.destroyed) return;
      const pushed = result.pushStatuses.filter((status) => status >= 200 && status < 300).length;
      const text = !result.pushOn
        ? 'Push staat uit op deze server.'
        : result.devices === 0
          ? 'Geen toestel aangemeld voor push: open de ERP-webapp op je gsm en zet Meldingen aan.'
          : `Testpush naar ${pushed} van ${result.devices} ${result.devices === 1 ? 'toestel' : 'toestellen'} (antwoord ${result.pushStatuses.join(', ')}).`;
      this.lastTest.set({ ok: pushed > 0, text });
      this.ui.toast(text, pushed > 0 ? 'ok' : 'err');
    } catch (error) {
      const text = messageOf(error, 'De testpush is mislukt.');
      this.lastTest.set({ ok: false, text });
      this.ui.toast(text, 'err');
    } finally {
      this.busy.set(false);
    }
  }

  async sendTestMail(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.api.sendTestMail();
      if (this.destroyRef.destroyed) return;
      const ok = result.sent > 0 && result.failed.length === 0;
      const to = result.total === 1 ? result.mailTo : `${result.total} adressen`;
      const text = result.mock
        ? `Testmail niet verstuurd: deze server mailt niet (alleen in het log, ${to}).`
        : ok
          ? `Testmail verstuurd naar ${to}.`
          : result.sent > 0
            ? `Testmail naar ${result.sent} van ${result.total} adressen; mislukt voor ${result.failed.join(', ')}.`
            : `Testmail mislukt (${result.mailStatus})${result.detail ? ': ' + result.detail : ''}`;
      this.lastTest.set({ ok, text });
      this.ui.toast(text, ok ? 'ok' : 'err');
    } catch (error) {
      const text = messageOf(error, 'De testmail is mislukt.');
      this.lastTest.set({ ok: false, text });
      this.ui.toast(text, 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /** Adds the typed address to the extra mail addresses. */
  async addMail(event: Event, input: HTMLInputElement): Promise<void> {
    event.preventDefault();
    const address = input.value.trim();
    const data = this.feed();
    if (!address || !data?.extraMailTo || this.busy()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { this.ui.toast('Dit is geen geldig mailadres.', 'err'); return; }
    if (await this.saveMails([...data.extraMailTo, address])) {
      input.value = '';
      this.ui.toast(`Meldingen gaan nu ook naar ${address.toLowerCase()}.`);
    }
  }

  async removeMail(address: string): Promise<void> {
    const data = this.feed();
    if (!data?.extraMailTo || this.busy()) return;
    if (await this.saveMails(data.extraMailTo.filter((candidate) => candidate !== address))) this.ui.toast(`${address} krijgt geen meldingen meer.`);
  }

  private async saveMails(emails: string[]): Promise<boolean> {
    this.busy.set(true);
    this.request++;
    this.loading.set(false);
    try {
      this.apply(await this.api.setMailRecipients(emails));
      return true;
    } catch (error) {
      this.ui.toast(messageOf(error, 'Het mailadres kon niet worden bewaard.'), 'err');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------------------------ cells

  private cell(shop: StockRadarShop, item: StockRadarItem, watch: StockRadarWatch | null): Cell {
    const where = `${shop.name}, ${item.label}`;
    if (!watch) return { watch: null, tone: 'none', text: '–', label: `${where}: niet gevolgd`, stale: false };
    const tone = this.tone(watch);
    const text = tone === 'none' ? '…'
      : tone === 'err' ? 'Fout'
        : tone === 'wait' ? 'Wacht'
          : tone === 'on' ? this.whenShort(watch)
            : tone === 'later' ? (watch.deliveryBy ? (/minstens/i.test(watch.statusText ?? '') ? '≥ ' : '') + this.day(watch.deliveryBy) : 'Later')
              : 'Niet';
    const stale = this.staleGood(watch);
    const label = tone === 'err' || tone === 'wait'
      ? `${where}: ${this.stateLabel(watch)}${watch.lastError ? ', ' + watch.lastError : ''}${watch.statusText ? '; laatst gezien: ' + watch.statusText : ''}`
      : `${where}: ${watch.statusText ?? this.stateLabel(watch)}${stale ? ' (oudere stand)' : ''}`;
    return { watch, tone, text, label, stale };
  }

  /** The shop has refused or failed for more than three of its rhythms: the last good state is old. */
  private staleGood(watch: StockRadarWatch): boolean {
    return watch.errorCount > 0 && !!watch.goodAt && this.clock() - new Date(watch.goodAt).getTime() > watch.rhythmSeconds * 3000;
  }

  /**
   * The latest good read itself says "to be had": in stock, and no date or a
   * date within the window. The backend keeps "available" until a second read
   * confirms it is gone (one alert, one "weer weg"); the screen shows the read.
   */
  private readSaysOpen(watch: StockRadarWatch): boolean {
    if (!watch.inStock) return false;
    if (!watch.deliveryBy) return true;
    const limit = new Date();
    limit.setDate(limit.getDate() + (this.feed()?.maxDeliveryDays ?? 3));
    return watch.deliveryBy <= this.iso(limit);
  }

  /** Not read for more than one and a half of its rhythm: waiting after a refusal, or the radar was paused. */
  stale(watch: StockRadarWatch): boolean {
    return !watch.checkedAt || this.clock() - new Date(watch.checkedAt).getTime() > watch.rhythmSeconds * 1500;
  }

  /** "Elke minuut", "Elke 2 min", "Elke 30 s": the radar's own pace. */
  pace(seconds: number): string {
    if (seconds === 60) return 'Elke minuut';
    return seconds < 60 ? `Elke ${seconds} s` : `Elke ${Math.round(seconds / 60)} min`;
  }

  rhythm(watch: StockRadarWatch): string {
    const every = this.feed()?.intervalSeconds ?? 60;
    if (watch.rhythmSeconds <= every * 1.5) return this.pace(watch.rhythmSeconds).toLowerCase();
    return `om de ${Math.round(watch.rhythmSeconds / 60)} min, de pagina's van deze winkel om de beurt`;
  }

  /**
   * A broken page (layout changed) is "Fout" after three reads in a row. A shop
   * that refuses (Amazon's Server Busy, a robot check) is only "Wacht" while no
   * good answer is known; otherwise the cell keeps the last good state.
   */
  tone(watch: StockRadarWatch): Tone {
    if (watch.errorCount >= 3 && !watch.refused) return 'err';
    if (watch.available === null) return watch.lastError ? 'wait' : 'none';
    if (watch.available && this.readSaysOpen(watch)) return 'on';
    return watch.inStock ? 'later' : 'off';
  }

  stateLabel(watch: StockRadarWatch): string {
    switch (this.tone(watch)) {
      case 'on': return 'Beschikbaar';
      case 'later': return 'Later leverbaar';
      case 'off': return 'Niet beschikbaar';
      case 'err': return 'Niet leesbaar';
      case 'wait': return watch.refused ? 'Winkel weigert even' : 'Nog geen antwoord';
      default: return 'Nog niet gecontroleerd';
    }
  }

  /** "Nu", "Morgen", "Winkel", or the date. */
  private whenShort(watch: StockRadarWatch): string {
    if (watch.places) return 'Winkel';
    if (!watch.deliveryBy) return 'Nu';
    const today = this.isoToday();
    if (watch.deliveryBy <= today) return 'Nu';
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    return watch.deliveryBy === this.iso(tomorrow) ? 'Morgen' : this.day(watch.deliveryBy);
  }

  private isoToday(): string { return this.iso(new Date()); }

  private iso(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private shop(key: string): StockRadarShop | undefined {
    return (this.feed()?.families ?? []).flatMap((family) => family.shops).find((shop) => shop.key === key);
  }

  shopName(key: string): string { return this.shop(key)?.name ?? key; }

  shopKind(key: string): string { return this.shop(key)?.kind ?? ''; }

  shopShort(key: string): string { return this.shop(key)?.shortName ?? key; }

  private family(key: string): StockRadarFamily | undefined { return this.feed()?.families.find((family) => family.key === key); }

  /** "iPhone Duo · Blauw 256 GB", or just "PS5 Pro" when the product has one variant. */
  itemTitle(watch: StockRadarWatch): string {
    const family = this.family(watch.family);
    const item = family?.items.find((candidate) => candidate.key === watch.item);
    if (!family || !item) return watch.item;
    return family.items.length === 1 && item.label === family.label ? family.label : `${family.label} · ${item.label}`;
  }

  /** The white or blue dot over an iPhone column; none for products without a colour. */
  swatch(item: StockRadarItem): 'white' | 'blue' | null {
    if (/nachthemel|blauw/i.test(item.colour ?? '')) return 'blue';
    if (/wit/i.test(item.colour ?? '')) return 'white';
    return null;
  }

  /** The column head in two lines on the phone: "Blauw" over "256 GB". */
  headWord(item: StockRadarItem, line: 0 | 1): string {
    const words = item.label.split(' ');
    return line === 0 ? words[0] : words.slice(1).join(' ').replace(/ GB$/, '');
  }

  ago(iso: string | null): string {
    if (!iso) return 'nog niet';
    const seconds = Math.max(0, Math.round((this.clock() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return `${seconds} s geleden`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min geleden`;
    if (seconds < 86_400) return `${Math.round(seconds / 3600)} u geleden`;
    return new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  until(iso: string | null): string {
    if (!iso) return '–';
    const seconds = Math.round((new Date(iso).getTime() - this.clock()) / 1000);
    if (seconds <= 5) return 'zo meteen';
    if (seconds < 90) return `over ${seconds} s`;
    return `over ${Math.round(seconds / 60)} min`;
  }

  /** "6 dec". */
  day(iso: string): string {
    const [year, month, dayOfMonth] = iso.split('-').map(Number);
    return new Date(year, month - 1, dayOfMonth).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }).replace('.', '');
  }

  longDay(iso: string): string {
    const [year, month, dayOfMonth] = iso.split('-').map(Number);
    return new Date(year, month - 1, dayOfMonth).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  euro(amount: number): string {
    return '€ ' + amount.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
