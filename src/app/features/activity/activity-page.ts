import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivityApi } from '../../core/api/activity-api';
import { ActivityCategory, ActivityEvent } from '../../core/api/models';
import { StaffContactsApi } from '../../core/api/staff-contacts-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu, ContextMenuItem } from '../../shared/context-menu';
import { Icon } from '../../shared/icon';
import { keyContext } from '../../shared/key-context';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { WK_DOCK_MIN_PX, elementWidth } from '../../shared/workspace-layout';
import {
  activityActionLabel, activityCategory, activityCategoryColor, activityCategoryIcon, activityCategoryLabel, activityEntityLabel,
  activityQueryParams, activityRoute,
} from './activity-copy';
import {
  ActivityFilters, ActivityRow, CategoryChip, activityDays, activityEntityText, activityFiltersFromQuery, activityQueryFromFilters,
  activityOverview, activityRows, activitySummaryText, categoryRequest, changePreview, keepForChip, rowTime, todayEvents,
} from './activity-format';
import { ActivityInspector } from './activity-inspector';
import { ActivityNames } from './activity-names';

/** Whether the backend knows the FINANCE category; learned once per app visit (B4). */
let financeSupported: boolean | null = null;

const CHIP_ORDER: readonly CategoryChip[] = ['ALL', 'SALES', 'PURCHASING', 'CATALOGUE', 'RELATIONS', 'PLANNING', 'FINANCE', 'OTHER'];
/** A filtered page shorter than this fetches on by itself (at most four extra pages per action). */
const MIN_ROWS = 20;
const MAX_EXTRA_PAGES = 4;

/**
 * Logboek: every logged event, newest first, as dense rows (a burst of the
 * same edit is one row), filtered by category and person in the URL
 * (?soort=&wie=&type=&id=). A row opens its detail: a drawer on the desk, a
 * sheet on the phone. Values read as everywhere else in the ERP; purchase
 * orders by their container name.
 */
