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

    <div class="content">
      <details class="card more-group more-group--analyses" name="meer-groepen" open>
        <summary>
          <span class="thumb thumb--placeholder"><app-icon name="analytics" /></span>
          <span class="more-group__copy"><strong>Analyses</strong>
            <small>Overzicht · Verkoop · Voorraad · Inkoop · Markt</small></span>
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
      <details class="card more-group" name="meer-groepen">
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

      <details class="card more-group" name="meer-groepen">
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

      <details class="card more-group" name="meer-groepen">
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
          <a class="list-item" routerLink="/website/categories">
            <span class="thumb thumb--placeholder"><app-icon name="products" /></span>
            <div class="list-item__body"><div class="list-item__title">Categorieën</div>
              <div class="list-item__meta">Productgroepen en volgorde</div></div>
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

      <details class="card more-group" name="meer-groepen">
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

      <div class="section-title">App op dit toestel</div>
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
                      [style.background]="option.swatch" (click)="theme.set(option.key)">
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
    .more-group { margin-bottom: 10px; }
    .more-group summary { display: flex; align-items: center; gap: 12px; padding: 13px 14px;
      cursor: pointer; list-style: none; -webkit-tap-highlight-color: transparent; }
    .more-group summary::-webkit-details-marker { display: none; }
    .more-group__copy { flex: 1; min-width: 0; }
    .more-group__copy strong { display: block; font-size: 14.5px; }
    .more-group__copy small { display: block; overflow: hidden; color: var(--muted);
      font-size: 11.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    .more-group__chev { color: var(--muted-2); font-size: 18px; transition: transform .15s ease; }
    .more-group[open] .more-group__chev { transform: rotate(90deg); }
    .more-group__list { border-top: 1px solid var(--line); }
    .more-group__list .list-item { padding-left: 22px; }
    .more-theme { gap: 10px; }
    .more-theme__row { display: flex; align-items: center; gap: 8px; }
    .more-theme__swatch { width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent;
      box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%); cursor: pointer; padding: 0; transition: transform .12s ease; }
    .more-theme__swatch--active { border-color: var(--ink); transform: scale(1.12); box-shadow: inset 0 0 0 2px #fff; }
    .more-logout { width: 100%; border: 0; font: inherit; text-align: left; cursor: pointer; }
    .more-logout .list-item__title { color: var(--danger); }
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
