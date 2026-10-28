import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { StockRadarApi, type StockRadarFeed, type StockRadarRow } from '../../core/api/stock-radar-api';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';

/**
 * The stock radar: which shops are watched for the iPhone Duo, what each one
 * said last, and a button to prove the push + mail path on this phone. A
 * personal screen; the backend only answers it for the person it notifies.
 */
@Component({
  selector: 'app-stock-radar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, PageHeader, Skeleton],
  template: `
    <app-page-header title="Voorraadradar" subtitle="iPhone Duo · 256 GB · Sterrenwit" [parent]="parent">
      <button class="btn btn--sm btn--icon-mobile" type="button" (click)="checkAll()" [disabled]="busy()"
        aria-label="Alle winkels nu controleren" title="Alle winkels nu controleren">
        <app-icon name="refresh" [size]="17" /><span class="sr-desk-label">Nu controleren</span>
      </button>
    </app-page-header>
    <div class="content sr">
      @if (loadError(); as error) { <div class="sr-panel"><app-load-error title="Radar kon niet worden geladen" [message]="error" [busy]="loading()" (retry)="load()" /></div> }
      @if (loading() && !feed()) { <div class="sr-panel" role="status" aria-label="Voorraadradar laden"><app-skeleton kind="list" [rows]="5" /></div> }
      @if (feed(); as data) {
        <section class="sr-hero" [class.sr-hero--on]="availableRows().length > 0" [class.sr-hero--off]="!data.enabled">
          <p class="sr-hero-eyebrow">{{ data.product }}</p>
          <h2 class="sr-hero-title">
            @if (!data.enabled) { Radar staat uit }
            @else if (availableRows().length > 0) { Nu beschikbaar bij {{ availableRows().length }} {{ availableRows().length === 1 ? 'winkel' : 'winkels' }} }
            @else { Nergens binnen {{ data.maxDeliveryDays }} dagen te krijgen }
          </h2>
          <p class="sr-hero-meta">
            Push naar <strong>{{ data.notifyUser }}</strong> ({{ data.devices }} {{ data.devices === 1 ? 'toestel' : 'toestellen' }})
            · mail naar <strong>{{ data.mailTo }}</strong>
            · laatste ronde {{ ago(data.lastTickAt) }}
            @if (!data.pushEnabled) { · <span class="sr-warn">push uit</span> }
            @if (!data.mailEnabled) { · <span class="sr-warn">mail uit</span> }
            @if (!data.browserEnabled) { · <span class="sr-warn">browsercontroles uit</span> }
            @if (data.devices === 0) { · <span class="sr-warn">geen toestel aangemeld voor meldingen</span> }
          </p>
          <div class="sr-hero-tests">
            <button class="btn btn--sm btn--primary" type="button" (click)="sendTestPush()" [disabled]="busy()" title="Stuurt een testpush naar je toestellen">
              <app-icon name="bell" [size]="16" /><span>Testpush</span>
            </button>
            <button class="btn btn--sm" type="button" (click)="sendTestMail()" [disabled]="busy()" title="Stuurt een testmail naar {{ data.mailTo }}">
              <app-icon name="arrow-out" [size]="16" /><span>Testmail</span>
            </button>
            @if (lastTest(); as note) { <span class="sr-test-note" [class.sr-warn]="!note.ok">{{ note.text }}</span> }
          </div>
          @if (availableRows().length > 0) {
            <div class="sr-hero-links">
              @for (row of availableRows(); track row.key) {
                <a class="btn btn--primary" [href]="row.foundUrl || row.orderUrl" target="_blank" rel="noopener">{{ row.name }} · bestellen <app-icon name="external" [size]="15" /></a>
              }
            </div>
          }
        </section>
        <div class="sr-grid" aria-label="Gecontroleerde winkels">
          @for (row of data.stores; track row.key) {
            <article class="sr-card" [class.sr-card--on]="row.available === true" [class.sr-card--err]="!!row.lastError && row.available !== true">
              <header class="sr-card-head">
                <div><h3>{{ row.name }}</h3><p class="sr-kind">{{ row.kindLabel }}</p></div>
                <span class="sr-pill" [class.sr-pill--on]="row.available === true" [class.sr-pill--err]="!!row.lastError && row.available !== true">{{ stateLabel(row) }}</span>
              </header>
              <p class="sr-status">{{ row.lastError && row.available !== true ? row.lastError : (row.statusText || 'Nog niet gecontroleerd') }}</p>
              @if (row.lastError && row.available === true) { <p class="sr-status sr-status--muted">Laatste poging mislukt: {{ row.lastError }}</p> }
              <dl class="sr-facts">
                <div><dt>Prijs</dt><dd>{{ row.priceEur === null ? '–' : euro(row.priceEur) }}</dd></div>
                <div><dt>Levering</dt><dd>{{ row.deliveryBy ? day(row.deliveryBy) : (row.inStock ? 'geen datum' : '–') }}</dd></div>
                <div><dt>Gecontroleerd</dt><dd>{{ ago(row.checkedAt) }}</dd></div>
                <div><dt>Ritme</dt><dd>elke {{ row.intervalSeconds }} s · {{ row.method === 'browser' ? 'browser' : 'http' }}</dd></div>
                <div><dt>Controles</dt><dd>{{ row.checkCount }}@if (row.errorCount > 0) { <span class="sr-warn"> · {{ row.errorCount }} fout{{ row.errorCount === 1 ? '' : 'en' }} na elkaar</span> }</dd></div>
                <div><dt>Laatste melding</dt><dd>{{ row.notifiedAt ? ago(row.notifiedAt) : '–' }}@if (row.lastPushStatus !== null && row.notifiedAt) { <span class="sr-muted"> · push {{ row.lastPushStatus }}</span> }@if (row.lastMailStatus !== null && row.notifiedAt) { <span class="sr-muted"> · mail {{ row.lastMailStatus }}</span> }</dd></div>
              </dl>
              <footer class="sr-card-foot">
                <a class="btn btn--sm" [href]="row.foundUrl || row.orderUrl" target="_blank" rel="noopener">Open winkel <app-icon name="external" [size]="14" /></a>
                <button class="btn btn--sm" type="button" (click)="checkOne(row.key)" [disabled]="busy()">Nu controleren</button>
              </footer>
            </article>
          }
        </div>
        <p class="sr-foot">Apple-artikelnummer {{ data.applePart }} · beschikbaar = nu op voorraad met levering of afhaling binnen {{ data.maxDeliveryDays }} dagen · dit scherm ververst elke 10 s.</p>
      }
    </div>
  `,
  styles: [`
    :host{display:block}.sr{max-width:1240px}.sr-panel{border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:22px;margin-bottom:18px}
    .sr-hero{border:1px solid var(--line);border-radius:18px;background:var(--surface);padding:22px 24px;margin-bottom:18px}.sr-hero--on{border-color:color-mix(in srgb,var(--ok) 55%,var(--line));background:color-mix(in srgb,var(--ok) 7%,var(--surface))}.sr-hero--off{opacity:.75}
    .sr-hero-eyebrow{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}.sr-hero-title{margin:0;font-size:24px;line-height:1.2;font-weight:800}.sr-hero--on .sr-hero-title{color:var(--ok)}
    .sr-hero-meta{margin:10px 0 0;font-size:13px;line-height:1.6;color:var(--muted)}.sr-hero-meta strong{color:var(--ink);font-weight:600}.sr-hero-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.sr-hero-links .btn{display:inline-flex;align-items:center;gap:6px}
    .sr-hero-tests{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:14px}.sr-hero-tests .btn{display:inline-flex;align-items:center;gap:6px}.sr-test-note{font-size:12px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}
    .sr-warn{color:var(--danger,#b4232c);font-weight:600}.sr-muted{color:var(--muted)}
    .sr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
    .sr-card{display:flex;flex-direction:column;gap:10px;border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:16px 18px}.sr-card--on{border-color:color-mix(in srgb,var(--ok) 60%,var(--line));box-shadow:inset 3px 0 var(--ok)}.sr-card--err{border-color:color-mix(in srgb,var(--danger,#b4232c) 45%,var(--line))}
    .sr-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.sr-card-head h3{margin:0;font-size:15px;font-weight:700;line-height:1.3}.sr-kind{margin:2px 0 0;font-size:11px;color:var(--muted)}
    .sr-pill{flex:none;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;background:var(--surface-2);color:var(--muted);white-space:nowrap}.sr-pill--on{background:color-mix(in srgb,var(--ok) 16%,var(--surface));color:var(--ok)}.sr-pill--err{background:color-mix(in srgb,var(--danger,#b4232c) 12%,var(--surface));color:var(--danger,#b4232c)}
    .sr-status{margin:0;font-size:14px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}.sr-card--on .sr-status{color:var(--ok)}.sr-status--muted{font-weight:400;font-size:12px;color:var(--muted)}
    .sr-facts{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;margin:0}.sr-facts div{min-width:0}.sr-facts dt{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:700}.sr-facts dd{margin:1px 0 0;font-size:13px;line-height:1.4;overflow-wrap:anywhere}
    .sr-card-foot{display:flex;gap:8px;margin-top:auto;padding-top:4px}.sr-card-foot .btn{display:inline-flex;align-items:center;gap:5px}
    .sr-foot{font-size:12px;color:var(--muted);line-height:1.6;margin:18px 2px 0}
    .sr :is(button,a):focus-visible{outline:2px solid var(--rose);outline-offset:2px}
    @media(max-width:679px){.sr{padding-top:12px}.sr-desk-label{display:none}.sr-hero{padding:18px 16px;border-radius:16px}.sr-hero-title{font-size:21px}.sr-grid{grid-template-columns:minmax(0,1fr);gap:12px}.sr-card{padding:14px 15px}.sr-card-foot{flex-wrap:wrap}}
  `],
})
export class StockRadarPage {
  private readonly api = inject(StockRadarApi);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);
  readonly parent = { label: 'Meer', url: '/more', phoneLabel: 'Meer' };
  readonly feed = signal<StockRadarFeed | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly lastTest = signal<{ ok: boolean; text: string } | null>(null);
  readonly availableRows = computed(() => (this.feed()?.stores ?? []).filter((row) => row.available === true));
  private request = 0;

  constructor() {
    void this.load();
    const timer = setInterval(() => { if (!document.hidden && !this.loading() && !this.busy()) void this.load(); }, 10_000);
    this.destroyRef.onDestroy(() => { clearInterval(timer); this.request++; });
  }

  async load(): Promise<void> {
    if (this.loading()) return;
    const request = ++this.request;
    this.loading.set(true);
    try {
      const data = await this.api.feed();
      if (this.destroyRef.destroyed || request !== this.request) return;
      this.feed.set(data); this.loadError.set(null);
    } catch (error) {
      if (this.destroyRef.destroyed || request !== this.request) return;
      this.loadError.set(messageOf(error, 'De radargegevens konden niet worden opgehaald. Probeer opnieuw.'));
    } finally {
      if (request === this.request && !this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  async checkAll(): Promise<void> {
    await this.run(() => this.api.checkAll(), 'Alle winkels gecontroleerd; browserwinkels volgen binnen een minuut.');
  }

  async checkOne(key: string): Promise<void> {
    await this.run(() => this.api.checkOne(key), 'Winkel gecontroleerd.');
  }

  private async run(action: () => Promise<StockRadarFeed>, done: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.request++;
    try {
      this.feed.set(await action());
      this.loadError.set(null);
      this.ui.toast(done);
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
      const pushed = result.pushStatuses.filter((status) => status >= 200 && status < 300).length;
      const text = result.devices === 0
        ? 'Geen toestel aangemeld voor meldingen: open de test-ERP op je gsm en zet Meldingen op dit toestel aan.'
        : `Testpush naar ${pushed} van ${result.devices} toestel(len) (antwoord ${result.pushStatuses.join(', ')}).`;
      this.lastTest.set({ ok: pushed > 0, text });
      this.ui.toast(text, pushed > 0 ? 'ok' : 'err');
    } catch (error) {
      this.ui.toast(messageOf(error, 'De testpush is mislukt.'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  async sendTestMail(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.api.sendTestMail();
      const ok = (result.mailStatus >= 200 && result.mailStatus < 300) || result.mailStatus === 0;
      const text = ok
        ? `Testmail verstuurd naar ${result.mailTo}${result.mailStatus === 0 ? ' (lokale mailer)' : ''}.`
        : `Testmail mislukt (${result.mailStatus})${result.detail ? ': ' + result.detail : ''}`;
      this.lastTest.set({ ok, text });
      this.ui.toast(text, ok ? 'ok' : 'err');
    } catch (error) {
      this.ui.toast(messageOf(error, 'De testmail is mislukt.'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  stateLabel(row: StockRadarRow): string {
    if (row.available === true) return 'Beschikbaar';
    if (row.lastError && row.available === null) return 'Fout';
    if (row.available === null) return 'Nog niet gecontroleerd';
    if (row.lastError) return 'Fout';
    return row.inStock ? 'Later leverbaar' : 'Niet beschikbaar';
  }

  ago(iso: string | null): string {
    if (!iso) return 'nog niet';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return `${seconds} s geleden`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min geleden`;
    if (seconds < 86_400) return `${Math.round(seconds / 3600)} u geleden`;
    return new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  day(iso: string): string {
    const [year, month, dayOfMonth] = iso.split('-').map(Number);
    return new Date(year, month - 1, dayOfMonth).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  euro(amount: number): string {
    return '€ ' + amount.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
