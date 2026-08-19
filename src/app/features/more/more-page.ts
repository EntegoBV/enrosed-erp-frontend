import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { WorkQueue } from '../../core/api/work-queue';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';

@Component({
  selector: 'app-more-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, Icon],
  template: `
    <app-page-header title="Meer" [subtitle]="'Aangemeld als ' + (auth.username() ?? '')" />

    <div class="content">
      <div class="section-title">Verkoop</div>
      <div class="card"><div class="list">
        <a class="list-item" routerLink="/revisions">
          <span class="thumb thumb--placeholder"><app-icon name="exchange" /></span>
          <div class="list-item__body">
            <div class="list-item__title">Wijzigingsvoorstellen</div>
            <div class="list-item__meta">Offertes waar de klant aanpassingen vraagt</div>
          </div>
          @if (work.actionCount(); as count) {
            <span class="badge badge--warn">{{ count }}</span>
          }
          <span class="list-item__chev">›</span>
        </a>
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
        <a class="list-item" routerLink="/countries">
          <span class="thumb thumb--placeholder"><app-icon name="countries" /></span>
          <div class="list-item__body"><div class="list-item__title">Landen &amp; vracht</div></div>
          <span class="list-item__chev">›</span>
        </a>
        <a class="list-item" routerLink="/settings">
          <span class="thumb thumb--placeholder"><app-icon name="settings" /></span>
          <div class="list-item__body"><div class="list-item__title">Instellingen</div>
            <div class="list-item__meta">Categorieën, douanetarieven, staffels</div></div>
          <span class="list-item__chev">›</span>
        </a>
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

      <button class="btn btn--danger btn--block mt-24" type="button" (click)="logout()">
        Afmelden
      </button>
    </div>
  `,
})
export class MorePage {
  readonly auth = inject(Auth);
  readonly work = inject(WorkQueue);
  private readonly router = inject(Router);

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
