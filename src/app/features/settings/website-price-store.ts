import { Injectable, inject, signal } from '@angular/core';
import { SalesApi, WebsiteQuoteSettings as QuoteSettings } from '../../core/api/sales-api';
import { messageOf } from '../../core/api/errors';
import { ReadAfterWrite } from './read-after-write';

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
  /** A read that raced a save (the overview's refresh during an undo) never shows the old state (ReadAfterWrite). */
  private readonly order = new ReadAfterWrite();

  /** Reads the switch from the server; the shown value stays while it runs. */
  async load(): Promise<void> {
    if (this.loading() || this.saving()) return;
    this.loading.set(true);
    this.error.set(null);
    const ticket = this.order.readStarted();
    try {
      const settings = checked(await this.sales.websiteQuoteSettings());
      if (this.order.readCurrent(ticket)) this.settings.set(settings);
    } catch (failure) {
      if (this.order.readCurrent(ticket)) this.error.set(messageOf(failure, 'De prijsinstelling kon niet worden geladen. Probeer opnieuw.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Saves the switch; returns the saved state, or throws with the message to show. */
  async save(pricesVisible: boolean): Promise<QuoteSettings> {
    this.order.writeStarted();
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
      this.order.writeEnded();
    }
  }
}

function checked(value: QuoteSettings): QuoteSettings {
  if (typeof value?.pricesVisible !== 'boolean') throw new Error('De server gaf geen geldige prijsinstelling terug. Laad de pagina opnieuw.');
  return value;
}
