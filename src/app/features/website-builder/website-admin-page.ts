import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { PageHeader } from '../../shared/page-header';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { WebsiteTranslationQueue } from './website-translation-queue';

@Component({
  selector: 'app-website-admin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, RouterLink, WebsiteSyncStatus, WebsiteTranslationQueue],
  template: `
    <app-page-header
      title="Website beheren"
      subtitle="Eén werkplek voor inhoud, producten, vindbaarheid en publicatie."
      [showBell]="false"
    >
      <a class="btn btn--primary btn--sm" [href]="previewBaseUrl" target="_blank" rel="noopener">
        Testsite openen ↗
      </a>
    </app-page-header>

    <main class="content website-home">
      <section class="workspace-intro">
        <div>
          <span class="eyebrow">Website workspace</span>
          <h2>Kies wat u wilt aanpassen</h2>
          <p>
            De website gebruikt productdata uit het ERP. Publieke teksten en SEO hebben
            hier hun eigen duidelijke plek; interne namen, prijzen en factuurdata blijven intact.
          </p>
        </div>
        <aside role="note">
          <b>Merchandising-richting</b>
          <span>Glass bowls zijn de bestsellers en verdienen de meeste zichtbaarheid. Soap- en foamrozen blijven een ondersteunende collectie. Collectiebeelden komen van de featured SKU; vaste homepage-highlights volgen hun eigen websitecomponent.</span>
        </aside>
      </section>

      <section class="workspace-grid" aria-label="Website beheertaken">
        <a class="workspace-card workspace-card--primary" routerLink="/website/layout">
          <span aria-hidden="true">01</span>
          <div><b>Homepage-indeling &amp; live voorbeeld</b><small>Zet onderdelen in de juiste volgorde, verberg wat minder belangrijk is en controleer de testsite.</small></div>
          <strong>Indeling openen →</strong>
        </a>
        <a class="workspace-card" routerLink="/website/texts">
          <span aria-hidden="true">02</span>
          <div><b>Websiteteksten &amp; vertalingen</b><small>Homepage, navigatie, footer, juridische pagina’s en algemene labels in acht talen.</small></div>
          <strong>Teksten beheren →</strong>
        </a>
        <a class="workspace-card" routerLink="/website/seo">
          <span aria-hidden="true">03</span>
          <div><b>SEO</b><small>Controleer algemene paginatitels, ontbrekende product-SEO en verdachte Engelse titels zonder teksten automatisch te veranderen.</small></div>
          <strong>SEO controleren →</strong>
        </a>
        <a class="workspace-card" routerLink="/website/products">
          <span aria-hidden="true">04</span>
          <div><b>Publieke productinhoud</b><small>Kies een product voor websitenaam, beschrijving, foto’s, product-SEO en vertalingen.</small></div>
          <strong>Product kiezen →</strong>
        </a>
        <a class="workspace-card" routerLink="/website/categories">
          <span aria-hidden="true">05</span>
          <div><b>Categorieën &amp; websitemenu</b><small>Bepaal volgorde, collectiebeeld en korte namen voor desktop, mobiel en footer.</small></div>
          <strong>Categorieën beheren →</strong>
        </a>
        <a class="workspace-card" routerLink="/website/publication">
          <span aria-hidden="true">06</span>
          <div><b>Publicatie &amp; synchronisatie</b><small>Controleer of opgeslagen wijzigingen al in Vercel zijn verwerkt en herstel een mislukte update.</small></div>
          <strong>Status bekijken →</strong>
        </a>
      </section>

      <app-website-translation-queue />

      <section class="publication-card card" aria-labelledby="publication-overview-title">
        <div class="publication-card__head">
          <div><span class="eyebrow">Laatste stap</span><h2 id="publication-overview-title">Is de website bijgewerkt?</h2></div>
          <a class="btn" routerLink="/website/publication">Volledige publicatiestatus</a>
        </div>
        <app-website-sync-status />
      </section>
    </main>
  `,
  styles: `
    :host { display: block; }
    .website-home { max-width: 1540px; padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
    .workspace-intro {
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, .55fr); gap: 18px;
      align-items: stretch; margin-bottom: 18px;
    }
    .workspace-intro > div { padding: 24px 26px; border-radius: var(--r); background: var(--ink); color: #fff; }
    .eyebrow { color: var(--rose); font-size: 11px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
    .workspace-intro h2 { margin-top: 6px; font-size: clamp(25px, 2.2vw, 36px); line-height: 1.08; }
    .workspace-intro p { max-width: 72ch; margin-top: 9px; color: rgb(255 255 255 / 72%); font-size: 16px; line-height: 1.55; }
    .workspace-intro aside {
      display: grid; align-content: center; gap: 7px; padding: 22px 24px; border: 1px solid var(--rose-line);
      border-radius: var(--r); background: var(--rose-soft);
    }
    .workspace-intro aside b { color: var(--rose-dark); font-size: 18px; }
    .workspace-intro aside span { color: var(--ink-2); font-size: 15px; line-height: 1.5; }
    .workspace-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .workspace-card {
      display: grid; min-height: 230px; align-content: start; gap: 16px; padding: 20px;
      border: 1px solid var(--line); border-radius: var(--r); background: var(--surface);
      color: var(--ink); text-decoration: none; box-shadow: var(--sh-1);
    }
    .workspace-card > span { color: var(--rose-dark); font-size: 12px; font-weight: 850; letter-spacing: .1em; }
    .workspace-card > div { display: grid; gap: 7px; }
    .workspace-card b { font-size: 20px; line-height: 1.25; }
    .workspace-card small { color: var(--muted); font-size: 15px; line-height: 1.5; }
    .workspace-card strong { align-self: end; margin-top: auto; color: var(--rose-dark); font-size: 14px; }
    .workspace-card:hover { border-color: var(--rose-line); transform: translateY(-1px); box-shadow: var(--sh-2); }
    .workspace-card--primary { background: color-mix(in srgb, var(--rose-soft) 75%, var(--surface)); border-color: var(--rose-line); }
    .workspace-card:focus-visible { outline: 3px solid var(--rose); outline-offset: 3px; }
    .publication-card { margin-top: 18px; padding: 18px; }
    .publication-card__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    .publication-card__head h2 { margin-top: 3px; font-size: 22px; }
    .publication-card__head .btn { min-height: 48px; }
    .publication-card app-website-sync-status { display: block; }

    @media (max-width: 1100px) {
      .workspace-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .website-home { padding-inline: 12px; }
      .workspace-intro, .workspace-grid { grid-template-columns: 1fr; }
      .workspace-card { min-height: 0; }
      .publication-card__head { align-items: stretch; flex-direction: column; }
      .publication-card__head .btn { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .workspace-card:hover { transform: none; }
    }
  `,
})
export class WebsiteAdminPage {
  readonly previewBaseUrl = environment.websitePreviewUrl;
}
