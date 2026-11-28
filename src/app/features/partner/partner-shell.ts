import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { PartnerPortalApi } from '../../core/api/partner-portal-api';
import { useAppManifest } from '../../core/platform/app-manifest';
import { HostBridge } from '../../core/platform/host-bridge';
import { BrandMark } from '../../shared/brand-mark';
import { Icon } from '../../shared/icon';
import { PartnerContainersData } from './partner-containers-data';
import { PartnerData } from './partner-data';
import { partnerStatus } from './partner-report-format';

interface Tab {
  path: string;
  label: string;
  /** The word in the narrow rail (a smaller screen with a mouse), where the whole label does not fit. */
  rail?: string;
  icon: string;
  exact: boolean;
  /** The count beside it in the side bar (what is coming, in stock, waiting); null for none. */
  count?: 'coming' | 'stock' | 'waiting';
}

/** The portal's pages; Melden is the button above them (and a tab of its own on the phone). */
const TABS: readonly Tab[] = [
  { path: '/partner', label: 'Overzicht', icon: 'home', exact: true },
  { path: '/partner/inkooporders', label: 'Inkooporders', rail: 'Inkoop', icon: 'purchase', exact: false, count: 'coming' },
  { path: '/partner/voorraad', label: 'Voorraad', icon: 'stock', exact: false, count: 'stock' },
  { path: '/partner/meldingen', label: 'Meldingen', icon: 'list', exact: false, count: 'waiting' },
];

const MELDEN: Tab = { path: '/partner/melden', label: 'Melden', icon: 'plus', exact: false };

/**
 * The partner portal (Verhoeven): a separate, simple app inside the ERP for a partner login. On a desk a side bar
 * like the ERP's (2026-11-28): Enrosed, the green Melden button, Overzicht · Inkooporders · Voorraad · Meldingen
 * with what is coming, in stock and waiting on Enrosed, and at its foot whom to call, who is signed in and Afmelden;
 * a narrow rail of the same on a smaller screen with a mouse. On the phone the top bar with the tabs in a row under
 * it (Melden among them). The shell's own chrome is off for it (app.ts bare()).
 *
 * The native iOS app does not offer the portal: a partner who still lands there only reads where to open it.
 */
