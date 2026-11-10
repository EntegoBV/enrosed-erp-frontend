import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { PartnerPortalApi } from '../../core/api/partner-portal-api';
import { HostBridge } from '../../core/platform/host-bridge';
import { BrandMark } from '../../shared/brand-mark';
import { PartnerData } from './partner-data';

/**
 * The partner portal (Verhoeven): a separate, simple app inside the ERP for a
 * partner login. Its own header (Enrosed, Partnerportaal, who is signed in,
 * Afmelden), no staff menu and no bell; the shell's chrome is off for it
 * (app.ts bare()). One responsive column from 375 px to the desk.
 *
 * The native iOS app does not offer the portal: a partner who still lands
 * there only reads where to open it.
 */
@Component({
  selector: 'app-partner-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, BrandMark],
  providers: [PartnerData],
  template: `
    <div class="pt-page ios-page ios-page--bare">
      <header class="pt-head">
        <div class="pt-head__in">
          <a class="pt-head__brand" routerLink="/partner" aria-label="Partnerportaal, overzicht">
            <app-brand-mark subtitle="Partnerportaal" [small]="true" />
          </a>
          <div class="pt-head__who">
            @if (person()) { <strong>{{ person() }}</strong> }
            @if (company()) { <span>{{ company() }}</span> }
          </div>
          <button class="ios-capsule ios-capsule--sm pt-head__out" type="button" [disabled]="leaving()" (click)="logout()">Afmelden</button>
        </div>
      </header>
      <main class="pt-main">
        @if (host.present) {
          <div class="ios-empty">
            <h1 class="ios-empty__title">Open het partnerportaal in Safari</h1>
            <p class="ios-empty__text">De Enrosed-app is voor de medewerkers.</p>
          </div>
        } @else {
          <router-outlet />
        }
      </main>
    </div>
  `,
  styles: `
    :host{display:block;--pp-gutter:16px;--pp-head-h:calc(60px + var(--safe-t,0px))}
    /* Each page keeps its own room at the bottom (the Melden bar sits on the edge itself). */
    .pt-page{min-height:100dvh;padding-bottom:0}
    .pt-head{position:sticky;top:0;z-index:30;isolation:isolate;padding-top:var(--safe-t,0px)}
    .pt-head::before{content:'';position:absolute;inset:0;z-index:-1;background:var(--ios-glass,rgb(242 239 235/90%));box-shadow:0 .5px 0 rgb(26 22 20/10%);backdrop-filter:var(--ios-glass-filter,blur(20px));-webkit-backdrop-filter:var(--ios-glass-filter,blur(20px))}
    .pt-head__in{display:flex;align-items:center;gap:12px;max-width:1080px;min-height:60px;margin:0 auto;padding:0 var(--pp-gutter)}
    .pt-head__brand{display:flex;flex:none;align-items:center;min-height:44px;color:inherit;text-decoration:none;--brand-sub:var(--rose-dark)}
    .pt-head__who{display:grid;flex:1;justify-items:end;min-width:0;line-height:1.2;text-align:right}
    .pt-head__who strong{max-width:100%;overflow:hidden;font-size:14.5px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}
    .pt-head__who span{max-width:100%;overflow:hidden;color:var(--muted);font-size:12.5px;text-overflow:ellipsis;white-space:nowrap}
    .pt-head__out{flex:none;min-height:44px}
    .pt-main{width:100%;max-width:1080px;margin:0 auto;padding:8px var(--pp-gutter) 0}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){:host{--pp-gutter:24px}}
  `,
})
export class PartnerShell {
  private readonly auth = inject(Auth);
  private readonly api = inject(PartnerPortalApi);
  private readonly router = inject(Router);
  private readonly data = inject(PartnerData);
  readonly host = inject(HostBridge);

  readonly leaving = signal(false);
  readonly person = computed(() => this.data.overview()?.partner.displayName || this.auth.user()?.displayName || null);
  readonly company = computed(() => this.data.overview()?.partner.name ?? null);

  constructor() {
    /* The header's names (and every screen's data) come with the overview; a screen that loads it too shares the call. */
    if (!this.host.present) void this.data.load();
  }

  /**
   * Afmelden: first leave (a form with typed values asks first, and may keep
   * him here), then end the session on the server, then here. The login page
   * opens in partner mode again (lastPartner stays on this device).
   */
  async logout(): Promise<void> {
    if (this.leaving()) return;
    this.leaving.set(true);
    try {
      const left = await this.router.navigate(['/login'], { queryParams: { partner: 1 }, replaceUrl: true });
      if (!left) return;
      try { await this.api.logout(); } catch { /* the session may be gone already; signing out here is what counts */ }
      this.auth.logout();
    } finally {
      this.leaving.set(false);
    }
  }
}
