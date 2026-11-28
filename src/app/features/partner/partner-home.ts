import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PartnerContainer, PartnerProductTile } from '../../core/api/partner-portal-api';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { PartnerContainersData } from './partner-containers-data';
import { STATE_TONE, STATE_WORD, cartonsText, cbmText, palletsText, productsText, specOrFallback, stateOf } from './partner-containers-model';
import { PartnerData } from './partner-data';
import { familyTotal, foldFamilies } from './partner-families';
import { count, euro, longDate, percent } from './partner-format';
import { PartnerPakbonButton } from './partner-pakbon-button';
import { PartnerPhoto } from './partner-photo';
import { partnerStatus } from './partner-report-format';
import { PartnerRoute } from './partner-route';

/** "zaterdag 28 november". */
const WEEKDAY_DATE = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** How many of the next container's product families the card names. */
const NEXT_FAMILIES = 4;

/**
 * Overzicht (2026-11-28, desk first, one screen): three cards, each one subject once, each with one way on.
 * - Volgende container: the next one to come, its way (Besteld, Vertrokken, the port, Zaltbommel) with the days,
 *   what is in it per product family, its pakbon, and how many more are on their way (the list itself lives on
 *   Inkooporders only).
 * - Meldingen: what waits on Enrosed and what is confirmed but not invoiced, the last melding's day, the cost
 *   percents (the list lives on Meldingen).
 * - Voorraad: per category how many products lie in Zaltbommel (the products live on Voorraad).
 * Melden is the side bar's button. Never a price of Enrosed's: the money here is his own meldingen.
 */
