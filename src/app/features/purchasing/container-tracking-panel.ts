import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ContainerTrackingApi } from '../../core/api/container-tracking-api';
import type { ContainerTracking } from '../../core/api/container-tracking-models';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { carrierLookup, normalizedVesselImo, trackingArrived, trackingMapLink, trackingMapUrl, trackingRefreshNotice,
  trackingStale, trackingTime, trackingWebUrl, validatedContainerReference, vesselMapFrameUrl } from './container-tracking-model';

/** One tracking detail, shared by the purchase overview and the all-container screen. */
@Component({
  selector: 'app-container-tracking-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    @let item = row();
    <article class="tp" [attr.aria-label]="'Tracking van ' + (item.containerName || item.orderNumber)">
      <header class="tp-head">
        <div class="tp-identity">
          <span class="tp-kicker">{{ carrier()?.carrier || item.carrier || 'Track & trace' }} @if (box(); as number) { <span>· {{ number }}</span> }</span>
          <h2>{{ showOrderLink() ? item.containerName || item.orderNumber : item.vessel || 'Container volgen' }}</h2>
          <div class="tp-status-line">
            @if (showOrderLink() && item.vessel) { <span class="tp-ship"><app-icon name="globe" [size]="15" />{{ item.vessel }}</span> }
            <span class="tp-status" [class.tp-status--ok]="arrived(item)" [class.tp-status--warn]="!!item.error && !!item.source">
              {{ item.source ? item.statusLabel : 'Schip nog niet gekoppeld' }}
            </span>
          </div>
        </div>
        @if (showOrderLink()) { <a class="tp-order" [routerLink]="['/purchasing', item.orderId]">Inkooporder <app-icon name="chevron-right" [size]="15" /></a> }
      </header>

      @if (!configured()) { <div class="tp-notice" role="status"><app-icon name="info" [size]="17" /><span>Automatische controles staan uit. Je ziet de bewaarde gegevens.</span></div> }
      @if (item.error && item.source) {
        <div class="tp-notice tp-notice--warn" role="status"><app-icon name="alert" [size]="17" /><span>{{ item.error }} @if (item.updatedAt) { <span>Gegevens bewaard van {{ time(item.updatedAt) }}.</span> }</span></div>
      } @else if (stale() && item.automatic) {
        <div class="tp-notice tp-notice--warn" role="status"><app-icon name="info" [size]="17" /><span>De laatste controle is langer dan {{ intervalHours() }} uur geleden.</span></div>
      }

      <div class="tp-body" [class.tp-body--without-map]="!mapUrl()">
        @if (mapUrl(); as map) {
          <section class="tp-map-area" aria-label="Kaart">
            <iframe class="tp-map" [src]="map" [title]="item.vesselImo ? 'Scheepskaart van ' + (item.vessel || item.vesselImo) : 'Laatst gemelde locatie van de container'"
                    loading="eager" referrerpolicy="no-referrer"></iframe>
            <div class="tp-map-bar">
              <span>{{ item.source === 'VOYDAR' ? 'Scheepspositie' : item.position?.kind === 'VESSEL' ? 'Scheepspositie' : 'Laatst gemelde locatie' }}
                · <a [href]="item.source === 'VOYDAR' ? 'https://www.vesselfinder.com' : 'https://www.openstreetmap.org/copyright'" target="_blank" rel="noopener noreferrer">{{ item.source === 'VOYDAR' ? 'VesselFinder' : 'OpenStreetMap' }}</a></span>
              <a [href]="mapHref()" target="_blank" rel="noopener noreferrer" aria-label="Kaart op volledig scherm openen"><app-icon name="external" [size]="14" />Groter</a>
            </div>
            <p class="tp-map-note">{{ item.source === 'VOYDAR' ? 'Handmatig gekoppeld schip. Bekijk in de kaart hoe oud de positie is.' : item.position?.recordedAt ? 'Positie gemeld op ' + time(item.position?.recordedAt) + '.' : 'De bron geeft geen tijdstip van deze positie mee.' }}
              @if (item.source === 'VOYDAR' && arrived(item)) { <span>De container is aangekomen; deze kaart blijft het schip volgen.</span> }</p>
          </section>
        } @else if (!item.source) {
          <section class="tp-connect" aria-label="Scheepskaart toevoegen">
            <span class="tp-connect-icon"><app-icon name="globe" [size]="30" /></span>
            <h3>Je schip op de kaart</h3>
            <p>Koppel het schip uit je vrachtbrief om de kaart en havenmeldingen te volgen.</p>
            <button class="btn btn--primary" type="button" (click)="openVesselSettings()"><app-icon name="plus" [size]="16" />Schip koppelen</button>
          </section>
        } @else {
          <section class="tp-connect" aria-label="Geen positie beschikbaar"><app-icon name="globe" [size]="30" /><h3>Nog geen positie gemeld</h3><p>De laatste meldingen blijven hieronder beschikbaar.</p></section>
        }

        <aside class="tp-info">
          <div class="tp-check-head"><span class="tp-schedule" [class.tp-schedule--off]="!configured() || !item.automatic"><i></i>{{ item.automatic && configured() ? 'Controle elke ' + intervalHours() + ' uur' : arrived(item) ? 'Opvolging afgerond' : !configured() ? 'Controles uit' : 'Nog geen automatische opvolging' }}</span>
            @if (item.automatic) { <button class="tp-icon-button" type="button" aria-label="Tracking nu controleren" title="Meldingen nu controleren" [disabled]="!!busy() || !configured()" (click)="refresh()"><app-icon name="refresh" [size]="17" /></button> }
          </div>
          <dl class="tp-facts">
            <div class="tp-fact-wide"><dt>{{ item.source === 'VOYDAR' ? 'Laatste havenmelding' : 'Laatst gemelde locatie' }}</dt><dd>{{ item.location || 'Nog geen melding' }}</dd></div>
            @if (item.eta && item.source !== 'VOYDAR') { <div class="tp-fact-wide"><dt>Verwachte aankomst container</dt><dd>{{ time(item.eta, false) }}</dd></div> }
            <div><dt>Gecontroleerd</dt><dd>{{ item.checkedAt ? time(item.checkedAt) : 'Nog niet gecontroleerd' }}</dd></div>
            <div><dt>Volgende controle</dt><dd>{{ nextCheck() }}</dd></div>
          </dl>
          @if (carrier(); as provider) {
            <div class="tp-carrier">
              <div class="tp-carrier-title"><app-icon name="purchase" [size]="18" /><strong>Container bij {{ provider.carrier }}</strong></div>
              <p>Status en aankomst rechtstreeks bij de rederij.</p>
              <div class="tp-ref"><span><small>{{ provider.referenceLabel }}</small><code>{{ provider.reference }}</code></span><button class="tp-icon-button" type="button" [attr.aria-label]="provider.referenceLabel + ' kopiëren'" (click)="copy(provider.reference)"><app-icon name="copy" [size]="16" /></button></div>
              <a class="btn" [href]="provider.url" target="_blank" rel="noopener noreferrer">Open {{ provider.carrier }}<app-icon name="external" [size]="14" /></a>
              <span class="tp-small">Handmatige broncontrole</span>
            </div>
          } @else if (sourceLink(); as url) { <a class="btn" [href]="url" target="_blank" rel="noopener noreferrer">{{ item.source === 'VOYDAR' ? 'Bekijk scheepsmeldingen' : 'Trackingwebsite openen' }}<app-icon name="external" [size]="14" /></a> }
          @if (copyMessage()) { <p class="tp-feedback" role="status">{{ copyMessage() }}</p> }
          @if (feedback()) { <p class="tp-feedback" role="status">{{ feedback() }}</p> }
          @if (actionError()) { <p class="tp-feedback tp-feedback--error" role="alert">{{ actionError() }}</p> }
        </aside>
      </div>

      <details class="tp-details" [open]="item.events.length > 0 && item.events.length <= 3">
        <summary><span><app-icon name="activity" [size]="17" />{{ item.source === 'VOYDAR' ? 'Havenmeldingen' : 'Reisverloop' }}<span class="tp-count">{{ item.events.length }}</span></span><app-icon name="chevron-down" [size]="16" /></summary>
        <div class="tp-details-body">
          @if (item.events.length) {
            <ol class="tp-timeline">@for (event of item.events; track $index) {
              <li [class.tp-planned]="!event.actual"><div><strong>{{ event.status }}</strong>@if (!event.actual) { <span class="tp-small">Verwacht</span> }<p>{{ event.location }}</p>
                @if (event.source) { <span class="tp-small">{{ event.source }} @if (webUrl(event.sourceUrl); as url) { · <a [href]="url" target="_blank" rel="noopener noreferrer">Bron</a> }</span> }</div>
                <time [attr.datetime]="event.occurredAt">{{ time(event.occurredAt) }}</time></li>
            }</ol><p class="tp-small">Tijden in België</p>
          } @else { <p class="tp-empty-events">Er zijn nog geen {{ item.source === 'VOYDAR' ? 'havenmeldingen voor deze koppeling' : 'reisgebeurtenissen' }} beschikbaar.</p> }
        </div>
      </details>

      <details class="tp-details" #settingsSection [open]="settingsOpen()" (toggle)="settingsOpen.set($any($event.target).open)">
        <summary><span><app-icon name="settings" [size]="17" />{{ item.vesselImo ? 'Schip en bron' : 'Schip koppelen' }}</span><app-icon name="chevron-down" [size]="16" /></summary>
        <div class="tp-details-body tp-settings">
          <div>
            <h3>{{ item.vesselImo ? 'Scheepskoppeling wijzigen' : 'Schip uit je vrachtbrief' }}</h3>
            <p>Gebruik het IMO-nummer van het bevestigde schip. Bij overslag pas je deze koppeling zelf aan.</p>
            <form (submit)="$event.preventDefault(); saveVessel()">
              <label [for]="'tracking-imo-' + item.orderId">IMO-nummer <span>7 cijfers</span></label>
              <div class="tp-input-row"><input #imoInput [id]="'tracking-imo-' + item.orderId" type="text" inputmode="numeric" autocomplete="off" maxlength="16" placeholder="Bijv. 9975791"
                [value]="draft() ?? item.vesselImo ?? ''" (input)="draft.set($any($event.target).value); vesselError.set(null)" [disabled]="!!busy()" [attr.aria-invalid]="vesselError() ? 'true' : null" />
                <button class="btn btn--primary" type="submit" [disabled]="!!busy()">{{ busy() === 'save' ? 'Opslaan…' : item.vesselImo ? 'Opslaan' : 'Koppelen' }}</button></div>
              @if (vesselError()) { <p class="tp-feedback tp-feedback--error" role="alert">{{ vesselError() }}</p> }
            </form>
            <div class="tp-settings-actions"><a href="https://www.voydar.com" target="_blank" rel="noopener noreferrer">Zoek op scheepsnaam <app-icon name="external" [size]="13" /></a>
              @if (item.vesselImo) { <button class="tp-text-button" type="button" [disabled]="!!busy()" (click)="saveVessel(true)">Schip loskoppelen</button> }</div>
          </div>
          <div class="tp-source-copy"><h3>Wat deze tracking laat zien</h3>
            @if (item.source === 'VOYDAR' || !item.source) { <p>De kaart toont het gekoppelde schip, niet de exacte positie van de container. Een ETA in de kaart hoort bij het schip. De rederij bevestigt containerstatus, aankomst en overslag.</p><p>Havenmeldingen via <a href="https://www.voydar.com" target="_blank" rel="noopener noreferrer">Voydar</a> · kaart via <a href="https://www.vesselfinder.com" target="_blank" rel="noopener noreferrer">VesselFinder</a>.</p> }
            @else { <p>Containergegevens via ShipsGo. Aankomsttijden zijn verwachtingen van de vervoerder.</p> }
            <p class="tp-full-reference">{{ item.trackingReference }}</p>
            @if (item.providerUpdatedAt) { <p>Laatste bronmelding: {{ time(item.providerUpdatedAt) }}.</p> }
            @if (item.providerCheckedAt) { <p>Bron gecontroleerd: {{ time(item.providerCheckedAt) }}.</p> }
          </div>
        </div>
      </details>
    </article>
  `,
  styles: [`
    :host{display:block;min-width:0}.tp{border:1px solid var(--line);border-radius:18px;background:var(--surface);overflow:hidden;color:var(--ink)}
    .tp-head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 24px}.tp-identity{min-width:0}.tp-kicker{font-size:10px;font-weight:700;letter-spacing:.65px;color:var(--muted);text-transform:uppercase}.tp-kicker span{font-family:ui-monospace,monospace;letter-spacing:0}.tp h2{font-size:21px;line-height:1.25;letter-spacing:-.5px;margin:7px 0 10px;overflow-wrap:anywhere}.tp-status-line{display:flex;flex-wrap:wrap;gap:9px;align-items:center}.tp-ship{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600}.tp-status{font-size:10px;font-weight:650;padding:4px 7px;border-radius:6px;background:var(--surface-2);color:var(--muted)}.tp-status--ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 9%,var(--surface))}.tp-status--warn{color:var(--warn)}.tp-order{display:flex;align-items:center;white-space:nowrap;font-size:12px;font-weight:600;min-height:44px}
    .tp-body{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(245px,.8fr);border-top:1px solid var(--line)}.tp-map-area{min-width:0;background:var(--surface-2)}.tp-map{display:block;width:100%;height:400px;border:0;background:#dce8ed}.tp-map-bar{display:flex;justify-content:space-between;gap:10px;padding:11px 15px;font-size:10px;line-height:1.4}.tp-map-bar>a{display:flex;align-items:center;gap:5px;white-space:nowrap}.tp-map-note{font-size:10px;line-height:1.5;color:var(--muted);padding:0 15px 13px;margin:0}.tp-map-note span{display:block;margin-top:5px}.tp-info{min-width:0;padding:18px 20px;border-left:1px solid var(--line)}.tp-check-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.tp-schedule{font-size:10px;font-weight:650;display:flex;align-items:center;gap:6px;color:var(--ok)}.tp-schedule i{width:5px;height:5px;border-radius:50%;background:currentColor}.tp-schedule--off{color:var(--muted)}.tp-icon-button{border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink-2);width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;flex:none;cursor:pointer}.tp-icon-button:disabled{opacity:.45;cursor:default}.tp-facts{display:grid;grid-template-columns:1fr 1fr;gap:18px 12px;margin:18px 0 22px}.tp-facts>div{min-width:0}.tp-fact-wide{grid-column:1/-1}.tp-facts dt{font-size:10px;color:var(--muted);margin-bottom:5px}.tp-facts dd{font-size:12px;font-weight:600;line-height:1.5;margin:0;overflow-wrap:anywhere}
    .tp-carrier{border-top:1px solid var(--line);padding-top:18px}.tp-carrier-title{display:flex;align-items:center;gap:8px;font-size:12px}.tp-carrier p{font-size:11px;line-height:1.5;color:var(--muted);margin:8px 0}.tp-ref{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:9px 0}.tp-ref>span{min-width:0}.tp-ref small{display:block;font-size:9px;color:var(--muted);margin-bottom:3px}.tp-ref code{font-size:12px;overflow-wrap:anywhere;user-select:all}.tp-carrier>.btn{width:100%;font-size:12px;min-height:42px}.tp-carrier>.tp-small{display:block;text-align:center;margin-top:7px}.tp-small{font-size:10px;color:var(--muted);line-height:1.5}.tp-feedback{font-size:11px;line-height:1.5;margin:12px 0 0;color:var(--muted)}.tp-feedback--error{color:var(--danger)}
    .tp-connect{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px 25px;gap:12px;text-align:center;background:var(--surface-2)}.tp-connect-icon{padding:14px;background:var(--surface);border-radius:17px;color:var(--rose)}.tp-connect h3{margin:0;font-size:17px}.tp-connect p{font-size:12px;line-height:1.6;color:var(--muted);max-width:280px;margin:0}.tp-connect .btn{font-size:12px;min-height:44px;margin-top:4px}.tp-notice{display:flex;gap:8px;align-items:flex-start;padding:12px 22px;font-size:11px;line-height:1.5;background:var(--surface-2);color:var(--muted)}.tp-notice app-icon{flex:none}.tp-notice--warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 6%,var(--surface))}
    .tp-details{border-top:1px solid var(--line)}.tp-details>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;font-size:12px;font-weight:650;cursor:pointer;list-style:none;min-height:52px}.tp-details>summary::-webkit-details-marker{display:none}.tp-details>summary>span{display:flex;align-items:center;gap:8px}.tp-details[open]>summary>app-icon{transform:rotate(180deg)}.tp-count{font-size:10px;background:var(--surface-2);padding:2px 6px;border-radius:5px;color:var(--muted)}.tp-details-body{padding:0 22px 20px}.tp-empty-events{font-size:12px;color:var(--muted);margin:0;line-height:1.6}.tp-timeline{list-style:none;margin:0 0 10px;padding:0}.tp-timeline li{display:flex;justify-content:space-between;gap:15px;border-left:2px solid var(--line);padding:0 0 18px 16px;position:relative}.tp-timeline li::before{content:'';position:absolute;left:-5px;top:4px;width:8px;height:8px;border-radius:50%;background:var(--rose)}.tp-timeline li:last-child{padding-bottom:0}.tp-timeline strong{font-size:12px}.tp-timeline p{margin:4px 0;font-size:11px}.tp-timeline time{font-size:10px;color:var(--muted);line-height:1.6;flex-shrink:0}.tp-timeline .tp-planned::before{background:var(--surface);border:2px solid var(--muted)}
    .tp-settings{display:grid;grid-template-columns:1fr 1fr;gap:28px}.tp-settings>div{min-width:0}.tp-settings h3{font-size:12px;margin:0 0 8px}.tp-settings p{font-size:11px;line-height:1.6;color:var(--muted);margin:0 0 12px}.tp-settings label{display:block;font-size:11px;font-weight:650;margin:13px 0 7px}.tp-settings label span{font-weight:400;color:var(--muted);margin-left:5px}.tp-input-row{display:flex;gap:8px}.tp-input-row input{width:100%;min-width:0;border:1px solid var(--line-strong);background:var(--surface);color:var(--ink);border-radius:9px;padding:10px 11px;font-size:16px;min-height:44px}.tp-input-row .btn{font-size:12px;flex:none}.tp-input-row input[aria-invalid=true]{border-color:var(--danger)}.tp-settings-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:9px;font-size:11px}.tp-text-button{padding:10px 0;background:none;border:0;color:var(--danger);font-size:11px;cursor:pointer}.tp-settings-actions a{display:flex;align-items:center;gap:4px;min-height:40px}.tp-full-reference{overflow-wrap:anywhere;font-family:ui-monospace,monospace}.tp :is(button,a,summary,input):focus-visible{outline:2px solid var(--rose);outline-offset:3px}
    @media(max-width:1000px){.tp-body{grid-template-columns:minmax(0,1fr)}.tp-info{border-left:0;border-top:1px solid var(--line)}.tp-info .tp-facts{grid-template-columns:1.2fr 1fr 1fr}.tp-fact-wide{grid-column:auto}.tp-carrier>.btn{width:auto}.tp-carrier>.tp-small{text-align:left}.tp-carrier{display:grid;grid-template-columns:1fr auto;gap:0 20px}.tp-carrier-title,.tp-carrier>p{grid-column:1}.tp-ref{grid-column:2;grid-row:1/3;margin:0}.tp-carrier>.btn{grid-column:1}.tp-carrier>.tp-small{grid-column:2;align-self:center;margin:0}}
    @media(max-width:679px){.tp{border-radius:15px}.tp-head{padding:18px 17px;align-items:flex-start;gap:10px}.tp h2{font-size:19px}.tp-order{font-size:11px}.tp-info{padding:16px 17px}.tp-info .tp-facts{grid-template-columns:1fr 1fr;gap:16px}.tp-fact-wide{grid-column:1/-1}.tp-map-bar{padding-inline:12px;font-size:9px}.tp-map-note{padding-inline:12px}.tp-carrier{display:block}.tp-ref{margin:10px 0}.tp-carrier>.btn{width:100%;min-height:44px}.tp-carrier>.tp-small{text-align:center;margin-top:7px}.tp-details>summary{padding:16px 17px}.tp-details-body{padding:0 17px 18px}.tp-settings{grid-template-columns:1fr;gap:22px}.tp-source-copy{padding-top:18px;border-top:1px solid var(--line)}.tp-timeline li{display:block}.tp-timeline time{display:block;margin-top:7px}.tp-notice{padding-inline:17px}.tp-body--without-map .tp-connect{padding:24px 20px}.tp-icon-button{width:44px;height:44px}}
  `],
})
export class ContainerTrackingPanel {
  readonly row = input.required<ContainerTracking>();
  readonly configured = input(true);
  readonly intervalHours = input(6);
  readonly showOrderLink = input(false);
  readonly rowUpdated = output<ContainerTracking>();
  readonly busyChange = output<boolean>();
  private readonly api = inject(ContainerTrackingApi);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly settingsSection = viewChild<ElementRef<HTMLElement>>('settingsSection');
  private readonly imoInput = viewChild<ElementRef<HTMLInputElement>>('imoInput');
  private operation = 0;
  readonly busy = signal<'refresh' | 'save' | null>(null);
  readonly draft = signal<string | null>(null);
  readonly vesselError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly feedback = signal<string | null>(null);
  readonly copyMessage = signal<string | null>(null);
  readonly settingsOpen = signal(false);
  readonly identity = computed(() => `${this.row().orderId}:${this.row().trackingReference}`);
  readonly carrier = computed(() => carrierLookup(this.row()));
  readonly box = computed(() => validatedContainerReference(this.row().trackingReference));
  // Stable URL primitives keep a stored-feed refresh from reloading the user's map.
  private readonly vesselHref = computed(() => this.row().source === 'VOYDAR' ? vesselMapFrameUrl(this.row().vesselImo, window.location.origin + '/purchasing/tracking') : null);
  private readonly positionHref = computed(() => trackingMapUrl(this.row().position));
  readonly mapUrl = computed(() => {
    const href = this.vesselHref() || this.positionHref();
    return href ? this.sanitizer.bypassSecurityTrustResourceUrl(href) : null;
  });
  readonly mapHref = computed(() => this.vesselHref() || trackingMapLink(this.row().position));
  readonly sourceLink = computed(() => trackingWebUrl(this.row().trackingUrl) || trackingWebUrl(this.row().trackingReference));
  readonly stale = computed(() => trackingStale(this.row(), Date.now(), this.intervalHours()));
  readonly nextCheck = computed(() => {
    const item = this.row();
    if (!this.configured()) return 'Gepauzeerd';
    if (item.nextCheckAt) return trackingTime(item.nextCheckAt);
    if (arrivedTerminal(item)) return 'Afgerond';
    return item.automatic ? 'Eerste controle volgt' : 'Na koppelen schip';
  });
  readonly time = trackingTime;
  readonly arrived = trackingArrived;
  readonly webUrl = trackingWebUrl;

  constructor() {
    effect(() => {
      this.identity();
      untracked(() => {
        this.operation++;
        this.busy.set(null); this.busyChange.emit(false);
        this.draft.set(null); this.vesselError.set(null); this.actionError.set(null);
        this.feedback.set(null); this.copyMessage.set(null); this.settingsOpen.set(false);
      });
    });
    this.destroyRef.onDestroy(() => { this.operation++; });
  }

  async copy(reference: string): Promise<void> {
    const identity = this.identity();
    try {
      await navigator.clipboard.writeText(reference);
      if (!this.destroyRef.destroyed && identity === this.identity()) this.copyMessage.set('Referentie gekopieerd.');
    } catch {
      if (!this.destroyRef.destroyed && identity === this.identity()) this.copyMessage.set('Selecteer de referentie om te kopiëren.');
    }
  }

  openVesselSettings(): void {
    this.settingsOpen.set(true);
    afterNextRender(() => {
      this.settingsSection()?.nativeElement.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      this.imoInput()?.nativeElement.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  async refresh(): Promise<void> {
    if (this.busy() || !this.configured() || !this.row().automatic) return;
    const before = this.row();
    await this.run('refresh', () => this.api.refresh(before.orderId), updated => trackingRefreshNotice(before, updated));
  }

  async saveVessel(remove = false): Promise<void> {
    if (this.busy()) return;
    const before = this.row();
    const imo = remove ? null : normalizedVesselImo(this.draft() ?? before.vesselImo);
    if (!remove && !imo) { this.vesselError.set('Vul een geldig IMO-nummer van 7 cijfers in.'); return; }
    await this.run('save', () => this.api.setVessel(before.orderId, imo, before.trackingReference), () => remove ? 'Schip losgekoppeld.' : 'Scheepskoppeling opgeslagen.');
  }

  private async run(kind: 'refresh' | 'save', action: () => Promise<ContainerTracking>, message: (updated: ContainerTracking) => string | null): Promise<void> {
    const identity = this.identity();
    const operation = ++this.operation;
    const current = () => !this.destroyRef.destroyed && operation === this.operation && identity === this.identity();
    this.busy.set(kind); this.busyChange.emit(true);
    this.vesselError.set(null); this.actionError.set(null); this.feedback.set(null);
    try {
      const updated = await action();
      if (!current()) return;
      if (`${updated.orderId}:${updated.trackingReference}` !== identity) throw new Error('De trackingreferentie is gewijzigd. Vernieuw eerst de inkooporder.');
      this.rowUpdated.emit(updated);
      this.feedback.set(message(updated));
      if (kind === 'save') { this.draft.set(null); this.settingsOpen.set(false); }
    } catch (error) {
      if (current()) (kind === 'save' ? this.vesselError : this.actionError).set(messageOf(error, 'De controle is niet gelukt. Probeer opnieuw.'));
    } finally {
      if (current()) { this.busy.set(null); this.busyChange.emit(false); }
    }
  }
}

function arrivedTerminal(row: ContainerTracking): boolean { return row.orderStatus === 'ONTVANGEN' || row.status === 'EMPTY_RETURN'; }