@Component({
  selector: 'app-activity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityInspector, ContextMenu, Icon, LoadError, PageHeader, Segmented, Sheet, Skeleton],
  template: `
    <app-page-header title="Logboek" [subtitle]="subtitle()">
      @if (desktop.active()) {
        <app-segmented label="Medewerker" [options]="actorOptions()" [value]="filters().actor ?? 'ALL'" (changed)="setActor($event)" />
      } @else {
        <button class="btn" type="button" aria-haspopup="menu" (click)="actorMenu.set(true)">{{ actorLabel() }} ▾</button>
      }
    </app-page-header>

    <main class="content log-page" [attr.aria-busy]="loading() || loadingMore()">
      @if (desktop.active()) {
        <nav class="wk-subbar" aria-label="Onderdeel">
          <div class="wk-chips log-chips">
            @if (entityChip(); as chip) {
              <span class="wk-chip is-on">Alleen: {{ chip }}<button class="wk-chip__x" type="button" aria-label="Filter op record wissen" (click)="clearEntity()"><app-icon name="close" [size]="11" /></button></span>
            }
            @for (chip of chips; track chip) {
              <button class="wk-chip" type="button" [class.is-on]="filters().category === chip" [attr.aria-pressed]="filters().category === chip" (click)="setCategory(chip)">
                @if (chip !== 'ALL') { <i class="wk-dot" [style.--tone]="colorOf(chip)"></i> }{{ chipLabel(chip) }}</button>
            }
          </div>
          <span class="wk-subbar__end">{{ todayText() }}</span>
        </nav>
      } @else {
        <div class="ios-chips log-phone-chips" role="group" aria-label="Onderdeel">
          @if (entityChip(); as chip) {
            <button class="ios-chip" type="button" aria-pressed="true" (click)="clearEntity()">Alleen: {{ chip }} ✕</button>
          }
          @for (chip of chips; track chip) {
            <button class="ios-chip" type="button" [attr.aria-pressed]="filters().category === chip" (click)="setCategory(chip)">
              @if (chip !== 'ALL') { <i class="log-dot" [style.background]="colorOf(chip)"></i> }{{ chipLabel(chip) }}</button>
          }
        </div>
      }

      @if (loading() && !items().length) {
        @if (desktop.active()) { <div class="wk-card"><app-skeleton kind="table" [rows]="8" /></div> }
        @else { <app-skeleton kind="group" [rows]="6" /> }
      } @else if (error(); as message) {
        <app-load-error title="Logboek niet beschikbaar" [message]="message" [busy]="loading()" (retry)="reload()" />
      } @else if (!rows().length) {
        @if (desktop.active()) {
          <div class="wk-card"><div class="wk-empty"><div class="wk-empty__icon"><app-icon name="activity" [size]="22" /></div>
            <h2 class="wk-empty__title">Geen activiteiten gevonden</h2><p class="wk-empty__text">Kies een ander onderdeel of een andere medewerker.</p></div></div>
        } @else {
          <div class="ios-empty"><div class="ios-empty__icon"><app-icon name="activity" [size]="26" /></div>
            <h2 class="ios-empty__title">Geen activiteiten gevonden</h2><p class="ios-empty__text">Kies een ander onderdeel of een andere medewerker.</p></div>
        }
      } @else if (desktop.active()) {
        <div class="log-body" [class.log-body--docked]="docked()">
        <section class="wk-card log-card" aria-label="Activiteiten" (keydown)="rowKeys($event)">
          @for (day of days(); track day.key) {
            <div class="log-day" role="heading" aria-level="2">{{ day.label }} <span>· {{ day.count }}</span></div>
            @for (row of day.rows; track row.key) {
              <button class="wk-tr wk-tr--link log-row" type="button" [attr.data-row]="row.key" [attr.aria-selected]="selectedKey() === row.key"
                      [style.--cat]="rowColor(row)" (click)="select(row)">
                <span class="log-time">{{ time(row) }}</span>
                <span class="log-tile" aria-hidden="true"><app-icon [name]="rowIcon(row)" [size]="16" /></span>
                <span class="log-main">
                  <b [attr.title]="rowSummary(row)">{{ rowSummary(row) }}@if (row.events.length > 1) { <i> · {{ row.events.length }}×</i> }</b>
                  <span [attr.title]="rowLine(row)">{{ rowRecord(row) }}@if (rowPreview(row); as preview) { — <em>{{ preview }}</em> }</span>
                </span>
                <span class="log-actor"><span class="log-av" aria-hidden="true">{{ initial(row) }}</span>{{ actorName(row) }}</span>
              </button>
            }
          }
        </section>
        @if (docked()) {
          <!-- Docked: a sticky grid column, no transform or container (trap rule) -->
          <aside class="wk-card log-dock" aria-label="Details">
            <app-activity-inspector layout="dock" [row]="selectedRow()" [events]="items()" [ctx]="names.context()" [overview]="overview()"
                                    (selectEvent)="selectEvent($event)" (filterEntity)="filterEntity($event)" />
          </aside>
        }
        </div>
      } @else {
        @for (day of days(); track day.key) {
          <section class="ios-section">
            <div class="ios-section__head"><h2>{{ day.label }} · {{ day.count }}</h2></div>
            <div class="ios-group ios-group--icons">
              @for (row of day.rows; track row.key) {
                <button class="ios-cell log-cell" type="button" (click)="select(row)">
                  <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft" [style.--tone]="rowColor(row)" aria-hidden="true"><app-icon [name]="rowIcon(row)" [size]="17" /></span></span>
                  <span class="ios-cell__body">
                    <span class="ios-cell__title ios-cell__title--strong ios-cell__title--2">{{ rowSummary(row) }}@if (row.events.length > 1) { · {{ row.events.length }}× }</span>
                    <span class="ios-cell__sub ios-cell__sub--2">{{ rowName(row) }} · {{ actorName(row) }}</span>
                    @if (rowPreview(row); as preview) { <span class="ios-cell__sub ios-cell__sub--2">{{ preview }}</span> }
                  </span>
                  <span class="ios-cell__trail"><span class="ios-cell__meta log-cell__time">{{ time(row) }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
            </div>
          </section>
        }
      }

      @if (rows().length) {
        @if (moreError()) {
          <div class="log-more log-more--error" role="alert"><span>Meer activiteiten laden is niet gelukt.</span>
            <button class="wk-btn wk-btn--sm" type="button" [disabled]="loadingMore()" (click)="loadMore()">Opnieuw proberen</button></div>
        } @else if (nextBefore() !== null) {
          <div class="log-more"><button class="wk-btn" type="button" [disabled]="loadingMore()" (click)="loadMore()">{{ loadingMore() ? 'Laden…' : 'Meer laden' }}</button></div>
        }
      }
    </main>

    <!-- Overlays at page-host level (trap rule): the desk drawer, the phone sheet and the actor menu -->
    @if (selectedRow(); as row) {
      @if (desktop.active() && !docked()) {
        <aside class="wk-inspector wk-inspector--drawer log-drawer" aria-label="Details">
          <app-activity-inspector layout="drawer" [row]="row" [events]="items()" [ctx]="names.context()"
                                  (selectEvent)="selectEvent($event)" (filterEntity)="filterEntity($event)" (closed)="selectedKey.set(null)" />
        </aside>
      } @else if (!desktop.active()) {
        <app-sheet [title]="rowAction(row)" variant="ios" (closed)="selectedKey.set(null)">
          <div body><app-activity-inspector layout="sheet" [row]="row" [events]="items()" [ctx]="names.context()"
                                            (selectEvent)="selectEvent($event)" (filterEntity)="filterEntity($event)" /></div>
        </app-sheet>
      }
    }
    @if (actorMenu()) {
      <app-context-menu variant="ios" title="Medewerker" [items]="actorItems()" cancelLabel="Annuleren"
                        (pick)="setActor($event.id); actorMenu.set(false)" (closed)="actorMenu.set(false)" />
    }
  `,
  styles: `
    .log-page { max-width: 1240px; }
    .log-chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .log-chips .wk-dot { width: 8px; height: 8px; }
    .log-card { --wk-cols: 84px 28px minmax(0, 1fr) 112px; overflow: clip; }
    .log-day { position: sticky; top: var(--wk-sticky-top, 0px); z-index: 2; display: flex; align-items: center; gap: 4px; min-height: 30px; padding: 0 16px;
      border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--surface-2) 70%, var(--bg)); color: var(--ink-2);
      font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .log-day span { color: var(--muted); font-weight: 650; }
    .log-row { width: 100%; min-height: 56px; border-width: 0 0 1px; font: inherit; text-align: left; }
    .log-row:hover { background: var(--surface-2); }
    .log-time { color: var(--muted); font: 500 12.5px var(--mono, ui-monospace, monospace); white-space: nowrap; }
    .log-tile { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: color-mix(in srgb, var(--cat) 13%, var(--surface)); color: var(--cat); }
    .log-main { display: grid; min-width: 0; }
    .log-main b { overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    .log-main b i { color: var(--muted); font-style: normal; }
    .log-main > span { overflow: hidden; color: var(--muted); font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
    .log-main em { color: var(--ink-2); font-style: normal; }
    .log-actor { display: flex; align-items: center; gap: 7px; min-width: 0; color: var(--ink-2); font-size: 13px; }
    .log-av { display: grid; flex: none; place-items: center; width: 22px; height: 22px; border: 1px solid var(--line); border-radius: 50%; background: var(--surface-2); font-size: 10px; font-weight: 800; }
    .log-body--docked { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start; }
    .log-dock { position: sticky; top: calc(var(--appbar-h, 52px) + var(--wk-subbar-h, 48px) + 12px); max-height: calc(100dvh - var(--appbar-h, 52px) - 84px);
      overflow-y: auto; overscroll-behavior: contain; }
    .log-dock + .log-dock { margin-top: 0; }
    .log-body--docked > .wk-card + .wk-card { margin-top: 0; }
    .log-more { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 16px; }
    .log-more--error { color: var(--danger); font-size: 13px; }
    .log-drawer { --wk-status-h: 0px; overflow-y: auto; }
    .log-phone-chips { margin: 0 -12px 12px; padding-inline: 12px; }
    .log-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
    .ios-chip[aria-pressed=true] .log-dot { box-shadow: 0 0 0 1.5px #fff; }
    .log-cell { align-items: flex-start; }
    .log-cell__time { font-family: var(--mono, ui-monospace, monospace); }
    @media (max-width: 679px) { .log-page { --ios-inset: 0px; } }
  `,
})
export class ActivityPage {
  readonly desktop = inject(DesktopViewport);
  readonly names = inject(ActivityNames);
  private readonly api = inject(ActivityApi);
  private readonly staff = inject(StaffContactsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The detail docks beside the list when the page host is at least 1000 px wide; below, it is a drawer. */
  private readonly width = elementWidth(() => this.host.nativeElement.closest('.main') ?? this.host.nativeElement.querySelector('main'));
  readonly docked = computed(() => this.desktop.active() && this.width() >= WK_DOCK_MIN_PX);

  readonly chips = CHIP_ORDER;
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  /** The filters live in the URL: ?soort=PURCHASING&wie=berat&type=PURCHASE_ORDER&id=62. */
  readonly filters = computed<ActivityFilters>(() => {
    const params = this.query();
    return activityFiltersFromQuery({ soort: params.get('soort'), wie: params.get('wie'), type: params.get('type'), id: params.get('id') });
  });

  readonly items = signal<ActivityEvent[]>([]);
  readonly nextBefore = signal<number | null>(null);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);
  readonly moreError = signal(false);
  readonly selectedKey = signal<number | null>(null);
  readonly actorMenu = signal(false);
  private readonly accounts = signal<{ username: string; displayName: string }[]>([
    { username: 'emre', displayName: 'Emre' }, { username: 'berat', displayName: 'Berat' },
  ]);
  private requestId = 0;

