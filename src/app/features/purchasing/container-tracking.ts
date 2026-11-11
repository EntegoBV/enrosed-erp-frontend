import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { ContainerTrackingPanel } from './container-tracking-panel';
import { trackingArrived, trackingListLine, trackingProblems, trackingRows, type TrackingFilter } from './container-tracking-model';

@Component({
  selector: 'app-container-tracking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, LoadError, PageHeader, Segmented, Skeleton, ContainerTrackingPanel],
  template: `
    <!-- No "Vernieuwen" here: it only re-read stored rows and looked like a check. The page re-reads every minute and
         when it comes back into view; each row shows how old its last check is; the real check is on the panel. -->
    <app-page-header title="Track & trace" subtitle="Containers volgen" [parent]="parent" />
    <div class="content ct">
      @if (loadError(); as error) { <div class="ct-panel"><app-load-error title="Tracking kon niet worden geladen" [message]="error" [busy]="loading()" (retry)="load()" /></div> }
      @if (loading() && !feed()) { <div class="ct-panel" role="status" aria-label="Containertracking laden"><app-skeleton kind="list" [rows]="4" /></div> }
      @if (feed(); as data) {
        @if (!data.containers.length) {
          <section class="ct-panel ct-empty"><app-icon name="purchase" [size]="30" /><h2>Nog geen containers met tracking</h2>
            <p>Voeg bij een inkooporder een containernummer of BL: + nummer toe.</p><a class="btn btn--primary" routerLink="/purchasing">Naar inkooporders</a></section>
        } @else {
          <div class="ct-toolbar">
            <app-segmented [variant]="desktop.active() ? 'desk' : 'ios'" label="Containers filteren" [options]="filters()" [value]="filter()" (changed)="changeFilter($event)" />
            <label class="ct-search"><app-icon name="search" [size]="17" /><input type="search" aria-label="Container, schip of referentie zoeken" placeholder="Zoek container of schip" autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
          </div>
          @if (problemsShown(); as failed) {
            <section class="ct-alert" role="status" aria-label="Controles die niet gelukt zijn">
              <h2><app-icon name="alert" [size]="16" />Controle niet gelukt bij {{ failed.length }} {{ failed.length === 1 ? 'container' : 'containers' }}</h2>
              <ul>@for (item of failed; track item.row.orderId) {
                <li><button type="button" (click)="selectProblem(item.row)"><strong>{{ item.row.containerName || item.row.orderNumber }}</strong><span>{{ item.text }}@if (item.age) { · {{ item.age }} }</span></button></li>
              }</ul>
            </section>
          }
          <div class="ct-layout">
            <details class="ct-picker" [open]="desktop.active() || pickerOpen() || !selected()" (toggle)="pickerToggled($event)">
              <summary><span><small>Container kiezen · {{ visible().length }}</small><strong>{{ selected()?.containerName || selected()?.orderNumber || 'Kies een container' }}</strong></span><app-icon name="chevron-down" [size]="18" /></summary>
              <div class="ct-list" aria-label="Containers met tracking">
                <div class="ct-section-label"><h2>Containers</h2><span>{{ automaticCount() }} automatisch</span></div>
                @for (line of lines(); track line.row.orderId) {
                  @let row = line.row;
                  @let view = line.view;
                  <button class="ct-container" type="button" [class.ct-container--selected]="selected()?.orderId === row.orderId" [attr.aria-pressed]="selected()?.orderId === row.orderId" aria-controls="ct-detail" (click)="select(row)">
                    <span class="ct-row"><span class="ct-container-name">{{ row.containerName || row.orderNumber }}</span>
                      @if (view.arrival) { <span class="ct-arrival" [class.ct-arrival--later]="view.move?.later === true" [class.ct-arrival--earlier]="view.move?.later === false" [attr.title]="view.move ? 'Verwachte aankomst · ' + view.move.text : 'Verwachte aankomst'">{{ view.arrival }}</span> }</span>
                    <span class="ct-row"><span class="ct-status" [class.ct-status--ok]="view.status.tone === 'ok'" [class.ct-status--warn]="view.status.tone === 'warn'">{{ view.status.text }}</span>
                      @if (view.move; as move) { <span class="ct-delta" [class.ct-delta--later]="move.later" [class.ct-delta--earlier]="!move.later" [attr.title]="move.text">{{ move.short }}</span> }</span>
                    <span class="ct-row"><span class="ct-reference">{{ view.reference }}</span>
                      @if (view.age) { <span class="ct-age" [class.ct-age--warn]="view.ageWarn" title="Laatste controle">{{ view.age }}</span> }</span>
                  </button>
                } @empty { <div class="ct-no-results"><p>Geen containers gevonden.</p><button class="btn btn--sm" type="button" (click)="resetFilters()">Filters wissen</button></div> }
              </div>
            </details>
            <section id="ct-detail" class="ct-detail" #detail tabindex="-1" aria-label="Geselecteerde container">
              @for (row of selectedRows(); track row.orderId + ':' + row.trackingReference) {
                <app-container-tracking-panel [row]="row" [configured]="data.configured" [intervalHours]="data.intervalHours" [showOrderLink]="true" (busyChange)="panelBusyChanged(row, $event)" (rowUpdated)="rowUpdated($event)" />
              }
            </section>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host{display:block}.ct{max-width:1540px}.ct-panel{border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:22px;margin-bottom:18px}.ct-toolbar{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:18px}.ct-search{display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:0 12px;min-width:230px;color:var(--muted)}.ct-search input{border:0;outline:none;background:none;color:var(--ink);font-size:13px;min-height:42px;min-width:0;width:100%}.ct-search:focus-within{outline:2px solid var(--rose);outline-offset:2px}
    .ct-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:20px;align-items:start}.ct-picker{min-width:0;border:1px solid var(--line);border-radius:15px;overflow:hidden;background:var(--surface)}.ct-picker>summary{display:none}.ct-section-label{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:18px 16px 13px}.ct-section-label h2{font-size:12px;margin:0}.ct-section-label>span{font-size:10px;color:var(--muted)}.ct-container{width:100%;display:flex;flex-direction:column;gap:7px;padding:18px 16px;border:0;border-top:1px solid var(--line);background:var(--surface);text-align:left;color:var(--ink);cursor:pointer}.ct-container:hover{background:var(--surface-2)}.ct-container--selected{background:color-mix(in srgb,var(--rose) 5%,var(--surface));box-shadow:inset 3px 0 var(--rose)}.ct-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;width:100%;min-width:0}.ct-container-name{min-width:0;font-size:13px;font-weight:700;line-height:1.4;overflow-wrap:anywhere}.ct-arrival{flex:none;padding:1px 5px;margin-right:-5px;border-radius:5px;font-size:11px;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}.ct-arrival--later{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,var(--surface))}.ct-arrival--earlier{color:var(--ok);background:color-mix(in srgb,var(--ok) 10%,var(--surface))}.ct-status{min-width:0;font-size:10px;color:var(--muted)}.ct-status--ok{color:var(--ok)}.ct-status--warn{color:var(--warn)}.ct-delta,.ct-age{flex:none;font-size:10px;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--muted)}.ct-delta{font-weight:650}.ct-delta--later,.ct-age--warn{color:var(--warn)}.ct-delta--earlier{color:var(--ok)}.ct-reference{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--muted);font-family:ui-monospace,monospace}
    .ct-alert{margin-bottom:16px;padding:12px 16px;border:1px solid color-mix(in srgb,var(--warn) 30%,var(--line));border-radius:14px;background:color-mix(in srgb,var(--warn) 6%,var(--surface))}.ct-alert h2{display:flex;align-items:center;gap:7px;margin:0 0 4px;font-size:12px;color:var(--warn)}.ct-alert ul{margin:0;padding:0;list-style:none}.ct-alert button{display:flex;align-items:baseline;gap:8px;width:100%;min-height:32px;padding:5px 0;border:0;background:none;color:var(--ink);font:inherit;font-size:12px;text-align:left;cursor:pointer}.ct-alert strong{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ct-alert button span{min-width:0;color:var(--muted)}.ct-detail{min-width:0;scroll-margin-top:100px;outline:none}.ct-empty{padding:48px 24px;display:flex;align-items:center;flex-direction:column;gap:12px;text-align:center}.ct-empty>app-icon{color:var(--rose)}.ct-empty h2{font-size:20px;margin:0}.ct-empty p,.ct-no-results p{font-size:13px;color:var(--muted);line-height:1.6;margin:0 0 8px}.ct-no-results{padding:25px 16px}.ct :is(button,summary,a):focus-visible{outline:2px solid var(--rose);outline-offset:-3px}
    @media (min-width: 1024px) and (max-width: 1100px), (min-width: 680px) and (max-width: 1100px) and (hover: hover) {.ct-layout{grid-template-columns:220px minmax(0,1fr);gap:14px}}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {.ct{padding-top:12px}.ct-toolbar{flex-direction:column;align-items:stretch;gap:10px;margin-bottom:12px}.ct-search{min-width:0}.ct-search input{font-size:16px;min-height:44px}.ct-layout{grid-template-columns:minmax(0,1fr);gap:12px}.ct-picker>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;list-style:none;cursor:pointer;min-height:64px}.ct-picker>summary::-webkit-details-marker{display:none}.ct-picker>summary>span{display:flex;flex-direction:column;gap:4px;min-width:0}.ct-picker>summary small{color:var(--muted);font-size:10px}.ct-picker>summary strong{font-size:12px;line-height:1.5;overflow-wrap:anywhere}.ct-picker>summary>app-icon{flex:none}.ct-picker[open]>summary>app-icon{transform:rotate(180deg)}.ct-section-label{display:none}.ct-container{padding:16px}.ct-container-name{font-size:15px}.ct-arrival{font-size:13px}.ct-status,.ct-delta,.ct-age,.ct-reference{font-size:12px}.ct-alert{margin-bottom:12px}.ct-alert button{flex-direction:column;gap:2px;min-height:44px;font-size:13px}.ct-alert strong{max-width:none}.ct-detail{scroll-margin-top:90px}.ct-empty{padding:30px 20px}}
  `],
})
export class ContainerTrackingPage {
  private readonly api = inject(ContainerTrackingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
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
  readonly pickerOpen = signal(false);
  readonly panelBusy = signal(false);
  private request = 0;
  readonly visible = computed(() => trackingRows(this.feed()?.containers ?? [], this.filter(), this.query()));
  readonly selected = computed(() => this.visible().find(row => row.orderId === this.selectedId()) ?? this.visible()[0] ?? null);
  readonly selectedRows = computed(() => { const row = this.selected(); return row ? [row] : []; });
  private readonly selectedKey = computed(() => { const row = this.selected(); return row ? `${row.orderId}:${row.trackingReference}` : ''; });
  readonly automaticCount = computed(() => this.feed()?.containers.filter(row => row.automatic).length ?? 0);
  readonly filters = computed<SegmentOption[]>(() => {
    const rows = this.feed()?.containers ?? [];
    const arrived = rows.filter(trackingArrived).length;
    return [{ id: 'all', label: 'Alles', count: rows.length }, { id: 'active', label: 'Actief', count: rows.length - arrived }, { id: 'arrived', label: 'Aangekomen', count: arrived }];
  });
  /** Every visible row with its three lines: name and expected arrival, status, reference and check age. */
  readonly lines = computed(() => {
    const data = this.feed();
    return this.visible().map((row) => ({ row, view: trackingListLine(row, data?.configured ?? false, data?.intervalHours ?? 6) }));
  });
  /** Failed checks over all containers, whatever the filter shows. */
  readonly problems = computed(() => trackingProblems(this.feed()?.containers ?? [], this.feed()?.configured ?? false));
  /** One calm summary; not when its only line is the container whose panel already says it. */
  readonly problemsShown = computed(() => {
    const failed = this.problems();
    return failed.length && !(failed.length === 1 && failed[0].row.orderId === this.selected()?.orderId) ? failed : null;
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = Number(params.get('order'));
      this.selectedId.set(Number.isSafeInteger(id) && id > 0 ? id : null);
    });
    effect(() => { this.selectedKey(); untracked(() => this.panelBusy.set(false)); });
    void this.load();
    // Reload saved data; six-hour provider checks belong to the server.
    const timer = setInterval(() => { if (!document.hidden && !this.loading() && !this.panelBusy()) void this.load(); }, 60_000);
    const visible = () => { if (!document.hidden) void this.load(); };
    document.addEventListener('visibilitychange', visible);
    this.destroyRef.onDestroy(() => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); this.request++; });
  }

  async load(): Promise<void> {
    if (this.panelBusy() || this.loading()) return;
    const request = ++this.request;
    this.loading.set(true);
    try {
      const data = await this.api.list();
      if (this.destroyRef.destroyed || request !== this.request) return;
      this.feed.set(data); this.loadError.set(null);
    } catch (error) {
      if (this.destroyRef.destroyed || request !== this.request) return;
      this.loadError.set(messageOf(error, 'De trackinggegevens konden niet worden opgehaald. Probeer opnieuw.'));
    } finally {
      if (request === this.request && !this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  async select(row: ContainerTracking): Promise<void> {
    this.selectedId.set(row.orderId); this.pickerOpen.set(false);
    await this.router.navigate([], { relativeTo: this.route, queryParams: { order: row.orderId }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
    if (!this.desktop.active()) setTimeout(() => {
      if (this.destroyRef.destroyed || this.selected()?.orderId !== row.orderId) return;
      const el = this.detail()?.nativeElement;
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  }

  /** A line of the summary: the container may be filtered or searched away, so show everything first. */
  selectProblem(row: ContainerTracking): Promise<void> {
    this.resetFilters();
    return this.select(row);
  }

  pickerToggled(event: Event): void { if (!this.desktop.active()) this.pickerOpen.set((event.target as HTMLDetailsElement).open); }
  changeFilter(value: string): void { if (value === 'all' || value === 'active' || value === 'arrived') this.filter.set(value); }
  resetFilters(): void { this.filter.set('all'); this.query.set(''); }

  panelBusyChanged(row: ContainerTracking, busy: boolean): void {
    if (`${row.orderId}:${row.trackingReference}` !== this.selectedKey()) return;
    this.panelBusy.set(busy);
    if (busy) { this.request++; this.loading.set(false); }
  }

  rowUpdated(row: ContainerTracking): void {
    if (this.destroyRef.destroyed || `${row.orderId}:${row.trackingReference}` !== this.selectedKey()) return;
    this.request++; this.loading.set(false);
    this.feed.update(feed => feed ? { ...feed, containers: feed.containers.map(item => item.orderId === row.orderId ? row : item) } : feed);
  }
}
