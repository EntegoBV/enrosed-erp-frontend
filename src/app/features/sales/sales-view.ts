import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalesApi } from '../../core/api/sales-api';
import { AuthImage } from '../../core/api/auth-image';
import { Privacy } from '../../core/api/privacy';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import {
  Country, Customer, PricedLine, QuoteEvent, QuoteRevision, QuoteStatus, SalesOrderView,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import {
  CbmPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe,
} from '../../shared/pipes';
import { STATUS_LABEL, statusClass } from './quote-status';

/**
 * Read-first sales order.
 *
 * Looking at an order must be safe: this page contains no fields and never
 * changes commercial data. Actions that can alter the quote live in the
 * editor, behind one explicit button.
 */
@Component({
  selector: 'app-sales-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, PageHeader, Skeleton, CbmPipe, DateNlPipe,
            DateTimeNlPipe, EurPipe, NumPipe, PctPipe],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number" [subtitle]="customerName()"
                       [showBack]="true" [showBell]="false">
        <button class="btn btn--sm" type="button" [disabled]="downloading()"
                (click)="downloadPdf()">
          {{ downloading() ? 'Even wachten…' : 'PDF' }}
        </button>
        <a class="btn btn--primary btn--sm" [routerLink]="['/sales', data.order.id, 'edit']">
          {{ actionLabel() }}
        </a>
      </app-page-header>

      <main class="content sales-view-page anim-rise">
        <section class="sales-hero" aria-labelledby="sales-overview-title">
          <div class="sales-hero__top">
            <div class="sales-hero__identity">
              <span class="eyebrow">Verkoopofferte</span>
              <h1 id="sales-overview-title">{{ customerName() }}</h1>
              <p>
                {{ data.order.orderDate | dateNl }}
                <span aria-hidden="true"> · </span>
                {{ countryName() }}
              </p>
            </div>
            <span class="status-pill" [class]="'status-pill status-pill--' + cls(data.order.status)">
              <span aria-hidden="true"></span>{{ label(data.order.status) }}
            </span>
          </div>

          <div class="hero-facts" aria-label="Offerte in cijfers">
            <div>
              <span>Producten</span>
              <strong>{{ data.priced.lines.length }}</strong>
              <small>{{ data.priced.totals.pieces | num }} stuks</small>
            </div>
            <div>
              <span>Levering</span>
              <strong>{{ palletCount(data) | num }}</strong>
              <small>pallet(s)</small>
            </div>
            <div class="hero-facts__total">
              <span>Offertetotaal</span>
              <strong>{{ data.priced.totals.total | eur: 0 }}</strong>
              <small>{{ data.priced.totals.vatLegalMention ? 'BTW verlegd' : 'excl. BTW' }}</small>
            </div>
          </div>

          @if (privacy.showPurchase()) {
            <div class="profit-strip">
              <span>Alleen intern · winst</span>
              <strong [class.profit-strip__negative]="data.priced.totals.marginEur < 0">
                {{ signedMoney(data.priced.totals.marginEur) }}
              </strong>
            </div>
          }
        </section>

        @if (pendingRevision(); as revision) {
          <section class="revision-alert" aria-labelledby="revision-alert-title">
            <span class="revision-alert__icon" aria-hidden="true">⇄</span>
            <div>
              <span class="eyebrow">Wacht op ons</span>
              <h2 id="revision-alert-title">De klant vraagt een wijziging</h2>
              <p>
                {{ revision.proposedBy || 'De klant' }} stuurde een voorstel met
                {{ revision.lines.length }} gewijzigde regel(s).
              </p>
            </div>
            <a class="btn btn--primary btn--sm" [routerLink]="['/sales', data.order.id, 'edit']">
              Beoordelen
            </a>
          </section>
        }

        <div class="sales-layout">
          <div class="sales-main">
            <section class="section-card products-card" aria-labelledby="sales-lines-title">
              <header class="section-card__head">
                <div>
                  <span class="section-kicker">Orderinhoud</span>
                  <h2 id="sales-lines-title">Producten</h2>
                </div>
                <span class="section-count">{{ data.priced.lines.length }} regels</span>
              </header>

              <div class="product-lines">
                @for (line of data.priced.lines; track line.productId) {
                  <article class="product-line">
                    <div class="product-line__photo">
                      @if (line.photoUrl) {
                        <img [appAuthSrc]="line.photoUrl" [alt]="line.description" />
                      } @else {
                        <span aria-hidden="true">◇</span>
                      }
                    </div>
                    <div class="product-line__copy">
                      <h3>{{ line.description }}</h3>
                      <p class="product-line__sku">{{ line.sku || 'Zonder SKU' }}</p>
                      <div class="product-line__meta">
                        <span><b>{{ line.quantity | num }}</b> stuks</span>
                        <span>{{ line.cartons | num }} dozen</span>
                        <span>{{ line.netUnitPrice | eur: 2 }} / stuk</span>
                      </div>
                    </div>
                    <div class="product-line__amount">
                      <span>Netto</span>
                      <strong>{{ line.net | eur: 2 }}</strong>
                      @if (line.discountPct) {
                        <small>− {{ line.discountPct | pct: 1 }}</small>
                      }
                    </div>
                    <div class="delivery-line" [class.delivery-line--open]="deliveryOpen(line, data)">
                      <span class="delivery-line__dot" aria-hidden="true"></span>
                      <span>Levering</span>
                      <strong>{{ deliveryText(line, data) }}</strong>
                    </div>
                    @if (privacy.showPurchase()) {
                      <div class="line-profit">
                        <span>Intern · totale regelwinst</span>
                        <strong [class.negative]="line.marginEur < 0">
                          {{ line.marginEur | eur: 2 }} · {{ line.marginPct | pct: 1 }}
                        </strong>
                      </div>
                    }
                  </article>
                } @empty {
                  <div class="products-empty">
                    <span aria-hidden="true">◇</span>
                    <strong>Nog geen producten</strong>
                    <p>Open Bewerken om de eerste productregel toe te voegen.</p>
                  </div>
                }
              </div>
            </section>

            <section class="section-card" aria-labelledby="quote-details-title">
              <header class="section-card__head">
                <div><span class="section-kicker">Afspraken</span><h2 id="quote-details-title">Offertedetails</h2></div>
              </header>
              <dl class="detail-grid">
                <div><dt>Offertedatum</dt><dd>{{ data.order.orderDate | dateNl }}</dd></div>
                <div><dt>Geldig tot</dt><dd>{{ data.order.validUntil | dateNl }}</dd></div>
                <div><dt>Klant</dt><dd>{{ customerName() }}</dd></div>
                <div><dt>Contactpersoon</dt><dd>{{ customer()?.contact || '—' }}</dd></div>
                <div><dt>Betaalvoorwaarden</dt><dd>{{ paymentTerms() }}</dd></div>
                <div><dt>BTW</dt><dd>{{ vatLabel(data) }}</dd></div>
                @if (data.order.notes) {
                  <div class="detail-grid__wide"><dt>Bericht op offerte</dt><dd class="text-value">{{ data.order.notes }}</dd></div>
                }
                @if (privacy.showPurchase() && data.order.internalNotes) {
                  <div class="detail-grid__wide detail-grid__internal"><dt>Interne notitie</dt><dd class="text-value">{{ data.order.internalNotes }}</dd></div>
                }
              </dl>
            </section>

            <section class="section-card" aria-labelledby="delivery-details-title">
              <header class="section-card__head">
                <div><span class="section-kicker">Logistiek</span><h2 id="delivery-details-title">Levering</h2></div>
                <span class="delivery-state" [class.delivery-state--open]="data.order.deliveryTerms === 'TE_BEPALEN'">
                  {{ deliveryState(data) }}
                </span>
              </header>
              <dl class="detail-grid">
                <div><dt>Leverland</dt><dd>{{ countryName() }}</dd></div>
                <div><dt>Incoterm</dt><dd>{{ data.order.incoterm || '—' }}</dd></div>
                <div><dt>Pallets</dt><dd>{{ palletCount(data) | num }}</dd></div>
                <div><dt>Dozen</dt><dd>{{ data.priced.totals.cartons | num }}</dd></div>
                <div><dt>Volume</dt><dd>{{ data.priced.totals.cbm | cbm }}</dd></div>
                <div><dt>Gewicht</dt><dd>{{ data.priced.totals.weightKg | num: 1 }} kg</dd></div>
                <div><dt>Vracht</dt><dd>{{ freightLabel(data) }}</dd></div>
                <div><dt>Levertermijn</dt><dd>{{ deliveryState(data) }}</dd></div>
              </dl>
            </section>

            <section class="section-card history-card" aria-labelledby="quote-history-title">
              <header class="section-card__head">
                <div><span class="section-kicker">Status</span><h2 id="quote-history-title">Geschiedenis</h2></div>
                <span class="badge" [class]="'badge badge--' + cls(data.order.status)">{{ label(data.order.status) }}</span>
              </header>
              <div class="timeline">
                @for (event of history(); track event.id) {
                  <div class="timeline__event" [class.timeline__event--customer]="event.byCustomer">
                    <span class="timeline__dot" aria-hidden="true"></span>
                    <div>
                      <strong>{{ event.summary }}</strong>
                      <p>{{ event.at | dateTimeNl }}@if (event.actor) { · {{ event.actor }} }</p>
                      @if (event.detail) { <small>{{ event.detail }}</small> }
                    </div>
                  </div>
                } @empty {
                  <p class="empty-history">Nog geen statuswijzigingen geregistreerd.</p>
                }
              </div>
            </section>
          </div>

          <aside class="sales-side" aria-label="Totalen en acties">
            <section class="totals-card">
              <header><span class="section-kicker">Controle</span><h2>Totalen</h2></header>
              <dl class="totals-list">
                <div><dt>Goederen</dt><dd>{{ data.priced.totals.goodsTotal | eur: 2 }}</dd></div>
                <div><dt>Vracht</dt><dd>{{ freightAmount(data) }}</dd></div>
                <div><dt>Handling</dt><dd>{{ data.priced.totals.handling | eur: 2 }}</dd></div>
                <div class="totals-list__main"><dt>Offertetotaal <small>excl. BTW</small></dt><dd>{{ data.priced.totals.total | eur: 2 }}</dd></div>
                <div><dt>BTW {{ data.priced.totals.vatRatePct | pct: 0 }}</dt><dd>{{ data.priced.totals.vatAmount | eur: 2 }}</dd></div>
                <div class="totals-list__incl"><dt>Inclusief BTW</dt><dd>{{ data.priced.totals.totalInclVat | eur: 2 }}</dd></div>
              </dl>
              @if (privacy.showPurchase()) {
                <div class="totals-profit">
                  <span>Alleen intern</span>
                  <div><b>Winst</b><strong [class.negative]="data.priced.totals.marginEur < 0">{{ data.priced.totals.marginEur | eur: 2 }}</strong></div>
                  <small>{{ data.priced.totals.marginPct | pct: 1 }} van het netto goederenbedrag</small>
                </div>
              }
              <a class="btn btn--primary btn--block" [routerLink]="['/sales', data.order.id, 'edit']">
                {{ actionLabel() }}
              </a>
            </section>
          </aside>
        </div>
      </main>
    } @else if (loading()) {
      <app-page-header title="Offerte laden" [showBack]="true" [showBell]="false" />
      <main class="content sales-view-page">
        <app-skeleton kind="card" />
        <div class="loading-grid"><app-skeleton kind="lines" [rows]="5" /><app-skeleton kind="lines" [rows]="4" /></div>
      </main>
    } @else {
      <app-page-header title="Offerte niet beschikbaar" [showBack]="true" [showBell]="false" />
      <main class="content sales-view-page">
        <section class="load-error">
          <span aria-hidden="true">!</span>
          <h1>Deze offerte kon niet worden geopend</h1>
          <p>{{ loadError() }}</p>
          <button class="btn btn--primary" type="button" (click)="retry()">Opnieuw proberen</button>
        </section>
      </main>
    }
  `,
  styles: [`
    .sales-view-page { max-width:1180px;margin-inline:auto;background:radial-gradient(circle at 48% 0,var(--rose-soft),transparent 340px) }
    .sales-view-page>*+* { margin-top:12px }
    .sales-hero { overflow:hidden;padding:18px;border-radius:22px;background:linear-gradient(145deg,#27211f,#151210);color:#fff;box-shadow:var(--sh-2) }
    .sales-hero__top { display:flex;align-items:flex-start;justify-content:space-between;gap:12px }
    .eyebrow,.section-kicker { color:var(--rose);font-size:9.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase }
    .sales-hero .eyebrow { color:#efb8c4 }
    .sales-hero h1 { margin:3px 0 0;color:#fff;font-size:clamp(21px,6vw,30px);line-height:1.14;letter-spacing:-.03em }
    .sales-hero__identity p { margin:5px 0 0;color:rgb(255 255 255/.62);font-size:11.5px }
    .status-pill { display:inline-flex;flex:0 0 auto;align-items:center;gap:6px;max-width:44%;padding:6px 9px;border:1px solid rgb(255 255 255/.18);border-radius:999px;background:rgb(255 255 255/.08);font-size:10.5px;font-weight:750;text-align:center }
    .status-pill>span { width:7px;height:7px;border-radius:50%;background:#c6beb9 }
    .status-pill--ok>span { background:#50cc8c }.status-pill--danger>span { background:#ff8076 }.status-pill--gold>span { background:#f1c66d }.status-pill--rose>span { background:#ef8ba2 }.status-pill--blue>span { background:#81b9f5 }
    .hero-facts { display:grid;grid-template-columns:.72fr .72fr 1.35fr;gap:1px;margin-top:18px;overflow:hidden;border:1px solid rgb(255 255 255/.1);border-radius:14px;background:rgb(255 255 255/.1) }
    .hero-facts>div { min-width:0;padding:11px;background:rgb(255 255 255/.055) }
    .hero-facts span,.hero-facts small { display:block;color:rgb(255 255 255/.56);font-size:9.5px }.hero-facts strong { display:block;overflow:hidden;margin-top:2px;color:#fff;font-size:17px;line-height:1.2;text-overflow:ellipsis;white-space:nowrap }
    .hero-facts__total strong { font-size:19px }.hero-facts__total { background:rgb(255 255 255/.1)!important }
    .profit-strip { display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px -3px -3px;padding:8px 11px;border-radius:10px;background:rgb(77 203 137/.12);color:#a8e8c6;font-size:10px }
    .profit-strip strong { font-size:13px;font-variant-numeric:tabular-nums }.profit-strip .profit-strip__negative { color:#ff9189 }
    .revision-alert { display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px 12px;padding:14px;border:1px solid #ead49d;border-radius:var(--r);background:var(--gold-soft);box-shadow:var(--sh-1) }
    .revision-alert__icon { display:grid;width:38px;height:38px;place-items:center;border-radius:12px;background:#fff;color:var(--gold);font-size:19px }
    .revision-alert h2 { margin:2px 0 0;font-size:14px }.revision-alert p { margin:3px 0 0;color:var(--muted);font-size:11.5px;line-height:1.45 }.revision-alert .btn { grid-column:1/-1 }
    .sales-layout,.sales-main { display:grid;gap:12px;min-width:0 }
    .section-card,.totals-card { overflow:hidden;border:1px solid rgb(255 255 255/.75);border-radius:var(--r);background:var(--surface);box-shadow:var(--sh-1) }
    .section-card__head { min-height:62px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line) }
    .section-card h2,.totals-card h2 { margin:2px 0 0;font-size:15px;letter-spacing:-.01em }
    .section-count,.delivery-state { flex:0 0 auto;padding:5px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:10px;font-weight:700 }
    .delivery-state { background:var(--ok-soft);color:var(--ok) }.delivery-state--open { background:var(--warn-soft);color:var(--warn) }
  `, `
    .product-lines { padding:10px }.product-line { display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:10px;padding:11px;border:1px solid var(--line);border-radius:14px;background:var(--surface-2) }.product-line+.product-line { margin-top:9px }
    .product-line__photo { width:54px;height:54px;display:grid;place-items:center;overflow:hidden;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--muted-2);font-size:21px }.product-line__photo img { width:100%;height:100%;object-fit:contain }
    .product-line__copy { min-width:0 }.product-line h3 { overflow:hidden;margin:1px 0 0;font-size:12.5px;line-height:1.25;text-overflow:ellipsis;white-space:nowrap }.product-line__sku { overflow:hidden;margin:3px 0 0;color:var(--muted);font:9.5px/1.2 var(--mono);text-overflow:ellipsis;white-space:nowrap }
    .product-line__meta { display:flex;flex-wrap:wrap;gap:3px 9px;margin-top:7px;color:var(--muted);font-size:10px }.product-line__meta b { color:var(--ink) }
    .product-line__amount { min-width:72px;text-align:right }.product-line__amount span,.product-line__amount small { display:block;color:var(--muted);font-size:9px }.product-line__amount strong { display:block;margin-top:2px;font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap }
    .delivery-line,.line-profit { grid-column:1/-1;display:flex;align-items:center;gap:6px;padding-top:9px;border-top:1px solid var(--line);font-size:10px }.delivery-line>span:nth-child(2),.line-profit span { color:var(--muted) }.delivery-line strong,.line-profit strong { margin-left:auto;text-align:right }
    .delivery-line__dot { width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft) }.delivery-line--open .delivery-line__dot { background:var(--warn);box-shadow:0 0 0 3px var(--warn-soft) }
    .line-profit { padding:7px 9px;border:0;border-radius:9px;background:var(--rose-soft);color:var(--rose-dark) }.negative { color:var(--danger)!important }
    .products-empty { padding:36px 18px;text-align:center;color:var(--muted) }.products-empty>span { display:block;font-size:32px;opacity:.55 }.products-empty strong { display:block;margin-top:6px;color:var(--ink-2);font-size:13px }.products-empty p { margin:4px 0 0;font-size:11.5px }
    .detail-grid { margin:0;padding:5px 14px 10px }.detail-grid>div { display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--line) }.detail-grid>div:last-child { border:0 }
    .detail-grid dt { color:var(--muted);font-size:11px }.detail-grid dd { min-width:0;margin:0;color:var(--ink-2);font-size:12px;font-weight:650;overflow-wrap:anywhere;text-align:right }.detail-grid .text-value { white-space:pre-line;line-height:1.5 }.detail-grid__internal { margin-inline:-6px;padding-inline:6px!important;border-radius:9px;background:var(--rose-soft) }
    .timeline { padding:4px 14px 14px }.timeline__event { position:relative;display:grid;grid-template-columns:13px minmax(0,1fr);gap:9px;padding:9px 0 }.timeline__event:not(:last-child)::before { position:absolute;top:22px;bottom:-8px;left:5px;width:1px;background:var(--line);content:'' }
    .timeline__dot { position:relative;z-index:1;width:11px;height:11px;margin-top:3px;border:3px solid var(--surface);border-radius:50%;background:var(--rose);box-shadow:0 0 0 1px var(--rose) }.timeline__event--customer .timeline__dot { background:var(--gold);box-shadow:0 0 0 1px var(--gold) }
    .timeline strong { display:block;font-size:11.5px }.timeline p { margin:2px 0 0;color:var(--muted);font-size:9.5px }.timeline small { display:block;margin-top:4px;color:var(--ink-2);font-size:10.5px;line-height:1.45 }.empty-history { margin:12px 0 0;color:var(--muted);font-size:11.5px }
  `, `
    .totals-card { padding:15px }.totals-card header { margin-bottom:7px }.totals-list { margin:0 }.totals-list>div { display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:8px 0;border-bottom:1px solid var(--line) }.totals-list dt { color:var(--muted);font-size:11px }.totals-list dd { margin:0;font-size:12px;font-weight:680;font-variant-numeric:tabular-nums;white-space:nowrap }
    .totals-list__main { margin-top:4px;padding:12px 0!important;border-top:1px solid var(--line) }.totals-list__main dt { color:var(--ink)!important;font-weight:760 }.totals-list__main dt small { display:block;margin-top:1px;color:var(--muted);font-size:8.5px;font-weight:550 }.totals-list__main dd { font-size:17px!important }
    .totals-list__incl { border-bottom:0!important }.totals-list__incl dt,.totals-list__incl dd { color:var(--ink-2);font-weight:730 }
    .totals-profit { margin:10px 0 12px;padding:10px;border:1px solid var(--rose-line);border-radius:11px;background:var(--rose-soft) }.totals-profit>span { color:var(--rose-dark);font-size:8.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase }.totals-profit>div { display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:3px }.totals-profit b { font-size:11px }.totals-profit strong { color:var(--ok);font-size:14px;font-variant-numeric:tabular-nums }.totals-profit small { display:block;margin-top:3px;color:var(--muted);font-size:9.5px }
    .sales-side { min-width:0 }.load-error { max-width:520px;margin:28px auto!important;padding:34px 20px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);text-align:center;box-shadow:var(--sh-1) }.load-error>span { display:grid;width:46px;height:46px;margin:0 auto 11px;place-items:center;border-radius:14px;background:var(--danger-soft);color:var(--danger);font-size:20px;font-weight:800 }.load-error h1 { font-size:17px }.load-error p { margin:5px 0 15px;color:var(--muted);font-size:12px }.loading-grid { display:grid;gap:12px;margin-top:12px }
    @media(max-width:390px) { .sales-hero { padding:15px }.hero-facts>div { padding:9px 8px }.hero-facts strong { font-size:15px }.hero-facts__total strong { font-size:16px }.product-line { grid-template-columns:46px minmax(0,1fr) }.product-line__photo { width:46px;height:46px }.product-line__amount { grid-column:2;display:flex;align-items:baseline;justify-content:space-between;text-align:left }.product-line__amount span { display:inline }.product-line__amount small { margin-left:auto }.revision-alert { padding:12px } }
    @media(min-width:760px) { .sales-hero { padding:22px }.hero-facts { max-width:700px }.revision-alert { grid-template-columns:auto minmax(0,1fr) auto;align-items:center }.revision-alert .btn { grid-column:auto }.product-line { grid-template-columns:60px minmax(0,1fr) 120px;padding:13px }.product-line__photo { width:60px;height:60px }.detail-grid { display:grid;grid-template-columns:1fr 1fr;gap:0 24px }.detail-grid__wide { grid-column:1/-1 }.loading-grid { grid-template-columns:1fr 1fr } }
    @media(min-width:1000px) { .sales-layout { grid-template-columns:minmax(0,1fr) 310px;align-items:start }.sales-side { position:sticky;top:78px }.sales-main { grid-template-columns:1fr 1fr }.products-card,.history-card { grid-column:1/-1 }.detail-grid { grid-template-columns:1fr }.sales-hero__top { align-items:center }.sales-hero h1 { max-width:700px }.sales-side .btn { min-height:46px } }
  `],
})
export class SalesView {
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);

  readonly id = input<string>('');
  readonly view = signal<SalesOrderView | null>(null);
  readonly customers = signal<Customer[]>([]);
  readonly countries = signal<Country[]>([]);
  readonly revisions = signal<QuoteRevision[]>([]);
  readonly history = signal<QuoteEvent[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly downloading = signal(false);

  readonly customer = computed(() => {
    const customerId = this.view()?.order.customerId;
    return this.customers().find((item) => item.id === customerId) ?? null;
  });

  readonly country = computed(() => {
    const code = this.view()?.order.countryCode;
    return this.countries().find((item) => item.code === code) ?? null;
  });

  readonly pendingRevision = computed(
    () => this.revisions().find((item) => item.status === 'IN_AFWACHTING') ?? null);

  readonly actionLabel = computed(() =>
    this.view()?.order.status === 'CONCEPT' ? 'Bewerken' : 'Beheren');

  constructor() {
    effect(() => {
      const orderId = Number(this.id());
      if (Number.isInteger(orderId) && orderId > 0) void this.load(orderId);
      else {
        this.loading.set(false);
        this.loadError.set('Het ordernummer in de link is ongeldig.');
      }
    });
  }

  private async load(orderId: number): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    this.view.set(null);
    try {
      const [view, customers, countries, revisions, history] = await Promise.all([
        this.sales.order(orderId),
        this.sales.customers(),
        this.sales.countries(),
        this.sales.revisionsFor(orderId).catch(() => [] as QuoteRevision[]),
        this.sales.history(orderId).catch(() => [] as QuoteEvent[]),
      ]);
      this.view.set(view);
      this.customers.set(customers);
      this.countries.set(countries);
      this.revisions.set(revisions);
      this.history.set(history);
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'De offerte kon niet worden geladen'));
    } finally {
      this.loading.set(false);
    }
  }

  retry(): void {
    const orderId = Number(this.id());
    if (Number.isInteger(orderId) && orderId > 0) void this.load(orderId);
  }

  customerName(): string {
    return this.customer()?.company || 'Geen klant';
  }

  countryName(): string {
    return this.country()?.name || this.view()?.order.countryCode || 'Geen leverland';
  }

  paymentTerms(): string {
    return this.view()?.order.paymentTerms || this.customer()?.paymentTerms || '—';
  }

  palletCount(data: SalesOrderView): number {
    return data.priced.totals.palletsManual || data.priced.totals.palletsStrict;
  }

  deliveryOpen(line: PricedLine, data: SalesOrderView): boolean {
    return !line.deliveryWeek && (data.order.deliveryTerms === 'TE_BEPALEN' || line.shortfall > 0);
  }

  deliveryText(line: PricedLine, data: SalesOrderView): string {
    if (line.deliveryWeek) return new WeekNlPipe().transform(line.deliveryWeek, 'short');
    if (line.deliveryExplanation) return line.deliveryExplanation;
    if (data.order.deliveryTerms === 'TE_BEPALEN') return 'Nog te bepalen';
    if (line.shortfall > 0) return `${line.shortfall} stuks tekort`;
    if (line.inStock) return 'Op voorraad';
    return 'Volgens afspraak';
  }

  deliveryState(data: SalesOrderView): string {
    switch (data.order.deliveryTerms) {
      case 'TE_BEPALEN': return 'Nog te bepalen';
      case 'AANGEVULD': return 'Aangevuld';
      default: return 'Volledig';
    }
  }

  freightLabel(data: SalesOrderView): string {
    return data.order.freight === 'TE_BEPALEN'
      ? 'Nog te bepalen'
      : new EurPipe().transform(data.priced.totals.freight, 2);
  }

  freightAmount(data: SalesOrderView): string {
    return data.order.freight === 'TE_BEPALEN'
      ? 'open post'
      : new EurPipe().transform(data.priced.totals.freight, 2);
  }

  vatLabel(data: SalesOrderView): string {
    return data.priced.totals.vatLegalMention
      || `${new PctPipe().transform(data.priced.totals.vatRatePct, 0)} · ${data.priced.totals.vatTreatment.toLowerCase()}`;
  }

  signedMoney(value: number): string {
    const formatted = new EurPipe().transform(Math.abs(value), 0);
    return `${value >= 0 ? '+' : '−'} ${formatted}`;
  }

  label = (status: QuoteStatus) => STATUS_LABEL[status];
  cls = statusClass;

  async downloadPdf(): Promise<void> {
    const data = this.view();
    if (!data || this.downloading()) return;
    this.downloading.set(true);
    try {
      const blob = await this.sales.quotePdf(data.order.id);
      saveBlob(blob, `${data.order.number}.pdf`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'PDF downloaden mislukt'), 'err');
    } finally {
      this.downloading.set(false);
    }
  }
}
