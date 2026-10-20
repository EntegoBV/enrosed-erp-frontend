import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, ViewEncapsulation, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TicaApi, TicaNotificationMode, TicaSale, TicaSalesPage, TicaSettings, TicaStatus } from '../../core/api/tica-api';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, confirmLeave } from '../../shared/ui';
import { ticaMoment, ticaRangeError, ticaToday } from './tica-format';
import {
  PRESETS, dayGroups, dayHead, discountText, periodText, presetOf, presetPeriod, saleMatches, saleTime, salesTotals, settlementCounts,
  settlementSums, syncLine, unmatched, type SettlementFilter, type TicaPreset, type TicaTab,
} from './tica-list-model';
import { TicaSettlements } from './tica-settlements';
import { TicaStockSettings } from './tica-stock-settings';
import { ticaStockLabel, ticaStockNeedsAttention } from './tica-stock-rules';
import { TicaSaleHistory } from './tica-sale-history';

/** A caption or subtitle while nothing is known yet: keeps the line's height, never a false 0. */
const NOT_KNOWN_YET = ' ';

/**
 * TICA verkopen (/tica) on the list recipe of Inkoop and Verkoop (2026-10-20).
 * Desk: the toolbar holds the tabs Verkopen · Afrekeningen, the search, the
 * import state with "Nu ophalen" (Verkopen) or "Creditnota toevoegen"
 * (Afrekeningen) and a ⋯ menu (Meldingen, Handmatig toevoegen); the subbar
 * the period chips, Niet herkend and Vestiging with the shown sums; a kit
 * table per tab, sales grouped per day, settlements per state. Phone: the
 * large title with a ready-guarded caption, the iOS segmented, one search
 * row with the filter button, quick chips, inset sections per day or state.
 * The sales of a period load whole (pages of 200, at most 10 000 lines).
 * Settlement logic and its sheets live in TicaSettlements, which stays
 * mounted on both tabs for ?settlement= links and unsaved-change guards.
 * Codex's stock link (TicaStockSettings, its card and sheet with its own
 * guard) sits under the sales table and stays mounted on both tabs too; a
 * sale's stock state is the desk's Product sub or the amber line, and its
 * history (TicaSaleHistory, ?sale=) opens from the row menu.
 * Area rules in tica-page.scss, all under app-tica-page (encapsulation off).
 */
@Component({
  selector: 'app-tica-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [
    NgTemplateOutlet, FormsModule, RouterLink, Icon, PageHeader, Skeleton, Sheet, Segmented, ContextMenu, LoadError,
    TicaSettlements, TicaStockSettings, TicaSaleHistory,
  ],
  templateUrl: './tica-page.html',
  styleUrl: './tica-page.scss',
})
export class TicaPage {
  readonly desktop = inject(DesktopViewport);
  private readonly api = inject(TicaApi);
  private readonly ui = inject(Ui);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private destroyed = false;
  private salesVersion = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private statusBusy = false;
  readonly settlements = viewChild(TicaSettlements);
  private readonly stockSettings = viewChild(TicaStockSettings);
  private readonly subbar = viewChild<ElementRef<HTMLElement>>('subbar');

  /* ------------------------------------------------------------ state */

  readonly tab = signal<TicaTab>('verkopen');
  readonly query = signal('');
  readonly from = signal(ticaToday());
  readonly to = signal(ticaToday());
  readonly unmatchedOnly = signal(false);
  readonly location = signal('');
  readonly settlementFilter = signal<SettlementFilter>('all');
  readonly now = signal(Date.now());
  readonly today = computed(() => ticaToday(new Date(this.now())));

  readonly status = signal<TicaStatus | null>(null);
  readonly settings = signal<TicaSettings | null>(null);
  readonly sales = signal<(TicaSalesPage & { complete: boolean }) | null>(null);
  readonly statusError = signal<string | null>(null);
  readonly salesError = signal<string | null>(null);
  readonly settingsError = signal<string | null>(null);
  readonly syncError = signal<string | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly syncing = signal(false);
  readonly settingsLoading = signal(true);
  readonly settingsOpen = signal(false);
  readonly filtersOpen = signal(false);
  readonly periodOpen = signal(false);
  /** false: closed; null: the phone's sheet; a point: the desk popover. */
  readonly pageMenu = signal<MenuPoint | null | false>(false);
  readonly lineMenu = signal<{ line: TicaSale; point: MenuPoint | null } | null>(null);
  readonly formError = signal<string | null>(null);
  readonly draftMode = signal<TicaNotificationMode>('DAILY');
  readonly draftTime = signal('21:00');
  readonly draftFrom = signal(ticaToday());
  readonly draftTo = signal(ticaToday());