@Component({
  selector: 'app-partner-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, BrandMark, Icon],
  providers: [PartnerData, PartnerContainersData],
  template: `
    <div class="pt-page ios-page ios-page--bare" [class.has-side]="!host.present">
      @if (!host.present) {
        <aside class="pt-side" aria-label="Partnerportaal">
          <a class="pt-side__brand" routerLink="/partner" aria-label="Partnerportaal, overzicht">
            <app-brand-mark subtitle="Partnerportaal" [small]="true" />
          </a>
          <a class="pt-side__melden" [routerLink]="melden.path" [class.is-on]="isOn(melden)" [attr.aria-current]="isOn(melden) ? 'page' : null">
            <app-icon name="plus" [size]="18" /><span>Melden</span>
          </a>
          <nav class="pt-side__nav" aria-label="Pagina's">
            @for (tab of tabs; track tab.path) {
              <a class="pt-side__link" [routerLink]="tab.path" [class.is-on]="isOn(tab)" [class.has-rail]="!!tab.rail" [attr.aria-current]="isOn(tab) ? 'page' : null">
                <app-icon [name]="tab.icon" [size]="18" />
                <span class="pt-side__label">{{ tab.label }}</span>
                @if (tab.rail) { <span class="pt-side__rail">{{ tab.rail }}</span> }
                @if (countOf(tab); as n) { <span class="pt-side__count" [class.is-alert]="tab.count === 'waiting'">{{ n }}</span> }
              </a>
            }
          </nav>
          <div class="pt-side__foot">
            @if (contactPhone()) {
              <p class="pt-side__contact">Vragen? {{ contactName() }}<br /><a [href]="'tel:' + tel(contactPhone())">{{ contactPhone() }}</a></p>
            }
            <div class="pt-side__who">
              @if (person()) { <strong>{{ person() }}</strong> }
              @if (company()) { <span>{{ company() }}</span> }
            </div>
            <button class="pt-side__out" type="button" [disabled]="leaving()" (click)="logout()" aria-label="Afmelden">
              <app-icon name="arrow-out" [size]="16" /><span>Afmelden</span>
            </button>
          </div>
        </aside>
      }
      <header class="pt-head">
        <div class="pt-head__in">
          <a class="pt-head__brand" routerLink="/partner" aria-label="Partnerportaal, overzicht">
            <app-brand-mark subtitle="Partnerportaal" [small]="true" />
          </a>
          @if (!host.present) {
            <nav class="pt-tabs" aria-label="Partnerportaal" #tabStrip>
              @for (tab of phoneTabs; track tab.path) {
                <a class="pt-tab" [routerLink]="tab.path" [class.is-on]="isOn(tab)" [attr.aria-current]="isOn(tab) ? 'page' : null"
                   [attr.aria-label]="tab.rail ? tab.label : null">{{ tab.rail ?? tab.label }}</a>
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
    .pt-side{display:none}

    /* ---- phone: the top bar with the tabs in a row under it */
    .pt-head{position:sticky;top:0;z-index:30;isolation:isolate;padding-top:var(--safe-t,0px)}
    .pt-head::before{content:'';position:absolute;inset:0;z-index:-1;background:var(--ios-glass,rgb(242 239 235/90%));box-shadow:0 .5px 0 rgb(26 22 20/10%);backdrop-filter:var(--ios-glass-filter,blur(20px));-webkit-backdrop-filter:var(--ios-glass-filter,blur(20px))}
    .pt-head__in{display:flex;flex-wrap:wrap;align-items:center;gap:0 12px;max-width:1240px;min-height:60px;margin:0 auto;padding:0 var(--pp-gutter)}
    .pt-head__brand{display:flex;flex:none;align-items:center;min-height:44px;color:inherit;text-decoration:none;--brand-sub:var(--rose-dark)}
    .pt-tabs{display:flex;order:3;flex:1 0 100%;gap:2px;height:48px;margin:0 calc(-1 * var(--pp-gutter));padding:0 calc(var(--pp-gutter) - 8px) 4px;overflow-x:auto;scrollbar-width:none}
    .pt-tabs::-webkit-scrollbar{display:none}
    .pt-tab{position:relative;display:inline-flex;flex:none;align-items:center;min-height:44px;padding:0 8px;border-radius:10px;color:var(--ink-2);font-size:15px;font-weight:650;text-decoration:none;white-space:nowrap;-webkit-tap-highlight-color:transparent}
    .pt-tab.is-on{color:var(--rose-dark)}
    .pt-tab.is-on::after{content:'';position:absolute;right:8px;bottom:4px;left:8px;height:2.5px;border-radius:2px;background:var(--rose)}
    .pt-tab:focus-visible{outline:2px solid var(--rose-dark);outline-offset:-2px}
    .pt-head__who{display:grid;flex:1;justify-items:end;min-width:0;line-height:1.2;text-align:right}
    .pt-head__who strong{max-width:100%;overflow:hidden;font-size:14.5px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}
    .pt-head__who span{max-width:100%;overflow:hidden;color:var(--muted);font-size:12.5px;text-overflow:ellipsis;white-space:nowrap}
    .pt-head__out{flex:none;min-height:44px}
    .pt-main{width:100%;max-width:1240px;margin:0 auto;padding:12px var(--pp-gutter) 0}

    /* ---- desk: the side bar (a rail under 1024 px), no top bar */
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      :host{--pp-gutter:24px;--pp-head-h:var(--safe-t,0px);--pp-sticky-top:var(--safe-t,0px);--pp-side-w:84px}
      /* In the iOS app (no side bar) the top bar stays, one row high. */
      .pt-page:not(.has-side){--pp-head-h:calc(60px + var(--safe-t,0px));--pp-sticky-top:calc(60px + var(--safe-t,0px))}
      .pt-page.has-side{display:grid;grid-template-columns:var(--pp-side-w) minmax(0,1fr);align-items:start}
      .pt-page.has-side>.pt-head{display:none}
      .pt-side{position:sticky;top:0;z-index:30;display:flex;flex-direction:column;gap:6px;height:100dvh;padding:calc(14px + var(--safe-t,0px)) 10px 12px;border-right:1px solid var(--line);background:var(--surface)}
      .pt-side__brand{display:flex;align-items:center;justify-content:center;min-height:40px;padding:0 0 10px;margin:0 -10px 4px;border-bottom:1px solid var(--line);color:inherit;text-decoration:none;--brand-sub:var(--rose-dark)}
      .pt-side__brand ::ng-deep .brand-mark__sub{display:none}
      .pt-side__brand ::ng-deep .brand-mark__logo{width:60px;height:auto;max-width:60px}
      .pt-side__melden{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:52px;margin:6px 0 8px;border-radius:12px;background:var(--rose);color:#fff;font-size:10.5px;font-weight:700;text-decoration:none;box-shadow:0 1px 2px rgb(26 22 20/12%)}
      .pt-side__melden:hover,.pt-side__melden.is-on{background:var(--rose-dark)}
      .pt-side__melden:focus-visible{outline:2px solid var(--rose-dark);outline-offset:2px}
      .pt-side__nav{display:grid;align-content:start;gap:2px;flex:1;min-height:0;overflow-x:hidden;overflow-y:auto}
      .pt-side__link{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 2px 8px;border-radius:10px;color:var(--ink-2);font-size:10.5px;font-weight:600;line-height:1.1;text-align:center;text-decoration:none}
      .pt-side__link:hover{background:var(--surface-2);color:var(--ink)}
      .pt-side__link.is-on{background:var(--rose-soft);color:var(--rose-dark);font-weight:700}
      .pt-side__link:focus-visible{outline:2px solid var(--rose-dark);outline-offset:-2px}
      .pt-side__label{max-width:100%;overflow:hidden;text-overflow:ellipsis}
      .pt-side__rail{display:none;max-width:100%;overflow:hidden;text-overflow:ellipsis}
      .has-rail .pt-side__label{display:none}
      .has-rail .pt-side__rail{display:block}
      .pt-side__count{position:absolute;top:3px;right:8px;min-width:17px;height:17px;padding:0 5px;border-radius:999px;background:var(--surface-2);color:var(--ink-2);font-size:10px;font-weight:700;line-height:17px;text-align:center;box-shadow:inset 0 0 0 1px var(--line)}
      .pt-side__count.is-alert{background:#c48a2c;color:#fff;box-shadow:none}
      .pt-side__foot{display:grid;gap:8px;padding-top:10px;border-top:1px solid var(--line)}
      .pt-side__contact,.pt-side__who{display:none}
      .pt-side__out{display:flex;flex-direction:column;align-items:center;gap:2px;min-height:44px;padding:4px 0;border:1px solid var(--line-strong);border-radius:10px;background:transparent;color:var(--ink-2);font:inherit;font-size:10.5px;font-weight:600;cursor:pointer}
      .pt-side__out:hover:not(:disabled){background:var(--surface-2);color:var(--ink)}
      .pt-main{max-width:1240px;padding:22px var(--pp-gutter) 0}
    }
    @media (min-width: 1024px){
      :host{--pp-side-w:200px}
      .pt-side{gap:8px;padding:calc(16px + var(--safe-t,0px)) 12px 14px}
      .pt-side__brand{justify-content:flex-start;min-height:48px;padding:0 18px 12px;margin:0 -12px 4px}
      .pt-side__brand ::ng-deep .brand-mark__sub{display:block}
      .pt-side__brand ::ng-deep .brand-mark__logo{width:auto;height:19px;max-width:none}
      .has-rail .pt-side__label{display:block}
      .has-rail .pt-side__rail{display:none}
      .pt-side__melden{flex-direction:row;gap:8px;min-height:42px;margin:8px 0 10px;font-size:14.5px}
      .pt-side__link{flex-direction:row;gap:11px;padding:9px 10px;font-size:14px;font-weight:550;text-align:left}
      .pt-side__link.is-on{font-weight:700}
      .pt-side__label{flex:1}
      .pt-side__count{position:static;min-width:22px;height:20px;padding:0 7px;font-size:11.5px;line-height:20px}
      .pt-side__contact{display:block;margin:0;padding:0 4px;color:var(--muted);font-size:12.5px;line-height:1.45}
      .pt-side__contact a{color:var(--rose-dark);font-weight:650;text-decoration:none}
      .pt-side__who{display:grid;padding:0 4px;line-height:1.25}
      .pt-side__who strong{overflow:hidden;font-size:13.5px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}
      .pt-side__who span{overflow:hidden;color:var(--muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
      .pt-side__out{flex-direction:row;justify-content:center;gap:7px;min-height:36px;font-size:13px}
    }
    @media (min-width: 1200px){
      :host{--pp-side-w:216px}
    }
  `,
})
export class PartnerShell {
  private readonly auth = inject(Auth);
  private readonly api = inject(PartnerPortalApi);
  private readonly router = inject(Router);
  private readonly data = inject(PartnerData);
  private readonly containers = inject(PartnerContainersData);
  readonly host = inject(HostBridge);
  private readonly injector = inject(Injector);
  private readonly tabStrip = viewChild<ElementRef<HTMLElement>>('tabStrip');

