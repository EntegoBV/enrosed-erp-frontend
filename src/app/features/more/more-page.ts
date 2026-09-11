import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { THEMES, Theme } from '../../core/platform/theme';

@Component({
  selector: 'app-more-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageHeader, Icon],
  template: `
    <app-page-header title="Meer" [subtitle]="'Aangemeld als ' + (auth.username() ?? '')" />

    <div class="content more">
      <!-- Who is signed in, and the way out: one card, as on a phone's settings screen. -->
      <section class="more-me card" aria-label="Account">
        <span class="more-me__avatar" aria-hidden="true">{{ initial() }}</span>
        <span class="more-me__copy"><b>{{ auth.username() || 'Enrosed' }}</b><small>Enrosed · Sales &amp; Sourcing</small></span>
        <button class="more-me__out" type="button" (click)="logout()">Afmelden</button>
      </section>

      <div class="search-control more-search">
        <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
        <input class="input" type="search" inputmode="search" autocomplete="off" placeholder="Zoek een pagina of instelling…"
               aria-label="Zoek een pagina of instelling" [ngModel]="query()" (ngModelChange)="query.set($event)" />
        @if (query()) {
          <button class="search-clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')">×</button>
        }
      </div>

      @for (group of visibleGroups(); track group.title) {
        <section class="more-group" [attr.aria-label]="group.title">
          <h2 class="more-group__title">{{ group.title }}</h2>
          <div class="card more-group__card">
            @for (item of group.items; track item.label) {
              <a class="more-row" [routerLink]="item.link" [queryParams]="item.params ?? null">
                <span class="more-row__icon" [attr.data-tone]="item.tone"><app-icon [name]="item.icon" [size]="18" /></span>
                <span class="more-row__copy"><b>{{ item.label }}</b><small>{{ item.hint }}</small></span>
                <span class="more-row__chev" aria-hidden="true">›</span>
              </a>
            }
          </div>
        </section>
      } @empty {
        <p class="more-empty">Niets gevonden voor "{{ query() }}".</p>
      }

      @if (!query()) {
        <section class="more-group" aria-label="App op dit toestel">
          <h2 class="more-group__title">App op dit toestel</h2>
          <div class="card more-group__card">
            <a class="more-row" [routerLink]="['/settings']" [queryParams]="{ sectie: 'notifications' }">
              <span class="more-row__icon" data-tone="ink"><app-icon name="bell" [size]="18" /></span>
              <span class="more-row__copy"><b>Meldingen</b><small>Pushmeldingen en geluiden op dit toestel</small></span>
              <span class="more-row__chev" aria-hidden="true">›</span>
            </a>
            <!-- The accent colour, right here: the one setting you change on a whim. -->
            <div class="more-row more-row--static">
              <span class="more-row__icon" data-tone="rose"><app-icon name="settings" [size]="18" /></span>
              <span class="more-row__copy"><b>Weergave</b><small>{{ currentThemeLabel() }}</small></span>
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
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .more { max-width: 720px; }
    .more-me { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding: 14px 16px; }
    .more-me__avatar { display: grid; width: 46px; height: 46px; flex: none; place-items: center; border-radius: 50%;
      background: linear-gradient(145deg, var(--rose), var(--rose-dark)); color: #fff; font-size: 18px; font-weight: 800; text-transform: uppercase; }
    .more-me__copy { display: grid; flex: 1; min-width: 0; gap: 1px; }
    .more-me__copy b { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
    .more-me__copy small { color: var(--muted); font-size: 11.5px; }
    .more-me__out { flex: none; min-height: 36px; padding: 0 13px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface);
      color: var(--danger); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
    .more-me__out:active { background: var(--danger-soft); }
    .more-search { margin-bottom: 6px; }
    .more-search .input { min-height: 44px; border-radius: 14px; }
    /* Inset grouped lists: a quiet caption, one white card, a coloured icon square per row. */
    .more-group { margin-top: 16px; }
    .more-group__title { margin: 0 0 6px 14px; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
    .more-group__card { overflow: hidden; }
    .more-row { display: flex; align-items: center; gap: 12px; min-height: 54px; padding: 8px 12px 8px 12px; color: inherit; text-decoration: none;
      -webkit-tap-highlight-color: transparent; transition: background .12s ease; }
    .more-row + .more-row { border-top: 1px solid var(--line); }
    a.more-row:active, a.more-row:hover { background: var(--surface-2); }
    .more-row__icon { display: grid; width: 32px; height: 32px; flex: none; place-items: center; border-radius: 9px; color: #fff; background: var(--ink-2); }
    .more-row__icon[data-tone='rose'] { background: var(--rose); }
    .more-row__icon[data-tone='green'] { background: var(--ok); }
    .more-row__icon[data-tone='blue'] { background: #3b6ea8; }
    .more-row__icon[data-tone='amber'] { background: #c58a2a; }
    .more-row__icon[data-tone='plum'] { background: #6b4a8a; }
    .more-row__icon[data-tone='ink'] { background: #2b2623; }
    .more-row__icon[data-tone='teal'] { background: #2b7f7a; }
    .more-row__copy { display: grid; flex: 1; min-width: 0; gap: 1px; }
    .more-row__copy b { overflow: hidden; font-size: 14px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
    .more-row__copy small { overflow: hidden; color: var(--muted); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
    .more-row__chev { color: var(--muted-2); font-size: 18px; }
    .more-row--static { cursor: default; }
    .more-theme__row { display: flex; align-items: center; gap: 7px; }
    .more-theme__swatch { width: 26px; height: 26px; padding: 0; border: 2px solid transparent; border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%); cursor: pointer; transition: transform .12s ease; }
    .more-theme__swatch--active { border-color: var(--ink); transform: scale(1.12); box-shadow: inset 0 0 0 2px #fff; }
    .more-empty { margin: 24px 14px; color: var(--muted); font-size: 13px; text-align: center; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    @media (min-width: 680px) {
      .more-group__card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .more-row + .more-row { border-top: 0; }
      .more-row { border-bottom: 1px solid var(--line); }
      .more-row:nth-child(odd) { border-right: 1px solid var(--line); }
      .more-row:nth-last-child(1), .more-row:nth-last-child(2):nth-child(odd) { border-bottom: 0; }
    }
  `,
})
export class MorePage {
  readonly auth = inject(Auth);
  readonly theme = inject(Theme);
  readonly themes = THEMES;
  private readonly router = inject(Router);
  readonly query = signal('');

