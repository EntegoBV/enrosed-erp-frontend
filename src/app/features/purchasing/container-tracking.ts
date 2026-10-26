import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ContainerTrackingApi } from '../../core/api/container-tracking-api';
import type { ContainerTracking, ContainerTrackingFeed } from '../../core/api/container-tracking-models';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import {
  trackingArrived, trackingMapLink, trackingMapUrl, trackingRows, trackingStale,
  trackingTime, trackingWebUrl, type TrackingFilter,
} from './container-tracking-model';

@Component({
  selector: 'app-container-tracking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, LoadError, PageHeader, Segmented, Skeleton],
  template: `
    <app-page-header title="Track & trace" subtitle="Containers volgen" [parent]="parent">
      <button class="btn btn--sm btn--icon-mobile" type="button" (click)="load()" [disabled]="loading() || refreshing() !== null"
              aria-label="Trackingoverzicht vernieuwen" title="Opgeslagen trackinggegevens vernieuwen">
        <app-icon name="refresh" [size]="17" /><span class="ct-desk-label">Vernieuwen</span>
      </button>
    </app-page-header>

    <div class="content ct">
      @if (loadError(); as error) {
        <div class="ct-panel"><app-load-error title="Tracking kon niet worden geladen" [message]="error" [busy]="loading()" (retry)="load()" /></div>
      }
      @if (loading() && !feed()) {
        <div class="ct-panel" role="status" aria-label="Containertracking laden"><app-skeleton kind="list" [rows]="4" /></div>
      }
      @if (feed(); as data) {
        <section class="ct-intro" aria-label="Automatische opvolging">
          <div class="ct-intro__icon"><app-icon name="globe" [size]="25" /></div>
          <div class="ct-intro__copy">
            <h2>Je containers in beeld</h2>
            <p>{{ data.configured ? 'Status, aankomst en de laatst gemelde locatie op één plek.' : 'Alle containers met een trackingreferentie staan hier klaar.' }}</p>
          </div>
          <span class="ct-schedule" [class.ct-schedule--off]="!data.configured">
            <span class="ct-dot" aria-hidden="true"></span>{{ data.configured ? 'Elke ' + data.intervalHours + ' uur' : 'Nog niet gekoppeld' }}
          </span>
        </section>

        @if (!data.configured) {
          <section class="ct-notice" aria-labelledby="ct-setup-title">
            <app-icon name="info" [size]="21" />
            <div><h3 id="ct-setup-title">Automatische tracking activeren</h3>
              <p>Koppel ShipsGo om status, verwachte aankomst en beschikbare locaties om de {{ data.intervalHours }} uur te controleren. Tot die tijd blijven je trackingreferenties hier zichtbaar.</p>
              <a href="https://shipsgo.com/ocean" target="_blank" rel="noopener noreferrer">ShipsGo bekijken <app-icon name="external" [size]="14" /></a>
            </div>
          </section>
        }

        @if (!data.containers.length) {
          <section class="ct-panel ct-empty">
            <span class="ct-empty__icon"><app-icon name="purchase" [size]="31" /></span>
            <h2>Nog geen containers met tracking</h2>
            <p>Voeg bij een inkooporder een containernummer, B/L of trackinglink toe. De container verschijnt dan automatisch in dit overzicht.</p>
            <a class="btn btn--primary" routerLink="/purchasing">Naar inkooporders</a>
          </section>
        } @else {
          <div class="ct-toolbar">
            <app-segmented [variant]="desktop.active() ? 'desk' : 'ios'" label="Containers filteren"
                           [options]="filters()" [value]="filter()" (changed)="changeFilter($event)" />
            <label class="ct-search"><app-icon name="search" [size]="18" />
              <input type="search" aria-label="Container, schip of referentie zoeken" placeholder="Zoek container of schip"
                     autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" />
            </label>
          </div>

          <div class="ct-layout">
            <section class="ct-list" aria-label="Containers met tracking">
              <div class="ct-section-label"><h2>Containers</h2><span>{{ visible().length }} van {{ data.containers.length }}</span></div>
              @for (row of visible(); track row.orderId) {
                <button class="ct-container" type="button" [class.ct-container--selected]="selected()?.orderId === row.orderId"
                        [attr.aria-pressed]="selected()?.orderId === row.orderId" aria-controls="ct-detail"
                        (click)="select(row)">
                  <span class="ct-container__top"><strong>{{ row.containerName || row.orderNumber }}</strong>
                    <span class="ct-status" [class.ct-status--warn]="!!row.error || row.status === 'UNSUPPORTED'"
                          [class.ct-status--ok]="arrived(row)">{{ row.statusLabel }}</span>
                  </span>
                  <span class="ct-reference">{{ row.trackingReference }}</span>
                  <span class="ct-container__bottom"><span>{{ row.location || row.vessel || 'Locatie nog niet bekend' }}</span><app-icon name="chevron-right" [size]="16" /></span>
                  @if (row.eta) { <span class="ct-container__eta">Aankomst {{ time(row.eta, false) }}</span> }
                  @if (row.error && data.configured) { <span class="ct-container__warning"><app-icon name="alert" [size]="13" />Controle vraagt aandacht</span> }
                </button>
              } @empty {
                <div class="ct-panel ct-empty ct-empty--small"><h3>Geen containers gevonden</h3>
                  <p>{{ query() ? 'Probeer een andere naam, referentie of schip.' : 'Er zijn geen containers in deze selectie.' }}</p>
                  <button class="btn btn--sm" type="button" (click)="resetFilters()">Alle containers tonen</button>
                </div>
              }
            </section>

            @if (selected(); as row) {
              <section #detail class="ct-panel ct-detail" id="ct-detail" tabindex="-1" aria-labelledby="ct-detail-title">
                <div class="ct-detail__head">
                  <div><span class="ct-eyebrow">Container volgen</span><h2 id="ct-detail-title">{{ row.containerName || row.orderNumber }}</h2>
                    <span class="ct-reference">{{ row.trackingReference }}</span>
                  </div>
                  <a class="ct-order-link" [routerLink]="['/purchasing', row.orderId]" aria-label="Bijbehorende inkooporder openen">Order <app-icon name="chevron-right" [size]="15" /></a>
                </div>

                <div class="ct-journey">
                  <span class="ct-status" [class.ct-status--warn]="!!row.error" [class.ct-status--ok]="arrived(row)">{{ row.statusLabel }}</span>
                  @if (row.vessel) { <span>{{ row.vessel }}</span> }
                  @if (row.carrier) { <span class="ct-muted">{{ row.carrier }}</span> }
                </div>

                @if (mapUrl(); as map) {
                  <div class="ct-map">
                    <iframe [src]="map" [title]="'Laatst gemelde locatie van ' + (row.containerName || row.orderNumber)"
                            loading="lazy" referrerpolicy="no-referrer"></iframe>
                    <div class="ct-map__caption"><span>{{ row.position?.kind === 'VESSEL' ? 'Scheepspositie volgens ShipsGo' : 'Laatst gemelde locatie' }}</span>
                      <a [href]="mapLink(row.position)" target="_blank" rel="noopener noreferrer" aria-label="Locatie op een grotere kaart openen">Grotere kaart <app-icon name="external" [size]="13" /></a>
                    </div>
                  </div>
                  <p class="ct-source-note">{{ row.position?.kind === 'VESSEL' ? 'De kaart toont de positie van het schip dat de bron aan deze container koppelt.' : 'De kaart toont de laatst gemelde haven of locatie van de container.' }}
                    {{ row.position?.recordedAt ? 'Positie gemeld op ' + time(row.position?.recordedAt) + '.' : 'De bron geeft geen tijdstip van deze positie mee.' }}</p>
                } @else {
                  <div class="ct-map-empty"><app-icon name="globe" [size]="40" /><h3>Nog geen locatie gemeld</h3>
                    <p>{{ data.configured ? 'Zodra de trackingbron een locatie doorgeeft, verschijnt die hier op de kaart.' : 'Na het koppelen verschijnt hier de locatie die ShipsGo doorgeeft.' }}</p>
                  </div>
                }

                @if (row.error && data.configured) {
                  <div class="ct-alert" role="status"><app-icon name="alert" [size]="18" /><div>
                    <strong>{{ row.updatedAt ? 'Laatste controle niet gelukt' : 'Tracking vraagt aandacht' }}</strong><p>{{ row.error }}</p>
                    @if (row.updatedAt) { <p>De laatst bekende gegevens van {{ time(row.updatedAt) }} blijven zichtbaar.</p> }
                  </div></div>
                } @else if (isStale(row) && data.configured) {
                  <div class="ct-alert" role="status"><app-icon name="info" [size]="18" /><p>De laatste succesvolle controle is langer dan {{ data.intervalHours }} uur geleden. De kaart toont de laatst bekende locatie.</p></div>
                }

                <dl class="ct-facts">
                  <div><dt>Verwachte aankomst</dt><dd>{{ time(row.eta, false) }}</dd></div>
                  <div><dt>Laatst gemelde locatie</dt><dd>{{ row.location || 'Nog niet bekend' }}</dd></div>
                  <div><dt>Laatste controle</dt><dd>{{ row.checkedAt ? time(row.checkedAt) : 'Nog niet gecontroleerd' }}</dd></div>
                  <div><dt>Volgende controle</dt><dd>{{ nextCheck(row, data.configured) }}</dd></div>
                  @if (row.changedAt) { <div><dt>Laatste wijziging gevonden</dt><dd>{{ time(row.changedAt) }}</dd></div> }
                  @if (row.providerCheckedAt) { <div><dt>Bron gecontroleerd</dt><dd>{{ time(row.providerCheckedAt) }}</dd></div> }
                </dl>

                <div class="ct-detail__actions">
                  <button class="btn btn--primary" type="button" [disabled]="!canRefresh(row)" [attr.aria-busy]="refreshing() === row.orderId" (click)="refresh(row)">
                    <app-icon name="refresh" [size]="16" />{{ refreshing() === row.orderId ? 'Controleren…' : 'Nu controleren' }}
                  </button>
                  @if (webUrl(row.trackingUrl); as url) { <a class="btn" [href]="url" target="_blank" rel="noopener noreferrer">Trackingwebsite <app-icon name="external" [size]="15" /></a> }
                </div>
                @if (actionOrderId() === row.orderId) {
                  @if (actionError(); as error) { <p class="ct-action-error" role="alert">{{ error }}</p> }
                  @if (actionMessage(); as message) { <p class="ct-action-message" role="status">{{ message }}</p> }
                }
                @if (row.status === 'UNSUPPORTED' || row.status === 'UNCONFIGURED') {
                  <div class="ct-reference-help"><p>Gebruik een containernummer, <b>BL:</b> gevolgd door het master-B/L of <b>BOOKING:</b> gevolgd door het boekingsnummer. Een interne referentie of house-B/L is mogelijk niet traceerbaar.</p>
                    <a [routerLink]="['/purchasing', row.orderId, 'edit']">Trackingreferentie aanpassen ›</a>
                  </div>
                }

                <section class="ct-events" aria-labelledby="ct-events-title">
                  <div class="ct-section-label"><h3 id="ct-events-title">Reisverloop</h3><span>Tijden in België</span></div>
                  @if (row.events.length) {
                    <ol class="ct-timeline">
                      @for (event of row.events; track $index) {
                        <li [class.ct-timeline__planned]="!event.actual">
                          <span class="ct-timeline__dot" aria-hidden="true"></span>
                          <div><strong>{{ event.status }}</strong>@if (!event.actual) { <span class="ct-planned">Verwacht</span> }
                            @if (event.location) { <p>{{ event.location }}</p> }
                            <time [attr.datetime]="event.occurredAt">{{ time(event.occurredAt) }}</time>
                          </div>
                        </li>
                      }
                    </ol>
                  } @else { <p class="ct-events__empty">Er zijn nog geen reisgebeurtenissen gemeld.</p> }
                </section>
              </section>
            }
          </div>
          <p class="ct-footer">{{ data.configured ? 'Actieve containers worden op de server elke ' + data.intervalHours + ' uur gecontroleerd, ook als dit scherm gesloten is.' : 'Automatische controles starten zodra de trackingdienst gekoppeld is.' }}
            Aankomsttijden zijn verwachtingen van de vervoerder.</p>
        }
      }
    </div>
  `,
  styles: [`
    .ct-reference-help{font-size:11px;line-height:1.6;color:var(--muted);margin:0 24px 20px}.ct-reference-help p{margin:0 0 6px}.ct-reference-help a{font-weight:650}
    :host{display:block;min-width:0}.ct{max-width:1400px;margin:auto;padding-bottom:110px}.ct-panel{border:1px solid var(--line);border-radius:20px;background:var(--surface);overflow:hidden}.ct-intro{display:flex;align-items:center;gap:15px;margin:4px 0 22px}.ct-intro__icon{width:52px;height:52px;border-radius:16px;background:var(--rose-soft);color:var(--rose-dark);display:grid;place-items:center;flex:none}.ct-intro__copy{flex:1;min-width:0}.ct-intro h2{font-size:21px;line-height:1.2;margin:0 0 5px;font-weight:750;letter-spacing:-.4px}.ct-intro p{font-size:13px;color:var(--muted);margin:0;line-height:1.5}.ct-schedule{display:flex;align-items:center;gap:7px;white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:8px 12px;color:var(--rose-dark);font-size:12px;font-weight:700;background:var(--surface)}.ct-schedule--off{color:var(--muted)}.ct-dot{width:6px;height:6px;border-radius:50%;background:currentColor}.ct-notice{display:flex;gap:11px;padding:17px 19px;border-radius:16px;background:var(--rose-soft);border:1px solid color-mix(in srgb,var(--rose) 20%,transparent);margin-bottom:22px;color:var(--rose-dark)}.ct-notice>app-icon{flex:none;margin-top:2px}.ct-notice h3{font-size:14px;margin:0 0 5px}.ct-notice p{max-width:850px;line-height:1.55;font-size:13px;margin:0}.ct-notice a{display:inline-flex;gap:6px;align-items:center;font-size:13px;font-weight:700;margin-top:9px;color:inherit}.ct-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 22px}.ct-search{display:flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:0 12px;min-height:40px;width:300px;color:var(--muted)}.ct-search input{border:0;background:transparent;outline:none;width:100%;min-width:0;font-size:13px}.ct-search:focus-within{outline:2px solid var(--rose);outline-offset:2px}.ct-layout{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:22px;align-items:start}.ct-list{display:grid;gap:10px;min-width:0}.ct-section-label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:2px}.ct-section-label h2,.ct-section-label h3{font-size:13px;font-weight:750;margin:0}.ct-section-label>span{font-size:11px;color:var(--muted)}.ct-container{display:grid;gap:6px;border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:16px;text-align:left;cursor:pointer;min-width:0;transition:border-color var(--dur-1,120ms),background var(--dur-1,120ms)}.ct-container:hover{border-color:var(--line-strong)}.ct-container--selected{border-color:var(--rose);background:color-mix(in srgb,var(--rose-soft) 50%,var(--surface));box-shadow:inset 3px 0 0 var(--rose)}.ct-container:focus-visible{outline:2px solid var(--rose);outline-offset:3px}.ct-container__top{display:flex;align-items:start;justify-content:space-between;gap:8px;min-width:0}.ct-container__top>strong{font-size:14px;line-height:1.35;overflow-wrap:anywhere}.ct-status{display:inline-flex;align-items:center;justify-content:center;flex:none;border-radius:7px;padding:4px 7px;background:var(--surface-2);border:1px solid var(--line);font-size:10px;font-weight:700;color:var(--muted);line-height:1.3}.ct-status--ok{background:color-mix(in srgb,var(--ok) 9%,var(--surface));color:var(--ok);border-color:color-mix(in srgb,var(--ok) 20%,transparent)}.ct-status--warn{background:color-mix(in srgb,var(--warn) 9%,var(--surface));color:var(--warn);border-color:color-mix(in srgb,var(--warn) 20%,transparent)}.ct-reference{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.ct-container__bottom{display:flex;align-items:center;justify-content:space-between;gap:7px;font-size:12px;line-height:1.4;margin-top:4px}.ct-container__bottom>span{overflow-wrap:anywhere}.ct-container__bottom>app-icon{flex:none;color:var(--muted)}.ct-container__eta{font-size:11px;color:var(--muted)}.ct-container__warning{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--warn);margin-top:3px}.ct-detail{min-width:0;scroll-margin-top:80px}.ct-detail:focus{outline:none}.ct-detail__head{padding:23px 24px 12px;display:flex;gap:12px;align-items:center;justify-content:space-between}.ct-detail__head>div{min-width:0}.ct-eyebrow{display:block;text-transform:uppercase;letter-spacing:1.1px;color:var(--muted);font-size:9px;font-weight:750;margin-bottom:6px}.ct-detail__head h2{font-size:22px;line-height:1.25;letter-spacing:-.5px;overflow-wrap:anywhere;margin:0 0 6px}.ct-order-link{display:inline-flex;align-items:center;gap:2px;flex:none;font-size:12px;font-weight:650;min-height:44px;text-decoration:none}.ct-journey{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:0 24px 20px;font-size:12px}.ct-muted{color:var(--muted)}.ct-map{margin:0 16px;border:1px solid var(--line);border-radius:14px;overflow:hidden}.ct-map iframe{display:block;width:100%;height:310px;border:0;background:#d9e8ed}.ct-map__caption{display:flex;justify-content:space-between;gap:10px;align-items:center;background:var(--surface-2);padding:10px 12px;font-size:10px;color:var(--muted)}.ct-map__caption a{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.ct-source-note{font-size:11px;line-height:1.5;color:var(--muted);margin:11px 24px 0}.ct-map-empty{display:flex;min-height:230px;margin:0 16px;align-items:center;justify-content:center;flex-direction:column;border-radius:14px;background:linear-gradient(145deg,color-mix(in srgb,var(--rose-soft) 40%,var(--surface)),var(--surface-2));border:1px dashed var(--line-strong);padding:26px;color:var(--muted);text-align:center}.ct-map-empty>app-icon{color:var(--rose);opacity:.75}.ct-map-empty h3{font-size:15px;color:var(--ink);margin:14px 0 7px}.ct-map-empty p{font-size:12px;line-height:1.6;max-width:300px;margin:0}.ct-alert{display:flex;align-items:flex-start;gap:9px;margin:17px 24px 0;padding:12px;border-radius:10px;background:color-mix(in srgb,var(--warn) 8%,var(--surface));color:var(--warn);font-size:12px;line-height:1.5}.ct-alert>app-icon{flex:none;margin-top:2px}.ct-alert strong{font-size:12px}.ct-alert p{margin:0}.ct-alert strong+p{margin-top:4px}.ct-facts{display:grid;grid-template-columns:1fr 1fr;gap:18px 22px;margin:0;padding:23px 24px}.ct-facts>div{min-width:0}.ct-facts dt{font-size:11px;color:var(--muted);margin-bottom:5px}.ct-facts dd{font-size:13px;font-weight:650;margin:0;line-height:1.5;overflow-wrap:anywhere}.ct-detail__actions{display:flex;gap:9px;flex-wrap:wrap;padding:0 24px 22px}.ct-detail__actions .btn{min-height:42px;font-size:12px}.ct-action-error,.ct-action-message{font-size:12px;line-height:1.5;margin:0 24px 18px}.ct-action-error{color:var(--danger)}.ct-action-message{color:var(--muted)}.ct-events{border-top:1px solid var(--line);padding:20px 24px 24px}.ct-events__empty{font-size:12px;color:var(--muted);line-height:1.5;margin:16px 0 0}.ct-timeline{list-style:none;margin:20px 0 0;padding:0}.ct-timeline li{position:relative;display:flex;gap:14px;padding-bottom:22px}.ct-timeline li:last-child{padding-bottom:0}.ct-timeline li:not(:last-child)::before{content:'';position:absolute;top:13px;bottom:-2px;left:4px;width:1px;background:var(--line-strong)}.ct-timeline__dot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:4px;background:var(--rose);position:relative;z-index:1}.ct-timeline__planned .ct-timeline__dot{background:var(--surface);border:2px solid var(--line-strong)}.ct-timeline strong{font-size:12px;line-height:1.45}.ct-timeline p{font-size:12px;margin:4px 0;color:var(--ink-2)}.ct-timeline time{display:block;font-size:11px;color:var(--muted);margin-top:4px}.ct-planned{margin-left:7px;font-size:10px;color:var(--muted)}.ct-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:50px 24px;gap:12px}.ct-empty__icon{color:var(--rose);background:var(--rose-soft);border-radius:18px;padding:16px}.ct-empty h2{font-size:20px;margin:6px 0 0}.ct-empty h3{font-size:14px;margin:0}.ct-empty p{font-size:13px;line-height:1.6;max-width:440px;color:var(--muted);margin:0}.ct-empty .btn{margin-top:8px}.ct-empty--small{padding:28px 16px}.ct-footer{font-size:11px;line-height:1.65;color:var(--muted);margin:22px 0 0;max-width:800px}
    @media(max-width:1050px){.ct-layout{grid-template-columns:minmax(235px,290px) minmax(0,1fr);gap:16px}.ct-container__top{flex-direction:column}.ct-schedule{font-size:11px}.ct-intro{flex-wrap:wrap}.ct-detail__head{padding:20px 18px 12px}.ct-journey{padding-inline:18px}.ct-facts{padding:21px 18px;gap:16px}.ct-detail__actions{padding-inline:18px}.ct-events{padding-inline:18px}}
    @media(max-width:679px){.ct{padding:16px 16px 110px}.ct-desk-label{display:none}.ct-intro{display:grid;grid-template-columns:44px minmax(0,1fr);gap:11px;margin:4px 0 17px}.ct-intro__copy{min-width:0}.ct-intro__icon{width:44px;height:44px;border-radius:13px}.ct-intro h2{font-size:18px}.ct-intro p{font-size:12px}.ct-schedule{grid-column:2;justify-self:start;margin-left:0;padding:6px 10px}.ct-notice{padding:14px;gap:9px;margin-bottom:20px}.ct-notice p{font-size:12px}.ct-notice h3{font-size:13px}.ct-toolbar{display:grid;gap:12px;margin-bottom:19px}.ct-search{width:100%;min-height:44px}.ct-search input{font-size:16px}.ct-layout{grid-template-columns:minmax(0,1fr);gap:22px}.ct-container__top{flex-direction:row;align-items:start}.ct-container{padding:14px}.ct-detail{border-radius:17px}.ct-detail__head h2{font-size:21px}.ct-map{margin:0 12px}.ct-map iframe{height:290px}.ct-map__caption{flex-wrap:wrap;line-height:1.4}.ct-map-empty{margin:0 12px;min-height:215px}.ct-facts{gap:19px 14px}.ct-facts dd{font-size:12px}.ct-detail__actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ct-detail__actions .btn{min-height:44px;padding-inline:9px;font-size:11px}.ct-source-note{margin-inline:18px}.ct-alert{margin-inline:18px}.ct-footer{font-size:10px}.ct-timeline strong{font-size:13px}}
    @media(prefers-reduced-motion:reduce){.ct-container{transition:none}}
  `],
})
export class ContainerTrackingPage {
  private readonly api = inject(ContainerTrackingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  readonly desktop = inject(DesktopViewport);
  readonly detail = viewChild<ElementRef<HTMLElement>>('detail');
  readonly parent = { label: 'Inkoop', url: '/purchasing', phoneLabel: 'Inkoop' };
  readonly feed = signal<ContainerTrackingFeed | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly query = signal('');
  readonly filter = signal<TrackingFilter>('all');
  readonly selectedId = signal<number | null>(null);
  readonly refreshing = signal<number | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly actionMessage = signal<string | null>(null);
  readonly actionOrderId = signal<number | null>(null);
  private readonly now = signal(Date.now());
  private request = 0;

  readonly visible = computed(() => trackingRows(this.feed()?.containers ?? [], this.filter(), this.query()));
  readonly selected = computed(() => this.visible().find((row) => row.orderId === this.selectedId()) ?? this.visible()[0] ?? null);
  readonly filters = computed<SegmentOption[]>(() => {
    const rows = this.feed()?.containers ?? [];
    const arrived = rows.filter(trackingArrived).length;
    return [{ id: 'all', label: 'Alles', count: rows.length },
      { id: 'active', label: 'Actief', count: rows.length - arrived },
      { id: 'arrived', label: 'Aangekomen', count: arrived }];
  });
  readonly mapUrl = computed(() => {
    const url = trackingMapUrl(this.selected()?.position);
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });
  readonly time = trackingTime;
  readonly arrived = trackingArrived;
  readonly webUrl = trackingWebUrl;
  readonly mapLink = trackingMapLink;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('order'));
      this.selectedId.set(Number.isSafeInteger(id) && id > 0 ? id : null);
    });
    void this.load();
    // Reload saved data while the page is visible; provider polling belongs to the server.
    const timer = setInterval(() => {
      this.now.set(Date.now());
      if (!document.hidden && !this.loading() && this.refreshing() === null) void this.load(true);
    }, 60_000);
    this.destroyRef.onDestroy(() => { clearInterval(timer); this.request++; });
  }

  async load(quiet = false): Promise<void> {
    if (this.refreshing() !== null) return;
    const request = ++this.request;
    if (!quiet) this.loading.set(true);
    try {
      const data = await this.api.list();
      if (this.destroyRef.destroyed || request !== this.request) return;
      this.feed.set(data);
      this.loadError.set(null);
      this.now.set(Date.now());
    } catch (error) {
      if (this.destroyRef.destroyed || request !== this.request) return;
      this.loadError.set(messageOf(error, 'De trackinggegevens konden niet worden opgehaald. Probeer opnieuw.'));
    } finally {
      if (request === this.request && !this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  async select(row: ContainerTracking): Promise<void> {
    this.selectedId.set(row.orderId);
    this.actionError.set(null);
    this.actionMessage.set(null);
    // The app restores navigation to the top; this in-page selection owns its scroll instead.
    await this.router.navigate([], { relativeTo: this.route, queryParams: { order: row.orderId }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
    if (!this.desktop.active()) setTimeout(() => {
      if (this.destroyRef.destroyed) return;
      const el = this.detail()?.nativeElement;
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  }

  changeFilter(value: string): void {
    if (value === 'all' || value === 'active' || value === 'arrived') this.filter.set(value);
    this.actionError.set(null);
    this.actionMessage.set(null);
  }

  resetFilters(): void { this.filter.set('all'); this.query.set(''); }

  isStale(row: ContainerTracking): boolean {
    return trackingStale(row, this.now(), this.feed()?.intervalHours ?? 6);
  }

  nextCheck(row: ContainerTracking, configured: boolean): string {
    if (!configured) return 'Na koppelen';
    if (row.nextCheckAt) return trackingTime(row.nextCheckAt);
    if (row.orderStatus === 'ONTVANGEN' || row.status === 'EMPTY_RETURN') return 'Tracking afgerond';
    if (row.status === 'UNSUPPORTED') return 'Referentie aanvullen';
    return 'Wacht op eerste controle';
  }

  canRefresh(row: ContainerTracking): boolean {
    return !!this.feed()?.configured && this.refreshing() === null && row.status !== 'UNSUPPORTED';
  }

  async refresh(row: ContainerTracking): Promise<void> {
    if (!this.canRefresh(row)) return;
    this.request++;
    this.loading.set(false);
    this.refreshing.set(row.orderId);
    this.actionOrderId.set(row.orderId);
    this.actionError.set(null);
    this.actionMessage.set(null);
    try {
      const updated = await this.api.refresh(row.orderId);
      if (this.destroyRef.destroyed) return;
      this.request++;
      this.feed.update((feed) => feed ? { ...feed, containers: feed.containers.map((item) => item.orderId === updated.orderId ? updated : item) } : feed);
      this.now.set(Date.now());
      if (this.selected()?.orderId === row.orderId) {
        this.actionMessage.set(updated.error ? null : updated.changedAt && updated.changedAt !== row.changedAt
          ? 'Er is een wijziging gevonden. De tracking is bijgewerkt.' : 'Controle afgerond. Er zijn geen nieuwe wijzigingen gemeld.');
      }
    } catch (error) {
      if (!this.destroyRef.destroyed && this.selected()?.orderId === row.orderId) {
        this.actionError.set(messageOf(error, 'De controle is niet gelukt. Je laatst bekende tracking blijft bewaard.'));
      }
    } finally {
      if (!this.destroyRef.destroyed) this.refreshing.set(null);
    }
  }
}
