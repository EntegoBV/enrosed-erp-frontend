import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { PageHeader } from '../../shared/page-header';

@Component({
  selector: 'app-more-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader],
  template: `
    <app-page-header title="Meer" [subtitle]="'Aangemeld als ' + (auth.username() ?? '')" />

    <div class="content">
      <div class="section-title">Verkoop</div>
      <div class="card"><div class="list">
        <a class="list-item" routerLink="/customers">
          <span class="thumb thumb--placeholder">◔</span>
          <div class="list-item__body"><div class="list-item__title">Klanten</div></div>
          <span class="list-item__chev">›</span>
        </a>
      </div></div>

      <div class="section-title">Inkoop</div>
      <div class="card"><div class="list">
        <a class="list-item" routerLink="/suppliers">
          <span class="thumb thumb--placeholder">⚓</span>
          <div class="list-item__body"><div class="list-item__title">Leveranciers</div></div>
          <span class="list-item__chev">›</span>
        </a>
      </div></div>

      <div class="section-title">Configuratie</div>
      <div class="card"><div class="list">
        <a class="list-item" routerLink="/countries">
          <span class="thumb thumb--placeholder">⊞</span>
          <div class="list-item__body"><div class="list-item__title">Landen &amp; vracht</div></div>
          <span class="list-item__chev">›</span>
        </a>
        <a class="list-item" routerLink="/settings">
          <span class="thumb thumb--placeholder">⚙</span>
          <div class="list-item__body"><div class="list-item__title">Instellingen</div>
            <div class="list-item__meta">Categorieën, douanetarieven, staffels</div></div>
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
  private readonly router = inject(Router);

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
