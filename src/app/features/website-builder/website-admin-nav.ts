import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export type WebsiteAdminSection =
  | 'overview'
  | 'layout'
  | 'texts'
  | 'products'
  | 'categories'
  | 'seo'
  | 'publication';

/**
 * One stable information architecture for every public-website task.
 *
 * The global ERP sidebar gets staff into the workspace. This local navigation
 * keeps the seven website responsibilities visible while they work, without
 * mixing operational product fields with customer-facing content.
 */
@Component({
  selector: 'app-website-admin-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="website-admin-nav" aria-label="Website beheren">
      <a routerLink="/website" routerLinkActive="active"
         [routerLinkActiveOptions]="{ exact: true }"
         [class.active]="active() === 'overview'"
         [attr.aria-current]="active() === 'overview' ? 'page' : null">
        <span aria-hidden="true">01</span><b>Overzicht</b><small>Start &amp; taken</small>
      </a>
      <a routerLink="/website/layout" routerLinkActive="active"
         [class.active]="active() === 'layout'"
         [attr.aria-current]="active() === 'layout' ? 'page' : null">
        <span aria-hidden="true">02</span><b>Indeling</b><small>Homepage &amp; preview</small>
      </a>
      <a routerLink="/website/texts" routerLinkActive="active"
         [class.active]="active() === 'texts'"
         [attr.aria-current]="active() === 'texts' ? 'page' : null">
        <span aria-hidden="true">03</span><b>Websiteteksten</b><small>Pagina's &amp; talen</small>
      </a>
      <a routerLink="/website/seo" routerLinkActive="active"
         [class.active]="active() === 'seo'"
         [attr.aria-current]="active() === 'seo' ? 'page' : null">
        <span aria-hidden="true">04</span><b>SEO</b><small>Pagina's &amp; producten</small>
      </a>
      <a routerLink="/website/products" routerLinkActive="active"
         [class.active]="active() === 'products'"
         [attr.aria-current]="active() === 'products' ? 'page' : null">
        <span aria-hidden="true">05</span><b>Productinhoud</b><small>Publiek &amp; vertaling</small>
      </a>
      <a routerLink="/website/categories" routerLinkActive="active"
         [class.active]="active() === 'categories'"
         [attr.aria-current]="active() === 'categories' ? 'page' : null">
        <span aria-hidden="true">06</span><b>Categorieën</b><small>Menu &amp; collectie</small>
      </a>
      <a routerLink="/website/publication" routerLinkActive="active"
         [class.active]="active() === 'publication'"
         [attr.aria-current]="active() === 'publication' ? 'page' : null">
        <span aria-hidden="true">07</span><b>Publicatie</b><small>Status &amp; herstel</small>
      </a>
    </nav>
  `,
  styles: `
    :host { display: block; min-width: 0; margin-bottom: 18px; }
    .website-admin-nav {
      display: grid; grid-template-columns: repeat(7, minmax(118px, 1fr)); gap: 6px;
      padding: 6px; overflow-x: auto; border: 1px solid var(--line); border-radius: 16px;
      background: var(--surface); box-shadow: var(--sh-1); scrollbar-width: thin;
    }
    a {
      position: relative; display: grid; min-width: 118px; min-height: 72px; align-content: center;
      gap: 1px; padding: 9px 11px 9px 36px; border: 1px solid transparent; border-radius: 11px;
      color: var(--ink); text-decoration: none;
    }
    a > span {
      position: absolute; left: 10px; top: 12px; color: var(--muted-2);
      font-size: 10px; font-weight: 800; letter-spacing: .04em;
    }
    a b { overflow: hidden; font-size: 13px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
    a small { overflow: hidden; color: var(--muted); font-size: 11px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
    a:hover { background: var(--surface-2); }
    a.active {
      border-color: var(--rose-line); background: var(--rose-soft); color: var(--rose-dark);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rose) 22%, transparent);
    }
    a.active > span, a.active small { color: var(--rose-dark); }
    a:focus-visible { outline: 3px solid var(--rose); outline-offset: 2px; }

    @media (max-width: 900px) {
      .website-admin-nav { grid-template-columns: repeat(7, 150px); }
      a { min-width: 150px; min-height: 64px; }
    }
  `,
})
export class WebsiteAdminNav {
  readonly active = input<WebsiteAdminSection | null>(null);
}