@Component({
  selector: 'app-partner-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, LoadError, Skeleton, PartnerPakbonButton, PartnerPhoto, PartnerRoute],
  template: `
    <header class="hd">
      <h1>{{ greeting() }}</h1>
      @if (todayText()) { <p>{{ todayText() }}</p> }
    </header>

    @if (overview(); as o) {
      <div class="grid">
        <section class="ov-card ov-card--next" aria-labelledby="ov-next">
          <div class="ov-card__head">
            <h2 id="ov-next" class="ov-card__kicker">Volgende container</h2>
            <a class="ov-card__link" routerLink="/partner/inkooporders">Alle inkooporders</a>
          </div>
          @if (next(); as n) {
            <div class="nx-title">
              <div class="nx-name">
                <b>{{ n.container.name }}</b>
                <span class="wk-pill {{ n.tone }}">{{ n.word }}</span>
                @if (n.container.own) { <span class="wk-pill tone-accent">Samen met jou</span> }
              </div>
              <div class="nx-actions">
                <app-partner-pakbon-button [containerId]="n.container.id" [name]="n.container.name" />
                <a class="nx-open" routerLink="/partner/inkooporders" [queryParams]="{ container: n.container.id }">Bekijk <app-icon name="chevron-right" [size]="15" /></a>
              </div>
            </div>
            <app-partner-route class="nx-route" [container]="n.container" [today]="n.today" [warehouseName]="n.warehouse" />
            <p class="nx-cargo">{{ n.cargo }}</p>
            @if (n.families.length) {
              <ul class="nx-list" aria-label="Wat erin zit">
                @for (family of n.families; track family.key) {
                  <li>
                    <app-partner-photo class="nx-photo" [product]="family.photo" />
                    <span class="nx-fam"><b>{{ family.title }}</b>
                      @if (family.colours.length > 1) {
                        <span class="nx-dots" aria-hidden="true">@for (colour of family.colours; track $index) { <i [style.background]="colour"></i> }</span>
                      }
                    </span>
                    <span class="nx-fig">{{ family.total }}</span>
                  </li>
                }
              </ul>
              @if (n.moreFamilies) { <p class="nx-more">+ {{ n.moreFamilies }} {{ n.moreFamilies === 1 ? 'product' : 'producten' }} meer op de pakbon</p> }
            }
            @if (n.after) { <p class="nx-after">{{ n.after }}</p> }
          } @else if (containers.page()) {
            <p class="none">Er is nu geen container onderweg.</p>
          } @else if (containers.failure()) {
            <p class="none">De inkooporders konden niet geladen worden. <button class="none__retry" type="button" (click)="reload()">Opnieuw</button></p>
          } @else {
            <app-skeleton kind="card" [rows]="3" />
          }
        </section>

        <section class="ov-card ov-card--meld" aria-labelledby="ov-meld">
          <div class="ov-card__head">
            <h2 id="ov-meld" class="ov-card__kicker">Meldingen</h2>
            <a class="ov-card__link" routerLink="/partner/meldingen">Alle meldingen</a>
          </div>
          <div class="kv" [class.is-on]="meld().waiting > 0">
            <span class="kv__label">Wacht op Enrosed</span>
            <b class="kv__value">{{ meld().waiting }}</b>
            @if (meld().waiting) { <span class="kv__sub">{{ eur(meld().waitingEur) }} netto</span> }
          </div>
          <div class="kv">
            <span class="kv__label">Bevestigd, nog niet gefactureerd</span>
            <b class="kv__value">{{ meld().confirmed }}</b>
            @if (meld().confirmed) { <span class="kv__sub">{{ eur(meld().confirmedEur) }} netto</span> }
          </div>
          <p class="ov-card__foot">
            @if (meld().last; as last) { Laatste melding {{ last }} · } @else { Nog niets gemeld · }
            veilingcommissie {{ pct(o.costs.auctionCommissionPct) }}, transport {{ pct(o.costs.auctionTransportPct) }}
          </p>
        </section>

        <section class="ov-card ov-card--stock" aria-labelledby="ov-stock">
          <div class="ov-card__head">
            <h2 id="ov-stock" class="ov-card__kicker">Voorraad</h2>
            <a class="ov-card__link" routerLink="/partner/voorraad">Naar voorraad</a>
          </div>
          @if (stock().length) {
            <ul class="cats">
              @for (category of stock(); track category.key) {
                <li><span>{{ category.name }}</span><b>{{ category.products }}</b></li>
              }
            </ul>
            <p class="ov-card__foot">{{ stockTotal() }}</p>
          } @else {
            <p class="none">Er ligt nu geen voorraad.</p>
          }
        </section>
      </div>

      @if (o.contact?.phone) {
        <p class="contact">Vragen? {{ o.contact?.name || 'Enrosed' }} · <a [href]="'tel:' + tel(o.contact?.phone)">{{ o.contact?.phone }}</a></p>
      }
    } @else if (data.failure()) {
      <app-load-error [message]="failureText()" [busy]="data.loading()" (retry)="reload()" />
    } @else {
      <app-skeleton [kind]="desk.active() ? 'table' : 'card'" [rows]="5" />
    }
  `,
  styles: `
    :host{display:block;padding-bottom:calc(24px + var(--safe-b,0px))}
    .hd{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 16px;margin:6px 2px 16px}
    .hd h1{margin:0;font-size:26px;font-weight:800;letter-spacing:-.025em;line-height:1.15}
    .hd p{margin:0;color:var(--muted);font-size:14px;font-weight:600}
    .grid{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
    .ov-card{min-width:0;padding:16px 18px 16px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .ov-card__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
    .ov-card__kicker{margin:0;color:var(--muted);font-size:12px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}
    .ov-card__link{display:inline-flex;align-items:center;min-height:32px;margin:-8px 0;color:var(--rose-dark);font-size:13.5px;font-weight:650;text-decoration:none}
    .ov-card__link:hover{text-decoration:underline}
    .ov-card__foot{margin:12px 0 0;color:var(--muted);font-size:12.5px;line-height:1.4}
    .none{margin:0;padding:14px 0 4px;color:var(--muted)}
    .none__retry{padding:0;border:0;background:none;color:var(--rose-dark);font:inherit;font-weight:650;cursor:pointer}
    .nx-title{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin-bottom:18px}
    .nx-name{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
    .nx-name b{font-size:22px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
    .nx-actions{display:flex;align-items:center;gap:8px}
    .nx-open{display:inline-flex;align-items:center;gap:2px;min-height:36px;padding:0 10px 0 13px;border-radius:10px;background:var(--rose);color:#fff;font-size:13.5px;font-weight:650;text-decoration:none}
    .nx-open:hover{background:var(--rose-dark)}
    .nx-route{margin:0 -4px 14px}
    .nx-cargo{margin:0 0 10px;padding-top:12px;border-top:1px solid var(--line);color:var(--ink-2);font-size:13px;font-weight:600}
    .nx-list{display:grid;gap:2px;margin:0;padding:0;list-style:none}
    .nx-list li{display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:40px}
    .nx-photo{width:32px;height:32px;border-radius:8px}
    .nx-fam{display:flex;align-items:center;gap:8px;min-width:0}
    .nx-fam b{min-width:0;overflow:hidden;font-size:13.5px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
    .nx-dots{display:inline-flex;flex:none;gap:3px}
    .nx-dots i{width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1px rgb(26 22 20/14%)}
    .nx-fig{font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
    .nx-more{margin:4px 0 0 42px;color:var(--muted);font-size:12.5px}
    .nx-after{margin:12px 0 0;padding-top:10px;border-top:1px solid var(--line);color:var(--ink-2);font-size:13px}
    .kv{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:0 12px;padding:10px 0;border-bottom:1px solid var(--line)}
    .kv__label{color:var(--ink-2);font-size:13.5px;font-weight:600}
    .kv__value{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}
    .kv.is-on .kv__value{color:#9a6212}
    .kv__sub{grid-column:1/-1;color:var(--muted);font-size:12.5px}
    .cats{display:grid;margin:0;padding:0;list-style:none}
    .cats li{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13.5px}
    .cats li:last-child{border-bottom:0}
    .cats b{font-weight:700;font-variant-numeric:tabular-nums}
    .contact{margin:18px 0 8px;color:var(--muted);font-size:14px;text-align:center}
    .contact a{display:inline-flex;align-items:center;min-height:44px;color:var(--rose-dark);font-weight:650;text-decoration:none}
    /* From 1024 px the side bar's foot says whom to call; below it (phone, the narrow rail) this line does. */
    @media (min-width: 1024px){.contact{display:none}}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .grid{grid-template-columns:minmax(0,1.65fr) minmax(250px,1fr);grid-template-rows:auto 1fr;align-items:start}
      .ov-card--next{grid-row:1 / span 2}
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .hd h1{font-size:24px}
      .ov-card{border:0;border-radius:20px;padding:16px}
      .nx-name b{font-size:20px}
      .nx-actions{width:100%}
      .nx-actions > *{flex:1}
      .nx-open{justify-content:center;min-height:44px;border-radius:12px;font-size:15px}
    }
  `,
})
export class PartnerHome {
  readonly data = inject(PartnerData);
  readonly containers = inject(PartnerContainersData);
  readonly desk = inject(DesktopViewport);

