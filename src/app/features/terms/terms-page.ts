import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { api } from '../../core/api/api.config';
import { Auth } from '../../core/api/auth';
import { CompanyProfile } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { PageHeader } from '../../shared/page-header';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';

/**
 * Terms and privacy statement, publicly readable.
 *
 * Quote PDFs and the customer portal link here; non-Dutch documents arrive
 * with ?lang=en. Dutch and English are the two maintained versions - a
 * toggle offers the other one, nothing more.
 *
 * Staff (logged in) read the same texts inside the app: the page header
 * with NL | EN and Bewerken (to Instellingen › Voorwaarden & privacy) and a
 * line saying which texts are our own. Customers keep the dark bar.
 */
@Component({
  selector: 'app-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, PageHeader, RouterLink, Segmented, Skeleton],
  template: `
    @if (staff()) {
      <app-page-header title="Voorwaarden & privacy" subtitle="Zo lezen klanten het" [showBell]="desktop.active()" [large]="false">
        @if (desktop.active()) {
          <app-segmented label="Taal" [options]="languages" [value]="language()" (changed)="load($event === 'en' ? 'en' : 'nl')" />
        }
        <a class="btn" routerLink="/settings" [queryParams]="{ sectie: 'legal' }">Bewerken</a>
      </app-page-header>
      <div class="content terms-staff">
        @if (!desktop.active()) {
          <app-segmented class="terms-staff__seg" variant="ios" label="Taal" [options]="languages" [value]="language()" (changed)="load($event === 'en' ? 'en' : 'nl')" />
        }
        @if (status(); as line) { <p class="terms-staff__status">{{ line }}</p> }
        <ng-container [ngTemplateOutlet]="texts" />
      </div>
    } @else {
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
        <ng-container [ngTemplateOutlet]="texts" />
        <p class="tiny muted center mt-24">{{ companyName() }}</p>
      </div>
    </div>
    }

    <ng-template #texts>
        <div class="card">
          <div class="card__head">
            <h2>{{ language() === 'nl' ? 'Algemene voorwaarden' : 'Terms and conditions' }}</h2>
          </div>
          <div class="card__body">
            <ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ text: terms() }" />
          </div>
        </div>

        <div class="card mt-16">
          <div class="card__head">
            <h2>{{ language() === 'nl' ? 'Privacyverklaring' : 'Privacy statement' }}</h2>
          </div>
          <div class="card__body">
            <ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ text: privacy() }" />
          </div>
        </div>
    </ng-template>

    <ng-template #body let-text="text">
      @if (failed()) {
        <div class="terms__failed" role="alert">
          <p>{{ language() === 'nl' ? 'De tekst kon niet worden geladen. Probeer het later opnieuw.' : 'The text could not be loaded. Please try again later.' }}</p>
          <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="load(language())">{{ language() === 'nl' ? 'Opnieuw proberen' : 'Try again' }}</button>
        </div>
      } @else if (loading() || !text) {
        <app-skeleton kind="lines" [rows]="6" />
      } @else {
        <div class="terms__text">{{ text }}</div>
      }
    </ng-template>
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
    .terms__failed { display: grid; justify-items: start; gap: 10px; color: var(--danger); font-size: 13.5px; }
    .terms__failed p { margin: 0; }
    .terms-staff { max-width: 860px; }
    .terms-staff__seg { display: grid; margin: 0 0 14px; }
    .terms-staff__status { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
  `,
})
export class TermsPage {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(Auth);
  private readonly sales = inject(SalesApi);
  readonly desktop = inject(DesktopViewport);

  /** Staff read the texts inside the app; customers get the public page. */
  readonly staff = this.auth.isLoggedIn;
  readonly languages: readonly SegmentOption[] = [
    { id: 'nl', label: 'Nederlands', shortLabel: 'NL' },
    { id: 'en', label: 'English', shortLabel: 'EN' },
  ];
  readonly language = signal<'nl' | 'en'>('nl');
  readonly terms = signal('');
  readonly privacy = signal('');
  readonly companyName = signal('Enrosed BV');
  readonly loading = signal(true);
  readonly failed = signal(false);
  private readonly profile = signal<CompanyProfile | null>(null);
  private requestId = 0;

  /** "Algemene voorwaarden: ingebouwd voorstel · Privacyverklaring: eigen tekst" for the open language. */
  readonly status = computed(() => {
    const profile = this.profile();
    if (!profile) return '';
    const en = this.language() === 'en';
    const word = (value: string | null | undefined) => value?.trim() ? 'eigen tekst' : 'ingebouwd voorstel';
    return `Algemene voorwaarden: ${word(en ? profile.termsAndConditionsEn : profile.termsAndConditions)}`
      + ` · Privacyverklaring: ${word(en ? profile.privacyPolicyEn : profile.privacyPolicy)}`;
  });

  constructor() {
    const requested = this.route.snapshot.queryParamMap.get('lang');
    void this.load(requested === 'en' ? 'en' : 'nl');
    if (this.staff()) this.sales.company().then((profile) => this.profile.set(profile), () => undefined);
  }

  async load(language: 'nl' | 'en'): Promise<void> {
    const id = ++this.requestId;
    this.language.set(language);
    this.loading.set(true);
    this.failed.set(false);
    try {
      const result = await firstValueFrom(this.http.get<{
        companyName: string; terms: string; privacy: string;
      }>(api('/api/public/terms?lang=' + language)));
      if (id !== this.requestId) return;
      this.terms.set(result.terms);
      this.privacy.set(result.privacy);
      this.companyName.set(result.companyName);
    } catch {
      if (id !== this.requestId) return;
      this.terms.set('');
      this.privacy.set('');
      this.failed.set(true);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
