import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Auth } from '../../core/api/auth';
import { BrandMark } from '../../shared/brand-mark';
import { Icon } from '../../shared/icon';

/** A dedicated shell for public-website work, separate from daily ERP operations. */
@Component({
  selector: 'app-website-admin-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, Icon, RouterLink, RouterLinkActive],
  template: `
    <aside class="website-sidebar" aria-label="Website beheren">
      <header class="website-sidebar__brand">
        <app-brand-mark subtitle="Website workspace" />
        @if (environmentLabel) { <span>{{ environmentLabel }}</span> }
      </header>

      <div class="website-sidebar__context">
        <small>Website beheren</small>
        <strong>Enrosed B2B</strong>
        <a [href]="previewBaseUrl" target="_blank" rel="noopener">
          {{ previewLinkLabel }} <span aria-hidden="true">↗</span>
        </a>
      </div>

      <nav class="website-sidebar__nav" aria-label="Onderdelen van Website beheren">
        <span class="website-sidebar__label">Werkruimte</span>
        <a routerLink="/website" routerLinkActive="active"
           [routerLinkActiveOptions]="{ exact: true }">
          <app-icon name="home" [size]="19" />
          <span><b>Overzicht</b><small>Start en open taken</small></span>
        </a>
        <a routerLink="/website/layout" routerLinkActive="active">
          <app-icon name="exchange" [size]="19" />
          <span><b>Indeling &amp; preview</b><small>Homepage samenstellen</small></span>
        </a>
        <a routerLink="/website/products" routerLinkActive="active">
          <app-icon name="products" [size]="19" />
          <span><b>Producten</b><small>Publieke productinhoud</small></span>
        </a>
        <a routerLink="/website/categories" routerLinkActive="active">
          <app-icon name="more" [size]="19" />
          <span><b>Categorieën &amp; menu</b><small>Collecties en navigatie</small></span>
        </a>

        <span class="website-sidebar__label website-sidebar__label--spaced">Inhoud &amp; bereik</span>
        <a routerLink="/website/texts" routerLinkActive="active">
          <app-icon name="sales" [size]="19" />
          <span><b>Webcopy &amp; vertalingen</b><small>Pagina's, navigatie en footer</small></span>
        </a>
        <a routerLink="/website/seo" routerLinkActive="active">
          <app-icon name="countries" [size]="19" />
          <span><b>SEO</b><small>Pagina- en productcontrole</small></span>
        </a>
        <a routerLink="/website/publication" routerLinkActive="active">
          <app-icon name="stock" [size]="19" />
          <span><b>Publicatie</b><small>Concept, live en herstel</small></span>
        </a>

        <span class="website-sidebar__label website-sidebar__label--spaced">Bestellen</span>
        <a class="website-sidebar__utility" routerLink="/stock-locations">
          <app-icon name="truck" [size]="19" />
          <span><b>Afhalen &amp; locaties</b><small>Publieke afhaalpunten in ERP</small></span>
          <i aria-hidden="true">↗</i>
        </a>
      </nav>

      <footer class="website-sidebar__footer">
        <a class="website-sidebar__back" routerLink="/dashboard">
          <span aria-hidden="true">←</span>
          <span><b>Terug naar ERP</b><small>Verkoop &amp; voorraad</small></span>
        </a>
        <div class="website-sidebar__account">
          <span>{{ auth.username() }}</span>
          <button type="button" (click)="logout()">Afmelden</button>
        </div>
      </footer>
    </aside>
  `,
  styles: `
    :host { display: block; width: 100%; flex: none; color: #f8f4ef; background: #171311; }
    .website-sidebar { display: flex; min-height: 0; flex-direction: column; }
    .website-sidebar__brand {
      display: flex; min-height: 78px; align-items: center; justify-content: space-between;
      gap: 10px; padding: 15px 18px; border-bottom: 1px solid rgb(255 255 255 / 10%);
    }
    .website-sidebar__brand app-brand-mark { min-width: 0; filter: invert(1) grayscale(1) brightness(2); }
    .website-sidebar__brand > span {
      flex: none; padding: 4px 7px; border: 1px solid rgb(255 255 255 / 20%);
      border-radius: 999px; color: #d7b876; font-size: 9px; font-weight: 850; letter-spacing: .12em;
    }
    .website-sidebar__context { display: none; }
    .website-sidebar__nav {
      display: grid; grid-template-columns: repeat(8, minmax(176px, 1fr)); gap: 6px;
      padding: 10px 12px; overflow-x: auto; scrollbar-width: thin;
    }
    .website-sidebar__label { display: none; }
    .website-sidebar__nav > a {
      display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 9px;
      min-height: 54px; padding: 8px 11px; border: 1px solid transparent; border-radius: 12px;
      color: rgb(255 255 255 / 68%); text-decoration: none;
    }
    .website-sidebar__nav > a > span { display: grid; min-width: 0; gap: 1px; }
    .website-sidebar__nav b { color: inherit; font-size: 13px; line-height: 1.25; }
    .website-sidebar__nav small {
      overflow: hidden; color: rgb(255 255 255 / 42%); font-size: 10.5px;
      line-height: 1.25; text-overflow: ellipsis; white-space: nowrap;
    }
    .website-sidebar__nav > a:hover { background: rgb(255 255 255 / 7%); color: #fff; }
    .website-sidebar__nav > a.active {
      border-color: rgb(215 184 118 / 28%); background: rgb(215 184 118 / 14%); color: #f5d894;
    }
    .website-sidebar__nav > a.active small { color: rgb(245 216 148 / 62%); }
    .website-sidebar__nav > a:focus-visible,
    .website-sidebar__footer a:focus-visible,
    .website-sidebar__footer button:focus-visible { outline: 3px solid #d7b876; outline-offset: 2px; }
    .website-sidebar__utility { grid-template-columns: 24px minmax(0, 1fr) auto !important; }
    .website-sidebar__utility i { color: rgb(255 255 255 / 35%); font-style: normal; }
    .website-sidebar__footer {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 11px 14px; border-top: 1px solid rgb(255 255 255 / 10%);
    }
    .website-sidebar__back { display: flex; align-items: center; gap: 9px; color: #fff; text-decoration: none; }
    .website-sidebar__back > span:last-child { display: grid; }
    .website-sidebar__back b { font-size: 12px; }
    .website-sidebar__back small { color: rgb(255 255 255 / 45%); font-size: 10px; }
    .website-sidebar__account { display: flex; align-items: center; gap: 8px; color: rgb(255 255 255 / 45%); font-size: 10.5px; }
    .website-sidebar__account button {
      min-height: 36px; padding: 5px 9px; border: 1px solid rgb(255 255 255 / 18%);
      border-radius: 9px; background: transparent; color: #fff; cursor: pointer;
    }

    @media (min-width: 960px) {
      :host { width: 292px; flex: 0 0 292px; }
      .website-sidebar { position: sticky; top: 0; height: 100dvh; }
      .website-sidebar__context { display: grid; gap: 3px; margin: 12px; padding: 15px; border: 1px solid rgb(255 255 255 / 9%); border-radius: 14px; background: rgb(255 255 255 / 4%); }
      .website-sidebar__context small { color: rgb(255 255 255 / 44%); font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      .website-sidebar__context strong { font-size: 18px; }
      .website-sidebar__context a { display: inline-flex; align-items: center; gap: 5px; margin-top: 9px; color: #f5d894; font-size: 12px; font-weight: 750; text-decoration: none; }
      .website-sidebar__nav { display: block; flex: 1; padding: 2px 12px 16px; overflow: auto; }
      .website-sidebar__label { display: block; padding: 13px 10px 6px; color: rgb(255 255 255 / 35%); font-size: 9px; font-weight: 850; letter-spacing: .15em; text-transform: uppercase; }
      .website-sidebar__label--spaced { margin-top: 7px; border-top: 1px solid rgb(255 255 255 / 8%); }
      .website-sidebar__nav > a { margin-bottom: 2px; }
      .website-sidebar__footer { display: grid; align-items: stretch; padding: 12px; }
      .website-sidebar__back { padding: 8px; border-radius: 10px; }
      .website-sidebar__back:hover { background: rgb(255 255 255 / 6%); }
      .website-sidebar__account { justify-content: space-between; padding: 8px 8px 0; border-top: 1px solid rgb(255 255 255 / 8%); }
    }
  `,
})
export class WebsiteAdminNav {
  readonly auth = inject(Auth);
  readonly environmentLabel = environment.environmentLabel;
  readonly previewBaseUrl = environment.websitePreviewUrl;
  readonly previewLinkLabel = environment.environmentLabel === 'TEST'
    ? 'Testsite bekijken'
    : environment.environmentLabel === 'LOCAL'
      ? 'Lokale website bekijken'
      : 'Website bekijken';
  private readonly router = inject(Router);

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
