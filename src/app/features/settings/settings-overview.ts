import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ActivityApi } from '../../core/api/activity-api';
import { Auth } from '../../core/api/auth';
import { CatalogApi } from '../../core/api/catalog-api';
import { DeletedItemsApi } from '../../core/api/deleted-items-api';
import { messageOf } from '../../core/api/errors';
import { ActivityEvent, Category, DiscountTier, HsCode } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { StaffContact, StaffContactsApi } from '../../core/api/staff-contacts-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { PushSetup } from '../../core/platform/push';
import { THEMES, Theme } from '../../core/platform/theme';
import { Icon } from '../../shared/icon';
import { CompanyStore } from './company-store';
import {
  bankSummary, contactLine, deviceLines, dutySummary, fiscalSummary, footerSummary, identityLine,
  legalPill, lineDiscountSummary, numberingSummary, shortDateTimeNl, tierSummary, todayCount, trashSummary,
  websiteSyncValue,
} from './company-fields';
import { WebsitePriceStore } from './website-price-store';
import { WebsiteSyncStore } from './website-sync-store';
import { ActivityNames } from '../activity/activity-names';
import { activityEntityText, activitySummaryText } from '../activity/activity-format';

/** One data source of the overview: its value, or why it is missing. A reload keeps the value on screen. */
class Source<T> {
  readonly value = signal<T | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  private run = 0;

  async load(read: () => Promise<T>): Promise<void> {
    const id = ++this.run;
    this.loading.set(true);
    try {
      const value = await read();
      if (id !== this.run) return;
      this.value.set(value);
      this.error.set(null);
    } catch (failure: unknown) {
      if (id !== this.run) return;
      this.error.set(messageOf(failure, 'Niet geladen'));
    } finally {
      if (id === this.run) this.loading.set(false);
    }
  }
}

type Link = { path: string; query: Record<string, string> | null };

/**
 * Instellingen with no ?sectie=: every setting with its current value, so
 * the owner sees the state of things without opening anything. Desk: six
 * cards that stack themselves into columns; phone: the iOS Settings root.
 *
 * Each value loads on its own (nothing waits for the 1.7 s product
 * families), and every time the overview shows again it re-reads them all:
 * the old value stays until the new one lands (B6). Company values and the
 * website price switch come from the same stores the views write.
 */
