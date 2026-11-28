import {
  ChangeDetectionStrategy, Component, DestroyRef, Injector, afterNextRender, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { DOCUMENT, Location } from '@angular/common';
import { ActivatedRoute, Router, Scroll } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import type { PartnerContainer } from '../../core/api/partner-portal-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { PartnerCalendar } from './partner-calendar';
import { PartnerContainerTable } from './partner-container-table';
import { PartnerContainersData } from './partner-containers-data';
import { isReceived } from './partner-containers-model';
import { count } from './partner-format';
import { PartnerHead } from './partner-head';

type Filter = 'alle' | 'komt' | 'binnen';
type View = 'lijst' | 'kalender';

const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'komt', label: 'Komt eraan' },
  { key: 'binnen', label: 'Aangekomen' },
];

/**
 * Inkooporders (2026-11-28, until then "Containers"): every purchase order of Enrosed's that is not a concept, as
 * one table: what is coming first (the nearest arrival first), then what arrived (the newest first), each with the
 * day it left and the port, the arrival at the port and in Zaltbommel, the cargo and its pakbon (PDF, no price).
 * Alle · Komt eraan · Aangekomen narrow it; Lijst | Kalender shows the same containers on their arrival days instead
 * (one view at a time: the list no longer stands beside the month). `?container=<id>` selects one: it opens, is
 * highlighted and scrolled to (the Overzicht's Bekijk, a calendar chip). A pick on the page writes the address with
 * Location.replaceState, never a navigation (the router's scroll-to-top would throw him back up). Never a price,
 * amount or supplier: the server sends none.
 */
@Component({
  selector: 'app-partner-containers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadError, Skeleton, PartnerCalendar, PartnerContainerTable, PartnerHead],
  template: `
    <app-partner-head title="Inkooporders" [sub]="desk.active() ? 'Alle containers van Enrosed, zonder prijzen' : null">
      @if (page()) {
        <div class="pc-tools">
          @if (view() === 'lijst') {
            <div class="pc-seg" role="group" aria-label="Welke inkooporders">
              @for (item of filters; track item.key) {
                <button type="button" class="pc-seg__btn" [attr.aria-pressed]="filter() === item.key" (click)="filter.set(item.key)">
                  {{ item.label }} <span class="pc-seg__n">{{ num(counts()[item.key]) }}</span>
                </button>
              }
            </div>
          }
          <div class="pc-seg" role="group" aria-label="Weergave">
            <button type="button" class="pc-seg__btn" [attr.aria-pressed]="view() === 'lijst'" (click)="view.set('lijst')">Lijst</button>
            <button type="button" class="pc-seg__btn" [attr.aria-pressed]="view() === 'kalender'" (click)="view.set('kalender')">Kalender</button>
          </div>
        </div>
      }
    </app-partner-head>
    @if (page(); as p) {
      @if (view() === 'kalender') {
        <section class="pc-card pc-card--cal" aria-label="Kalender">
          <app-partner-calendar [containers]="p.containers" [today]="p.serverDate" [selectedId]="selected()" (picked)="fromCalendar($event)" />
        </section>
      } @else if (shown().length) {
        <div class="pc-card pc-card--table">
          <app-partner-container-table [containers]="shown()" [specs]="data.specs()" [order]="data.order()" [today]="p.serverDate"
                                       [selectedId]="selected()" [expanded]="expanded()"
                                       [warehouseName]="p.warehouseName || 'Zaltbommel'" (toggled)="toggle($event)" />
        </div>
        @if (palletNote()) { <p class="pc-note">{{ palletNote() }}</p> }
      } @else {
        <p class="pc-none">{{ emptyText() }}</p>
      }
    } @else if (data.failure()) {
      <app-load-error [message]="failureText()" [busy]="data.loading()" (retry)="reload()" />
    } @else {
      <app-skeleton [kind]="desk.active() ? 'table' : 'card'" [rows]="6" />
    }
  `,
  styles: `
    :host{display:block;padding-bottom:calc(24px + var(--safe-b,0px))}
    .pc-tools{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px}
    .pc-seg{display:inline-flex;padding:2px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
    .pc-seg__btn{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 11px;border:0;border-radius:8px;background:transparent;color:var(--ink-2);font:inherit;font-size:13px;font-weight:650;white-space:nowrap;cursor:pointer}
    .pc-seg__btn:hover{color:var(--ink)}
    .pc-seg__btn[aria-pressed=true]{background:var(--rose-soft);color:var(--rose-dark)}
    .pc-seg__btn:focus-visible{outline:2px solid var(--rose-dark);outline-offset:-2px}
    .pc-seg__n{color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums}
    .pc-seg__btn[aria-pressed=true] .pc-seg__n{color:inherit}
    .pc-card{border:1px solid var(--line);border-radius:14px;background:var(--surface);--wk-sticky-top:var(--pp-sticky-top,0px)}
    .pc-card--cal{overflow:hidden}
    .pc-note{margin:8px 4px 0;color:var(--muted);font-size:12.5px}
    .pc-none{margin:0;padding:22px;border-radius:14px;background:var(--surface);color:var(--muted);text-align:center}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      :host ::ng-deep app-partner-head{flex-wrap:wrap}
      .pc-tools{flex:1 0 100%;justify-content:flex-start}
      .pc-seg__btn{min-height:40px;padding:0 12px;font-size:14px}
      .pc-card--cal{border:0;border-radius:20px}
      .pc-card--table{border:0;background:transparent}
      .pc-note{margin:10px 6px 0;font-size:13px}
    }
  `,
})
export class PartnerContainers {
  readonly data = inject(PartnerContainersData);
  readonly desk = inject(DesktopViewport);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly injector = inject(Injector);
  private readonly doc = inject(DOCUMENT);