  readonly rows = computed(() => activityRows(this.items()));
  readonly days = computed(() => activityDays(this.rows()));
  readonly selectedRow = computed(() => {
    const key = this.selectedKey();
    return key === null ? null : this.rows().find((row) => row.key === key) ?? null;
  });
  readonly subtitle = computed(() => `${this.items().length} geladen · nieuwste eerst`);
  /** With nothing selected the docked pane shows who did what in the loaded events: never an empty pane. */
  readonly overview = computed(() => activityOverview(this.items(), (event) => activityCategory(event)));
  readonly todayText = computed(() => `${todayEvents(this.items())} vandaag`);
  readonly actorOptions = computed<SegmentOption[]>(() => [
    { id: 'ALL', label: 'Iedereen' },
    ...this.accounts().map((account) => ({ id: account.username, label: account.displayName })),
    { id: 'systeem', label: 'Systeem' },
  ]);
  readonly actorLabel = computed(() => this.actorOptions().find((option) => option.id === (this.filters().actor ?? 'ALL'))?.label ?? 'Iedereen');
  readonly actorItems = computed<ContextMenuItem[]>(() => this.actorOptions().map((option) => ({
    id: option.id, label: option.label, checked: option.id === (this.filters().actor ?? 'ALL'),
  })));
  /** "Inkooporder 12-Set-Roseamor-Jerry" while the list is narrowed to one record. */
  readonly entityChip = computed(() => {
    const filters = this.filters();
    if (!filters.entityType || !filters.entityId) return null;
    const sample = this.items().find((event) => event.entityType === filters.entityType && event.entityId === filters.entityId);
    if (!sample) return `${filters.entityType.toLowerCase().replaceAll('_', ' ')} #${filters.entityId}`;
    return `${activityEntityLabel(sample)} ${activityEntityText(sample, this.names.context())}`;
  });