  readonly tabs = TABS;
  readonly melden = MELDEN;
  /** The phone's row: Melden second, between Overzicht and the lists. */
  readonly phoneTabs: readonly Tab[] = [TABS[0], MELDEN, ...TABS.slice(1)];
  readonly leaving = signal(false);
  /** The current path without its query (RouterLinkActive would add its code to the initial bundle). */
  private readonly path = signal(this.router.url.split(/[?#]/)[0]);
  readonly person = computed(() => this.data.overview()?.partner.displayName || this.auth.user()?.displayName || null);
  readonly company = computed(() => this.data.overview()?.partner.name ?? null);
  readonly contactName = computed(() => this.data.overview()?.contact?.name || 'Enrosed');
  readonly contactPhone = computed(() => this.data.overview()?.contact?.phone || null);

  /** What the side bar counts: containers still coming, products in stock, meldingen waiting on Enrosed. */
  private readonly counts = computed(() => {
    const overview = this.data.overview();
    /* Over all his meldingen (the server's summary); an older server: the 10 newest it lists. */
    const waiting = overview?.meldingen?.waiting
      ?? (overview?.reports ?? []).filter((report) => report.status === 'OPEN' && partnerStatus(report).label === 'Ingediend').length;
    return {
      coming: this.containers.page() ? this.containers.coming().length : 0,
      stock: overview?.stock.length ?? 0,
      waiting,
    };
  });

  constructor() {
    const navigation = this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      this.path.set(event.urlAfterRedirects.split(/[?#]/)[0]);
      afterNextRender(() => this.revealTab(), { injector: this.injector });
    });
    inject(DestroyRef).onDestroy(() => navigation.unsubscribe());
    if (this.host.present) return;
    /* The names and the side bar's counts (and every screen's data) come with the overview and the containers; a
       screen that loads them too shares the call. */
    void this.data.load();
    void this.containers.load();
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

  /** On the phone the tabs can be wider than the screen: the current one scrolls into the strip (never the page). */
  private revealTab(): void {
    const strip = this.tabStrip()?.nativeElement;
    const tab = strip?.querySelector<HTMLElement>('.pt-tab.is-on');
    if (!strip || !tab || !strip.clientWidth) return;
    const box = strip.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    if (at.right > box.right) strip.scrollLeft += at.right - box.right + 8;
    else if (at.left < box.left) strip.scrollLeft -= box.left - at.left + 8;
  }

  isOn(tab: { path: string; exact: boolean }): boolean {
    const path = this.path();
    return tab.exact ? path === tab.path : path === tab.path || path.startsWith(tab.path + '/');
  }

  countOf(tab: Tab): number | null {
    if (!tab.count) return null;
    const value = this.counts()[tab.count];
    return value > 0 ? value : null;
  }

  tel(phone: string | null | undefined): string {
    return (phone ?? '').replace(/[^\d+]/g, '');
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
