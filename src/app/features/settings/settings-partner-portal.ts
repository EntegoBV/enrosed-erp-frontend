import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type { StockLocation } from '../../core/api/models';
import { PARTNER_PASSWORD_HINT, PARTNER_PASSWORD_MIN } from '../../core/api/partner-password';
import { PartnerPortalAdminRow, PartnerSalesApi, isMissingEndpoint } from '../../core/api/partner-sales-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import {
  DraftErrors, DraftField, PartnerPortalDraft, changedFields, draftErrors, draftOf, loginChanged, loginRequest, pctText,
  settingsChanged, settingsRequest,
} from './partner-portal-fields';
import { SettingsEditor, dirtyStatusText } from './settings-editor';

const WHEN = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Instellingen › Partnerportaal: per partner customer the login for the
 * portal (gebruikersnaam, naam, wachtwoord, actief), the two cost percents
 * of a sale on the clock (Frans sees them; each melding keeps the ones of its
 * day), the stock location his tiles show, and a warning for settlements
 * whose pieces still lie in stock. One save model with the page's toolbar
 * (Opslaan, ⌘S, the leave question), like Bedrijf and Kortingen. The portal
 * address to copy sits once at the end.
 */
@Component({
  selector: 'app-settings-partner-portal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, RouterLink, Skeleton],
  template: `
    @if (missing()) {
      <div [class.wk-card]="desk.active()" [class.spp-empty]="true">
        <p>De server kent het partnerportaal nog niet.</p>
      </div>
    } @else if (error() && !loaded()) {
      <div [class.wk-card]="desk.active()"><app-load-error title="Partnerportaal kon niet worden geladen" [message]="error()" [busy]="loading()" (retry)="load()" /></div>
    } @else if (!loaded()) {
      @if (desk.active()) { <div class="wk-card spp-skel"><app-skeleton kind="lines" [rows]="6" /></div> }
      @else { <app-skeleton kind="group" [rows]="4" /><app-skeleton kind="group" [rows]="3" /> }
    } @else if (!rows().length) {
      <div [class.wk-card]="desk.active()" class="spp-empty">
        <p>Nog geen partnerklant. Zet <b>Partnercontainers</b> aan bij een klant; daarna maak je hier zijn login.</p>
        <a class="wk-link" routerLink="/customers">Naar Klanten ›</a>
      </div>
    } @else if (desk.active()) {
      @if (dirty()) { <p class="spp-status" role="status">{{ statusText() }}</p> }
      @for (row of rows(); track row.customerId) {
        @let d = draftFor(row.customerId);
        @let e = errorsFor(row.customerId);
        <section class="wk-card spp-card" [id]="'spp-' + row.customerId" [attr.aria-label]="row.customerName">
          <header class="spp-head">
            <h2>{{ row.customerName }}</h2>
            <span class="wk-pill" [class]="pillOf(row).tone">{{ pillOf(row).label }}</span>
            <a class="wk-link spp-head__link" routerLink="/customers" [queryParams]="{ q: row.customerName }">Klant ›</a>
          </header>
          @if (row.unshippedSettlements.length) {
            <div class="wk-banner wk-banner--warn wk-banner--inset spp-banner" role="note">
              <app-icon name="alert" [size]="16" />
              <span class="wk-banner__text"><b>{{ unshippedText(row) }}</b>: de stuks staan nog op voorraad. Boek ze af voor {{ personOf(row) }} begint.
                @for (doc of row.unshippedSettlements; track doc.id) { <a class="wk-link" [routerLink]="['/sales', doc.id]">{{ doc.number || 'Afrekening' }}</a>@if (!$last) {, } }</span>
            </div>
          }
          @if (!row.partner) {
            <p class="spp-note">Geen partner meer: zet Partnercontainers weer aan bij de klant, of zet de login uit.</p>
          }
          @if (serverError(row.customerId); as message) { <p class="spp-err spp-err--block" role="alert">{{ message }}</p> }
          <div class="spp-cols" [class.spp-cols--one]="!row.partner">
            <div class="spp-block">
              <h3>Aanmelden</h3>
              <div class="spp-field" [class.is-dirty]="changed(row, 'username')">
                <label [for]="'spp-user-' + row.customerId">Gebruikersnaam</label>
                <input class="spp-input mono" [id]="'spp-user-' + row.customerId" type="text" maxlength="64" placeholder="bv. verhoeven"
                       autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off"
                       [value]="d.username" (input)="set(row, 'username', $any($event.target).value)" (blur)="tidyUsername(row)" />
                @if (e.username; as message) { <p class="spp-err" role="alert">{{ message }}</p> }
              </div>
              <div class="spp-field" [class.is-dirty]="changed(row, 'displayName')">
                <label [for]="'spp-name-' + row.customerId">Naam</label>
                <input class="spp-input" [id]="'spp-name-' + row.customerId" type="text" maxlength="100" placeholder="bv. Frans" autocomplete="off"
                       [value]="d.displayName" (input)="set(row, 'displayName', $any($event.target).value)" />
                @if (e.displayName; as message) { <p class="spp-err" role="alert">{{ message }}</p> } @else { <p class="spp-hint">Zo staat hij in het portaal en in het logboek.</p> }
              </div>
              <div class="spp-field" [class.is-dirty]="changed(row, 'password')">
                <label [for]="'spp-pw-' + row.customerId">Wachtwoord</label>
                @if (passwordShown(row)) {
                  <span class="spp-pw">
                    <input class="spp-input" [id]="'spp-pw-' + row.customerId" [type]="reveal().has(row.customerId) ? 'text' : 'password'"
                           maxlength="72" autocomplete="new-password" autocapitalize="none" autocorrect="off" spellcheck="false"
                           [attr.placeholder]="'minstens ' + passwordMin + ' tekens'" [value]="d.password"
                           (input)="set(row, 'password', $any($event.target).value)" />
                    <button class="wk-btn wk-btn--sm" type="button" (click)="toggleReveal(row)">{{ reveal().has(row.customerId) ? 'Verberg' : 'Toon' }}</button>
                    @if (row.login) { <button class="wk-btn wk-btn--sm" type="button" (click)="closePassword(row)">Annuleren</button> }
                  </span>
                  @if (e.password; as message) { <p class="spp-err" role="alert">{{ message }}</p> } @else { <p class="spp-hint">{{ passwordHint }}</p> }
                } @else {
                  <span class="spp-pw"><span class="spp-value">{{ passwordLine(row) }}</span>
                    <button class="wk-btn wk-btn--sm" type="button" (click)="openPassword(row)">Wijzigen</button></span>
                }
              </div>
              <label class="spp-switch" [class.is-dirty]="changed(row, 'active')">
                <span><b>Actief</b><small>{{ d.active ? personOf(row, true) + ' kan zich aanmelden' : 'Aanmelden kan niet; open sessies stoppen' }}</small></span>
                <input class="ios-switch" type="checkbox" role="switch" [checked]="d.active" (change)="set(row, 'active', $any($event.target).checked)" />
              </label>
              @if (row.login) { <p class="spp-meta">Laatst aangemeld: {{ when(row.login.lastLoginAt) || 'nog niet' }}</p> }
            </div>

            @if (row.partner) {
              <div class="spp-block">
                <h3>Kosten op de veiling</h3>
                <div class="spp-field" [class.is-dirty]="changed(row, 'commission')">
                  <label [for]="'spp-com-' + row.customerId">Veilingcommissie</label>
                  <span class="spp-pct"><input class="spp-input spp-input--num" [id]="'spp-com-' + row.customerId" type="text" inputmode="decimal" autocomplete="off"
                         [attr.placeholder]="'standaard ' + defaultText(row.settings.defaultAuctionCommissionPct)" [value]="d.commission"
                         (input)="set(row, 'commission', $any($event.target).value)" /><i>%</i></span>
                  @if (e.commission; as message) { <p class="spp-err" role="alert">{{ message }}</p> }
                </div>
                <div class="spp-field" [class.is-dirty]="changed(row, 'transport')">
                  <label [for]="'spp-tr-' + row.customerId">Transport</label>
                  <span class="spp-pct"><input class="spp-input spp-input--num" [id]="'spp-tr-' + row.customerId" type="text" inputmode="decimal" autocomplete="off"
                         [attr.placeholder]="'standaard ' + defaultText(row.settings.defaultAuctionTransportPct)" [value]="d.transport"
                         (input)="set(row, 'transport', $any($event.target).value)" /><i>%</i></span>
                  @if (e.transport; as message) { <p class="spp-err" role="alert">{{ message }}</p> }
                </div>
                <p class="spp-hint spp-hint--block">{{ personOf(row, true) }} ziet deze percentages. Elke melding houdt die van zijn dag; directe verkoop heeft geen standaardkost.</p>
                <h3>Voorraad</h3>
                <div class="spp-field" [class.is-dirty]="changed(row, 'locationId')">
                  <label [for]="'spp-loc-' + row.customerId">Voorraadlocatie</label>
                  <select class="spp-input" [id]="'spp-loc-' + row.customerId" (change)="setLocation(row, $any($event.target).value)">
                    <option value="" [selected]="d.locationId == null">{{ mainName() }} (standaard)</option>
                    @for (location of locationChoices(); track location.id) {
                      <option [value]="location.id" [selected]="d.locationId === location.id">{{ location.name }}</option>
                    }
                  </select>
                  <p class="spp-hint">{{ personOf(row, true) }} ziet en meldt de voorraad van deze locatie.</p>
                </div>
              </div>
            }
          </div>
        </section>
      }
      <section class="wk-card spp-card spp-address" aria-label="Adres van het portaal">
        <div class="spp-address__main">
          <span class="spp-address__label">Adres van het portaal</span>
          <code class="spp-address__url">{{ address }}</code>
          <span class="spp-hint">Test in een privévenster: één browser houdt maar één aanmelding.</span>
        </div>
        <button class="wk-btn wk-btn--sm" type="button" (click)="copyAddress()"><app-icon name="copy" [size]="14" />Kopiëren</button>
      </section>
    } @else {
      <!-- Phone: inset groups per partner, label left and value right -->
      <div class="spp-phone">
        @if (dirty()) {
          <div class="ios-banner ios-banner--info" role="status"><span>{{ statusText() }}</span>
            <button class="spp-textbtn" type="button" (click)="revert()">Wissen</button></div>
        }
        @for (row of rows(); track row.customerId) {
          @let d = draftFor(row.customerId);
          @let e = errorsFor(row.customerId);
          <section class="ios-section" [id]="'spp-' + row.customerId">
            <div class="ios-section__head"><h2>{{ row.customerName }}</h2></div>
            @if (row.unshippedSettlements.length) {
              <div class="ios-banner" role="note"><span><b>{{ unshippedText(row) }}</b>: de stuks staan nog op voorraad.
                @for (doc of row.unshippedSettlements; track doc.id) { <a class="spp-plink" [routerLink]="['/sales', doc.id]">{{ doc.number || 'Afrekening' }}</a>@if (!$last) {, } }</span></div>
            }
            @if (serverError(row.customerId); as message) { <div class="ios-banner ios-banner--danger" role="alert"><span>{{ message }}</span></div> }
            <div class="ios-group">
              <label class="spp-cell" [class.is-dirty]="changed(row, 'username')">
                <span>Gebruikersnaam</span>
                <input class="mono" type="text" maxlength="64" placeholder="verhoeven" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off"
                       [value]="d.username" (input)="set(row, 'username', $any($event.target).value)" (blur)="tidyUsername(row)" />
                @if (e.username; as message) { <small class="spp-sub spp-sub--err" role="alert">{{ message }}</small> }
              </label>
              <label class="spp-cell" [class.is-dirty]="changed(row, 'displayName')">
                <span>Naam</span>
                <input type="text" maxlength="100" placeholder="Frans" autocomplete="off" [value]="d.displayName" (input)="set(row, 'displayName', $any($event.target).value)" />
                @if (e.displayName; as message) { <small class="spp-sub spp-sub--err" role="alert">{{ message }}</small> }
              </label>
              @if (passwordShown(row)) {
                <label class="spp-cell spp-cell--stack" [class.is-dirty]="changed(row, 'password')">
                  <span>{{ row.login ? 'Nieuw wachtwoord' : 'Wachtwoord' }}</span>
                  <span class="spp-pwrow">
                    <input [type]="reveal().has(row.customerId) ? 'text' : 'password'" maxlength="72" autocomplete="new-password" autocapitalize="none"
                           autocorrect="off" spellcheck="false" [attr.placeholder]="'minstens ' + passwordMin + ' tekens'" [value]="d.password"
                           (input)="set(row, 'password', $any($event.target).value)" />
                    <button class="spp-textbtn" type="button" (click)="$event.preventDefault(); toggleReveal(row)">{{ reveal().has(row.customerId) ? 'Verberg' : 'Toon' }}</button>
                  </span>
                  @if (e.password; as message) { <small class="spp-sub spp-sub--err" role="alert">{{ message }}</small> }
                  @else { <small class="spp-sub">{{ passwordHint }}</small> }
                </label>
              } @else {
                <button class="ios-cell spp-tap" type="button" (click)="openPassword(row)">
                  <span class="ios-cell__body"><span class="ios-cell__title">Wachtwoord</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value">{{ passwordLine(row) }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
              <label class="ios-cell spp-tap" [class.is-dirty]="changed(row, 'active')">
                <span class="ios-cell__body"><span class="ios-cell__title">Actief</span></span>
                <input class="ios-switch" type="checkbox" role="switch" [checked]="d.active" (change)="set(row, 'active', $any($event.target).checked)" />
              </label>
              @if (row.login) {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Laatst aangemeld</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value">{{ when(row.login.lastLoginAt) || 'nog niet' }}</span></span></div>
              }
            </div>
            @if (!row.partner) { <p class="ios-section__foot">Geen partner meer: zet Partnercontainers weer aan bij de klant, of zet de login uit.</p> }
          </section>
          @if (row.partner) {
            <section class="ios-section">
              <div class="ios-section__head"><h2>Kosten op de veiling</h2></div>
              <div class="ios-group">
                <label class="spp-cell" [class.is-dirty]="changed(row, 'commission')">
                  <span>Veilingcommissie</span>
                  <span class="spp-pct"><input type="text" inputmode="decimal" autocomplete="off" [attr.placeholder]="defaultText(row.settings.defaultAuctionCommissionPct)"
                         [value]="d.commission" (input)="set(row, 'commission', $any($event.target).value)" /><i>%</i></span>
                  @if (e.commission; as message) { <small class="spp-sub spp-sub--err" role="alert">{{ message }}</small> }
                </label>
                <label class="spp-cell" [class.is-dirty]="changed(row, 'transport')">
                  <span>Transport</span>
                  <span class="spp-pct"><input type="text" inputmode="decimal" autocomplete="off" [attr.placeholder]="defaultText(row.settings.defaultAuctionTransportPct)"
                         [value]="d.transport" (input)="set(row, 'transport', $any($event.target).value)" /><i>%</i></span>
                  @if (e.transport; as message) { <small class="spp-sub spp-sub--err" role="alert">{{ message }}</small> }
                </label>
                <label class="spp-cell" [class.is-dirty]="changed(row, 'locationId')">
                  <span>Voorraad</span>
                  <select (change)="setLocation(row, $any($event.target).value)">
                    <option value="" [selected]="d.locationId == null">{{ mainName() }}</option>
                    @for (location of locationChoices(); track location.id) {
                      <option [value]="location.id" [selected]="d.locationId === location.id">{{ location.name }}</option>
                    }
                  </select>
                </label>
              </div>
              <p class="ios-section__foot">Leeg = standaard. {{ personOf(row, true) }} ziet de percentages en de voorraad van deze locatie.</p>
            </section>
          }
        }
        <section class="ios-section">
          <div class="ios-section__head"><h2>Adres van het portaal</h2></div>
          <div class="ios-group">
            <button class="ios-cell spp-tap" type="button" (click)="copyAddress()">
              <span class="ios-cell__body"><span class="ios-cell__title mono spp-url">{{ address }}</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value spp-accent">Kopiëren</span></span>
            </button>
          </div>
          <p class="ios-section__foot">Test in een privévenster: één browser houdt maar één aanmelding.</p>
        </section>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    :host([hidden]) { display: none !important; }
    .spp-empty { display: grid; justify-items: start; gap: 8px; padding: 18px 20px; color: var(--ink-2); font-size: 14px; }
    .spp-empty p { margin: 0; line-height: 1.45; }
    .spp-skel { padding: 16px; }
    .spp-status { margin: 0 0 10px; color: var(--muted); font-size: 12.5px; }
    .spp-card { container: spp / inline-size; margin: 0 0 16px; padding: 0 0 12px; }
    .spp-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 14px 16px 8px; }
    .spp-head h2 { margin: 0; min-width: 0; font-size: 15px; font-weight: 700; letter-spacing: -.01em; overflow-wrap: anywhere; }
    .spp-head__link { margin-left: auto; font-size: 13px; }
    .spp-banner { margin: 2px 16px 10px; }
    .spp-banner a { margin-left: 4px; }
    .spp-note { margin: 0 16px 10px; color: var(--ink-2); font-size: 13px; }
    .spp-cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px 24px; }
    @container spp (min-width: 720px) { .spp-cols:not(.spp-cols--one) { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); } }
    .spp-block { display: grid; align-content: start; min-width: 0; }
    .spp-block h3 { margin: 10px 16px 4px; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .spp-field { display: grid; grid-template-columns: 128px minmax(0, 1fr); align-items: center; column-gap: 12px; padding: 5px 16px; }
    .spp-field > label { justify-self: end; color: var(--ink-2); font-size: 13px; font-weight: 600; text-align: right; }
    .is-dirty > label::before, .spp-switch.is-dirty b::before {
      content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%; background: var(--warn); vertical-align: 1px; }
    .spp-input { width: 100%; height: 36px; padding: 0 11px; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--surface); color: var(--ink); font: inherit; font-size: 14px; }
    .spp-input:focus { border-color: var(--rose); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--rose) 18%, transparent); }
    .spp-input::placeholder { color: var(--muted-2); font-style: italic; }
    .mono { font-family: var(--mono, ui-monospace, monospace); }
    /* Room for the placeholder "standaard 4,5" in the italic placeholder face. */
    .spp-input--num { width: 136px; text-align: right; font-variant-numeric: tabular-nums; }
    .spp-pct { display: inline-flex; align-items: center; gap: 6px; }
    .spp-pct i { color: var(--muted); font-style: normal; }
    .spp-pw { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .spp-pw .spp-input { flex: 1; min-width: 0; }
    .spp-value { flex: 1; min-width: 0; color: var(--ink-2); font-size: 13.5px; }
    .spp-hint, .spp-err { grid-column: 2; margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .spp-err { color: var(--danger); font-weight: 600; }
    .spp-err--block { margin: 0 16px 8px; font-size: 13px; }
    /* A hint of the whole block (not of one field): the block is a one-column grid, so it spans that column. A
       grid-column: 2 here made an implicit second column and squeezed every field beside it. */
    .spp-hint--block { grid-column: auto; margin: 4px 16px 6px; }
    .spp-switch { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; margin: 6px 16px 4px; padding: 9px 12px;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); cursor: pointer; }
    .spp-switch b { display: block; font-size: 13.5px; }
    .spp-switch small { display: block; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .spp-meta { margin: 6px 16px 0; color: var(--muted); font-size: 12.5px; }
    @container spp (max-width: 479px) {
      .spp-field { grid-template-columns: minmax(0, 1fr); row-gap: 5px; }
      .spp-field > label { justify-self: start; text-align: left; }
      .spp-hint, .spp-err { grid-column: 1; }
    }
    .spp-address { display: flex; align-items: center; gap: 14px; padding: 14px 16px; }
    .spp-address__main { display: grid; flex: 1; gap: 3px; min-width: 0; }
    .spp-address__label { color: var(--ink-2); font-size: 13px; font-weight: 650; }
    .spp-address__url { overflow-wrap: anywhere; color: var(--ink); font: 600 14px var(--mono, ui-monospace, monospace); }
    .spp-address .spp-hint { grid-column: auto; margin: 0; }
    .spp-phone { --ios-inset: 0px; }
    .spp-phone .ios-banner { margin-inline: 0; }
    .spp-textbtn { flex: none; min-width: 44px; min-height: 44px; padding: 0 4px; border: 0; background: none; color: var(--rose-dark); font: inherit; font-size: 15px; font-weight: 650; cursor: pointer; }
    .spp-cell { display: flex; flex-wrap: wrap; align-items: center; column-gap: 12px; min-height: 48px; padding: 6px 16px; background: var(--surface); cursor: text; }
    .spp-cell + .spp-cell, .spp-cell + .ios-cell, .ios-cell + .spp-cell { border-top: .5px solid var(--line); }
    .spp-cell > span:first-child { flex: 0 0 42%; min-width: 0; color: var(--ink); font-size: 16px; }
    .spp-cell input, .spp-cell select { flex: 1; min-width: 0; height: 36px; padding: 0; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 16px; text-align: right; outline: none; }
    .spp-cell select { text-align-last: right; appearance: none; -webkit-appearance: none; color: var(--muted); }
    .spp-cell input::placeholder { color: var(--muted-2); }
    .spp-cell .spp-pct { flex: 1; justify-content: flex-end; }
    .spp-cell .spp-pct input { flex: 0 1 80px; }
    .spp-cell--stack > span:first-child { flex-basis: 100%; margin-top: 4px; color: var(--muted); font-size: 13px; }
    .spp-pwrow { display: flex; flex-basis: 100%; align-items: center; gap: 8px; }
    .spp-pwrow input { text-align: left; }
    .spp-cell.is-dirty > span:first-child::before, .ios-cell.is-dirty .ios-cell__title::before {
      content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--warn); vertical-align: 2px; }
    .spp-sub { flex-basis: 100%; padding-bottom: 4px; color: var(--muted); font-size: 12.5px; line-height: 1.35; }
    .spp-sub--err { color: var(--danger); font-weight: 600; }
    .spp-tap { min-height: 48px; cursor: pointer; }
    .spp-url { overflow-wrap: anywhere; white-space: normal; font-size: 14px; }
    .spp-accent { color: var(--rose-dark); font-weight: 650; }
    .spp-plink { color: inherit; font-weight: 650; }
  `,
})
export class SettingsPartnerPortal implements SettingsEditor {
  private readonly api = inject(PartnerSalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  readonly desk = inject(DesktopViewport);

  readonly passwordMin = PARTNER_PASSWORD_MIN;
  readonly passwordHint = `${PARTNER_PASSWORD_HINT}; minstens ${PARTNER_PASSWORD_MIN} tekens.`;
  /** What Frans types in Safari: this ERP's own address. */
  readonly address = `${this.document.location?.origin ?? ''}/partner`;

  readonly rows = signal<PartnerPortalAdminRow[]>([]);
  private readonly locations = signal<StockLocation[]>([]);
  private readonly drafts = signal<ReadonlyMap<number, PartnerPortalDraft>>(new Map());
  private readonly errors = signal<ReadonlyMap<number, DraftErrors>>(new Map());
  private readonly serverErrors = signal<ReadonlyMap<number, string>>(new Map());
  /** Logins whose password field is open ("Wijzigen"); a row without a login always shows it. */
  private readonly passwordOpen = signal<ReadonlySet<number>>(new Set());
  readonly reveal = signal<ReadonlySet<number>>(new Set());

  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly missing = signal(false);
  readonly saving = signal(false);
  private run = 0;
  private scrolled = false;

  /** Active locations to choose from besides the default (the main warehouse). */
  readonly locationChoices = computed(() => this.locations()
    .filter((location) => location.active && location.id != null && location.code !== 'MAIN')
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'nl')));
  readonly mainName = computed(() => this.locations().find((location) => location.code === 'MAIN')?.name || 'Magazijn');

  private readonly changes = computed(() => new Map(this.rows().map((row) =>
    [row.customerId, changedFields(this.drafts().get(row.customerId) ?? draftOf(row), row)] as const)));
  readonly dirtyCount = computed(() => [...this.changes().values()].reduce((sum, fields) => sum + fields.length, 0));
  readonly dirty = computed(() => this.dirtyCount() > 0);
  readonly statusText = computed(() => dirtyStatusText(this.dirtyCount()));

  constructor() {
    void this.load();
  }

  /** Reads the partners and the locations; a draft is replaced (the page only reloads a view without changes). */
  async load(): Promise<void> {
    const run = ++this.run;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [rows, locations] = await Promise.all([this.api.adminRows(), this.catalog.stockLocations().catch(() => [] as StockLocation[])]);
      if (run !== this.run) return;
      this.rows.set(rows);
      this.locations.set(locations);
      this.drafts.set(new Map(rows.map((row) => [row.customerId, draftOf(row)])));
      this.errors.set(new Map());
      this.serverErrors.set(new Map());
      this.passwordOpen.set(new Set());
      this.missing.set(false);
      this.loaded.set(true);
      this.scrollToAsked();
    } catch (failure: unknown) {
      if (run !== this.run) return;
      if (isMissingEndpoint(failure)) { this.missing.set(true); this.loaded.set(true); return; }
      this.error.set(messageOf(failure, 'Het partnerportaal kon niet worden geladen.'));
    } finally {
      if (run === this.run) this.loading.set(false);
    }
  }

  /** ?klant=<id> (the row on the customer sheet): that partner's card into view, once. */
  private scrollToAsked(): void {
    const id = Number(this.route.snapshot.queryParamMap.get('klant'));
    if (this.scrolled || !Number.isSafeInteger(id) || id <= 0) return;
    this.scrolled = true;
    setTimeout(() => this.document.getElementById(`spp-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
  }

  draftFor(customerId: number): PartnerPortalDraft {
    const row = this.rows().find((candidate) => candidate.customerId === customerId)!;
    return this.drafts().get(customerId) ?? draftOf(row);
  }

  errorsFor(customerId: number): DraftErrors {
    return this.errors().get(customerId) ?? {};
  }

  serverError(customerId: number): string | null {
    return this.serverErrors().get(customerId) ?? null;
  }

  changed(row: PartnerPortalAdminRow, field: DraftField): boolean {
    return this.changes().get(row.customerId)?.includes(field) ?? false;
  }

  set<K extends DraftField>(row: PartnerPortalAdminRow, field: K, value: PartnerPortalDraft[K]): void {
    const next = { ...this.draftFor(row.customerId), [field]: value };
    this.drafts.update((map) => new Map(map).set(row.customerId, next));
    const errors = this.errors().get(row.customerId);
    if (errors?.[field]) {
      const rest = { ...errors };
      delete rest[field];
      this.errors.update((map) => new Map(map).set(row.customerId, rest));
    }
    if (this.serverErrors().has(row.customerId)) this.serverErrors.update((map) => { const copy = new Map(map); copy.delete(row.customerId); return copy; });
  }

  setLocation(row: PartnerPortalAdminRow, value: string): void {
    const id = value === '' ? null : Number(value);
    this.set(row, 'locationId', id != null && Number.isSafeInteger(id) ? id : null);
  }

  /** The username as the server stores it, shown when the field is left. */
  tidyUsername(row: PartnerPortalAdminRow): void {
    const draft = this.draftFor(row.customerId);
    const tidy = draft.username.trim().toLowerCase();
    if (tidy !== draft.username) this.set(row, 'username', tidy);
  }

  passwordShown(row: PartnerPortalAdminRow): boolean {
    return !row.login || this.passwordOpen().has(row.customerId);
  }

  openPassword(row: PartnerPortalAdminRow): void {
    this.passwordOpen.update((set) => new Set(set).add(row.customerId));
    setTimeout(() => (this.document.getElementById(`spp-pw-${row.customerId}`) as HTMLInputElement | null)?.focus(), 0);
  }

  closePassword(row: PartnerPortalAdminRow): void {
    this.set(row, 'password', '');
    this.passwordOpen.update((set) => { const next = new Set(set); next.delete(row.customerId); return next; });
  }

  toggleReveal(row: PartnerPortalAdminRow): void {
    this.reveal.update((set) => {
      const next = new Set(set);
      if (!next.delete(row.customerId)) next.add(row.customerId);
      return next;
    });
  }

  /** Opslaan: per partner the login (when it changed), then its costs and location. */
  async save(): Promise<boolean> {
    if (this.saving()) return false;
    const work = this.rows().filter((row) => (this.changes().get(row.customerId)?.length ?? 0) > 0);
    if (!work.length) return false;
    const errors = new Map(work.map((row) => [row.customerId, draftErrors(this.draftFor(row.customerId), row)] as const));
    const first = [...errors.values()].flatMap((found) => Object.values(found)).find(Boolean);
    if (first) {
      this.errors.set(errors);
      this.ui.toast(first, 'err');
      return false;
    }
    this.errors.set(new Map());
    this.saving.set(true);
    let failed: string | null = null;
    try {
      for (const row of work) {
        const draft = this.draftFor(row.customerId);
        const fields = changedFields(draft, row);
        try {
          let current = row;
          if (loginChanged(fields)) {
            current = await this.api.saveLogin(row.customerId, loginRequest(draft));
            this.replace(current, { ...draft, password: '' });
            this.passwordOpen.update((set) => { const next = new Set(set); next.delete(row.customerId); return next; });
          }
          if (current.partner && settingsChanged(fields)) {
            current = await this.api.saveSettings(row.customerId, settingsRequest(draft));
          }
          this.replace(current, draftOf(current));
        } catch (failure: unknown) {
          const message = messageOf(failure, 'Opslaan is niet gelukt. Controleer de verbinding en probeer opnieuw.');
          this.serverErrors.update((map) => new Map(map).set(row.customerId, message));
          failed ??= message;
        }
      }
    } finally {
      this.saving.set(false);
    }
    if (failed) { this.ui.toast(failed, 'err'); return false; }
    this.ui.toast('Partnerportaal opgeslagen');
    return true;
  }

  /** A row the server answered, with the draft that now applies to it. */
  private replace(row: PartnerPortalAdminRow, draft: PartnerPortalDraft): void {
    this.rows.update((rows) => rows.map((known) => (known.customerId === row.customerId ? row : known)));
    this.drafts.update((map) => new Map(map).set(row.customerId, draft));
  }

  revert(): void {
    this.drafts.set(new Map(this.rows().map((row) => [row.customerId, draftOf(row)])));
    this.errors.set(new Map());
    this.serverErrors.set(new Map());
    this.passwordOpen.set(new Set());
    this.reveal.set(new Set());
  }

  async copyAddress(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.address);
      this.ui.toast('Adres gekopieerd');
    } catch {
      this.ui.toast('Kopiëren lukt hier niet; selecteer het adres', 'err');
    }
  }

  pillOf(row: PartnerPortalAdminRow): { label: string; tone: string } {
    if (!row.partner) return { label: 'Geen partner meer', tone: 'tone-grey' };
    if (!row.login) return { label: 'Geen login', tone: 'tone-amber' };
    return row.login.active ? { label: 'Actief', tone: 'tone-green' } : { label: 'Uit', tone: 'tone-grey' };
  }

  /** "Frans", else "de partner" (capitalised at the start of a sentence). */
  personOf(row: PartnerPortalAdminRow, start = false): string {
    const name = row.login?.displayName?.trim();
    return name || (start ? 'De partner' : 'de partner');
  }

  passwordLine(row: PartnerPortalAdminRow): string {
    const set = this.when(row.login?.passwordSetAt ?? null);
    return set ? `Ingesteld ${set}` : 'Ingesteld';
  }

  unshippedText(row: PartnerPortalAdminRow): string {
    const n = row.unshippedSettlements.length;
    return n === 1 ? '1 afrekening is nog niet afgeboekt' : `${n} afrekeningen zijn nog niet afgeboekt`;
  }

  defaultText(value: number): string {
    return pctText(value);
  }

  when(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : WHEN.format(date);
  }
}
