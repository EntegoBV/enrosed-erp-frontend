import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Ui } from '../../shared/ui';
import { WebsiteSyncStatus } from './website-sync-status';
import { WebsiteSyncStore } from './website-sync-store';
import { WebsitePriceStore } from './website-price-store';

@Component({
  selector: 'app-website-quote-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WebsiteSyncStatus],
  template: `
    <div class="quote-setting" [attr.aria-busy]="loading() || saving()">
      <div class="quote-setting__row">
        <div>
          <h3 id="quote-prices-label">Prijzen tonen op de website</h3>
          <p id="quote-prices-description">Geldt voor de productpagina’s en het offerte- en bestelscherm. Staat dit uit, dan ziet een bezoeker nergens op de website een prijs.</p>
        </div>
        <button class="quote-setting__switch" type="button" role="switch"
                aria-labelledby="quote-prices-label" aria-describedby="quote-prices-description"
                [attr.aria-checked]="settings()?.pricesVisible === true"
                [class.quote-setting__switch--on]="settings()?.pricesVisible === true"
                [disabled]="loading() || saving() || !settings()"
                (click)="togglePrices()">
          <span aria-hidden="true"></span>
        </button>
      </div>
      <p class="quote-setting__status" aria-live="polite" role="status">
        @if (loading()) {
          Instelling laden…
        } @else if (saving()) {
          Wijziging opslaan…
        } @else if (settings(); as current) {
          <b>{{ current.pricesVisible ? 'Prijzen zichtbaar' : 'Prijzen verborgen' }}</b>
          <span>{{ current.pricesVisible
            ? 'Bezoekers zien prijzen op de productpagina’s en in het offerte- en bestelscherm.'
            : 'Bezoekers zien geen bedragen. Bij elk product staat dat de prijs op aanvraag is. De prijs volgt in jullie offerte.' }}</span>
        }
      </p>
      @if (error(); as failure) {
        <div class="quote-setting__error" role="alert">
          <span>{{ failure }}</span>
          <button class="btn btn--sm" type="button" [disabled]="loading() || saving()" (click)="load()">Opnieuw laden</button>
        </div>
      }
      <p class="quote-setting__hint">Geldt voor alle websitetalen. Wijzigingen worden meteen opgeslagen. {{ rebuildHint() }} Prijzen blijven beschikbaar in het dashboard en op jullie offertes en facturen.</p>
      <app-website-sync-status compact [refreshKey]="syncRefreshKey()" />
    </div>
  `,
  styles: `
    :host { display: block; }
    .quote-setting__row { display: flex; gap: 24px; align-items: center; justify-content: space-between; }
    h3 { font-size: 15px; margin: 0 0 6px; }
    p { margin: 0; line-height: 1.5; }
    .quote-setting__row p { color: var(--ink-2); font-size: 13px; max-width: 640px; }
    .quote-setting__switch { flex: 0 0 52px; width: 52px; height: 44px; border: 0; background: transparent; position: relative; cursor: pointer; padding: 7px 0; }
    .quote-setting__switch::before { content: ''; position: absolute; inset: 7px 0; background: var(--line-strong); border-radius: 20px; transition: background .18s; }
    .quote-setting__switch span { position: relative; display: block; width: 24px; height: 24px; margin: 3px; background: #fff; border-radius: 50%; box-shadow: 0 1px 4px #0003; transition: transform .18s; }
    .quote-setting__switch--on::before { background: var(--accent); }
    .quote-setting__switch--on span { transform: translateX(22px); }
    .quote-setting__switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 22px; }
    .quote-setting__switch:disabled { cursor: default; opacity: .5; }
    .quote-setting__status { display: grid; gap: 3px; margin-top: 18px; padding: 13px 15px; border: 1px solid var(--line-strong); border-radius: 14px; font-size: 13px; }
    .quote-setting__status:empty { display: none; }
    .quote-setting__status span, .quote-setting__hint { color: var(--ink-2); }
    .quote-setting__hint { font-size: 12px; margin-top: 12px; }
    .quote-setting__error { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; color: var(--danger); font-size: 13px; margin-top: 12px; }
    @media (max-width: 679px) { .quote-setting__row { gap: 14px; align-items: flex-start; } }
    @media (prefers-reduced-motion: reduce) { .quote-setting__switch::before, .quote-setting__switch span { transition: none; } }
  `,
})
export class WebsiteQuoteSettings {
  private readonly ui = inject(Ui);
  private readonly sync = inject(WebsiteSyncStore);
  /** The one price switch of the app: the settings overview reads the same store. */
  private readonly prices = inject(WebsitePriceStore);
  readonly settings = this.prices.settings;
  readonly loading = this.prices.loading;
  readonly saving = this.prices.saving;
  readonly error = this.prices.error;
  /** Host counter, so a rebuild queued elsewhere on the page also refreshes this status. */
  readonly refreshKey = input(0);
  /** Emits after a save; the backend queues a website rebuild when the value changed. */
  readonly saved = output<void>();
  private readonly ownRefresh = signal(0);
  readonly syncRefreshKey = computed(() => this.refreshKey() + this.ownRefresh());
  readonly rebuildHint = computed(() => this.sync.status()?.status === 'NOT_CONFIGURED'
    ? 'De website wordt nu nog niet automatisch opnieuw opgebouwd. Hieronder staat wat daarvoor nodig is.'
    : 'Na een wijziging wordt de website automatisch opnieuw opgebouwd. Dat duurt enkele minuten. Hieronder zie je wanneer de website is bijgewerkt.');

  constructor() { void this.load(); }

  load(): Promise<void> {
    return this.prices.load();
  }

  /**
   * Turning prices on asks first (every visitor sees them, in every
   * language); turning them off does not. Either way the toast offers
   * "Ongedaan maken", which works even after leaving this screen.
   */
  togglePrices(): void {
    const current = this.settings();
    if (!current || this.loading() || this.saving()) return;
    if (current.pricesVisible) { void this.switchPrices(false); return; }
    this.ui.confirm({
      title: 'Prijzen tonen op de website?',
      message: 'Elke bezoeker ziet dan prijzen, in alle talen. De website wordt opnieuw opgebouwd.',
      confirmLabel: 'Prijzen tonen',
    }, () => void this.switchPrices(true));
  }

  private async switchPrices(visible: boolean): Promise<void> {
    try {
      const saved = await this.prices.save(visible);
      this.ownRefresh.update((value) => value + 1);
      this.saved.emit();
      // Only the saved fact: whether a rebuild follows is for the status below to say.
      this.ui.toast(saved.pricesVisible ? 'Prijzen zichtbaar op de website' : 'Prijzen verborgen op de website', 'ok',
        { label: 'Ongedaan maken', run: () => void undoPriceSwitch(this.prices, this.sync, this.ui, !saved.pricesVisible) });
    } catch {
      /* The store holds the message; the error row below shows it. */
    }
  }
}

/**
 * The undo of a price switch: no confirm (he just had that state), and only
 * root services, so it still works once the settings screen is gone.
 */
async function undoPriceSwitch(prices: WebsitePriceStore, sync: WebsiteSyncStore, ui: Ui, visible: boolean): Promise<void> {
  try {
    const saved = await prices.save(visible);
    sync.refresh();
    ui.toast(saved.pricesVisible ? 'Prijzen weer zichtbaar op de website' : 'Prijzen weer verborgen op de website');
  } catch (failure: unknown) {
    ui.toast(failure instanceof Error ? failure.message : 'Ongedaan maken is niet gelukt.', 'err');
  }
}