  /** Every page of the app that is not on the tab bar, grouped the way you would look for it. */
  readonly groups: MoreGroup[] = [
    { title: 'Werkplekken', items: [
      { label: 'Documenten & media', hint: 'Foto’s, PDF’s en bestanden beheren en delen', icon: 'media', tone: 'blue', link: '/files' },
      { label: 'Kosten & bank', hint: 'Kosten, vaste kosten, banksaldo en analyse', icon: 'exchange', tone: 'green', link: '/costs' },
      { label: 'Website beheren', hint: 'Indeling, teksten, SEO, producten en publicatie', icon: 'settings', tone: 'plum', link: '/website' },
      { label: 'Analyses', hint: 'Overzicht, verkoop, voorraad, inkoop, markt en website', icon: 'analytics', tone: 'ink', link: '/analyses/overview' },
    ] },
    { title: 'Verkoop', items: [
      { label: 'Klanten', hint: 'Contacten, voorwaarden en nieuwe orders', icon: 'customers', tone: 'rose', link: '/customers' },
      { label: 'Wijzigingen', hint: 'Voorstellen van klanten op verstuurde offertes', icon: 'sales', tone: 'rose', link: '/revisions' },
      { label: 'Landen & vracht', hint: 'Minimumorders, tarieven en verzendorganisaties', icon: 'countries', tone: 'rose', link: '/countries' },
      { label: 'Kortingen', hint: 'Staffels per regel en per order', icon: 'exchange', tone: 'rose', link: '/settings', params: { sectie: 'discounts' } },
    ] },
    { title: 'Inkoop', items: [
      { label: 'Leveranciers', hint: 'Contacten, valuta en levertijden', icon: 'suppliers', tone: 'amber', link: '/suppliers' },
      { label: 'Douane', hint: 'HS-codes en invoerrechten', icon: 'truck', tone: 'amber', link: '/settings', params: { sectie: 'duties' } },
      { label: 'Markt & container', hint: 'Actuele wisselkoersen en containertarieven', icon: 'exchange', tone: 'amber', link: '/analyses/market' },
    ] },
    { title: 'Producten & voorraad', items: [
      { label: 'Voorraad', hint: 'Per locatie tellen en verplaatsen', icon: 'stock', tone: 'green', link: '/stock' },
      { label: 'Voorraadlocaties', hint: 'Magazijn, stand en wat de website telt', icon: 'stock', tone: 'green', link: '/stock-locations' },
      { label: 'Categorieën', hint: 'Productgroepen, foto’s en volgorde', icon: 'products', tone: 'green', link: '/categories' },
      { label: 'Catalogusdata', hint: 'Excel-import en -export van productgegevens', icon: 'products', tone: 'green', link: '/settings', params: { sectie: 'catalog-data' } },
      { label: 'EAN-codes', hint: 'Vrije barcodes voor nieuwe producten', icon: 'barcode', tone: 'green', link: '/barcodes' },
      { label: 'Catalogus PDF', hint: 'Selecteer producten, taal en prijzen', icon: 'pdf', tone: 'green', link: '/catalog-export' },
    ] },
    { title: 'Bedrijf', items: [
      { label: 'Logboek', hint: 'Belangrijke bedrijfsacties per medewerker', icon: 'activity', tone: 'ink', link: '/activity' },
      { label: 'Bedrijfsgegevens', hint: 'Adres, BTW, IBAN en juridische teksten', icon: 'settings', tone: 'ink', link: '/settings', params: { sectie: 'company' } },
      { label: 'Documenten & media instellingen', hint: 'Bestanden uploaden, koppelen en veilig hergebruiken', icon: 'media', tone: 'ink', link: '/settings/documents-media' },
      { label: 'Voorwaarden & privacy', hint: 'Bekijk wat klanten te zien krijgen', icon: 'sales', tone: 'ink', link: '/voorwaarden' },
    ] },
  ];

  /** Typing narrows every group to the rows whose name or hint matches. */
  readonly visibleGroups = computed(() => {
    const needle = this.query().trim().toLowerCase();
    if (!needle) return this.groups;
    return this.groups
      .map((group) => ({ ...group, items: group.items.filter((item) =>
        item.label.toLowerCase().includes(needle) || item.hint.toLowerCase().includes(needle) || group.title.toLowerCase().includes(needle)) }))
      .filter((group) => group.items.length);
  });

  initial(): string {
    return (this.auth.username() ?? 'E').trim().charAt(0) || 'E';
  }

  currentThemeLabel(): string {
    return THEMES.find((option) => option.key === this.theme.current())?.label ?? '';
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}

interface MoreGroup {
  title: string;
  items: { label: string; hint: string; icon: string; tone: 'rose' | 'green' | 'blue' | 'amber' | 'plum' | 'ink' | 'teal'; link: string; params?: Record<string, string> }[];
}
