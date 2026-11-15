import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { LoginActivityLogin, LoginActivityReport, LoginActivityVisit, LoginRequestApi } from '../../core/api/login-request-api';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { NumPipe } from '../../shared/pipes';
import { AnDrillHost } from './drill-host';
import { loginCustomersView, loginTimeView, loginUnusedView, loginVisitsView } from './drill-logins';
import { dayMonth, plural, rangeLabel } from './analyses-words';
import { deltaShort } from './website-analytics-math';
import { belgianParts, clockText, deviceText, lengthText, mainKindText, minutesText, momentText, recentText, startText } from './login-activity-words';

const RANGE_LABEL: Record<number, string> = { 1: 'Vandaag', 7: '7 dagen', 30: '30 dagen', 90: '90 dagen', 365: 'Jaar' };
/** Lists on the screen stop here; the rest is one click away in the dialog. */
const SHOWN = 8;

/**
 * Bezoekers › Klantlogins: which customer used their website login when, how long and what for. A visit is
 * the run of a login's activity with less than 30 minutes between two moments (the server works them out);
 * its length runs from the first to the last moment. Every figure opens the Analyses drill-down. With a
 * login (from the Websitelogin block on the customer sheet) the screen shows that one login.
 */
@Component({
  selector: 'app-customer-login-analytics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NumPipe],
  template: `
    @if (loading() && !report()) {
      <p class="kl__state" role="status">Klantlogins laden…</p>
    } @else if (error(); as message) {
      <p class="kl__state kl__state--error" role="alert">{{ message }} <button class="linklike" type="button" (click)="load(true)">Opnieuw proberen</button></p>
    } @else if (report(); as r) {
      @if (r.accountId !== null) {
        <div class="kl__filter">
          <span class="kl__filter-name">{{ single()?.company ?? single()?.email ?? 'Eén login' }}<small>{{ single()?.email }}</small></span>
          <button class="wk-btn wk-btn--ghost" type="button" (click)="loginChange.emit(null)">Alle logins</button>
        </div>
      }
      <div class="an-kpis an-kpis--5" [attr.aria-busy]="loading()">
        @if (r.totals.customers) {
          <button type="button" class="an-kpi an-kpi--drill" aria-haspopup="dialog" (click)="openCustomers()">
            <span class="an-kpi__label">{{ r.accountId === null ? 'Ingelogde klanten' : 'Ingelogd' }}</span>
            <span class="an-kpi__value">{{ r.totals.customers | num }}</span>
            <span class="an-kpi__sub">{{ delta(r.totals.customers, r.previous.customers) }}</span>
            <span class="an-kpi__foot" [class.is-ok]="r.totals.activeNow > 0">{{ r.totals.activeNow ? (r.totals.activeNow | num) + ' nu op de site' : '' }}</span></button>
        } @else {
          <div class="an-kpi"><span class="an-kpi__label">{{ r.accountId === null ? 'Ingelogde klanten' : 'Ingelogd' }}</span><span class="an-kpi__value">0</span>
            <span class="an-kpi__sub">{{ r.days === 1 ? 'nog niemand vandaag' : 'niemand in deze periode' }}</span><span class="an-kpi__foot"></span></div>
        }
        @if (r.totals.visits) {
          <button type="button" class="an-kpi an-kpi--drill" aria-haspopup="dialog" (click)="openVisits()">
            <span class="an-kpi__label">Bezoeken</span><span class="an-kpi__value">{{ r.totals.visits | num }}</span>
            <span class="an-kpi__sub">{{ delta(r.totals.visits, r.previous.visits) }}</span><span class="an-kpi__foot"></span></button>
        } @else {
          <div class="an-kpi"><span class="an-kpi__label">Bezoeken</span><span class="an-kpi__value">0</span>
            <span class="an-kpi__sub">geen in deze periode</span><span class="an-kpi__foot"></span></div>
        }
        @if (r.totals.seconds > 0) {
          <button type="button" class="an-kpi an-kpi--drill" aria-haspopup="dialog" (click)="openTime()">
            <span class="an-kpi__label">Tijd op de site</span><span class="an-kpi__value">{{ minutes(r.totals.seconds / 60) }}</span>
            <span class="an-kpi__sub">{{ average() }}</span><span class="an-kpi__foot">{{ measuredFoot() }}</span></button>
        } @else if (r.totals.measuredVisits > 0) {
          <div class="an-kpi"><span class="an-kpi__label">Tijd op de site</span><span class="an-kpi__value">&lt; 1 min</span>
            <span class="an-kpi__sub">{{ average() }}</span><span class="an-kpi__foot">{{ measuredFoot() }}</span></div>
        } @else {
          <div class="an-kpi"><span class="an-kpi__label">Tijd op de site</span><span class="an-kpi__value">—</span>
            <span class="an-kpi__sub">{{ r.totals.visits ? 'nog niet gemeten' : 'geen bezoeken' }}</span><span class="an-kpi__foot">{{ measuredFoot() }}</span></div>
        }
        <div class="an-kpi"><span class="an-kpi__label">Bestellingen</span><span class="an-kpi__value">{{ r.totals.ordersPlaced | num }}</span>
          <span class="an-kpi__sub">{{ r.totals.ordersPlaced || r.previous.ordersPlaced ? delta(r.totals.ordersPlaced, r.previous.ordersPlaced) : 'via een login' }}</span><span class="an-kpi__foot"></span></div>
        @if (r.accountId === null) {
          @if (unused().length) {
            <button type="button" class="an-kpi an-kpi--drill" aria-haspopup="dialog" (click)="openUnused()">
              <span class="an-kpi__label">Logins</span><span class="an-kpi__value">{{ r.totals.loginsActive | num }}<small>actief</small></span>
              <span class="an-kpi__sub">{{ unused().length | num }} link nog niet gebruikt</span><span class="an-kpi__foot"></span></button>
          } @else {
            <div class="an-kpi"><span class="an-kpi__label">Logins</span><span class="an-kpi__value">{{ r.totals.loginsActive | num }}<small>actief</small></span>
              <span class="an-kpi__sub">elke link gebruikt</span><span class="an-kpi__foot"></span></div>
          }
        } @else {
          <div class="an-kpi"><span class="an-kpi__label">Login</span><span class="an-kpi__value" data-kind="text">{{ statusWord(single()?.status) }}</span>
            <span class="an-kpi__sub">{{ single()?.activatedAt ? 'wachtwoord gekozen ' + day(single()?.activatedAt) : 'link nog niet gebruikt' }}</span><span class="an-kpi__foot"></span></div>
        }
      </div>

      <div class="kl__grid">
        @if (r.days > 1) {
          <section class="an-card kl__wide" aria-labelledby="kl-days-title">
            <header class="an-card__head"><h3 class="an-card__title" id="kl-days-title">Per dag</h3>
              <span class="an-card__trail"><span class="kl__legend"><i></i> bezoeken · <em></em> klanten</span></span></header>
            <div class="kl__plot">
              <span class="kl__yaxis" aria-hidden="true"><span>{{ maxDay() | num }}</span><span>0</span></span>
              <div class="kl__chart" role="img" [attr.aria-label]="'Bezoeken en klanten per dag, ' + r.days + ' dagen'">
                @for (d of r.perDay; track d.date) {
                  <div class="kl__bar" [class.kl__bar--weekend]="weekend(d.date)" [title]="day(d.date) + ': ' + d.visits + ' ' + (d.visits === 1 ? 'bezoek' : 'bezoeken') + ', ' + d.customers + ' ' + (d.customers === 1 ? 'klant' : 'klanten')">
                    <i [style.height.%]="height(d.visits)"></i><em [style.height.%]="height(d.customers)"></em>
                  </div>
                }
              </div>
            </div>
            <div class="kl__axis"><span>{{ day(r.from) }}</span><span>{{ day(r.to) }}</span></div>
          </section>
        }

        @if (r.accountId === null) {
          <section class="an-card" aria-labelledby="kl-logins-title">
            <header class="an-card__head"><h3 class="an-card__title" id="kl-logins-title">Per klant</h3>
              <span class="an-card__trail">tijd op de site</span></header>
            <div class="an-card__body">
              @for (login of usedLogins().slice(0, shownLogins()); track login.accountId) {
                <button class="an-row an-row--nolead an-row--chev" type="button" aria-haspopup="dialog" (click)="openLogin(login)">
                  <span class="an-row__body"><span class="an-row__title">{{ login.company ?? login.email }}</span>
                    <span class="an-row__sub">{{ loginSub(login) }}</span></span>
                  <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="login.measuredVisits ? null : 'muted'">{{ login.measuredVisits ? minutes(login.seconds / 60) : '—' }}</span>
                    <span class="an-row__meta">{{ login.visits ? plural(login.visits, 'bezoek', 'bezoeken') : 'geen bezoek' }}</span></span>
                  <span class="an-row__chev" aria-hidden="true">›</span>
                </button>
              } @empty { <p class="an-empty">Nog geen enkele login gebruikt.</p> }
              @if (usedLogins().length > SHOWN) {
                <button class="an-more" type="button" (click)="allLogins.set(!allLogins())">{{ allLogins() ? 'Minder tonen' : 'Alle ' + usedLogins().length + ' tonen' }}</button>
              }
            </div>
          </section>
        }

        <section class="an-card" aria-labelledby="kl-visits-title">
          <header class="an-card__head"><h3 class="an-card__title" id="kl-visits-title">{{ r.accountId === null ? 'Laatste bezoeken' : 'Bezoeken' }}</h3>
            <span class="an-card__trail">duur</span></header>
          <div class="an-card__body">
            @for (visit of r.visits.slice(0, SHOWN); track visit.accountId + visit.start) {
              <button class="an-row an-row--nolead an-row--chev" type="button" aria-haspopup="dialog" (click)="openVisitsOf(visit)">
                <span class="an-row__body"><span class="an-row__title">{{ r.accountId === null ? (visit.company ?? visit.email) : moment(visit.start) }}</span>
                  <span class="an-row__sub">{{ visitSub(visit, r.accountId === null) }}</span></span>
                <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="visit.seconds === null ? 'muted' : null">{{ length(visit.seconds) }}</span>
                  @if (visit.orderIds.length) { <span class="an-row__meta" data-tone="ok">besteld</span> }</span>
                <span class="an-row__chev" aria-hidden="true">›</span>
              </button>
            } @empty { <p class="an-empty">{{ r.days === 1 ? 'Nog geen bezoeken vandaag.' : 'Geen bezoeken in deze periode.' }}</p> }
            @if (r.visits.length > SHOWN) {
              <button class="an-more" type="button" aria-haspopup="dialog" (click)="openVisits()">Alle {{ r.totals.visits | num }} bezoeken</button>
            }
          </div>
        </section>

        @if (r.accountId === null && unused().length) {
          <section class="an-card" aria-labelledby="kl-unused-title">
            <header class="an-card__head"><h3 class="an-card__title" id="kl-unused-title">Link nog niet gebruikt</h3>
              <span class="an-card__trail">{{ unused().length | num }}</span></header>
            <div class="an-card__body">
              @for (login of unused().slice(0, 5); track login.accountId) {
                <button class="an-row an-row--nolead an-row--chev" type="button" aria-haspopup="dialog" (click)="openUnused()">
                  <span class="an-row__body"><span class="an-row__title">{{ login.company ?? login.email }}</span>
                    <span class="an-row__sub">{{ login.email }}</span></span>
                  <span class="an-row__end"><span class="an-row__meta" [attr.data-tone]="linkOpen(login) ? null : 'warn'">{{ linkOpen(login) ? 'link geldig' : 'link verlopen' }}</span>
                    <span class="an-row__meta">verstuurd {{ day(login.linkSentAt ?? login.createdAt) }}</span></span>
                  <span class="an-row__chev" aria-hidden="true">›</span>
                </button>
              }
              @if (unused().length > 5) {
                <button class="an-more" type="button" aria-haspopup="dialog" (click)="openUnused()">Alle {{ unused().length | num }} tonen</button>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
  styles: `
    :host { display: grid; gap: 12px; min-width: 0; }
    .kl__state { margin: 0; padding: 18px; color: var(--muted); font-size: 13px; }
    .kl__state--error { color: var(--danger); }
    .kl__state .linklike { min-height: 44px; }
    .kl__filter { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px;
      padding: 10px 14px; border: 1px solid var(--rose-line); border-radius: 14px; background: color-mix(in srgb, var(--rose) 6%, var(--surface)); }
    .kl__filter-name { display: grid; min-width: 0; font-size: 14px; font-weight: 700; }
    .kl__filter-name small { color: var(--muted); font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }
    .kl__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
    .kl__wide { grid-column: 1 / -1; }
    .kl__plot { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; padding: 0 16px; }
    .kl__yaxis { display: flex; flex-direction: column; justify-content: space-between; height: 120px; color: var(--muted); font-size: 10px; text-align: right; }
    .kl__chart { display: flex; align-items: flex-end; gap: clamp(.2px, .15vw, 2px); height: 120px; min-width: 0; }
    .kl__bar { position: relative; flex: 1 1 0; min-width: 0; height: 100%; border-radius: 3px 3px 0 0; }
    .kl__bar--weekend { background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
    .kl__bar i, .kl__bar em { position: absolute; bottom: 0; left: 0; right: 0; border-radius: 3px 3px 0 0; }
    .kl__bar i { background: rgb(143 41 66 / 28%); }
    .kl__bar em { background: rgb(143 41 66 / 85%); }
    .kl__axis { display: flex; justify-content: space-between; gap: 8px; padding: 6px 16px 14px; color: var(--muted); font-size: 10px; }
    .kl__legend { color: var(--muted); font-size: 11px; }
    .kl__legend i, .kl__legend em { display: inline-block; width: 10px; height: 10px; margin: 0 3px 0 6px; border-radius: 2px; vertical-align: -1px; }
    .kl__legend i { background: rgb(143 41 66 / 28%); }
    .kl__legend em { background: rgb(143 41 66 / 85%); }
    .an-kpi__foot.is-ok { color: var(--ok); }
    @media (max-width: 860px) { .kl__grid { grid-template-columns: 1fr; } }
  `,
})
export class CustomerLoginAnalytics {
  private readonly api = inject(LoginRequestApi);
  private readonly drill = inject(AnDrillHost);
  /** The phone's rows leave the device out (one line under the name); the popup has it. */
  private readonly desk = inject(DesktopViewport);

  readonly days = input(30);
  readonly login = input<number | null>(null);
  readonly refreshKey = input(0);
  readonly loadingChanged = output<boolean>();
  readonly loginChange = output<number | null>();

  readonly SHOWN = SHOWN;
  readonly report = signal<LoginActivityReport | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly allLogins = signal(false);

  readonly plural = plural;
  readonly delta = deltaShort;
  readonly minutes = minutesText;
  readonly length = lengthText;
  readonly moment = (iso: string) => momentText(iso);
  readonly recent = (iso: string) => recentText(iso);

  /** The one login of a filtered report. */
  readonly single = computed(() => {
    const report = this.report();
    return report && report.accountId !== null ? report.logins.find((login) => login.accountId === report.accountId) ?? null : null;
  });
  /** Logins that were ever used, most recent first (the server's order). */
  readonly usedLogins = computed(() => (this.report()?.logins ?? []).filter((login) => !!login.lastActiveAt));
  /** Logins whose current link waits for a password (loginUnusedView lists the same ones). */
  readonly unused = computed(() => (this.report()?.logins ?? []).filter((login) => login.status === 'INVITED'));
  readonly shownLogins = computed(() => this.allLogins() ? this.usedLogins().length : SHOWN);
  readonly maxDay = computed(() => Math.max(1, ...(this.report()?.perDay.map((day) => day.visits) ?? [1])));
  /** "gem. 8 min per bezoek" over the measured visits. */
  readonly average = computed(() => {
    const totals = this.report()?.totals;
    if (!totals?.measuredVisits) return '';
    return `gem. ${minutesText(totals.seconds / totals.measuredVisits / 60)} per bezoek`;
  });
  /** Said only while the period reaches back before the measuring began: older visits have a moment, no length. */
  readonly measuredFoot = computed(() => {
    const report = this.report();
    if (!report) return '';
    const since = report.measuredSince;
    if (!since) return report.totals.visits ? 'duur gemeten vanaf nu' : '';
    const sinceDay = belgianDay(since);
    return sinceDay && sinceDay > report.from ? `duur gemeten sinds ${this.day(sinceDay)}` : '';
  });

  private version = 0;
  private alive = true;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.alive = false; this.drill.close(); });
    effect(() => {
      this.days();
      this.login();
      this.refreshKey();
      untracked(() => void this.load(this.refreshKey() > 0));
    });
  }

  async load(force = false): Promise<void> {
    const version = ++this.version;
    this.loading.set(true);
    this.loadingChanged.emit(true);
    if (force) this.error.set(null);
    try {
      const report = await this.api.activity(this.days(), this.login());
      if (version !== this.version || !this.alive) return;
      this.report.set(report);
      this.error.set(null);
    } catch (failure: unknown) {
      if (version !== this.version || !this.alive) return;
      this.error.set(messageOf(failure, 'Klantlogins laden mislukt'));
    } finally {
      if (version === this.version && this.alive) {
        this.loading.set(false);
        this.loadingChanged.emit(false);
      }
    }
  }

  // ------------------------------------------------------------------ words

  /** "3 nov" (a date or an instant, by its Belgian day); "—" without one. */
  day(iso: string | null | undefined): string {
    if (!iso) return '—';
    const date = iso.length > 10 ? belgianDay(iso) ?? iso.slice(0, 10) : iso;
    return dayMonth(date, String(new Date().getFullYear())) || iso;
  }

  weekend(date: string): boolean {
    const day = new Date(`${date}T12:00:00`).getDay();
    return day === 0 || day === 6;
  }

  height(value: number): number {
    return Math.round((value / this.maxDay()) * 100);
  }

  statusWord(status: string | undefined): string {
    return status === 'ACTIVE' ? 'Actief' : status === 'INVITED' ? 'Uitgenodigd' : status === 'DISABLED' ? 'Ingetrokken' : '—';
  }

  /** "vandaag 21:39 · Besteld · Computer": when last, the most telling thing done, the device; one line. */
  loginSub(login: LoginActivityLogin): string {
    const last = login.lastActiveAt ? recentText(login.lastActiveAt) : null;
    if (!login.visits) return [last ? 'laatst ' + last : null, login.status === 'DISABLED' ? 'ingetrokken' : null].filter(Boolean).join(' · ');
    const parts = [
      last,
      login.orderIds.length ? plural(login.orderIds.length, 'bestelling', 'bestellingen') : mainKindText(login.kinds) || null,
      login.measuredVisits ? (this.desk.active() ? deviceText(login.device) || null : null) : 'zonder duur',
    ];
    return parts.filter(Boolean).join(' · ');
  }

  /** "14 nov · 12:20 · Prijzen" (all logins) or "Prijzen · Telefoon · Ingelogd" (one login); the popup has the rest. */
  visitSub(visit: LoginActivityVisit, withMoment: boolean): string {
    const what = mainKindText(visit.kinds);
    const parts = withMoment
      ? [this.moment(visit.start), what || startText(visit.startKind, visit.history)]
      : [what || null, deviceText(visit.device) || null, startText(visit.startKind, visit.history)];
    return parts.filter(Boolean).join(' · ');
  }

  linkOpen(login: LoginActivityLogin): boolean {
    return !!login.linkExpiresAt && new Date(login.linkExpiresAt).getTime() > Date.now();
  }

  // ------------------------------------------------------------------ drill-downs

  private scope(): string {
    const report = this.report();
    if (!report) return '';
    const range = RANGE_LABEL[report.days] ?? `${report.days} dagen`;
    return `${range} · ${rangeLabel(report.from, report.to)} · Belgische tijd`;
  }

  openVisits(): void {
    const report = this.report();
    if (!report?.totals.visits) return;
    const single = this.single();
    this.drill.open([loginVisitsView(report.visits, {
      scope: this.scope(),
      title: single ? `Bezoeken · ${single.company ?? single.email}` : 'Bezoeken met een login',
      count: report.totals.visits,
      single: report.accountId !== null,
      note: report.visits.some((visit) => visit.history) ? 'Zonder duur: van vóór de meting, enkel het moment is gekend.' : null,
    })]);
  }

  /** One login's visits in this period, from its row (Per klant). */
  openLogin(login: LoginActivityLogin): void {
    const report = this.report();
    if (!report) return;
    const visits = report.visits.filter((visit) => visit.accountId === login.accountId);
    this.drill.open([loginVisitsView(visits, {
      scope: this.scope(),
      title: `Bezoeken · ${login.company ?? login.email}`,
      count: login.visits,
      single: true,
      note: login.visits ? null : 'Geen bezoek in deze periode; kies een langere periode.',
    })]);
  }

  /** A visit row opens the visits of its login (all logins) or every visit (one login). */
  openVisitsOf(visit: LoginActivityVisit): void {
    const report = this.report();
    if (!report) return;
    if (report.accountId !== null) { this.openVisits(); return; }
    const login = report.logins.find((row) => row.accountId === visit.accountId);
    if (login) this.openLogin(login);
  }

  openTime(): void {
    const report = this.report();
    if (!report || report.totals.seconds <= 0) return;
    this.drill.open([loginTimeView(report.logins, { scope: this.scope(), seconds: report.totals.seconds })]);
  }

  openCustomers(): void {
    const report = this.report();
    if (!report?.totals.customers) return;
    this.drill.open([loginCustomersView(report.logins, { scope: this.scope(), customers: report.totals.customers })]);
  }

  openUnused(): void {
    const report = this.report();
    if (!report) return;
    this.drill.open([loginUnusedView(report.logins, { scope: `Vandaag · ${clockText(report.generatedAt)}`, now: new Date() })]);
  }
}

/** The Belgian calendar day of an instant, 2026-11-15. */
function belgianDay(iso: string): string | null {
  const parts = belgianParts(iso);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` : null;
}