  constructor() {
    this.staff.accounts().then((accounts) => { if (accounts.length) this.accounts.set(accounts); }, () => undefined);
    effect(() => {
      const filters = this.filters();
      untracked(() => void this.load(filters));
    });
  }

  /* ------------------------------------------------------------ filters */

  private navigate(next: ActivityFilters): void {
    this.selectedKey.set(null);
    void this.router.navigate([], { relativeTo: this.route, queryParams: activityQueryFromFilters(next), replaceUrl: true });
  }

  setCategory(chip: CategoryChip): void {
    if (chip !== this.filters().category) this.navigate({ ...this.filters(), category: chip });
  }

  setActor(value: string): void {
    const actor = value === 'ALL' ? null : value;
    if (actor !== this.filters().actor) this.navigate({ ...this.filters(), actor });
  }

  filterEntity(event: ActivityEvent): void {
    if (event.entityId) this.navigate({ ...this.filters(), entityType: event.entityType, entityId: event.entityId });
  }

  clearEntity(): void {
    this.navigate({ ...this.filters(), entityType: null, entityId: null });
  }

  /* ------------------------------------------------------------ loading */

  reload(): void {
    void this.load(this.filters());
  }

  /** One page, filtered for the chip (B4); a short filtered page fetches on by itself. */
  private async fetchPage(filters: ActivityFilters, before?: number): Promise<{ items: ActivityEvent[]; nextBefore: number | null }> {
    let request = categoryRequest(filters.category, financeSupported);
    const ask = () => this.api.list({
      actor: filters.actor ?? undefined, category: request.category,
      entityType: filters.entityType ?? undefined, entityId: filters.entityId ?? undefined, before, limit: 50,
    });
    let page;
    try {
      page = await ask();
      if (request.category === 'FINANCE') financeSupported = true;
    } catch (failure: unknown) {
      if (request.category !== 'FINANCE' || (failure as { status?: number })?.status !== 400) throw failure;
      financeSupported = false;
      request = categoryRequest(filters.category, financeSupported);
      page = await ask();
    }
    return { items: page.items.filter((event) => keepForChip(event, request.keep)), nextBefore: page.nextBefore };
  }

