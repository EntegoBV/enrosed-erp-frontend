import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SalesApi, WebsiteQuoteSettings as QuoteSettings } from '../../core/api/sales-api';
import { messageOf } from '../../core/api/errors';
import { Ui } from '../../shared/ui';

@Component({
  selector: 'app-website-quote-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="quote-setting" [attr.aria-busy]="loading() || saving()">
      <div class="quote-setting__row">
        <div>
          <h3 id="quote-prices-label">Prijzen tonen bij offerteaanvraag</h3>
          <p id="quote-prices-description">Toon stukprijzen, kortingen, bezorgkosten en totalen tijdens het samenstellen van een aanvraag op de website.</p>
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
            ? 'Bezoekers zien een indicatieve prijs bij hun selectie.'
            : 'Bezoekers kiezen producten en aantallen. De prijs volgt in jullie offerte.' }}</span>
        }
      </p>
      @if (error(); as failure) {
        <div class="quote-setting__error" role="alert">
          <span>{{ failure }}</span>
          <button class="btn btn--sm" type="button" [disabled]="loading() || saving()" (click)="load()">Opnieuw laden</button>
        </div>
      }
      <p class="quote-setting__hint">Geldt voor alle websitetalen. Prijzen blijven beschikbaar in het dashboard en op jullie offertes en facturen. Wijzigingen worden meteen opgeslagen.</p>
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
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);
  readonly settings = signal<QuoteSettings | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor() { void this.load(); }

  async load(): Promise<void> {
    if (this.loading() || this.saving()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.settings.set(this.checked(await this.sales.websiteQuoteSettings()));
    } catch (failure) {
      this.error.set(messageOf(failure, 'De prijsinstelling kon niet worden geladen. Probeer opnieuw.'));
    } finally {
      this.loading.set(false);
    }
  }

  async togglePrices(): Promise<void> {
    const current = this.settings();
    if (!current || this.loading() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = this.checked(await this.sales.saveWebsiteQuoteSettings({ pricesVisible: !current.pricesVisible }));
      this.settings.set(saved);
      this.ui.toast(saved.pricesVisible ? 'Prijzen zichtbaar bij offerteaanvraag' : 'Prijzen verborgen bij offerteaanvraag', 'ok');
    } catch (failure) {
      this.error.set(messageOf(failure, 'Opslaan kon niet worden bevestigd. Laad de instelling opnieuw.'));
    } finally {
      this.saving.set(false);
    }
  }

  private checked(value: QuoteSettings): QuoteSettings {
    if (typeof value?.pricesVisible !== 'boolean') throw new Error('De server gaf geen geldige prijsinstelling terug. Laad de pagina opnieuw.');
    return value;
  }
}
