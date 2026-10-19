import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TicaApi, TicaNotificationMode, TicaSalesPage, TicaSettings, TicaStatus } from '../../core/api/tica-api';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, confirmLeave } from '../../shared/ui';
import { ticaDate, ticaMoment, ticaPreset, ticaRangeError, ticaToday } from './tica-format';
import { TicaSettlements } from './tica-settlements';

@Component({
  selector: 'app-tica-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, PageHeader, Skeleton, Sheet, TicaSettlements],
  templateUrl: './tica-page.html',
  styleUrl: './tica-page.scss',
})
export class TicaPage {
  private readonly api = inject(TicaApi);
  private readonly ui = inject(Ui);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private destroyed = false;
  private salesVersion = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private statusBusy = false;
  private readonly settlements = viewChild(TicaSettlements);

  readonly status = signal<TicaStatus | null>(null);
  readonly settings = signal<TicaSettings | null>(null);
  readonly sales = signal<TicaSalesPage | null>(null);
  readonly statusError = signal<string | null>(null);
  readonly salesError = signal<string | null>(null);
  readonly settingsError = signal<string | null>(null);
  readonly syncError = signal<string | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly syncing = signal(false);
  readonly settingsLoading = signal(true);
  readonly settingsOpen = signal(false);
  readonly formError = signal<string | null>(null);
  readonly draftMode = signal<TicaNotificationMode>('DAILY');
  readonly draftTime = signal('21:00');
  readonly from = signal(ticaToday());
  readonly to = signal(ticaToday());
  readonly draftFrom = signal(ticaToday());
  readonly draftTo = signal(ticaToday());
  readonly hasDaily = computed(() => ['DAILY', 'SALES_AND_DAILY'].includes(this.draftMode()));
  readonly dirty = computed(() => !!this.settings() && (
    this.settings()!.notificationMode !== this.draftMode() || this.settings()!.summaryTime.slice(0, 5) !== this.draftTime()
  ));
  readonly syncBusy = computed(() => this.syncing() || ['PENDING', 'RUNNING'].includes(this.status()?.syncState ?? ''));
  readonly canSync = computed(() => !!this.status()?.enabled && !!this.status()?.credentialsReady && !this.syncBusy());
  readonly hasMore = computed(() => !!this.sales() && this.sales()!.lines.length < this.sales()!.totalLines);
  readonly connectionLabel = computed(() => {
    if (!this.status()) return this.statusError() ? 'Status niet beschikbaar' : 'Verbinding controleren…';
    return ({ DISABLED: 'Automatisch ophalen staat uit', NOT_CONFIGURED: 'Verbinding nog instellen',
      PENDING: 'Ophalen staat klaar', RUNNING: 'Verkopen worden opgehaald', ERROR: 'Ophalen vraagt aandacht',
      READY: 'Verbinding actief', NEVER_SYNCED: 'Klaar voor de eerste import' })[this.status()!.syncState] ?? 'Status onbekend';
  });
  readonly notificationLabel = computed(() => {
    const settings = this.settings();
    if (!settings) return this.settingsLoading() ? 'Meldingen laden…' : 'Meldingen niet beschikbaar';
    const time = settings.summaryTime.slice(0, 5);
    return ({ DAILY: `Dagoverzicht om ${time}`, SALES: 'Bij nieuwe verkopen',
      SALES_AND_DAILY: `Nieuwe verkopen en dagoverzicht om ${time}`, NONE: 'TICA-meldingen staan uit' })[settings.notificationMode];
  });
  readonly deliveryLabel = computed(() => {
    const status = this.status()?.lastNotificationStatus;
    if (!status) return null;
    return ({ PENDING: 'Wacht op verzending', PROCESSING: 'Wordt verzonden', WAITING_FOR_DEVICES: 'Wacht op een aangemeld toestel',
      ACCEPTED: 'Aangeboden aan pushdienst', PARTIAL: 'Aan een deel van de toestellen aangeboden',
      FAILED: 'Verzenden mislukt', EXPIRED: 'Verlopen', CANCELLED: 'Geannuleerd' } as Record<string, string>)[status] ?? 'Status niet beschikbaar';
  });
  readonly notificationModes: { value: TicaNotificationMode; label: string; hint: string }[] = [
    { value: 'DAILY', label: 'Dagoverzicht', hint: 'Eén overzicht, alleen op dagen met verkopen.' },
    { value: 'SALES', label: 'Nieuwe verkopen', hint: 'Een melding zodra nieuwe verkopen zijn opgehaald.' },
    { value: 'SALES_AND_DAILY', label: 'Nieuwe verkopen en dagoverzicht', hint: 'Beide soorten meldingen ontvangen.' },
    { value: 'NONE', label: 'Geen TICA-meldingen', hint: 'Verkopen blijven beschikbaar in dit overzicht.' },
  ];
  readonly day = ticaDate;
  readonly moment = ticaMoment;
  readonly euro = (value: number) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(value);
  readonly count = (value: number) => new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 3 }).format(value);

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      ++this.salesVersion;
      clearTimeout(this.pollTimer);
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe(query => {
      const queryFrom = query.get('from'), queryTo = query.get('to');
      const range = queryFrom && queryTo && !ticaRangeError(queryFrom, queryTo)
        ? { from: queryFrom, to: queryTo } : ticaPreset('today');
      this.from.set(range.from); this.to.set(range.to);
      this.draftFrom.set(range.from); this.draftTo.set(range.to);
      this.sales.set(null);
      void this.loadSales();
    });
    void this.loadStatus();
    void this.loadSettings();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty() || this.saving()) { event.preventDefault(); event.returnValue = ''; }
  }

  async canDeactivate(): Promise<boolean> {
    if (this.saving()) return false;
    if (this.dirty() && !(await confirmLeave(this.ui, () => this.saveSettings()))) return false;
    return (await this.settlements()?.canDeactivate()) ?? true;
  }

  async closeSettings(): Promise<void> {
    if (await this.canDeactivate()) {
      const settings = this.settings();
      if (settings) { this.draftMode.set(settings.notificationMode); this.draftTime.set(settings.summaryTime.slice(0, 5)); }
      this.settingsOpen.set(false);
    }
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
      if (previousSuccess !== undefined && status.lastSuccessAt !== previousSuccess) void this.loadSales();
    } catch (failure) {
      if (!this.destroyed) this.statusError.set(messageOf(failure, 'De verbindingsstatus kon niet worden geladen.'));
    } finally {
      this.statusBusy = false;
      if (!this.destroyed) this.pollTimer = setTimeout(() => void this.loadStatus(), this.syncBusy() ? 5000 : 60000);
    }
  }

  async sync(): Promise<void> {
    if (!this.canSync()) return;
    this.syncing.set(true);
    this.syncError.set(null);
    try {
      const result = await this.api.sync();
      if (this.destroyed) return;
      if (result.queued) {
        this.status.update(status => status ? { ...status, syncState: 'PENDING' } : status);
        this.ui.toast('TICA-verkopen worden opgehaald');
        clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => void this.loadStatus(), 5000);
      }
    } catch (failure) {
      if (!this.destroyed) this.syncError.set(messageOf(failure, 'Verkopen ophalen kon niet worden gestart.'));
    } finally { if (!this.destroyed) this.syncing.set(false); }
  }

  applyRange(): void {
    const error = ticaRangeError(this.draftFrom(), this.draftTo());
    if (error) { this.formError.set(error); return; }
    this.formError.set(null);
    if (this.from() === this.draftFrom() && this.to() === this.draftTo()) {
      void this.loadSales();
      return;
    }
    void this.router.navigate([], { relativeTo: this.route, replaceUrl: true,
      queryParams: { from: this.draftFrom(), to: this.draftTo() }, queryParamsHandling: 'merge' });
  }

  preset(preset: 'today' | 'week' | 'month'): void {
    const range = ticaPreset(preset);
    this.draftFrom.set(range.from); this.draftTo.set(range.to);
    this.applyRange();
  }

  async loadSales(more = false): Promise<void> {
    if (more && (this.loading() || !this.hasMore())) return;
    const version = ++this.salesVersion;
    const previous = this.sales();
    this.loading.set(true);
    this.salesError.set(null);
    try {
      const page = await this.api.sales(this.from(), this.to(), more && previous ? previous.page + 1 : 0);
      if (version !== this.salesVersion || this.destroyed) return;
      this.sales.set(more && previous ? { ...page, lines: [...new Map([...previous.lines, ...page.lines].map(line => [line.id, line])).values()] } : page);
    } catch (failure) {
      if (version === this.salesVersion && !this.destroyed) this.salesError.set(messageOf(failure, 'De TICA-verkopen konden niet worden geladen.'));
    } finally { if (version === this.salesVersion && !this.destroyed) this.loading.set(false); }
  }
}