  /* ------------------------------------------------------------ sales */

  /** The shown period answered once: counts and sums may show (a failed first load shows the error card instead). */
  readonly ready = computed(() => this.sales() !== null);
  readonly lines = computed(() => this.sales()?.lines ?? []);
  readonly locations = computed(() => [...new Set(this.lines().map((line) => line.location).filter(Boolean))].sort());
  readonly locationOptions = computed(() => ['', ...this.locations()]);
  readonly searched = computed(() => this.lines().filter((line) => saleMatches(line, this.query()) && (!this.location() || line.location === this.location())));
  readonly shown = computed(() => (this.unmatchedOnly() ? this.searched().filter(unmatched) : this.searched()));
  readonly groups = computed(() => dayGroups(this.shown()));
  readonly unmatchedCount = computed(() => this.searched().filter(unmatched).length);
  /** The whole period: the server's sums when the lines stopped at the cap, else the lines'. */
  readonly periodTotals = computed(() => {
    const page = this.sales();
    if (page && !page.complete) {
      return { lines: page.totalLines, transactions: page.transactionCount, pieces: page.quantity, netEur: page.netTotal,
        grossEur: page.grossTotal, discountEur: Math.max(0, page.grossTotal - page.netTotal), unmatched: page.unmatchedLineCount };
    }
    return salesTotals(this.lines());
  });
  readonly narrowed = computed(() => !!this.query().trim() || this.unmatchedOnly() || !!this.location());
  readonly shownTotals = computed(() => (this.narrowed() ? salesTotals(this.shown()) : this.periodTotals()));
  readonly preset = computed(() => presetOf(this.from(), this.to(), this.today()));
  readonly periodWords = computed(() => periodText(this.from(), this.to(), this.today()));
  /** The phone filter button's badge: a period other than today, Niet herkend, a vestiging. */
  readonly salesFilterCount = computed(() => (this.unmatchedOnly() ? 1 : 0) + (this.location() ? 1 : 0) + (this.preset() === 'today' ? 0 : 1));

  /* ------------------------------------------------------------ settlements */

  readonly settlementRows = computed(() => this.settlements()?.rows() ?? []);
  readonly settlementsReady = computed(() => this.settlements()?.ready() ?? false);
  readonly settlementCounts = computed(() => settlementCounts(this.settlementRows(), this.query()));
  readonly settlementSums = computed(() => settlementSums(this.settlementRows()));

  /* ------------------------------------------------------------ chrome */