  readonly overview = this.data.overview;
  readonly failureText = computed(() => messageOf(this.data.failure(), LOAD_ERROR_FALLBACK));

  readonly greeting = computed(() => {
    const name = this.overview()?.partner.displayName?.trim();
    const hour = new Date().getHours();
    const word = hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond';
    return name ? `${word}, ${name}` : word;
  });

  readonly todayText = computed(() => {
    const today = this.overview()?.serverDate;
    if (!today || !/^\d{4}-\d{2}-\d{2}/.test(today)) return '';
    const [y, m, d] = today.slice(0, 10).split('-').map(Number);
    return WEEKDAY_DATE.format(new Date(Date.UTC(y, m - 1, d)));
  });

  /** The next container still coming, with its way, its cargo and what is in it per family. */
  readonly next = computed(() => {
    const page = this.containers.page();
    if (!page) return null;
    const coming = this.containers.coming();
    const container: PartnerContainer | undefined = coming[0];
    if (!container) return null;
    const today = page.serverDate;
    const state = stateOf(container, today);
    const specs = this.containers.specs();
    const order = this.containers.order();
    const lines = [...container.lines]
      .filter((line) => line.quantity > 0)
      .sort((a, b) => (order.get(a.productId) ?? 1e9) - (order.get(b.productId) ?? 1e9) || a.productId - b.productId);
    const tiles = lines.map((line) => ({ ...specOrFallback(specs.get(line.productId), line.productId), quantity: line.quantity }));
    const families = foldFamilies<PartnerProductTile & { quantity: number }>(tiles, (tile) => tile.quantity).flatMap((category) => category.families);
    const totals = container.totals;
    const cargo = totals
      ? [container.containerType, productsText(totals.products), cartonsText(totals.cartons), palletsText(totals.pallets), cbmText(totals.cbm)].filter(Boolean).join(' · ')
      : container.containerType ?? '';
    const rest = coming.slice(1);
    const onWay = rest.filter((item) => stateOf(item, today) !== 'BESTELD').length;
    const ordered = rest.length - onWay;
    const after = [onWay ? `${onWay} onderweg` : '', ordered ? `${ordered} besteld` : ''].filter(Boolean).join(' en ');
    return {
      container, today, word: STATE_WORD[state], tone: STATE_TONE[state], cargo,
      warehouse: page.warehouseName || 'Zaltbommel',
      families: families.slice(0, NEXT_FAMILIES).map((family) => ({
        key: family.key, title: family.title, total: familyTotal(family), photo: family.variants[0].item,
        colours: family.variants.map((variant) => variant.colour ?? '#c9bfb7').slice(0, 8),
      })),
      moreFamilies: Math.max(0, families.length - NEXT_FAMILIES),
      after: after ? `Daarna nog ${after}.` : '',
    };
  });

