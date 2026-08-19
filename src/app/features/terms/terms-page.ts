import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { api } from '../../core/api/api.config';

/**
 * Terms and privacy statement, publicly readable.
 *
 * Quote PDFs and the customer portal link here; non-Dutch documents arrive
 * with ?lang=en. Dutch and English are the two maintained versions - a
 * toggle offers the other one, nothing more.
 */
@Component({
  selector: 'app-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="terms">
      <header class="terms__bar">
        <img class="terms__logo" src="logo-ui.png" alt="Enrosed" />
        <div class="terms__lang">
          <button type="button" [class.on]="language() === 'nl'"
                  (click)="load('nl')">NL</button>
          <button type="button" [class.on]="language() === 'en'"
                  (click)="load('en')">EN</button>
        </div>
      </header>

      <div class="content" style="max-width:760px">
        <div class="card">
          <div class="card__head">
            <h2>{{ language() === 'nl' ? 'Algemene voorwaarden' : 'Terms and conditions' }}</h2>
          </div>
          <div class="card__body">
            @if (terms(); as body) {
              <div class="terms__text">{{ body }}</div>
            } @else {
              <div class="empty"><div class="empty__title">…</div></div>
            }
          </div>
        </div>

        <div class="card mt-16">
          <div class="card__head">
            <h2>{{ language() === 'nl' ? 'Privacyverklaring' : 'Privacy statement' }}</h2>
          </div>
          <div class="card__body">
            @if (privacy(); as body) {
              <div class="terms__text">{{ body }}</div>
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
      position: relative;
    }
    .terms__logo {
      height: 26px; width: auto; max-width: min(220px, 70vw);
      object-fit: contain; filter: invert(1);
    }
    .terms__lang {
      position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
      display: flex; gap: 2px;
    }
    .terms__lang button {
      border: 1px solid #4a423e; background: transparent; color: #cfc6c0;
      font-size: 11.5px; font-weight: 700; padding: 4px 9px; cursor: pointer;
    }
    .terms__lang button:first-child { border-radius: 6px 0 0 6px; }
    .terms__lang button:last-child { border-radius: 0 6px 6px 0; }
    .terms__lang button.on { background: #cfc6c0; color: #17120f; }
    /* pre-line keeps the article structure of the plain-text legal texts. */
    .terms__text { white-space: pre-line; font-size: 13.5px; line-height: 1.65; }
  `,
})
export class TermsPage {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  readonly language = signal<'nl' | 'en'>('nl');
  readonly terms = signal('');
  readonly privacy = signal('');
  readonly companyName = signal('Enrosed BV');

  constructor() {
    const requested = this.route.snapshot.queryParamMap.get('lang');
    void this.load(requested === 'en' ? 'en' : 'nl');
  }

  async load(language: 'nl' | 'en'): Promise<void> {
    this.language.set(language);
    try {
      const result = await firstValueFrom(this.http.get<{
        companyName: string; terms: string; privacy: string;
      }>(api('/api/public/terms?lang=' + language)));
      this.terms.set(result.terms);
      this.privacy.set(result.privacy);
      this.companyName.set(result.companyName);
    } catch {
      this.terms.set(language === 'nl'
        ? 'De voorwaarden konden niet geladen worden. Probeer het later opnieuw.'
        : 'The terms could not be loaded. Please try again later.');
    }
  }
}