  /** Fetches on while a filtered result is short (at most four extra pages per action). */
  private async fillUp(filters: ActivityFilters, page: { items: ActivityEvent[]; nextBefore: number | null }, id: number) {
    let extra = 0;
    while (page.items.length < MIN_ROWS && page.nextBefore !== null && extra < MAX_EXTRA_PAGES && id === this.requestId) {
      const next = await this.fetchPage(filters, page.nextBefore);
      page = { items: [...page.items, ...next.items], nextBefore: next.nextBefore };
      extra++;
    }
    return page;
  }

  private async load(filters: ActivityFilters): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.loadingMore.set(false);
    this.error.set(null);
    this.moreError.set(false);
    try {
      const page = await this.fillUp(filters, await this.fetchPage(filters), id);
      if (id !== this.requestId) return;
      this.items.set(page.items);
      this.nextBefore.set(page.nextBefore);
      void this.names.load(page.items);
    } catch {
      if (id !== this.requestId) return;
      this.items.set([]);
      this.nextBefore.set(null);
      this.error.set('Controleer je verbinding en probeer opnieuw.');
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  /** A failure here stays inline: the loaded list stays (bug 11). */
  async loadMore(): Promise<void> {
    const before = this.nextBefore();
    if (before === null || this.loadingMore()) return;
    const id = this.requestId;
    const filters = this.filters();
    this.loadingMore.set(true);
    this.moreError.set(false);
    try {
      const page = await this.fillUp(filters, await this.fetchPage(filters, before), id);
      if (id !== this.requestId) return;
      this.items.update((current) => [...current, ...page.items]);
      this.nextBefore.set(page.nextBefore);
      void this.names.load(page.items);
    } catch {
      if (id === this.requestId) this.moreError.set(true);
    } finally {
      if (id === this.requestId) this.loadingMore.set(false);
    }
  }

  /* -------------------------------------------------------------- rows */

  select(row: ActivityRow): void {
    this.selectedKey.set(row.key);
  }

  /** "Meer aan dit record": select the row that holds this event. */
  selectEvent(eventId: number): void {
    const row = this.rows().find((candidate) => candidate.events.some((event) => event.id === eventId));
    if (row) this.selectedKey.set(row.key);
  }

  private categoryOf(row: ActivityRow): ActivityCategory {
    return activityCategory(row.events[0]);
  }

  chipLabel(chip: CategoryChip): string {
    return chip === 'ALL' ? 'Alles' : activityCategoryLabel(chip);
  }

  colorOf(chip: CategoryChip): string {
    return chip === 'ALL' ? 'var(--muted)' : activityCategoryColor(chip);
  }

  rowColor(row: ActivityRow): string { return activityCategoryColor(this.categoryOf(row)); }
  rowIcon(row: ActivityRow): string { return activityCategoryIcon(this.categoryOf(row)); }
  rowSummary(row: ActivityRow): string { return activitySummaryText(row.events[0].summary); }
  rowAction(row: ActivityRow): string { return activityActionLabel(row.events[0].action); }
  time(row: ActivityRow): string { return rowTime(row); }
  actorName(row: ActivityRow): string { return row.events[0].actor?.displayName || 'Systeem'; }
  initial(row: ActivityRow): string { return this.actorName(row).trim().charAt(0).toUpperCase() || '•'; }

  /** "12-Set-Roseamor-Jerry" (container name) or the logged label. */
  rowName(row: ActivityRow): string {
    return activityEntityText(row.events[0], this.names.context()) || activityEntityLabel(row.events[0]);
  }

  /** "Inkooporder · 12-Set-Roseamor-Jerry". */
  rowRecord(row: ActivityRow): string {
    const event = row.events[0];
    const name = activityEntityText(event, this.names.context());
    return name ? `${activityEntityLabel(event)} · ${name}` : activityEntityLabel(event);
  }

  /** The whole second line, for its title when it is cut. */
  rowLine(row: ActivityRow): string {
    const preview = this.rowPreview(row);
    return preview ? `${this.rowRecord(row)} — ${preview}` : this.rowRecord(row);
  }

  /** The newest event's changes; a burst shows its newest edit. */
  rowPreview(row: ActivityRow): string {
    return changePreview(row.events[0], this.names.context());
  }

  /**
   * Desk keys: ↑/↓ select the previous or next row (and scroll it into
   * view), Enter opens the record, Esc clears the selection or closes the
   * drawer. Never while typing or behind another overlay.
   */
  @HostListener('document:keydown', ['$event'])
  keys(event: KeyboardEvent): void {
    if (!this.desktop.active() || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    const context = keyContext(event, this.host.nativeElement);
    if (context.typing || context.overlayOpen || !context.inScope) return;
    const target = event.target as HTMLElement | null;
    if (event.key === 'Escape') {
      if (this.selectedKey() !== null) { this.selectedKey.set(null); event.preventDefault(); }
      return;
    }
    /* On a row, the keys act from that row (focus can move with Tab without selecting). */
    const focusedRow = target?.classList.contains('log-row') ? Number(target.dataset['row']) : null;
    if (event.key === 'Enter') {
      /* A focused button (a chip, Openen) does its own job. */
      if (target && target !== this.document.body && focusedRow === null) return;
      /* A focused row that is not the selected one: its own click selects it first. */
      if (focusedRow !== null && focusedRow !== this.selectedKey()) return;
      const row = this.selectedRow();
      const route = row ? activityRoute(row.events[0]) : null;
      if (row && route) {
        event.preventDefault();
        void this.router.navigate(route, { queryParams: activityQueryParams(row.events[0]) ?? undefined });
      }
      return;
    }
    this.step(event.key === 'ArrowDown' ? 1 : -1, focusedRow ?? this.selectedKey());
    event.preventDefault();
  }

  /** ↑/↓ inside the list moves focus with the selection. */
  rowKeys(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.host.nativeElement.querySelector<HTMLElement>(`.log-row[data-row="${this.selectedKey()}"]`)?.focus({ preventScroll: true });
    }
  }

  private step(direction: 1 | -1, from: number | null): void {
    const rows = this.rows();
    if (!rows.length) return;
    const index = rows.findIndex((row) => row.key === from);
    const next = rows[index < 0 ? (direction > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, index + direction))];
    this.selectedKey.set(next.key);
    requestAnimationFrame(() => {
      const element = this.host.nativeElement.querySelector<HTMLElement>(`.log-row[data-row="${next.key}"]`);
      element?.scrollIntoView({ block: 'nearest' });
      element?.focus({ preventScroll: true });
    });
  }

  private readonly document = this.host.nativeElement.ownerDocument;
}
