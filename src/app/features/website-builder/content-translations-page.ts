import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { PageHeader } from '../../shared/page-header';
import { ContentTranslationWorkspace } from '../settings/content-translation-workspace';
import { WebsiteProductSeoAudit } from './website-product-seo-audit';

@Component({
  selector: 'app-content-translations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ContentTranslationWorkspace,
    PageHeader,
    RouterLink,
    WebsiteProductSeoAudit,
  ],
  template: `
    <app-page-header
      [title]="catalogMode ? 'Cataloguslabels' : (seoMode ? 'SEO beheren' : 'Websiteteksten & vertalingen')"
      [subtitle]="catalogMode
        ? 'Algemene labels voor de PDF-catalogus, los van de website.'
        : (seoMode
          ? 'Algemene pagina-SEO hier; product-SEO blijft bij het product.'
          : 'Beheer algemene websitecopy per taal. Productteksten blijven bij het product.')"
      [showBack]="catalogMode"
      [backTo]="catalogMode ? '/catalog-export' : null"
      [showBell]="false"
    />
    <main class="content content-page">
      <section class="ownership-guide" [class.ownership-guide--catalog]="catalogMode" role="note">
        <div>
          <span>{{ catalogMode ? 'PDF-catalogus' : (seoMode ? 'Pagina-SEO' : 'Algemene websitecopy') }}</span>
          <b>{{ catalogMode
            ? 'Deze labels verschijnen rond producten in de catalogus.'
            : (seoMode
              ? 'Titels en beschrijvingen voor homepage en algemene pagina’s.'
              : 'Homepage, navigatie, footer, juridische pagina’s en algemene labels.') }}</b>
          <small>{{ catalogMode
            ? 'Productnamen en productteksten worden niet op deze pagina gewijzigd.'
            : 'Acht talen, met verplichte velden en revision-beveiliging.' }}</small>
        </div>
        @if (!catalogMode) {
          <div>
            <span>Productinhoud</span>
            <b>Productnaam, beschrijving, product-SEO en foto-alt</b>
            <small>Deze gegevens horen bij het product en blijven gescheiden van algemene paginacopy.</small>
            <a routerLink="/website/products">Product kiezen <i aria-hidden="true">→</i></a>
          </div>
        }
      </section>

      @if (seoMode) {
        <app-website-product-seo-audit />
      }

      <app-content-translation-workspace
        [visible]="true"
        [title]="catalogMode ? 'Cataloguslabels' : (seoMode ? 'Algemene pagina-SEO' : 'Websiteteksten')"
        [description]="catalogMode
          ? 'Labels voor de PDF-catalogus in acht talen. Productspecifieke inhoud blijft bij het product.'
          : (seoMode
            ? 'Algemene meta-titels en beschrijvingen per pagina. Product-SEO beheert u in de controlelijst hierboven.'
            : 'Homepage, navigatie, footer en juridische pagina’s in acht talen. Productinhoud blijft bij het product.')"
        [initialScope]="catalogMode ? 'CATALOG' : 'WEBSITE'"
        [initialPrefix]="seoMode ? 'meta' : 'ALL'"
        [lockScope]="true"
        [lockPrefix]="seoMode"
        [allowAdvanced]="!seoMode"
        (dirtyChange)="dirty.set($event)"
        (busyChange)="busy.set($event)"
      />
    </main>
  `,
  styles: `
    .content-page { max-width: 1240px; margin-inline: auto; padding-bottom: calc(48px + env(safe-area-inset-bottom)); }
    .ownership-guide { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
    .ownership-guide > div { display: grid; align-content: start; gap: 5px; min-height: 150px; padding: 17px 18px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); }
    .ownership-guide > div:first-child { border-color: var(--rose-line); background: var(--rose-soft); }
    .ownership-guide > div > span { color: var(--rose-dark); font-size: 11px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
    .ownership-guide b { font-size: 17px; line-height: 1.35; }
    .ownership-guide small { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .ownership-guide a { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; margin-top: auto; color: var(--rose-dark); font-size: 14px; font-weight: 750; text-decoration: none; }
    .ownership-guide i { font-style: normal; }
    .ownership-guide--catalog { grid-template-columns: 1fr; }
    .ownership-guide--catalog > div { min-height: 112px; }
    a:focus-visible { outline: 3px solid var(--rose); outline-offset: 3px; }

    @media (max-width: 760px) {
      .ownership-guide { grid-template-columns: 1fr; }
    }

    @media (max-width: 460px) {
      .content-page { padding-inline: 12px; }
      .ownership-guide > div { min-height: 0; padding: 15px; }
    }
  `,
})
export class ContentTranslationsPage implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  readonly seoMode = this.route.snapshot.data['seoMode'] === true;
  readonly catalogMode = this.route.snapshot.data['catalogMode'] === true;
  readonly dirty = signal(false);
  readonly busy = signal(false);

  canDeactivate(): boolean {
    if (this.busy()) return false;
    if (!this.dirty()) return true;
    return window.confirm('U heeft teksten die nog niet zijn opgeslagen. Toch verlaten?');
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty() && !this.busy()) return;
    event.preventDefault();
    event.returnValue = '';
  }
}