@Component({
  selector: 'app-settings-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet, RouterLink],
  template: `
    @if (desktop.active()) {
      <div class="set-cols">
        <!-- Bedrijf -->
        <section class="wk-card set-card" aria-labelledby="set-card-company">
          <header class="set-card__head"><span class="set-tile tone-plum"><app-icon name="settings" [size]="16" /></span><h2 id="set-card-company">Bedrijf</h2></header>
          <div class="set-id">
            @if (company(); as profile) {
              <b class="mo-fade">{{ profile.name || 'Geen handelsnaam' }}</b>
              <span class="mo-fade">{{ identity() }}</span>
              @if (contact()) { <span class="mo-fade">{{ contact() }}</span> }
            } @else if (companyStore.error()) {
              <ng-container [ngTemplateOutlet]="failed" [ngTemplateOutletContext]="{ retry: 'company' }" />
            } @else {
              <span class="set-skel set-skel--wide"></span><span class="set-skel"></span>
            }
          </div>
          <a class="set-row" [routerLink]="companyLink.path" [queryParams]="companyLink.query"><span>Bedrijfsgegevens</span><span class="set-row__val"></span><app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" [routerLink]="companyLink.path" [queryParams]="companyLink.query"><span>Bank</span>
            <span class="set-row__val">@if (company(); as p) { <span class="mo-fade">{{ bank() }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: companyStore.error(), retry: 'company' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" [routerLink]="companyLink.path" [queryParams]="companyLink.query"><span>Nummering</span>
            <span class="set-row__val">@if (company(); as p) { <span class="mo-fade">{{ numbering() }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: companyStore.error(), retry: 'company' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" [routerLink]="companyLink.path" [queryParams]="companyLink.query"><span>Op elk document</span>
            <span class="set-row__val">@if (company(); as p) { <span class="mo-fade">{{ footer() }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: companyStore.error(), retry: 'company' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" [routerLink]="companyLink.path" [queryParams]="companyLink.query"><span>Contactpersonen</span>
            <span class="set-row__val">@if (staff.value(); as accounts) { <span class="mo-fade">{{ staffNames(accounts) }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: staff.error(), retry: 'staff' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
        </section>

        <!-- Voorwaarden & privacy -->
        <section class="wk-card set-card" aria-labelledby="set-card-legal">
          <header class="set-card__head"><span class="set-tile tone-plum"><app-icon name="book" [size]="16" /></span><h2 id="set-card-legal">Voorwaarden &amp; privacy</h2></header>
          <a class="set-row" [routerLink]="legalLink().path" [queryParams]="legalLink().query"><span>Algemene voorwaarden</span>
            <span class="set-row__val">@if (termsPill(); as pill) { <span class="wk-pill mo-fade" [class.tone-accent]="pill.custom">{{ pill.label }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: companyStore.error(), retry: 'company' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" [routerLink]="legalLink().path" [queryParams]="legalLink().query"><span>Privacyverklaring</span>
            <span class="set-row__val">@if (privacyPill(); as pill) { <span class="wk-pill mo-fade" [class.tone-accent]="pill.custom">{{ pill.label }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: companyStore.error(), retry: 'company' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" routerLink="/voorwaarden"><span>Bekijk zoals klanten</span><span class="set-row__val">NL · EN</span><app-icon name="chevron-right" [size]="14" /></a>
        </section>

        <!-- Verkoop & inkoop -->
        <section class="wk-card set-card" aria-labelledby="set-card-sales">
          <header class="set-card__head"><span class="set-tile tone-amber"><app-icon name="tag" [size]="16" /></span><h2 id="set-card-sales">Verkoop &amp; inkoop</h2></header>
          <a class="set-row" routerLink="/settings" [queryParams]="{ sectie: 'discounts' }"><span>Orderkorting</span>
            <span class="set-row__val">@if (orderTiers.value(); as tiers) { <span class="mo-fade">{{ tierText(tiers) }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: orderTiers.error(), retry: 'tiers' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" routerLink="/settings" [queryParams]="{ sectie: 'discounts' }"><span>Lijnkorting</span>
            <span class="set-row__val">@if (lineTiers.value(); as tiers) { <span class="mo-fade">{{ lineText(tiers) }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: lineTiers.error(), retry: 'tiers' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" [routerLink]="dutiesLink().path" [queryParams]="dutiesLink().query"><span>Douane</span>
            <span class="set-row__val">@if (duties.value(); as codes) { <span class="mo-fade">{{ dutyText(codes) }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: duties.error(), retry: 'duties' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" [routerLink]="companyLink.path" [queryParams]="companyLink.query"><span>Btw en douane</span>
            <span class="set-row__val">@if (company(); as p) { <span class="mo-fade">{{ fiscal() }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: companyStore.error(), retry: 'company' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
        </section>

        <!-- Website & catalogus -->
        <section class="wk-card set-card" aria-labelledby="set-card-website">
          <header class="set-card__head"><span class="set-tile tone-blue"><app-icon name="globe" [size]="16" /></span><h2 id="set-card-website">Website &amp; catalogus</h2></header>
          <a class="set-row" routerLink="/settings" [queryParams]="{ sectie: 'website' }"><span>Prijzen op de website</span>
            <span class="set-row__val">@if (prices.settings(); as current) { <span class="wk-pill mo-fade" [class.tone-warn]="current.pricesVisible">{{ current.pricesVisible ? 'Zichtbaar' : 'Verborgen' }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: prices.error(), retry: 'prices' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" routerLink="/settings" [queryParams]="{ sectie: 'website' }"><span>Website</span>
            <span class="set-row__val">@if (syncText()) { <span class="mo-fade">{{ syncText() }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: sync.loadError(), retry: 'sync' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" routerLink="/categories"><span>Categorieën</span>
            <span class="set-row__val">@if (categories.value(); as list) { <span class="mo-fade">{{ list.length }} · foto’s</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: categories.error(), retry: 'categories' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" routerLink="/website/categories"><span>Teksten &amp; talen</span><span class="set-row__val">menunamen per taal</span><app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" routerLink="/settings" [queryParams]="{ sectie: 'catalog-data' }"><span>Catalogusdata</span><span class="set-row__val">Excel en foto’s (ZIP)</span><app-icon name="chevron-right" [size]="14" /></a>
        </section>

        <!-- Beheer -->
        <section class="wk-card set-card" aria-labelledby="set-card-admin">
          <header class="set-card__head"><span class="set-tile tone-grey"><app-icon name="trash" [size]="16" /></span><h2 id="set-card-admin">Beheer</h2></header>
          <a class="set-row" routerLink="/settings/deleted-items"><span>Verwijderde items</span>
            <span class="set-row__val">@if (trash.value(); as bin) { <span class="mo-fade">{{ trashText(bin.items.length, bin.retentionDays) }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: trash.error(), retry: 'trash' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" routerLink="/activity"><span>Logboek</span>
            <span class="set-row__val">@if (activity.value(); as page) { <span class="mo-fade">{{ todayText() }}</span> } @else { <ng-container [ngTemplateOutlet]="pending" [ngTemplateOutletContext]="{ error: activity.error(), retry: 'activity' }" /> }</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          @for (event of newest(); track event.id) {
            <a class="set-mini mo-fade" routerLink="/activity">
              <time [attr.datetime]="event.at">{{ timeOf(event.at) }}</time>
              <span [attr.title]="miniText(event)">{{ miniText(event) }}</span>
              <small>{{ event.actor?.displayName || 'Systeem' }}</small>
            </a>
          }
        </section>

        <!-- Dit toestel -->
        <section class="wk-card set-card" aria-labelledby="set-card-device">
          <header class="set-card__head"><span class="set-tile tone-green"><app-icon name="bell" [size]="16" /></span><h2 id="set-card-device">Dit toestel</h2></header>
          <a class="set-row" routerLink="/settings" [queryParams]="{ sectie: 'appearance' }"><span>Weergave</span>
            <span class="set-row__val"><i class="set-swatch" [style.background]="themeOption().swatch" aria-hidden="true"></i>{{ themeOption().label }}</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          <a class="set-row" routerLink="/settings" [queryParams]="{ sectie: 'notifications' }"><span>Meldingen</span>
            <span class="set-row__val">{{ pushText() }}</span>
            <app-icon name="chevron-right" [size]="14" /></a>
          @if (devices.value(); as list) {
            @for (device of list; track device.id) {
              <div class="set-device mo-fade"><b>{{ deviceText(device).title }}</b><span>{{ deviceText(device).sub }}</span></div>
            }
          } @else if (devices.error()) {
            <div class="set-device"><ng-container [ngTemplateOutlet]="failed" [ngTemplateOutletContext]="{ retry: 'devices' }" /></div>
          }
        </section>
      </div>
    } @else {
      <!-- Phone: the iOS Settings root -->
      <div class="set-phone">
        <div class="ios-group set-phone__id">
          <a class="ios-cell ios-cell--tall" [routerLink]="companyLink.path" [queryParams]="companyLink.query" [info]="push">
            <span class="ios-cell__lead"><span class="set-mark" aria-hidden="true">{{ initial() }}</span></span>
            <span class="ios-cell__body">
              @if (company(); as profile) {
                <span class="ios-cell__title ios-cell__title--strong mo-fade">{{ profile.name || 'Geen handelsnaam' }}</span>
                <span class="ios-cell__sub mo-fade">{{ phoneIdentity() }}</span>
              } @else if (companyStore.error()) {
                <span class="ios-cell__title ios-cell__title--strong">Bedrijfsgegevens</span>
                <span class="ios-cell__sub set-fail">Niet geladen</span>
              } @else {
                <span class="set-skel set-skel--wide"></span>
              }
              <span class="ios-cell__sub">Bedrijfsgegevens, bank, nummering</span>
            </span>
            <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
          </a>
        </div>

        <section class="ios-section">
          <div class="ios-section__head"><h2>Bedrijf</h2></div>
          <div class="ios-group ios-group--icons">
            <a class="ios-cell" [routerLink]="legalLink().path" [queryParams]="legalLink().query" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile tone-plum" aria-hidden="true"><app-icon name="book" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Voorwaarden &amp; privacy</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ legalShort() }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
            <a class="ios-cell" routerLink="/settings/deleted-items" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile tone-grey" aria-hidden="true"><app-icon name="trash" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Verwijderde items</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ trash.value()?.items?.length ?? '' }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
            <a class="ios-cell" routerLink="/activity" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile tone-blue" aria-hidden="true"><app-icon name="activity" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Logboek</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ activity.value() ? todayText() : '' }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
          </div>
        </section>

        <section class="ios-section">
          <div class="ios-section__head"><h2>Verkoop &amp; inkoop</h2></div>
          <div class="ios-group ios-group--icons">
            <a class="ios-cell" routerLink="/settings" [queryParams]="{ sectie: 'discounts' }" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile tone-amber" aria-hidden="true"><app-icon name="tag" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Kortingen</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ orderTiers.value() ? countText(orderTiers.value()!.length, 'staffel', 'staffels') : '' }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
            <a class="ios-cell" [routerLink]="dutiesLink().path" [queryParams]="dutiesLink().query" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile tone-amber" aria-hidden="true"><app-icon name="truck" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Douane</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ duties.value() ? countText(duties.value()!.length, 'tarief', 'tarieven') : '' }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
          </div>
        </section>

        <section class="ios-section">
          <div class="ios-section__head"><h2>Website &amp; catalogus</h2></div>
          <div class="ios-group ios-group--icons">
            <a class="ios-cell" routerLink="/settings" [queryParams]="{ sectie: 'website' }" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile tone-blue" aria-hidden="true"><app-icon name="globe" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Prijzen op de website</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value" [class.set-warn]="prices.settings()?.pricesVisible">{{ prices.settings() ? (prices.settings()!.pricesVisible ? 'Zichtbaar' : 'Verborgen') : '' }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
            <a class="ios-cell" routerLink="/categories" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile tone-green" aria-hidden="true"><app-icon name="grid" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Categorieën</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ categories.value()?.length ?? '' }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
            <a class="ios-cell" routerLink="/settings" [queryParams]="{ sectie: 'catalog-data' }" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile tone-green" aria-hidden="true"><app-icon name="download" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Catalogusdata</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">Excel, ZIP</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
          </div>
        </section>

        <section class="ios-section">
          <div class="ios-section__head"><h2>Dit toestel</h2></div>
          <div class="ios-group ios-group--icons">
            <a class="ios-cell" routerLink="/settings" [queryParams]="{ sectie: 'notifications' }" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile tone-grey" aria-hidden="true"><app-icon name="bell" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Meldingen</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ pushShort() }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
            <a class="ios-cell" routerLink="/settings" [queryParams]="{ sectie: 'appearance' }" [info]="push">
              <span class="ios-cell__lead"><span class="ios-tile" [style.background]="themeOption().swatch" aria-hidden="true"><app-icon name="eye" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">Weergave</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ themeOption().label }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
          </div>
          @if (auth.username(); as name) { <p class="ios-section__foot">Aangemeld als {{ name }}</p> }
        </section>
      </div>
    }

    <ng-template #pending let-error="error" let-retry="retry">
      @if (error) {
        <span class="set-fail">Niet geladen
          <button class="set-retry" type="button" aria-label="Opnieuw laden" (click)="$event.preventDefault(); $event.stopPropagation(); retryOne(retry)"><app-icon name="refresh" [size]="13" /></button>
        </span>
      } @else {
        <span class="set-skel" aria-label="Laden"></span>
      }
    </ng-template>
    <ng-template #failed let-retry="retry">
      <span class="set-fail">Niet geladen
        <button class="set-retry" type="button" aria-label="Opnieuw laden" (click)="retryOne(retry)"><app-icon name="refresh" [size]="13" /></button>
      </span>
    </ng-template>
  `,
  styles: `
    :host { display: block; }
    :host([hidden]) { display: none !important; }
    .set-cols { columns: 3 340px; column-gap: 16px; }
    .set-card { display: block; margin: 0 0 16px; break-inside: avoid; overflow: hidden; }
    .set-card + .set-card { margin-top: 0; }
    .set-card__head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
    .set-card__head h2 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
    .set-tile { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--tone, var(--muted-2)); color: #fff; }
    .set-id { display: grid; gap: 2px; padding: 0 16px 12px; }
    .set-id b { font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
    .set-id span { color: var(--muted); font-size: 12.5px; line-height: 1.55; overflow-wrap: anywhere; }
    .set-row { display: grid; grid-template-columns: auto minmax(0, 1fr) 14px; align-items: center; gap: 12px; min-height: 40px;
      padding: 6px 12px 6px 16px; border-top: 1px solid var(--line); color: var(--ink); font-size: 13.5px; font-weight: 600;
      text-decoration: none; transition: background var(--dur-1, 120ms); }
    .set-row:hover { background: var(--surface-2); }
    .set-row:focus-visible { outline: 2px solid var(--rose); outline-offset: -2px; }
    .set-row > app-icon { color: var(--muted-2); }
    .set-row__val { justify-self: end; min-width: 0; color: var(--muted); font-size: 13px; font-weight: 500; line-height: 1.4;
      text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
    .set-swatch { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 50%; vertical-align: -1px; }
    .set-skel { display: inline-block; width: 64px; height: 10px; border-radius: 5px; background: linear-gradient(90deg, #efe9e4, #f6f2ee, #efe9e4); vertical-align: middle; }
    .set-skel--wide { width: 160px; height: 14px; margin-bottom: 4px; }
    .set-fail { display: inline-flex; align-items: center; gap: 4px; color: var(--danger); font-size: 13px; font-weight: 600; }
    .set-retry { display: inline-grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--danger); cursor: pointer; }
    .set-retry:hover { background: var(--danger-soft); }
    .set-mini { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 6px 16px 6px 28px;
      border-top: 1px dashed var(--line); color: var(--ink-2); font-size: 12.5px; text-decoration: none; }
    .set-mini:hover { background: var(--surface-2); }
    .set-mini time { color: var(--muted); font: 500 12px var(--mono, ui-monospace, monospace); }
    .set-mini span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .set-mini small { color: var(--muted); font-size: 12px; }
    .set-device { display: grid; gap: 1px; padding: 7px 16px 7px 28px; border-top: 1px dashed var(--line); font-size: 12.5px; }
    .set-device b { color: var(--ink-2); font-weight: 600; overflow-wrap: anywhere; }
    .set-device span { color: var(--muted); }
    .set-phone { --ios-inset: 0px; }
    .set-phone__id { margin-bottom: 22px; }
    .set-mark { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; background: var(--rose); color: #fff; font-size: 22px; font-weight: 800; }
    .set-phone .ios-cell--tall .ios-cell__sub { white-space: normal; }
    .set-warn { color: var(--warn); font-weight: 600; }
  `,
})
export class SettingsOverview {
  readonly desktop = inject(DesktopViewport);
  readonly auth = inject(Auth);
  readonly companyStore = inject(CompanyStore);
  readonly prices = inject(WebsitePriceStore);
  readonly sync = inject(WebsiteSyncStore);
  private readonly sales = inject(SalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly deleted = inject(DeletedItemsApi);
  private readonly activityApi = inject(ActivityApi);
  private readonly staffApi = inject(StaffContactsApi);
  private readonly pushSetup = inject(PushSetup);
  private readonly theme = inject(Theme);
  private readonly document = inject(DOCUMENT);
  /** Container and supplier names for the Logboek mini rows (shared with the Logboek, loaded after the rows show). */
  private readonly names = inject(ActivityNames);

  /** True while the overview is the open view: each time it turns true, every value is read again. */
  readonly active = input(true);
  /** Douane lives at /douane once the purchasing screen exists. */
  readonly douaneRoute = input(false);
  /** The Voorwaarden & privacy view exists (else the texts sit in Bedrijfsgegevens). */
  readonly legalView = input(false);

  /** Phone rows push (a query-only navigation would otherwise not animate). */
  readonly push = { nav: 'push' };
  readonly companyLink: Link = { path: '/settings', query: { sectie: 'company' } };
  readonly dutiesLink = computed<Link>(() => this.douaneRoute()
    ? { path: '/douane', query: null }
    : { path: '/settings', query: { sectie: 'duties' } });
  readonly legalLink = computed<Link>(() => ({ path: '/settings', query: { sectie: this.legalView() ? 'legal' : 'company' } }));

  readonly orderTiers = new Source<DiscountTier[]>();
  readonly lineTiers = new Source<DiscountTier[]>();
  readonly duties = new Source<HsCode[]>();
  readonly categories = new Source<Category[]>();
  readonly trash = new Source<{ items: unknown[]; retentionDays: number }>();
  readonly devices = new Source<{ id: number; device: string; since: string | null; lastStatus: number | null; lastAt: string | null }[]>();
  readonly activity = new Source<{ items: ActivityEvent[]; nextBefore: number | null }>();
  readonly staff = new Source<StaffContact[]>();

  readonly company = this.companyStore.saved;
  readonly identity = computed(() => { const p = this.company(); return p ? identityLine(p) : ''; });
  readonly contact = computed(() => { const p = this.company(); return p ? contactLine(p) : ''; });
  readonly bank = computed(() => { const p = this.company(); return p ? bankSummary(p) : ''; });
  readonly numbering = computed(() => { const p = this.company(); return p ? numberingSummary(p) : ''; });
  readonly footer = computed(() => { const p = this.company(); return p ? footerSummary(p) : ''; });
  readonly fiscal = computed(() => { const p = this.company(); return p ? fiscalSummary(p) : ''; });
  readonly termsPill = computed(() => { const p = this.company(); return p ? legalPill(p.termsAndConditions, p.termsAndConditionsEn) : null; });
  readonly privacyPill = computed(() => { const p = this.company(); return p ? legalPill(p.privacyPolicy, p.privacyPolicyEn) : null; });
  readonly legalShort = computed(() => {
    const terms = this.termsPill();
    const privacy = this.privacyPill();
    if (!terms || !privacy) return '';
    return terms.custom || privacy.custom ? 'Eigen tekst' : 'Ingebouwd';
  });
  readonly initial = computed(() => (this.company()?.name ?? '').trim().charAt(0).toUpperCase() || 'E');
  readonly phoneIdentity = computed(() => {
    const p = this.company();
    return p ? [p.vatNumber?.trim(), p.city?.trim()].filter(Boolean).join(' · ') : '';
  });
  readonly syncText = computed(() => websiteSyncValue(this.sync.status()));
  readonly newest = computed(() => (this.activity.value()?.items ?? []).slice(0, 3));
  readonly todayText = computed(() => {
    const page = this.activity.value();
    return page ? todayCount(page.items, page.nextBefore !== null) : '';
  });
  readonly themeOption = computed(() => THEMES.find((option) => option.key === this.theme.current()) ?? THEMES[0]);
  readonly pushText = computed(() => !this.pushSetup.supported()
    ? 'Niet ondersteund'
    : this.pushSetup.enabled() ? 'Aan op dit toestel' : 'Uit op dit toestel');
  readonly pushShort = computed(() => !this.pushSetup.supported() ? '—' : this.pushSetup.enabled() ? 'Aan' : 'Uit');

  constructor() {
    this.sync.attach();
    /* B6: every time the overview shows, read everything again. */
    effect(() => {
      if (this.active()) untracked(() => this.refresh());
    });
    const onVisible = () => { if (this.document.visibilityState === 'visible' && this.active()) this.refresh(); };
    this.document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisible);
      this.sync.detach();
    });
  }

  /** All sources in parallel; none waits for another, the shown values stay until the new ones land. */
  refresh(): void {
    for (const key of ['company', 'tiers', 'duties', 'prices', 'sync', 'categories', 'trash', 'devices', 'activity', 'staff']) {
      this.retryOne(key);
    }
  }

  retryOne(key: string): void {
    switch (key) {
      case 'company': void this.companyStore.load(true); break;
      case 'tiers':
        void this.orderTiers.load(() => this.sales.tiers('ORDER'));
        void this.lineTiers.load(() => this.sales.tiers('LINE'));
        break;
      case 'duties': void this.duties.load(() => this.catalog.hsCodes()); break;
      case 'prices': void this.prices.load(); break;
      case 'sync': this.sync.refresh(); break;
      case 'categories': void this.categories.load(() => this.catalog.categories()); break;
      case 'trash': void this.trash.load(() => this.deleted.list()); break;
      case 'devices': void this.devices.load(() => this.pushSetup.devices()); break;
      case 'activity': void this.activity.load(() => this.activityApi.list({ limit: 50 })).then(() => void this.names.load()); break;
      case 'staff': void this.staff.load(() => this.staffApi.accounts()); break;
    }
  }

  tierText(tiers: DiscountTier[]): string { return tierSummary(tiers); }
  lineText(tiers: DiscountTier[]): string { return lineDiscountSummary(tiers); }
  dutyText(codes: HsCode[]): string { return dutySummary(codes); }
  trashText(count: number, days: number): string { return trashSummary(count, days > 0 ? days : null); }
  deviceText(device: { device: string; since: string | null; lastStatus: number | null; lastAt: string | null }) { return deviceLines(device); }
  staffNames(accounts: StaffContact[]): string { return accounts.map((account) => account.displayName).join(', ') || 'Geen accounts'; }
  countText(count: number, one: string, many: string): string { return `${count} ${count === 1 ? one : many}`; }

  timeOf(at: string): string {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    if (date.toDateString() !== today.toDateString()) return shortDateTimeNl(at, today).split(',')[0];
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  /** "Inkooporder bijgewerkt · 12-Set-Roseamor-Jerry": the Logboek's own words and names. */
  miniText(event: ActivityEvent): string {
    return [activitySummaryText(event.summary), activityEntityText(event, this.names.context())].filter(Boolean).join(' · ');
  }
}
