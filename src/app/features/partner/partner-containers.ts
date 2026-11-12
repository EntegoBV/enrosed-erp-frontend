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
import { OLD_DAYS, isOld } from './partner-containers-model';
import { count } from './partner-format';
import { PartnerHead } from './partner-head';

/**
 * Containers: every container of Enrosed's, desk first. On top a calendar
 * card (the month with each container on its arrival day, and "Komt eraan"
 * beside it), below it the containers as a table whose rows open what is in
 * them. "Ook oude containers" adds the ones received more than 60 days ago.
 * `?container=<id>` selects one: it opens, is highlighted and scrolled to (a
 * chip, a Komt eraan row and the Overzicht's strip link here). A pick on the
 * page writes the address with Location.replaceState, never a navigation: the
 * router's scroll-to-top would throw him back to the calendar. Never a price,
 * amount or supplier: the server sends none.
 */
@Component({
  selector: 'app-partner-containers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadError, Skeleton, PartnerCalendar, PartnerContainerTable, PartnerHead],
  template: `
    <app-partner-head title="Containers" [sub]="desk.active() ? 'Wanneer welke container komt en wat erin zit.' : null" />
    @if (page(); as p) {
      <section class="pc-card pc-card--cal" aria-label="Kalender">
        <app-partner-calendar [containers]="p.containers" [today]="p.serverDate" [selectedId]="selected()" (picked)="pick($event)" />
      </section>

      <section class="pc-sec" aria-labelledby="pc-all">
        <div class="pc-sec__head">
          <h2 id="pc-all">Alle containers <span class="pc-sec__count">{{ shown().length }}</span></h2>
          @if (oldCount()) {
            <button class="wk-chip pc-chip" type="button" [attr.aria-pressed]="showOld()" (click)="showOld.set(!showOld())">
              Ook oude containers <span class="pc-chip__n">{{ num(oldCount()) }}</span>
            </button>
          }
        </div>
        @if (shown().length) {
          <div class="pc-card pc-card--table">
            <app-partner-container-table [containers]="shown()" [specs]="data.specs()" [order]="data.order()" [today]="p.serverDate"
                                         [selectedId]="selected()" [expanded]="expanded()" [palletTitle]="palletTitle()" (toggled)="toggle($event)" />
          </div>
          @if (palletNote()) { <p class="pc-note">{{ palletNote() }}</p> }
        } @else {
          <p class="pc-none">{{ p.containers.length ? 'Geen containers van de laatste ' + oldDays + ' dagen.' : 'Er zijn nog geen containers.' }}</p>
        }
      </section>
    } @else if (data.failure()) {
      <app-load-error [message]="failureText()" [busy]="data.loading()" (retry)="reload()" />
    } @else {
      <app-skeleton [kind]="desk.active() ? 'table' : 'card'" [rows]="6" />
    }
  `,
  styles: `
    :host{display:block;padding-bottom:calc(24px + var(--safe-b,0px))}
    .pc-card{border:1px solid var(--line);border-radius:14px;background:var(--surface);--wk-sticky-top:var(--pp-sticky-top,60px)}
    .pc-card--cal{margin:0 0 22px;overflow:hidden}
    .pc-sec{margin:0 0 8px}
    .pc-sec__head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;margin:0 2px 8px}
    .pc-sec__head h2{display:flex;align-items:baseline;gap:8px;margin:0;font-size:19px;font-weight:800;letter-spacing:-.02em}
    .pc-sec__count{color:var(--muted);font-size:13.5px;font-weight:650;letter-spacing:0}
    .pc-chip{flex:none}
    .pc-chip__n{color:var(--muted);font-variant-numeric:tabular-nums}
    .pc-chip[aria-pressed=true] .pc-chip__n{color:inherit}
    .pc-note{margin:8px 4px 0;color:var(--muted);font-size:12.5px}
    .pc-none{margin:0;padding:22px;border-radius:14px;background:var(--surface);color:var(--muted);text-align:center}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pc-card--cal{border:0;border-radius:20px}
      .pc-card--table{border:0;background:transparent}
      .pc-sec__head h2{font-size:21px}
      .pc-chip{height:40px;padding:0 14px;font-size:14px}
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

  readonly oldDays = OLD_DAYS;
  readonly page = this.data.page;
  readonly failureText = computed(() => messageOf(this.data.failure(), LOAD_ERROR_FALLBACK));

  readonly showOld = signal(false);
  readonly selected = signal<number | null>(null);
  readonly expanded = signal<ReadonlySet<number>>(new Set());
  /** The ?container of the address. */
  private readonly requested = signal<number | null>(null);
  /** The request already acted on (opened and scrolled to). */
  private applied: number | null = null;
  /** The container to show again after the router's scroll-to-top of the navigation that brought him here. */
  private pendingScroll: number | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  readonly oldCount = computed(() => {
    const page = this.page();
    return page ? page.containers.filter((container) => isOld(container, page.serverDate)).length : 0;
  });

  readonly shown = computed<PartnerContainer[]>(() => {
    const page = this.page();
    if (!page) return [];
    if (this.showOld()) return page.containers;
    return page.containers.filter((container) => !isOld(container, page.serverDate));
  });

  readonly palletTitle = computed(() => {
    const pallet = this.page()?.pallet;
    return pallet ? `Europallet ${count(pallet.widthCm)} × ${count(pallet.depthCm)} cm, tot ${count(pallet.maxHeightCm)} cm hoog` : null;
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
    /* Arriving from the Overzicht's strip: the router scrolls to the top after the page has rendered; show the row after that. */
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
    /* A link with ?container (the Overzicht's strip, a reload): open and show it once the containers are there. */
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

  /** A chip or a Komt eraan row: select, open and scroll to it in the table. */
  pick(id: number): void {
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
    const page = this.page();
    const container = page?.containers.find((item) => item.id === id);
    if (!page || !container) return;
    if (!this.showOld() && isOld(container, page.serverDate)) this.showOld.set(true);
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
    if (path !== '/partner/containers') return;
    const params = new URLSearchParams(search);
    if (id === null) params.delete('container'); else params.set('container', String(id));
    this.location.replaceState(path, params.toString(), this.location.getState());
  }
}
