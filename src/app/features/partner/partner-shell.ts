import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { PartnerPortalApi } from '../../core/api/partner-portal-api';
import { useAppManifest } from '../../core/platform/app-manifest';
import { HostBridge } from '../../core/platform/host-bridge';
import { BrandMark } from '../../shared/brand-mark';
import { PartnerContainersData } from './partner-containers-data';
import { PartnerData } from './partner-data';

/** The portal's tabs. */
const TABS: readonly { path: string; label: string; exact: boolean }[] = [
  { path: '/partner', label: 'Overzicht', exact: true },
  { path: '/partner/melden', label: 'Melden', exact: false },
  { path: '/partner/meldingen', label: 'Meldingen', exact: false },
  { path: '/partner/containers', label: 'Containers', exact: false },
];

/**
 * The partner portal (Verhoeven): a separate, simple app inside the ERP for a
 * partner login, desk first. Its own top bar (Enrosed, Partnerportaal, the
 * tabs Overzicht · Melden · Meldingen · Containers, who is signed in,
 * Afmelden), no staff menu and no bell; the shell's chrome is off for it
 * (app.ts bare()). Content up to about 1240 px; on the phone the tabs sit in
 * a row under the bar.
 *
 * The native iOS app does not offer the portal: a partner who still lands
 * there only reads where to open it.
 */
@Component({
  selector: 'app-partner-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, BrandMark],
  providers: [PartnerData, PartnerContainersData],
  template: `
    <div class="pt-page ios-page ios-page--bare">
      <header class="pt-head">
        <div class="pt-head__in">
          <a class="pt-head__brand" routerLink="/partner" aria-label="Partnerportaal, overzicht">
            <app-brand-mark subtitle="Partnerportaal" [small]="true" />
          </a>
          @if (!host.present) {
            <nav class="pt-tabs" aria-label="Partnerportaal">
              @for (tab of tabs; track tab.path) {
                <a class="pt-tab" [routerLink]="tab.path" [class.is-on]="isOn(tab)" [attr.aria-current]="isOn(tab) ? 'page' : null">{{ tab.label }}</a>
              }
            </nav>
          }
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
    :host{display:block;--pp-gutter:16px;--pp-head-h:calc(108px + var(--safe-t,0px));--pp-sticky-top:var(--pp-head-h)}
    /* Each page keeps its own room at the bottom (the Melden bar sits on the edge itself). */
    .pt-page{min-height:100dvh;padding-bottom:0}
    .pt-head{position:sticky;top:0;z-index:30;isolation:isolate;padding-top:var(--safe-t,0px)}
    .pt-head::before{content:'';position:absolute;inset:0;z-index:-1;background:var(--ios-glass,rgb(242 239 235/90%));box-shadow:0 .5px 0 rgb(26 22 20/10%);backdrop-filter:var(--ios-glass-filter,blur(20px));-webkit-backdrop-filter:var(--ios-glass-filter,blur(20px))}
    .pt-head__in{display:flex;flex-wrap:wrap;align-items:center;gap:0 12px;max-width:1240px;min-height:60px;margin:0 auto;padding:0 var(--pp-gutter)}
    .pt-head__brand{display:flex;flex:none;align-items:center;min-height:44px;color:inherit;text-decoration:none;--brand-sub:var(--rose-dark)}
    .pt-tabs{display:flex;order:3;flex:1 0 100%;gap:2px;height:48px;margin:0 calc(-1 * var(--pp-gutter));padding:0 calc(var(--pp-gutter) - 8px) 4px;overflow-x:auto;scrollbar-width:none}
    .pt-tabs::-webkit-scrollbar{display:none}
    .pt-tab{position:relative;display:inline-flex;flex:none;align-items:center;min-height:44px;padding:0 10px;border-radius:10px;color:var(--ink-2);font-size:15px;font-weight:650;text-decoration:none;white-space:nowrap;-webkit-tap-highlight-color:transparent}
    .pt-tab:hover{background:color-mix(in srgb,var(--ink) 5%,transparent);color:var(--ink)}
    .pt-tab.is-on{color:var(--rose-dark)}
    .pt-tab.is-on::after{content:'';position:absolute;right:10px;bottom:4px;left:10px;height:2.5px;border-radius:2px;background:var(--rose)}
    .pt-tab:focus-visible{outline:2px solid var(--rose-dark);outline-offset:-2px}
    .pt-head__who{display:grid;flex:1;justify-items:end;min-width:0;line-height:1.2;text-align:right}
    .pt-head__who strong{max-width:100%;overflow:hidden;font-size:14.5px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}
    .pt-head__who span{max-width:100%;overflow:hidden;color:var(--muted);font-size:12.5px;text-overflow:ellipsis;white-space:nowrap}
    .pt-head__out{flex:none;min-height:44px}
    .pt-main{width:100%;max-width:1240px;margin:0 auto;padding:12px var(--pp-gutter) 0}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      :host{--pp-gutter:24px;--pp-head-h:calc(60px + var(--safe-t,0px))}
      .pt-head__in{flex-wrap:nowrap;gap:20px}
      .pt-tabs{order:0;flex:0 1 auto;height:60px;margin:0;padding:0;align-items:stretch}
      .pt-tab{min-height:60px;padding:0 12px;border-radius:0;font-size:14.5px}
      .pt-tab:hover{background:transparent}
      .pt-tab.is-on::after{right:12px;bottom:0;left:12px;height:3px;border-radius:3px 3px 0 0}
      .pt-main{padding-top:20px}
    }
  `,
})
export class PartnerShell {
  private readonly auth = inject(Auth);
  private readonly api = inject(PartnerPortalApi);
  private readonly router = inject(Router);
  private readonly data = inject(PartnerData);
  readonly host = inject(HostBridge);

