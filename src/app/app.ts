import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { Auth } from './core/api/auth';
import { WorkQueue } from './core/api/work-queue';
import { UiHost } from './shared/ui';
import { BrandMark } from './shared/brand-mark';

/**
 * App-shell.
 *
 * Telefoon krijgt een tabbalk onderaan, desktop een zijbalk. Op de
 * aanmeldpagina en in het klantportaal verdwijnt de navigatie: dat zijn geen
 * schermen van ons personeel.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UiHost, BrandMark],
  template: `
    <div class="shell" [class.shell--bare]="bare()">
      @if (!bare()) {
        <aside class="sidebar">
          <div class="sidebar__brand">
            <app-brand-mark subtitle="Sales &amp; Sourcing" [onDark]="true" />
          </div>
          <nav class="sidebar__nav">
            <div class="sidebar__label">Overzicht</div>
            <a class="sidebar__link" routerLink="/dashboard" routerLinkActive="active">
              <span class="sidebar__icon">◧</span> Dashboard
            </a>

            <div class="sidebar__label">Verkoop</div>
            <a class="sidebar__link" routerLink="/sales" routerLinkActive="active">
              <span class="sidebar__icon">▤</span> Verkooporders
            </a>
            <a class="sidebar__link" routerLink="/revisions" routerLinkActive="active">
              <span class="sidebar__icon">⇄</span> Wijzigingen
              @if (openWork(); as n) { <span class="sidebar__count">{{ n }}</span> }
            </a>
            <a class="sidebar__link" routerLink="/customers" routerLinkActive="active">
              <span class="sidebar__icon">◔</span> Klanten
            </a>

            <div class="sidebar__label">Inkoop</div>
            <a class="sidebar__link" routerLink="/purchasing" routerLinkActive="active">
              <span class="sidebar__icon">▩</span> Inkooporders
            </a>
            <a class="sidebar__link" routerLink="/suppliers" routerLinkActive="active">
              <span class="sidebar__icon">⚓</span> Leveranciers
            </a>

            <div class="sidebar__label">Catalogus</div>
            <a class="sidebar__link" routerLink="/products" routerLinkActive="active">
              <span class="sidebar__icon">◈</span> Producten
            </a>

            <div class="sidebar__label">Configuratie</div>
            <a class="sidebar__link" routerLink="/countries" routerLinkActive="active">
              <span class="sidebar__icon">⊞</span> Landen &amp; vracht
            </a>
            <a class="sidebar__link" routerLink="/settings" routerLinkActive="active">
              <span class="sidebar__icon">⚙</span> Instellingen
            </a>
          </nav>

          <div class="sidebar__foot">
            <div class="sidebar__user">{{ auth.username() }}</div>
            <button class="sidebar__logout" type="button" (click)="logout()">Afmelden</button>
          </div>
        </aside>
      }

      <div class="main">
        <router-outlet />
      </div>

      @if (!bare()) {
        <nav class="tabbar">
          <a class="tabbar__item" routerLink="/dashboard" routerLinkActive="active">
            <span class="tabbar__icon">◧</span> Home
          </a>
          <a class="tabbar__item" routerLink="/sales" routerLinkActive="active">
            <span class="tabbar__icon">
              ▤
              @if (openWork(); as n) {
                <span class="tabbar__count">{{ n > 9 ? '9+' : n }}</span>
              }
            </span> Verkoop
          </a>
          <a class="tabbar__item" routerLink="/purchasing" routerLinkActive="active">
            <span class="tabbar__icon">▩</span> Inkoop
          </a>
          <a class="tabbar__item" routerLink="/products" routerLinkActive="active">
            <span class="tabbar__icon">◈</span> Producten
          </a>
          <a class="tabbar__item" routerLink="/more" routerLinkActive="active">
            <span class="tabbar__icon">☰</span> Meer
          </a>
        </nav>
      }
    </div>

    <app-ui-host />
  `,
})
export class App {
  readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly work = inject(WorkQueue);

  /**
   * Hoeveel offertes op ons wachten; het bolletje op de tab Verkoop.
   *
   * Dezelfde bron als het belletje rechtsboven, zodat de twee cijfers niet uit
   * elkaar lopen.
   */
  readonly openWork = this.work.actionCount;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Aanmeldpagina en klantportaal krijgen geen navigatie. */
  readonly bare = computed(() => {
    const url = this.url();
    return url.startsWith('/login') || url.startsWith('/offerte')
        || url.startsWith('/voorwaarden');
  });

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
