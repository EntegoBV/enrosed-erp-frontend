import { Injectable, inject, signal } from '@angular/core';
import { SalesApi, WebsiteQuoteSettings as QuoteSettings } from '../../core/api/sales-api';
import { messageOf } from '../../core/api/errors';

/**
 * Whether the website shows prices, as one fact for the whole app. The
 * Website view switches it; the settings overview reads the same signal, so
 * it can never show "Verborgen" after the switch went on (the kind of
 * mistake behind the earlier live price leak).
 */
@Injectable({ providedIn: 'root' })
export class WebsitePriceStore {
  private readonly sales = inject(SalesApi);

  readonly settings = signal<QuoteSettings | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Reads the switch from the server; the shown value stays while it runs. */
  async load(): Promise<void> {
    if (this.loading() || this.saving()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.settings.set(checked(await this.sales.websiteQuoteSettings()));
    } catch (failure) {
      this.error.set(messageOf(failure, 'De prijsinstelling kon niet worden geladen. Probeer opnieuw.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Saves the switch; returns the saved state, or throws with the message to show. */
  async save(pricesVisible: boolean): Promise<QuoteSettings> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = checked(await this.sales.saveWebsiteQuoteSettings({ pricesVisible }));
      this.settings.set(saved);
      return saved;
    } catch (failure) {
      const message = messageOf(failure, 'Opslaan kon niet worden bevestigd. Laad de instelling opnieuw.');
      this.error.set(message);
      throw new Error(message);
    } finally {
      this.saving.set(false);
    }
  }
}

function checked(value: QuoteSettings): QuoteSettings {
  if (typeof value?.pricesVisible !== 'boolean') throw new Error('De server gaf geen geldige prijsinstelling terug. Laad de pagina opnieuw.');
  return value;
}