  readonly sync = computed(() => syncLine(this.status(), !!this.statusError(), new Date(this.now())));
  readonly syncBusy = computed(() => this.syncing() || ['PENDING', 'RUNNING'].includes(this.status()?.syncState ?? ''));
  readonly canSync = computed(() => !!this.status()?.enabled && !!this.status()?.credentialsReady && !this.syncBusy());
  readonly tabOptions = computed<SegmentOption[]>(() => [
    { id: 'verkopen', label: 'Verkopen', count: this.ready() ? this.periodTotals().transactions : null },
    { id: 'afrekeningen', label: 'Afrekeningen', count: this.settlementsReady() ? this.settlementRows().length : null,
      dot: this.settlementSums().draftCount ? 'warn' : null },
  ]);
  /** Phone caption: what the tab holds, never a figure before it answered. */
  readonly caption = computed(() => {
    if (this.tab() === 'verkopen') {
      if (!this.ready()) return NOT_KNOWN_YET;
      const totals = this.shownTotals();
      return `${this.periodWords()} · ${this.plural(totals.transactions, 'verkoop', 'verkopen')} · ${this.whole(totals.netEur)}`;
    }
    if (!this.settlementsReady()) return NOT_KNOWN_YET;
    const sums = this.settlementSums();
    return sums.openEur ? `${this.whole(sums.openEur)} te ontvangen` : this.plural(this.settlementRows().length, 'afrekening', 'afrekeningen');
  });
  readonly notificationLabel = computed(() => {
    const settings = this.settings();
    if (!settings) return this.settingsLoading() ? 'Meldingen laden…' : 'Meldingen niet beschikbaar';
    const time = settings.summaryTime.slice(0, 5);
    return ({ DAILY: `Dagoverzicht om ${time}`, SALES: 'Bij nieuwe verkopen',
      SALES_AND_DAILY: `Nieuwe verkopen en dagoverzicht om ${time}`, NONE: 'Staan uit' })[settings.notificationMode];
  });
  readonly deliveryLabel = computed(() => {
    const status = this.status()?.lastNotificationStatus;
    if (!status) return null;
    return ({ PENDING: 'Wacht op verzending', PROCESSING: 'Wordt verzonden', WAITING_FOR_DEVICES: 'Wacht op een aangemeld toestel',
      ACCEPTED: 'Aangeboden aan pushdienst', PARTIAL: 'Aan een deel van de toestellen aangeboden',
      FAILED: 'Verzenden mislukt', EXPIRED: 'Verlopen', CANCELLED: 'Geannuleerd' } as Record<string, string>)[status] ?? 'Status niet beschikbaar';
  });
  readonly hasDaily = computed(() => ['DAILY', 'SALES_AND_DAILY'].includes(this.draftMode()));
  readonly dirty = computed(() => !!this.settings() && (
    this.settings()!.notificationMode !== this.draftMode() || this.settings()!.summaryTime.slice(0, 5) !== this.draftTime()
  ));
  readonly notificationModes: { value: TicaNotificationMode; label: string; hint: string }[] = [
    { value: 'DAILY', label: 'Dagoverzicht', hint: 'Eén overzicht, alleen op dagen met verkopen' },
    { value: 'SALES', label: 'Nieuwe verkopen', hint: 'Zodra nieuwe verkopen zijn opgehaald' },
    { value: 'SALES_AND_DAILY', label: 'Beide', hint: 'Nieuwe verkopen en het dagoverzicht' },
    { value: 'NONE', label: 'Geen meldingen', hint: 'Verkopen blijven hier zichtbaar' },
  ];
  readonly presets = PRESETS;
  readonly moment = ticaMoment;
  readonly dayHead = dayHead;
  readonly saleTime = saleTime;
  readonly discountText = discountText;
  readonly unmatched = unmatched;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      ++this.salesVersion;
      clearTimeout(this.pollTimer);
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((query) => {
      this.tab.set(query.get('tab') === 'afrekeningen' || query.get('settlement') ? 'afrekeningen' : 'verkopen');
      const queryFrom = query.get('from'), queryTo = query.get('to');
      const range = queryFrom && queryTo && !ticaRangeError(queryFrom, queryTo) ? { from: queryFrom, to: queryTo } : presetPeriod('today', this.today());
      if (range.from !== this.from() || range.to !== this.to() || !this.sales()) {
        this.from.set(range.from); this.to.set(range.to);
        this.draftFrom.set(range.from); this.draftTo.set(range.to);
        this.sales.set(null);
        void this.loadSales();
      }
    });
    void this.loadStatus();
    void this.loadSettings();
    /* The table head sticks under the subbar's measured height when the subbar wraps (Verkoop's --sl-subbar-h). */
    effect((onCleanup) => {
      const bar = this.subbar()?.nativeElement;
      const host = this.host.nativeElement as HTMLElement;
      if (!bar || typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver(() => host.style.setProperty('--tl-subbar-h', `${bar.offsetHeight}px`));
      observer.observe(bar);
      onCleanup(() => { observer.disconnect(); host.style.removeProperty('--tl-subbar-h'); });
    });
  }

  /* ------------------------------------------------------------ words */

