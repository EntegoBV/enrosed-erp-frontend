import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../../core/api/api.config';

/**
 * The general terms and conditions, publicly readable.
 *
 * The quote PDF and the customer portal link here, so this page needs no
 * login and no navigation chrome — a customer lands on it from a document,
 * reads, and leaves.
 */
@Component({
  selector: 'app-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="terms">
      <header class="terms__bar">
        <img class="terms__logo" src="logo.png" alt="Enrosed" />
      </header>

      <div class="content" style="max-width:760px">
        <div class="card">
          <div class="card__head"><h2>Algemene voorwaarden</h2></div>
          <div class="card__body">
            @if (text(); as body) {
              <div class="terms__text">{{ body }}</div>
            } @else {
              <div class="empty"><div class="empty__title">Laden…</div></div>
            }
          </div>
        </div>
        <p class="tiny muted center mt-24">{{ companyName() }}</p>
      </div>
    </div>
  `,
  styles: `
    .terms { min-height: 100dvh; background: var(--bg); }
    .terms__bar {
      background: #17120f;
      padding: 16px 20px;
      display: flex;
      justify-content: center;
    }
    .terms__logo {
      height: 26px; width: auto; max-width: min(220px, 70vw);
      object-fit: contain; filter: invert(1);
    }
    /* pre-line keeps the article structure of the plain-text terms. */
    .terms__text { white-space: pre-line; font-size: 13.5px; line-height: 1.65; }
  `,
})
export class TermsPage {
  private readonly http = inject(HttpClient);

  readonly text = signal('');
  readonly companyName = signal('Enrosed');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const terms = await firstValueFrom(
        this.http.get<{ companyName: string; text: string }>(api('/api/public/terms')));
      this.text.set(terms.text);
      this.companyName.set(terms.companyName);
    } catch {
      this.text.set('De voorwaarden konden niet geladen worden. Probeer het later opnieuw.');
    }
  }
}