  readonly tabs = TABS;
  readonly leaving = signal(false);
  /** The current path without its query (RouterLinkActive would add its code to the initial bundle). */
  private readonly path = signal(this.router.url.split(/[?#]/)[0]);
  readonly person = computed(() => this.data.overview()?.partner.displayName || this.auth.user()?.displayName || null);
  readonly company = computed(() => this.data.overview()?.partner.name ?? null);

  constructor() {
    const navigation = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.path.set(event.urlAfterRedirects.split(/[?#]/)[0]);
    });
    inject(DestroyRef).onDestroy(() => navigation.unsubscribe());
    if (this.host.present) return;
    /* The header's names (and every screen's data) come with the overview; a screen that loads it too shares the call. */
    void this.data.load();
    const doc = inject(DOCUMENT);
    const win = doc.defaultView;
    /* Added to the Home Screen from here, the app starts in the portal (core/platform/app-manifest.ts). */
    useAppManifest(doc, 'partner');
    /* Back in the portal (Safari brought to the front, the tab shown again, the page out of the back cache): today's
       stock and today's date, not those of when the page was loaded. A page left open in front reads again after midnight. */
    const back = () => { if (doc.visibilityState === 'visible') this.data.refreshIfStale(); };
    doc.addEventListener('visibilitychange', back);
    win?.addEventListener('focus', back);
    win?.addEventListener('pageshow', back);
    const timer = win?.setInterval(() => { if (doc.visibilityState === 'visible') this.data.refreshIfNewDay(); }, 60_000);
    inject(DestroyRef).onDestroy(() => {
      doc.removeEventListener('visibilitychange', back);
      win?.removeEventListener('focus', back);
      win?.removeEventListener('pageshow', back);
      if (timer !== undefined) win?.clearInterval(timer);
      useAppManifest(doc, 'staff');
    });
  }

  isOn(tab: { path: string; exact: boolean }): boolean {
    const path = this.path();
    return tab.exact ? path === tab.path : path === tab.path || path.startsWith(tab.path + '/');
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