  /** '€ 1.240' that never breaks; '− € 12' below zero. */
  whole(value: number): string {
    const text = `€ ${Math.round(Math.abs(value)).toLocaleString('nl-BE')}`;
    return value < 0 && Math.round(value) !== 0 ? `− ${text}` : text;
  }
  euro(value: number): string {
    return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(value);
  }
  count(value: number): string {
    return new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 3 }).format(value);
  }
  plural(value: number, one: string, many: string): string {
    return `${this.count(value)} ${value === 1 ? one : many}`;
  }

  /** The amber line: the sale's stock waits on us; an unmatched line already says 'niet herkend', so not twice. */
  stockAttention(line: TicaSale): string | null {
    if (!ticaStockNeedsAttention(line) || (line.stockStatus === 'PRODUCT_UNMATCHED' && unmatched(line))) return null;
    return [ticaStockLabel(line), line.stockMessage].filter(Boolean).join(' · ');
  }
  /** The desk's calm fact under the product: what this sale did to the stock (uit or vóór start the card says once). */
  stockFact(line: TicaSale): string | null {
    return line.stockStatus === 'POSTED' || line.stockStatus === 'REVERSED' ? ticaStockLabel(line) : null;
  }

  /* ------------------------------------------------------------ guards */

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty() || this.saving()) { event.preventDefault(); event.returnValue = ''; }
  }

  async canDeactivate(): Promise<boolean> {
    if (this.saving()) return false;
    if (this.dirty() && !(await confirmLeave(this.ui, () => this.saveSettings()))) return false;
    if (!(await this.stockSettings()?.canDeactivate() ?? true)) return false;
    return (await this.settlements()?.canDeactivate()) ?? true;
  }

  /* ------------------------------------------------------------ tabs and filters */

  switchTab(tab: TicaTab): void {
    if (tab === this.tab()) return;
    this.tab.set(tab);
    this.query.set('');
    void this.router.navigate([], { relativeTo: this.route, replaceUrl: true, queryParamsHandling: 'merge',
      queryParams: { tab: tab === 'afrekeningen' ? 'afrekeningen' : null, settlement: null } });
  }

  pickPreset(preset: TicaPreset): void {
    const period = presetPeriod(preset, this.today());
    this.periodOpen.set(false);
    this.setPeriod(period.from, period.to);
  }

  applyCustom(): void {
    const error = ticaRangeError(this.draftFrom(), this.draftTo());
    if (error) { this.formError.set(error); return; }
    this.formError.set(null);
    this.periodOpen.set(false);
    this.setPeriod(this.draftFrom(), this.draftTo());
  }

  private setPeriod(from: string, to: string): void {
    if (from === this.from() && to === this.to()) { void this.loadSales(); return; }
    const today = presetOf(from, to, this.today()) === 'today';
    void this.router.navigate([], { relativeTo: this.route, replaceUrl: true, queryParamsHandling: 'merge',
      queryParams: { from: today ? null : from, to: today ? null : to } });
  }

  clearFilters(): void {
    this.query.set('');
    this.unmatchedOnly.set(false);
    this.location.set('');
    this.settlementFilter.set('all');
  }

  escapeSearch(event: Event): void {
    if (!this.query()) return;
    event.stopPropagation();
    this.query.set('');
  }

  /* ------------------------------------------------------------ menus */

  openPageMenu(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.pageMenu.set(this.desktop.active() ? { x: Math.max(8, rect.right - 280), y: rect.bottom + 4 } : null);
  }

  pageMenuItems(): ContextMenuItem[] {
    const phone = !this.desktop.active();
    return [
      ...(phone || this.tab() === 'afrekeningen' ? [{ id: 'sync', label: this.syncBusy() ? 'Verkopen worden opgehaald' : 'Nu ophalen',
        hint: this.sync().title || undefined, iconName: 'refresh', disabled: !this.canSync() }] : []),
      ...(phone ? [{ id: 'pdf', label: 'Creditnota toevoegen', hint: 'PDF van TICA inlezen', iconName: 'upload' }] : []),
      { id: 'manual', label: 'Afrekening handmatig toevoegen', iconName: 'pencil' },
      { id: 'settings', label: 'Meldingen', hint: this.notificationLabel(), iconName: 'bell', divider: true },
    ];
  }

  pickPageMenu(id: string): void {
    this.pageMenu.set(false);
    if (id === 'sync') void this.startSync();
    else if (id === 'pdf') { this.switchTab('afrekeningen'); this.settlements()?.pickDocument(); }
    else if (id === 'manual') { this.switchTab('afrekeningen'); this.settlements()?.startNew(); }
    else if (id === 'settings') this.settingsOpen.set(true);
  }

  openLineMenu(event: MouseEvent | null, line: TicaSale): void {
    event?.stopPropagation();
    const rect = (event?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect();
    this.lineMenu.set({ line, point: rect && this.desktop.active() ? { x: Math.max(8, rect.right - 280), y: rect.bottom + 4 } : null });
  }

  lineMenuItems(line: TicaSale): ContextMenuItem[] {
    return [
      { id: 'history', label: 'Verkoop en voorraad', hint: ticaStockLabel(line), iconName: 'recent' },
      ...(line.productId && !unmatched(line) ? [{ id: 'product', label: 'Product openen', hint: line.sku || undefined, iconName: 'stock' }] : []),
      { id: 'receipt', label: `Bon ${line.transactionNumber} tonen`, hint: `${this.moment(line.soldAt)} · regel ${line.lineNumber}`, iconName: 'receipt' },
      { id: 'article', label: 'Alle verkopen van dit artikel', hint: line.sku || line.beeyondArticleNumber || undefined, iconName: 'search' },
    ];
  }

  pickLine(line: TicaSale, id: string): void {
    this.lineMenu.set(null);
    if (id === 'history') void this.router.navigate([], { relativeTo: this.route, queryParamsHandling: 'merge', queryParams: { sale: line.id } });
    else if (id === 'product' && line.productId) void this.router.navigate(['/products', line.productId]);
    else if (id === 'receipt') this.query.set(line.transactionNumber);
    else if (id === 'article') this.query.set(line.sku || line.beeyondArticleNumber || line.description);
  }

  /* ------------------------------------------------------------ settings */

  async closeSettings(): Promise<void> {
    if (this.saving()) return;
    if (this.dirty() && !(await confirmLeave(this.ui, () => this.saveSettings()))) return;
    const settings = this.settings();
    if (settings) { this.draftMode.set(settings.notificationMode); this.draftTime.set(settings.summaryTime.slice(0, 5)); }
    this.settingsOpen.set(false);
  }

  async loadSettings(): Promise<void> {
    this.settingsLoading.set(true);
    this.settingsError.set(null);
    try {
      const settings = await this.api.settings();
      if (this.destroyed) return;
      this.settings.set(settings);
      this.draftMode.set(settings.notificationMode);
      this.draftTime.set(settings.summaryTime.slice(0, 5));
    } catch (failure) {
      if (!this.destroyed) this.settingsError.set(messageOf(failure, 'De meldingsvoorkeur kon niet worden geladen.'));
    } finally { if (!this.destroyed) this.settingsLoading.set(false); }
  }

  async saveSettings(): Promise<boolean> {
    if (this.saving() || !this.settings()) return false;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(this.draftTime())) {
      this.settingsError.set('Vul een geldig tijdstip in voor het dagoverzicht.');
      return false;
    }
    this.saving.set(true);
    this.settingsError.set(null);
    try {
      const saved = await this.api.saveSettings({ notificationMode: this.draftMode(), summaryTime: this.draftTime(), timezone: 'Europe/Brussels' });
      if (this.destroyed) return false;
      this.settings.set(saved);
      this.draftMode.set(saved.notificationMode);
      this.draftTime.set(saved.summaryTime.slice(0, 5));
      this.settingsOpen.set(false);
      this.ui.toast('TICA-meldingen opgeslagen');
      return true;
    } catch (failure) {
      if (!this.destroyed) this.settingsError.set(messageOf(failure, 'De meldingsvoorkeur kon niet worden opgeslagen.'));
      return false;
    } finally { if (!this.destroyed) this.saving.set(false); }
  }

  /* ------------------------------------------------------------ import */

  async loadStatus(): Promise<void> {
    if (this.statusBusy || this.destroyed) return;
    this.statusBusy = true;
    clearTimeout(this.pollTimer);
    try {
      const previousSuccess = this.status()?.lastSuccessAt;
      const status = await this.api.status();
      if (this.destroyed) return;
      this.status.set(status);
      this.statusError.set(null);
      this.now.set(Date.now());
      if (previousSuccess !== undefined && status.lastSuccessAt !== previousSuccess) { void this.loadSales(); void this.stockSettings()?.reload(); }
    } catch (failure) {
      if (!this.destroyed) this.statusError.set(messageOf(failure, 'De verbindingsstatus kon niet worden geladen.'));
    } finally {
      this.statusBusy = false;
      if (!this.destroyed) this.pollTimer = setTimeout(() => void this.loadStatus(), this.syncBusy() ? 5000 : 60000);
    }
  }

  async startSync(): Promise<void> {
    if (!this.canSync()) return;
    this.syncing.set(true);
    this.syncError.set(null);
    try {
      const result = await this.api.sync();
      if (this.destroyed) return;
      if (result.queued) {
        this.status.update((status) => (status ? { ...status, syncState: 'PENDING' } : status));
        this.ui.toast('TICA-verkopen worden opgehaald');
        clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => void this.loadStatus(), 5000);
      }
    } catch (failure) {
      if (!this.destroyed) this.syncError.set(messageOf(failure, 'Verkopen ophalen kon niet worden gestart.'));
    } finally { if (!this.destroyed) this.syncing.set(false); }
  }

  /** The whole period; a reload keeps the shown lines until the new ones are in, and a failed one keeps them too. */
  async loadSales(): Promise<void> {
    const version = ++this.salesVersion;
    this.loading.set(true);
    this.salesError.set(null);
    try {
      const page = await this.api.allSales(this.from(), this.to());
      if (version !== this.salesVersion || this.destroyed) return;
      this.sales.set(page);
    } catch (failure) {
      if (version === this.salesVersion && !this.destroyed) this.salesError.set(messageOf(failure, 'De TICA-verkopen konden niet worden geladen.'));
    } finally { if (version === this.salesVersion && !this.destroyed) this.loading.set(false); }
  }
}