  readonly filters = FILTERS;
  readonly page = this.data.page;
  readonly failureText = computed(() => messageOf(this.data.failure(), LOAD_ERROR_FALLBACK));

  readonly filter = signal<Filter>('alle');
  readonly view = signal<View>('lijst');
  readonly selected = signal<number | null>(null);
  readonly expanded = signal<ReadonlySet<number>>(new Set());
  /** The ?container of the address. */
  private readonly requested = signal<number | null>(null);
  /** The request already acted on (opened and scrolled to). */
  private applied: number | null = null;
  /** The container to show again after the router's scroll-to-top of the navigation that brought him here. */
  private pendingScroll: number | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  /** The server's order: open ones by arrival, then the received ones newest first. */
  private readonly all = computed<PartnerContainer[]>(() => this.page()?.containers ?? []);

  readonly counts = computed<Record<Filter, number>>(() => {
    const all = this.all();
    const received = all.filter((container) => isReceived(container)).length;
    return { alle: all.length, komt: all.length - received, binnen: received };
  });

  readonly shown = computed<PartnerContainer[]>(() => {
    const filter = this.filter();
    const all = this.all();
    if (filter === 'komt') return all.filter((container) => !isReceived(container));
    if (filter === 'binnen') return all.filter((container) => isReceived(container));
    return all;
  });

  readonly emptyText = computed(() => {
    if (!this.all().length) return 'Er zijn nog geen inkooporders.';
    return this.filter() === 'komt' ? 'Er komt nu geen container aan.' : 'Er is nog geen container aangekomen.';
  });

  readonly palletNote = computed(() => {
    const pallet = this.page()?.pallet;
    return pallet
      ? `± Pallets: geschat op europallets van ${count(pallet.widthCm)} × ${count(pallet.depthCm)} cm, tot ${count(pallet.maxHeightCm)} cm hoog, elk product apart.`
      : null;
  });

  constructor() {
    void this.data.load();
    const query = this.route.queryParamMap.subscribe((params) => {
      const value = Number(params.get('container'));
      this.requested.set(Number.isSafeInteger(value) && value > 0 ? value : null);
    });
    /* Arriving from the Overzicht: the router scrolls to the top after the page has rendered; show the row after that. */
    const scrolls = this.router.events.subscribe((event) => {
      /* The router's own scroller hears this event after us: go on the next task, once it has scrolled to the top. */
      if (event instanceof Scroll && this.pendingScroll !== null) {
        const id = this.pendingScroll;
        setTimeout(() => this.scrollTo(id));
      }
    });
    inject(DestroyRef).onDestroy(() => {
      query.unsubscribe();
      scrolls.unsubscribe();
      if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    });
    /* A link with ?container (the Overzicht's Bekijk, a reload): open and show it once the containers are there. */
    effect(() => {
      const id = this.requested();
      const page = this.page();
      if (!page || id === null || id === this.applied) return;
      untracked(() => this.select(id, true));
    });
  }

  reload(): void {
    void this.data.load();
  }

  /** A chip in the month: the list, with that container open and in view. */
  fromCalendar(id: number): void {
    this.view.set('lijst');
    this.select(id, true);
    this.setAddress(id);
  }

  /** A row of the table: opens it (and selects it) or closes it. */
  toggle(id: number): void {
    const open = this.expanded().has(id);
    this.expanded.update((set) => {
      const next = new Set(set);
      if (open) next.delete(id); else next.add(id);
      return next;
    });
    if (open) {
      if (this.selected() === id) {
        this.selected.set(null);
        this.setAddress(null);
      }
      return;
    }
    this.selected.set(id);
    this.setAddress(id);
  }

  num(value: number): string {
    return count(value);
  }

  private select(id: number, scroll: boolean): void {
    this.applied = id;
    const container = this.all().find((item) => item.id === id);
    if (!container) return;
    /* A filter that hides it gives way to Alle. */
    if (!this.shown().some((item) => item.id === id)) this.filter.set('alle');
    this.selected.set(id);
    this.expanded.update((set) => (set.has(id) ? set : new Set([...set, id])));
    if (!scroll) return;
    this.pendingScroll = id;
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => { this.pendingScroll = null; this.pendingTimer = null; }, 1500);
    afterNextRender(() => this.scrollTo(id), { injector: this.injector });
  }

  private scrollTo(id: number): void {
    const row = this.doc.getElementById(`pc-${id}`);
    const reduce = this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  /** ?container=<id> in the address without a navigation (no history entry, no scroll to the top), as product-list does. */
  private setAddress(id: number | null): void {
    this.applied = id;
    this.requested.set(id);
    const [path, search = ''] = this.location.path().split('?');
    if (path !== '/partner/inkooporders') return;
    const params = new URLSearchParams(search);
    if (id === null) params.delete('container'); else params.set('container', String(id));
    this.location.replaceState(path, params.toString(), this.location.getState());
  }
}