  /**
   * Meldingen at a glance: waiting on Enrosed, confirmed but not invoiced (the server counts them over all his
   * meldingen; an older server without the summary: the 10 newest it lists), the last one's day.
   */
  readonly meld = computed(() => {
    const overview = this.overview();
    const reports = overview?.reports ?? [];
    let waiting = 0;
    let waitingEur = 0;
    let confirmed = 0;
    let confirmedEur = 0;
    for (const report of reports) {
      if (report.status !== 'OPEN') continue;
      const status = partnerStatus(report);
      if (status.label === 'Ingediend') { waiting++; waitingEur += report.totals.netEur; }
      else { confirmed++; confirmedEur += report.totals.netEur; }
    }
    const latest = reports.filter((report) => report.status !== 'VOIDED').sort((a, b) => b.soldOn.localeCompare(a.soldOn) || b.id - a.id)[0];
    const last = latest ? `${latest.number}, ${longDate(latest.soldOn)}` : null;
    const summary = overview?.meldingen;
    if (summary) {
      return { waiting: summary.waiting, waitingEur: summary.waitingNetEur, confirmed: summary.confirmed, confirmedEur: summary.confirmedNetEur, last };
    }
    return { waiting, waitingEur: Math.round(waitingEur * 100) / 100, confirmed, confirmedEur: Math.round(confirmedEur * 100) / 100, last };
  });

  /** The stock per category in Enrosed's order: how many products. */
  readonly stock = computed(() => {
    const stock = this.overview()?.stock ?? [];
    const sorted = [...stock].sort((a, b) =>
      (a.categoryOrder ?? Number.MAX_SAFE_INTEGER - (a.categoryName ? 1 : 0)) - (b.categoryOrder ?? Number.MAX_SAFE_INTEGER - (b.categoryName ? 1 : 0)));
    return foldFamilies(sorted, (tile) => tile.quantity).map((category) => ({ key: category.key, name: category.name, products: category.products }));
  });

  readonly stockTotal = computed(() => {
    const stock = this.overview()?.stock ?? [];
    return `${count(stock.length)} ${stock.length === 1 ? 'product' : 'producten'} in Zaltbommel`;
  });

  constructor() {
    /* Every visit reads the stock and the containers afresh; the last answers show meanwhile. */
    void this.data.load();
    void this.containers.load();
  }

  reload(): void {
    void this.data.load();
    void this.containers.load();
  }

  eur(value: number): string {
    return euro(value);
  }

  pct(value: number): string {
    return percent(value);
  }

  tel(phone: string | null | undefined): string {
    return (phone ?? '').replace(/[^\d+]/g, '');
  }
}
