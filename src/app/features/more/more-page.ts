import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { THEMES, Theme } from '../../core/platform/theme';

@Component({
  selector: 'app-more-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, Icon],
  template: `
    <app-page-header title="Meer" [subtitle]="'Aangemeld als ' + (auth.username() ?? '')" />

    <div class="content more-content">
      <div class="more-section-label">Snel naar</div>
      <nav class="more-shortcuts" aria-label="Snel naar">
      <a class="list-item card more-shortcut more-shortcut--media" routerLink="/files">
        <span class="thumb thumb--placeholder"><app-icon name="media" /></span>
        <div class="list-item__body"><div class="list-item__title">Documenten &amp; media</div>
          <div class="list-item__meta">Foto’s, PDF’s en bestanden beheren en delen</div></div>
        <span class="list-item__chev">›</span>
      </a>
      <a class="list-item card more-shortcut more-shortcut--finance" routerLink="/costs">
        <span class="thumb thumb--placeholder"><app-icon name="exchange" /></span>
        <div class="list-item__body"><div class="list-item__title">Kosten &amp; bank</div>
          <div class="list-item__meta">Kosten, vaste kosten, banksaldo en analyse</div></div>
        <span class="list-item__chev">›</span>
      </a>

      </nav>
      <div class="more-section-label">Werkruimtes</div>
      <details class="card more-group more-group--analyses" name="meer-groepen" open>
        <summary>
          <span class="thumb thumb--placeholder"><app-icon name="analytics" /></span>
          <span class="more-group__copy"><strong>Analyses</strong>
            <small>Verkoop, voorraad en resultaat in beeld</small></span>
          <span class="more-group__chev" aria-hidden="true">›</span>
        </summary>
        <div class="list more-group__list">
          <a class="list-item" routerLink="/analyses/overview">
            <span class="thumb thumb--placeholder"><app-icon name="analytics" /></span>
            <div class="list-item__body"><div class="list-item__title">Overzicht</div>
              <div class="list-item__meta">Belangrijkste waarde, kwaliteit en aandachtspunten</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/analyses/sales">
            <span class="thumb thumb--placeholder"><app-icon name="sales" /></span>
            <div class="list-item__body"><div class="list-item__title">Verkoop</div>
              <div class="list-item__meta">Pijplijn, conversie, facturen en klanten</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/analyses/inventory">
            <span class="thumb thumb--placeholder"><app-icon name="stock" /></span>
            <div class="list-item__body"><div class="list-item__title">Voorraad</div>
              <div class="list-item__meta">Waarde, tekorten, inkomend en datakwaliteit</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/analyses/purchasing">
            <span class="thumb thumb--placeholder"><app-icon name="purchase" /></span>
            <div class="list-item__body"><div class="list-item__title">Inkoop</div>
              <div class="list-item__meta">Leveranciers, ontvangstkwaliteit, schade en tekort</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/analyses/result">
            <span class="thumb thumb--placeholder"><app-icon name="analytics" /></span>
            <div class="list-item__body"><div class="list-item__title">Resultaat</div>
              <div class="list-item__meta">Omzet, marge en eigen kosten</div></div>
            <span class="list-item__chev" aria-hidden="true">›</span>
          </a>
          <a class="list-item" routerLink="/analyses/market">
            <span class="thumb thumb--placeholder"><app-icon name="exchange" /></span>
            <div class="list-item__body"><div class="list-item__title">Markt &amp; container</div>
              <div class="list-item__meta">Actuele wisselkoersen en containertarieven</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/analyses/website">
            <span class="thumb thumb--placeholder"><app-icon name="exchange" /></span>
            <div class="list-item__body"><div class="list-item__title">Websitebezoekers</div>
              <div class="list-item__meta">Bezoekers, landen, bronnen en drukste uren</div></div>
            <span class="list-item__chev">›</span>
          </a>
        </div>
      </details>

      <!-- One expander per domain: the menu stays one screen tall, and
           every drawer of the old settings page lives where you would
           actually look for it. -->
      <details class="card more-group more-group--sales" name="meer-groepen">
        <summary>
          <span class="thumb thumb--placeholder"><app-icon name="sales" /></span>
          <span class="more-group__copy"><strong>Verkoop</strong>
            <small>Klanten · Landen &amp; vracht · Kortingen</small></span>
          <span class="more-group__chev" aria-hidden="true">›</span>
        </summary>
        <div class="list more-group__list">
          <a class="list-item" routerLink="/customers">
            <span class="thumb thumb--placeholder"><app-icon name="customers" /></span>
            <div class="list-item__body"><div class="list-item__title">Klanten</div>
              <div class="list-item__meta">Contacten, voorwaarden en nieuwe orders</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/countries">
            <span class="thumb thumb--placeholder"><app-icon name="countries" /></span>
            <div class="list-item__body"><div class="list-item__title">Landen &amp; vracht</div>
              <div class="list-item__meta">Minimumorders, tarieven en verzendorganisaties</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" [routerLink]="['/settings']" [queryParams]="{ sectie: 'discounts' }">
            <span class="thumb thumb--placeholder"><app-icon name="exchange" /></span>
            <div class="list-item__body"><div class="list-item__title">Kortingen</div>
              <div class="list-item__meta">Staffels per regel en per order</div></div>
            <span class="list-item__chev">›</span>
          </a>
        </div>
      </details>

      <details class="card more-group more-group--purchase" name="meer-groepen">
        <summary>
          <span class="thumb thumb--placeholder"><app-icon name="purchase" /></span>
          <span class="more-group__copy"><strong>Inkoop</strong>
            <small>Leveranciers · Douane</small></span>
          <span class="more-group__chev" aria-hidden="true">›</span>
        </summary>
        <div class="list more-group__list">
          <a class="list-item" routerLink="/suppliers">
            <span class="thumb thumb--placeholder"><app-icon name="suppliers" /></span>
            <div class="list-item__body"><div class="list-item__title">Leveranciers</div>
              <div class="list-item__meta">Contacten, valuta en levertijden</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" [routerLink]="['/settings']" [queryParams]="{ sectie: 'duties' }">
            <span class="thumb thumb--placeholder"><app-icon name="truck" /></span>
            <div class="list-item__body"><div class="list-item__title">Douane</div>
              <div class="list-item__meta">HS-codes en invoerrechten</div></div>
            <span class="list-item__chev">›</span>
          </a>
        </div>
      </details>

      <details class="card more-group more-group--inventory" name="meer-groepen">
        <summary>
          <span class="thumb thumb--placeholder"><app-icon name="stock" /></span>
          <span class="more-group__copy"><strong>Producten &amp; voorraad</strong>
            <small>Voorraad · Locaties · Categorieën · EAN · Catalogus</small></span>
          <span class="more-group__chev" aria-hidden="true">›</span>
        </summary>
        <div class="list more-group__list">
          <a class="list-item" routerLink="/stock">
            <span class="thumb thumb--placeholder"><app-icon name="stock" /></span>
            <div class="list-item__body"><div class="list-item__title">Voorraad</div>
              <div class="list-item__meta">Per locatie tellen en verplaatsen</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/stock-locations">
            <span class="thumb thumb--placeholder"><app-icon name="stock" /></span>
            <div class="list-item__body"><div class="list-item__title">Voorraadlocaties</div>
              <div class="list-item__meta">Magazijn, stand en wat de website telt</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/categories">
            <span class="thumb thumb--placeholder"><app-icon name="products" /></span>
            <div class="list-item__body"><div class="list-item__title">Categorieën</div>
              <div class="list-item__meta">Productgroepen, foto’s en volgorde</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/website">
            <span class="thumb thumb--placeholder"><app-icon name="settings" /></span>
            <div class="list-item__body"><div class="list-item__title">Website beheren</div>
              <div class="list-item__meta">Indeling, teksten, SEO, producten en publicatie</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" [routerLink]="['/settings']" [queryParams]="{ sectie: 'catalog-data' }">
            <span class="thumb thumb--placeholder"><app-icon name="products" /></span>
            <div class="list-item__body"><div class="list-item__title">Catalogusdata</div>
              <div class="list-item__meta">Excel-import en -export van productgegevens</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/barcodes">
            <span class="thumb thumb--placeholder"><app-icon name="barcode" /></span>
            <div class="list-item__body"><div class="list-item__title">EAN-codes</div>
              <div class="list-item__meta">Vrije barcodes voor nieuwe producten</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/catalog-export">
            <span class="thumb thumb--placeholder"><app-icon name="pdf" /></span>
            <div class="list-item__body"><div class="list-item__title">Catalogus PDF</div>
              <div class="list-item__meta">Selecteer producten, taal en prijzen</div></div>
            <span class="list-item__chev">›</span>
          </a>
        </div>
      </details>

      <details class="card more-group more-group--company" name="meer-groepen">
        <summary>
          <span class="thumb thumb--placeholder"><app-icon name="settings" /></span>
          <span class="more-group__copy"><strong>Bedrijf</strong>
            <small>Logboek · Bedrijfsgegevens · Voorwaarden &amp; privacy</small></span>
          <span class="more-group__chev" aria-hidden="true">›</span>
        </summary>
        <div class="list more-group__list">
          <a class="list-item" routerLink="/activity">
            <span class="thumb thumb--placeholder"><app-icon name="activity" /></span>
            <div class="list-item__body"><div class="list-item__title">Logboek</div>
              <div class="list-item__meta">Belangrijke bedrijfsacties per medewerker</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" [routerLink]="['/settings']" [queryParams]="{ sectie: 'company' }">
            <span class="thumb thumb--placeholder"><app-icon name="settings" /></span>
            <div class="list-item__body"><div class="list-item__title">Bedrijfsgegevens</div>
              <div class="list-item__meta">Adres, BTW, IBAN en juridische teksten</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/settings/documents-media">
            <span class="thumb thumb--placeholder"><app-icon name="media" /></span>
            <div class="list-item__body"><div class="list-item__title">Documenten &amp; media</div>
              <div class="list-item__meta">Bestanden uploaden, koppelen en veilig hergebruiken</div></div>
            <span class="list-item__chev">›</span>
          </a>
          <a class="list-item" routerLink="/voorwaarden">
            <span class="thumb thumb--placeholder"><app-icon name="sales" /></span>
            <div class="list-item__body"><div class="list-item__title">Voorwaarden &amp; privacy</div>
              <div class="list-item__meta">Bekijk wat klanten te zien krijgen</div></div>
            <span class="list-item__chev">›</span>
          </a>
        </div>
      </details>

      <div class="more-section-label">App op dit toestel</div>
      <div class="card"><div class="list">
        <a class="list-item" [routerLink]="['/settings']" [queryParams]="{ sectie: 'notifications' }">
          <span class="thumb thumb--placeholder"><app-icon name="bell" /></span>
          <div class="list-item__body"><div class="list-item__title">Meldingen</div>
            <div class="list-item__meta">Pushmeldingen en geluiden op dit toestel</div></div>
          <span class="list-item__chev">›</span>
        </a>
        <!-- The accent colour, right here: the one setting you change on a whim. -->
        <div class="list-item more-theme">
          <div class="list-item__body"><div class="list-item__title">Weergave</div>
            <div class="list-item__meta">{{ currentThemeLabel() }}</div></div>
          <div class="more-theme__row" role="radiogroup" aria-label="Kleurschema">
            @for (option of themes; track option.key) {
              <button class="more-theme__swatch" type="button" role="radio" [title]="option.label"
                      [class.more-theme__swatch--active]="theme.current() === option.key"
                      [attr.aria-checked]="theme.current() === option.key"
                      [style.--swatch]="option.swatch" (click)="theme.set(option.key)">
                <span class="sr-only">{{ option.label }}</span>
              </button>
            }
          </div>
        </div>
      </div></div>

      <div class="card mt-24"><div class="list">
        <button class="list-item more-logout" type="button" (click)="logout()">
          <div class="list-item__body"><div class="list-item__title">Afmelden</div>
            <div class="list-item__meta">{{ auth.username() }}</div></div>
        </button>
      </div></div>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .more-content { max-width: 860px; margin-inline: auto; }
    .more-section-label { margin: 20px 4px 10px; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .more-section-label:first-child { margin-top: 0; }
    .more-shortcuts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .more-shortcut {
      position: relative;
      display: flex;
      align-items: flex-start;
      flex-direction: column;
      gap: 13px;
      min-width: 0;
      margin: 0;
      padding: 16px;
      border-radius: 22px;
      border-color: var(--line);
      background: var(--surface);
      text-decoration: none;
      transition: transform .16s ease, border-color .16s ease;
    }
    .more-shortcut--media { --more-accent: #6654aa; --more-soft: #eeeaf7; }
    .more-shortcut--finance { --more-accent: #26775d; --more-soft: #e7f2eb; }
    .more-shortcut .list-item__body { flex: none; width: 100%; }
    .more-shortcut .list-item__title { font-size: 15px; line-height: 1.3; white-space: normal; }
    .more-shortcut .list-item__meta { margin-top: 5px; font-size: 11px; line-height: 1.5; white-space: normal; }
    .more-shortcut .list-item__chev { position: absolute; top: 23px; right: 16px; }
    .more-shortcut:active { transform: scale(.985); }
    .thumb { display: grid; width: 40px; height: 40px; flex: 0 0 40px; place-items: center; border-radius: 13px; background: var(--more-soft, var(--rose-soft)); color: var(--more-accent, var(--rose-dark)); }
    .more-group { margin-bottom: 10px; border-radius: 20px; overflow: hidden; box-shadow: 0 2px 8px rgb(20 35 30 / 2%); }
    .more-group--analyses { --more-accent: #3d68a5; --more-soft: #eaf0f9; }
    .more-group--sales { --more-accent: #a04661; --more-soft: #f8eaf0; }
    .more-group--purchase { --more-accent: #946223; --more-soft: #f7efdf; }
    .more-group--inventory { --more-accent: #26775d; --more-soft: #e7f2eb; }
    .more-group--company { --more-accent: #6654aa; --more-soft: #eeeaf7; }
    .more-group summary { display: flex; align-items: center; gap: 12px; min-height: 76px; padding: 14px; cursor: pointer; list-style: none; -webkit-tap-highlight-color: transparent; }
    .more-group summary::-webkit-details-marker { display: none; }
    .more-group__copy { flex: 1; min-width: 0; }
    .more-group__copy strong { display: block; font-size: 15px; line-height: 1.4; }
    .more-group__copy small { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.45; }
    .more-group__chev { display: grid; width: 26px; height: 26px; flex: none; place-items: center; border-radius: 50%; background: var(--surface-2); color: var(--muted); font-size: 18px; transition: transform .18s ease; }
    .more-group[open] .more-group__chev { transform: rotate(90deg); }
    .more-group__list { padding: 0 12px 8px; border-top: 1px solid var(--line); }
    .more-group__list .list-item { gap: 11px; min-height: 64px; padding: 11px 3px; }
    .more-group__list .thumb { width: 32px; height: 32px; flex-basis: 32px; border-radius: 10px; }
    .more-group__list .list-item__title { font-size: 13px; line-height: 1.4; white-space: normal; }
    .more-group__list .list-item__meta { font-size: 11px; line-height: 1.45; white-space: normal; }
    .more-group--analyses .more-group__list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
    .more-group--analyses .list-item { align-items: flex-start; }
    .more-group--analyses .list-item__chev { display: none; }
    .more-group--analyses .list-item__meta { margin-top: 3px; }
    .more-theme { gap: 10px; flex-wrap: wrap; }
    .more-theme__row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
    .more-theme__swatch { position: relative; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; cursor: pointer; padding: 0; }
    .more-theme__swatch::before { position: absolute; inset: 9px; content: ''; border-radius: 50%; background: var(--swatch); box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%); }
    .more-theme__swatch--active::before { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--swatch); }
    .more-theme__swatch--active::after { position: absolute; inset: 0; display: grid; place-items: center; content: '✓'; color: #fff; font-size: 13px; font-weight: 750; }
    .more-logout { min-height: 64px; width: 100%; border: 0; font: inherit; text-align: left; cursor: pointer; }
    .more-logout .list-item__title { color: var(--danger); }
    .more-content > .card { border-radius: 20px; overflow: hidden; }
    :is(a, summary, button):focus-visible { outline: 2px solid var(--rose); outline-offset: -3px; }
    @media (max-width: 540px) {
      .more-shortcuts { gap: 10px; }
      .more-shortcut { padding: 14px; gap: 12px; }
      .more-shortcut .list-item__title { font-size: 14px; }
      .more-group--analyses .more-group__list { gap: 0 10px; }
      .more-group--analyses .list-item { flex-wrap: wrap; align-content: flex-start; gap: 7px; padding-block: 12px; }
      .more-group--analyses .list-item__body { flex: 1 1 100%; }
      .more-theme__row { flex-basis: 100%; justify-content: space-between; }
    }
    @media (prefers-reduced-motion: reduce) { .more-shortcut, .more-group__chev { transition: none; } }

  `,
})
export class MorePage {
  readonly auth = inject(Auth);
  readonly theme = inject(Theme);
  readonly themes = THEMES;
  private readonly router = inject(Router);
  currentThemeLabel(): string {
    return THEMES.find((option) => option.key === this.theme.current())?.label ?? '';
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
