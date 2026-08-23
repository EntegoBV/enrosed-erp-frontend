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
      <div class="section-title">Verkoop</div>
      <div class="card"><div class="list">
        <a class="list-item" routerLink="/customers">
          <span class="thumb thumb--placeholder"><app-icon name="customers" /></span>
          <div class="list-item__body"><div class="list-item__title">Klanten</div>
            <div class="list-item__meta">Contacten, voorwaarden en nieuwe orders</div></div>
          <span class="list-item__chev">›</span>
        </a>
      </div></div>

      <div class="section-title">Catalogus</div>
      <div class="card"><div class="list">
        <a class="list-item" routerLink="/catalog-export">
          <span class="thumb thumb--placeholder"><app-icon name="pdf" /></span>
          <div class="list-item__body"><div class="list-item__title">Catalogus PDF</div>
            <div class="list-item__meta">Selecteer producten, taal en prijzen</div></div>
          <span class="list-item__chev">›</span>
        </a>
        <a class="list-item" routerLink="/products">
          <span class="thumb thumb--placeholder"><app-icon name="products" /></span>
          <div class="list-item__body"><div class="list-item__title">Productmaster</div>
            <div class="list-item__meta">Website- en orderapp-publicatie</div></div>
          <span class="list-item__chev">›</span>
        </a>
        <a class="list-item" routerLink="/stock">
          <span class="thumb thumb--placeholder"><app-icon name="stock" /></span>
          <div class="list-item__body"><div class="list-item__title">Voorraad</div>
            <div class="list-item__meta">Per locatie tellen en verplaatsen</div></div>
          <span class="list-item__chev">›</span>
        </a>
      </div></div>

      <div class="section-title">Inkoop</div>
      <div class="card"><div class="list">
        <a class="list-item" routerLink="/suppliers">
          <span class="thumb thumb--placeholder"><app-icon name="suppliers" /></span>
          <div class="list-item__body"><div class="list-item__title">Leveranciers</div>
            <div class="list-item__meta">Contacten, valuta en levertijden</div></div>
          <span class="list-item__chev">›</span>
        </a>
      </div></div>

      <div class="section-title">Configuratie</div>
      <div class="card"><div class="list">
        <a class="list-item" routerLink="/barcodes">
          <span class="thumb thumb--placeholder"><app-icon name="barcode" /></span>
          <div class="list-item__body"><div class="list-item__title">EAN-codes</div>
            <div class="list-item__meta">Vrije barcodes voor nieuwe producten</div></div>
          <span class="list-item__chev">›</span>
        </a>
        <a class="list-item" routerLink="/stock-locations">
          <span class="thumb thumb--placeholder"><app-icon name="stock" /></span>
          <div class="list-item__body"><div class="list-item__title">Voorraadlocaties</div>
            <div class="list-item__meta">Magazijn, stand en wat de website telt</div></div>
          <span class="list-item__chev">›</span>
        </a>
        <a class="list-item" routerLink="/countries">
          <span class="thumb thumb--placeholder"><app-icon name="countries" /></span>
          <div class="list-item__body"><div class="list-item__title">Landen &amp; vracht</div>
            <div class="list-item__meta">Minimum order en verzendkosten per land</div></div>
          <span class="list-item__chev">›</span>
        </a>
        <a class="list-item" routerLink="/settings">
          <span class="thumb thumb--placeholder"><app-icon name="settings" /></span>
          <div class="list-item__body"><div class="list-item__title">Instellingen</div>
            <div class="list-item__meta">Bedrijf, categorieën, douane, kortingen</div></div>
          <span class="list-item__chev">›</span>
        </a>
      </div></div>

      <!-- The accent colour, right here: the one setting you change on a whim. -->
      <div class="section-title">Weergave</div>
      <div class="card"><div class="card__body more-theme">
        <div class="more-theme__row" role="radiogroup" aria-label="Kleurschema">
          @for (option of themes; track option.key) {
            <button class="more-theme__swatch" type="button" role="radio" [title]="option.label"
                    [class.more-theme__swatch--active]="theme.current() === option.key"
                    [attr.aria-checked]="theme.current() === option.key"
                    [style.background]="option.swatch" (click)="theme.set(option.key)">
              <span class="sr-only">{{ option.label }}</span>
            </button>
          }
          <span class="more-theme__label">{{ currentThemeLabel() }}</span>
        </div>
      </div></div>

      <div class="section-title">Juridisch</div>
      <div class="card"><div class="list">
        <a class="list-item" routerLink="/voorwaarden">
          <span class="thumb thumb--placeholder"><app-icon name="sales" /></span>
          <div class="list-item__body"><div class="list-item__title">Voorwaarden &amp; privacy</div>
            <div class="list-item__meta">Bekijk wat klanten te zien krijgen</div></div>
          <span class="list-item__chev">›</span>
        </a>
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
    .more-theme { padding: 12px 14px; }
    .more-theme__row { display: flex; align-items: center; gap: 10px; }
    .more-theme__swatch { width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent;
      box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%); cursor: pointer; padding: 0; transition: transform .12s ease; }
    .more-theme__swatch--active { border-color: var(--ink); transform: scale(1.12); box-shadow: inset 0 0 0 2px #fff; }
    .more-theme__label { margin-left: auto; color: var(--muted); font-size: 12.5px; font-weight: 650; }
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
