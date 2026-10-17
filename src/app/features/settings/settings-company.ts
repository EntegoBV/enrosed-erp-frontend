import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { CompanyProfile } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { StaffContactPhones } from '../../shared/staff-contact-phones';
import { Sheet, Ui } from '../../shared/ui';
import { CompanyStore } from './company-store';
import {
  COMPANY_DEFAULTS, CompanyErrors, CompanyField, FOOTER_PROPOSAL, NumberSeries, belgianPhoneHint, companyDirtyFields,
  companyPatch, companyRequiredErrors, ibanDisplay, numberPreview, partnerPatternWarning, rebaseCompanyDraft, websiteDisplay,
} from './company-fields';
import { SettingsEditor, dirtyStatusText } from './settings-editor';

interface FieldDef {
  key: CompanyField;
  label: string;
  /** Shorter label in a phone cell. */
  phoneLabel?: string;
  required?: boolean;
  mono?: boolean;
  max?: number;
  type?: 'text' | 'email' | 'tel';
  placeholder?: string;
  hint?: string;
  /** Phone: label above a full-width input (long values never get cut). */
  stacked?: boolean;
  upper?: boolean;
}

interface FieldGroup { id: string; title: string; fields: FieldDef[]; foot?: string }

interface SeriesRow { series: NumberSeries; label: string; field: CompanyField; next?: CompanyField; max: number; isNew?: boolean }

/** The texts edited in a sheet on the phone (and the legal texts in a sheet on the phone too). */
type LongField = 'documentFooter' | 'documentFooterEn' | 'termsAndConditions' | 'termsAndConditionsEn' | 'privacyPolicy' | 'privacyPolicyEn';

const LONG_LABELS: Record<LongField, string> = {
  documentFooter: 'Voettekst (NL)',
  documentFooterEn: 'Voettekst (EN)',
  termsAndConditions: 'Algemene voorwaarden (NL)',
  termsAndConditionsEn: 'Terms and conditions (EN)',
  privacyPolicy: 'Privacyverklaring (NL)',
  privacyPolicyEn: 'Privacy statement (EN)',
};

/**
 * Bedrijfsgegevens: the company profile that every quote, invoice and
 * catalogue carries, in labelled groups with one save model (the page's
 * toolbar: "n wijzigingen niet opgeslagen · Wijzigingen wissen · Opslaan",
 * ⌘S on the desk). Saves send only the changed fields on top of the page's
 * one CompanyStore, so another view's save (the legal texts) is never
 * undone. Empty fields say what documents will use ("Standaard: ENR").
 */
@Component({
  selector: 'app-settings-company',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, RouterLink, Sheet, Skeleton, StaffContactPhones],
  template: `
    @if (draft(); as d) {
      @if (desktop.active()) {
        <div class="set-company">
          <div class="set-grid">
            @for (group of groups; track group.id) {
              <section class="wk-card set-card" [attr.aria-labelledby]="'co-group-' + group.id">
                <h2 class="set-card__title" [id]="'co-group-' + group.id">{{ group.title }}</h2>
                @if (group.id === 'fiscal') {
                  <label class="set-switch">
                    <span><b>Vergunning ET 14000 (invoer-btw verlegd)</b>
                      <small>Aan: de invoer-btw van containers ingeklaard in België komt in rooster 87/57/59 in plaats van betaald aan de douane.</small></span>
                    <input class="ios-switch" type="checkbox" role="switch" [checked]="!!d.importVatDeferred"
                           (change)="set('importVatDeferred', $any($event.target).checked)" />
                  </label>
                }
                @for (f of group.fields; track f.key) {
                  <div class="set-field" [class.set-field--dirty]="isDirty(f.key)" [class.set-field--error]="!!errorOf(f.key)">
                    <label [for]="'co-' + f.key" [class.req]="f.required">{{ f.label }}</label>
                    <input class="set-input" [class.mono]="f.mono" [id]="'co-' + f.key" [type]="f.type ?? 'text'"
                           [attr.maxlength]="f.max ?? null" [attr.placeholder]="f.placeholder ?? null"
                           [attr.aria-invalid]="errorOf(f.key) ? 'true' : null" [value]="textOf(d, f.key)"
                           (focus)="focused.set(f.key)" (input)="set(f.key, inputValue($event, f))" (blur)="blurred(f.key)" />
                    @if (errorOf(f.key); as error) {
                      <p class="set-hint set-hint--err mo-fade" role="alert">{{ error }}</p>
                    } @else if (hintOf(f.key)) {
                      <p class="set-hint set-hint--warn mo-fade">{{ hintOf(f.key) }}</p>
                    } @else if (f.hint) {
                      <p class="set-hint">{{ f.hint }}</p>
                    }
                  </div>
                }
                @if (group.foot) { <p class="set-foot">{{ group.foot }}</p> }
              </section>
              @if (group.id === 'fiscal') {
                <section class="wk-card set-card" aria-labelledby="co-group-staff">
                  <h2 class="set-card__title" id="co-group-staff">Contactpersonen in de catalogus</h2>
                  <div class="set-staff"><app-staff-contact-phones [embedded]="true" /></div>
                  <p class="set-foot">Beide nummers komen met de accountnaam in de catalogus. Een leeg nummer wordt niet getoond.</p>
                </section>
              }
            }

            <!-- Nummering: one row per series, with how its numbers look -->
            <section class="wk-card set-card span-2" aria-labelledby="co-group-numbers">
              <h2 class="set-card__title" id="co-group-numbers">Nummering</h2>
              <div class="set-num set-num--head" aria-hidden="true"><span>Reeks</span><span>Letters of patroon</span><span>Volgend nummer</span><span>Voorbeeld</span></div>
              @for (row of series; track row.series) {
                <div class="set-num" [class.set-num--dirty]="isDirty(row.field) || (row.next ? isDirty(row.next) : false)">
                  <b>{{ row.label }}@if (row.isNew) { <span class="wk-pill tone-accent">nieuw</span> }</b>
                  <input class="set-input mono" [attr.aria-label]="row.label + ': letters of patroon'" [attr.maxlength]="row.max"
                         [attr.placeholder]="'Standaard: ' + defaultOf(row.field)" [value]="textOf(d, row.field)"
                         (input)="set(row.field, $any($event.target).value)" />
                  @if (row.next; as next) {
                    <input class="set-input set-input--num" type="number" min="1" step="1" inputmode="numeric"
                           [attr.aria-label]="row.label + ': volgend nummer'" placeholder="—" [value]="textOf(d, next)"
                           (input)="setNumber(next, $any($event.target).value)" />
                  } @else { <span class="set-muted">—</span> }
                  <span class="set-preview">{{ preview(row.series).text }}@if (preview(row.series).isDefault) { <span class="wk-pill wk-pill--outline">standaard</span> }</span>
                  @if (warning(row); as text) { <p class="set-num__warn mo-fade">{{ text }}</p> }
                </div>
              }
              <p class="set-foot">{{ '{jaar}' }} is het jaar, {{ '{nr:3}' }} het volgnummer met drie cijfers. Verander je de letters, dan telt de reeks gewoon door. Het volgnummer telt gewoon door. Een volgend nummer gebruik je alleen als de boekhouding al verder telt.</p>
            </section>

            <!-- Op elk document -->
            <section class="wk-card set-card span-2" aria-labelledby="co-group-footer">
              <h2 class="set-card__title" id="co-group-footer">Op elk document</h2>
              <div class="set-footers">
                @for (key of footerKeys; track key) {
                  <div class="set-footer" [class.set-field--dirty]="isDirty(key)">
                    <label [for]="'co-' + key">{{ longLabel(key) }}</label>
                    <textarea class="set-textarea" [id]="'co-' + key" [value]="textOf(d, key)" (input)="set(key, $any($event.target).value)"></textarea>
                    <p class="set-hint">
                      @if (!textOf(d, key).trim()) {
                        {{ key === 'documentFooter' ? 'Leeg · er komt geen extra regel onder documenten.' : 'Andere talen dan Nederlands gebruiken deze tekst; leeg = de Nederlandse.' }}
                        <button class="wk-link" type="button" (click)="propose(key)">Voorstel invullen</button>
                      } @else if (key === 'documentFooterEn') {
                        Andere talen dan Nederlands gebruiken deze tekst; leeg = de Nederlandse.
                      }
                    </p>
                  </div>
                }
              </div>
            </section>

            <!-- Voorwaarden & privacy: the legal texts stay here until their own view exists -->
            <section class="wk-card set-card span-2" aria-labelledby="co-group-legal">
              <h2 class="set-card__title" id="co-group-legal">Voorwaarden &amp; privacy</h2>
              <p class="set-foot">Voorstel voor Enrosed BV: laat deze teksten nakijken door je boekhouder of jurist. Klanten lezen ze op
                <a class="wk-link" routerLink="/voorwaarden">/voorwaarden</a>. Documenten in een andere taal dan Nederlands verwijzen naar de Engelse versie.
                Leeg laten betekent: gebruik het ingebouwde voorstel.</p>
              @for (key of legalKeys; track key) {
                <details class="set-legal" [class.set-field--dirty]="isDirty(key)">
                  <summary>{{ longLabel(key) }} <span class="wk-pill" [class.tone-accent]="!!textOf(d, key).trim()">{{ textOf(d, key).trim() ? 'Eigen tekst' : 'Ingebouwd voorstel' }}</span></summary>
                  <textarea class="set-textarea set-textarea--long" [attr.aria-label]="longLabel(key)" [value]="textOf(d, key)"
                            [attr.placeholder]="key.endsWith('En') ? 'Empty = built-in draft' : 'Leeg = ingebouwd voorstel'"
                            (input)="set(key, $any($event.target).value)"></textarea>
                </details>
              }
            </section>
          </div>
        </div>
      } @else {
        <!-- Phone: inset groups, label left and value right; long values stacked -->
        <div class="set-company-phone">
          @if (dirty()) {
            <div class="ios-banner ios-banner--info mo-fade" role="status">
              <span>{{ statusText() }}</span>
              <button class="set-text-btn" type="button" (click)="revert()">Wissen</button>
            </div>
          }
          @for (group of groups; track group.id) {
            <section class="ios-section">
              <div class="ios-section__head"><h2>{{ group.title }}</h2></div>
              <div class="ios-group">
                @if (group.id === 'fiscal') {
                  <label class="ios-cell set-switch-cell">
                    <span class="ios-cell__body"><span class="ios-cell__title">Vergunning ET 14000</span><span class="ios-cell__sub ios-cell__sub--2">Invoer-btw verlegd (87/57/59)</span></span>
                    <input class="ios-switch" type="checkbox" role="switch" [checked]="!!d.importVatDeferred"
                           (change)="set('importVatDeferred', $any($event.target).checked)" />
                  </label>
                }
                @for (f of group.fields; track f.key) {
                  <label class="p-field" [class.p-field--stack]="f.stacked" [class.dirty]="isDirty(f.key)" [class.p-field--error]="!!errorOf(f.key)">
                    <span>{{ f.phoneLabel ?? f.label }}@if (f.required) {<i class="p-req" aria-hidden="true">*</i>}</span>
                    <input [class.mono]="f.mono" [type]="f.type ?? 'text'" [attr.maxlength]="f.max ?? null"
                           [attr.placeholder]="f.placeholder ?? null" [attr.aria-invalid]="errorOf(f.key) ? 'true' : null"
                           [attr.data-co-field]="f.key" [value]="textOf(d, f.key)"
                           (focus)="focused.set(f.key)" (input)="set(f.key, inputValue($event, f))" (blur)="blurred(f.key)" />
                    @if (errorOf(f.key); as error) { <small class="p-sub p-sub--err" role="alert">{{ error }}</small> }
                    @else if (hintOf(f.key)) { <small class="p-sub p-sub--warn">{{ hintOf(f.key) }}</small> }
                    @else if (f.hint) { <small class="p-sub">{{ f.hint }}</small> }
                  </label>
                }
              </div>
              @if (group.foot) { <p class="ios-section__foot">{{ group.foot }}</p> }
            </section>
          }

          <section class="ios-section">
            <div class="ios-section__head"><h2>Nummering</h2></div>
            <div class="ios-group">
              @for (row of series; track row.series) {
                <label class="p-field" [class.p-field--stack]="!!row.next" [class.dirty]="isDirty(row.field)">
                  <span>{{ row.label }}@if (row.isNew) { <span class="wk-pill tone-accent">nieuw</span> }</span>
                  <input class="mono" [attr.maxlength]="row.max" [attr.placeholder]="row.next ? 'Standaard' : 'Standaard: ' + defaultOf(row.field)"
                         [value]="textOf(d, row.field)" (input)="set(row.field, $any($event.target).value)" />
                  <small class="p-sub mono">@if (row.next && preview(row.series).isDefault) { {{ defaultOf(row.field) }} → }{{ preview(row.series).text }}@if (preview(row.series).isDefault) { · standaard }</small>
                  @if (warning(row); as text) { <small class="p-sub p-sub--warn">{{ text }}</small> }
                </label>
                @if (row.next; as next) {
                  <label class="p-field" [class.dirty]="isDirty(next)">
                    <span>Volgend nummer</span>
                    <input type="number" min="1" step="1" inputmode="numeric" placeholder="—" [value]="textOf(d, next)"
                           (input)="setNumber(next, $any($event.target).value)" />
                  </label>
                }
              }
            </div>
            <p class="ios-section__foot">{{ '{jaar}' }} is het jaar, {{ '{nr:3}' }} het volgnummer met drie cijfers. Het volgnummer telt gewoon door.</p>
          </section>

          <section class="ios-section">
            <div class="ios-section__head"><h2>Op elk document</h2></div>
            <div class="ios-group">
              @for (key of footerKeys; track key) {
                <button class="ios-cell" type="button" [class.dirty]="isDirty(key)" (click)="openLong(key)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ longLabel(key) }}</span>
                    <span class="ios-cell__sub">{{ textOf(d, key).trim() || 'Geen' }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
            </div>
            <p class="ios-section__foot">Andere talen dan Nederlands gebruiken de Engelse voettekst; leeg = de Nederlandse.</p>
          </section>

          <section class="ios-section">
            <div class="ios-section__head"><h2>Contactpersonen in de catalogus</h2></div>
            <div class="ios-group set-staff-phone"><app-staff-contact-phones [embedded]="true" /></div>
            <p class="ios-section__foot">Beide nummers komen met de accountnaam in de catalogus. Een leeg nummer wordt niet getoond.</p>
          </section>

          <section class="ios-section">
            <div class="ios-section__head"><h2>Voorwaarden &amp; privacy</h2></div>
            <div class="ios-group">
              @for (key of legalKeys; track key) {
                <button class="ios-cell" type="button" (click)="openLong(key)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ longLabel(key) }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value">{{ textOf(d, key).trim() ? 'Eigen tekst' : 'Ingebouwd' }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
              <a class="ios-cell" routerLink="/voorwaarden">
                <span class="ios-cell__body"><span class="ios-cell__title">Bekijk zoals klanten</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </a>
            </div>
            <p class="ios-section__foot">Voorstel voor Enrosed BV: laat deze teksten nakijken door je boekhouder of jurist. Leeg = het ingebouwde voorstel.</p>
          </section>
        </div>
      }
    } @else if (store.error(); as error) {
      <app-load-error [message]="error" [busy]="store.loading()" (retry)="store.load(true)" />
    } @else if (desktop.active()) {
      <div class="set-grid set-grid--loading">
        @for (n of [1, 2, 3, 4]; track n) { <div class="wk-card set-card"><div class="set-card__skel"><app-skeleton kind="lines" [rows]="4" /></div></div> }
      </div>
    } @else {
      <app-skeleton kind="group" [rows]="4" /><app-skeleton kind="group" [rows]="4" />
    }

    <!-- Sheets at host level: never inside the container wrapper (trap rule) -->
    @if (longOpen(); as key) {
      <app-sheet [title]="longLabel(key)" variant="ios" [wide]="true" (closed)="longOpen.set(null)">
        <div body class="set-long">
          <textarea class="set-textarea set-textarea--sheet" [attr.aria-label]="longLabel(key)" [value]="longText()"
                    (input)="longText.set($any($event.target).value)"></textarea>
          @if (key === 'documentFooter' || key === 'documentFooterEn') {
            <p class="set-hint">{{ key === 'documentFooter' ? 'Leeg · er komt geen extra regel onder documenten.' : 'Andere talen dan Nederlands gebruiken deze tekst; leeg = de Nederlandse.' }}</p>
            @if (!longText().trim()) { <button class="wk-link" type="button" (click)="longText.set(proposalFor(key))">Voorstel invullen</button> }
          } @else {
            <p class="set-hint">Leeg laten = het ingebouwde voorstel.</p>
          }
        </div>
        <div foot class="set-long__foot">
          <button class="btn" type="button" (click)="longOpen.set(null)">Annuleren</button>
          <button class="btn btn--primary" type="button" (click)="applyLong()">Klaar</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display: block; }
    :host([hidden]) { display: none !important; }
    .set-company { container: set-company / inline-size; }
    .set-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: stretch; }
    @container set-company (min-width: 760px) { .set-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .set-grid > .span-2 { grid-column: 1 / -1; } }
    .set-card { container: set-card / inline-size; margin: 0; padding: 0 0 10px; }
    .set-card + .set-card { margin-top: 0; }
    .set-card__title { margin: 0; padding: 14px 16px 8px; font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
    .set-card__skel { padding: 16px; }
    .set-field { display: grid; grid-template-columns: 168px minmax(0, 1fr); align-items: center; column-gap: 14px; padding: 5px 16px; }
    .set-field > label { justify-self: end; color: var(--ink-2); font-size: 13px; font-weight: 600; text-align: right; }
    .set-field > label.req::after { content: ' *'; color: var(--danger); }
    .set-field--dirty > label::before, .set-footer.set-field--dirty > label::before, details.set-field--dirty > summary::before {
      content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%; background: var(--warn); vertical-align: 1px; }
    .set-field--error > label { color: var(--danger); }
    .set-input { width: 100%; height: 36px; padding: 0 11px; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--surface); color: var(--ink); font: inherit; font-size: 14px; }
    .set-input:focus, .set-textarea:focus { border-color: var(--rose); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--rose) 18%, transparent); }
    .set-input::placeholder, .set-textarea::placeholder, .p-field input::placeholder { color: var(--muted-2); font-style: italic; }
    .set-input.mono, .p-field input.mono { font-family: var(--mono, ui-monospace, monospace); font-size: 13px; }
    .set-field--error .set-input { border-color: var(--danger); }
    .set-hint { grid-column: 2; margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .set-hint--warn { color: var(--warn); }
    .set-hint--err { color: var(--danger); font-weight: 600; }
    @container set-card (max-width: 479px) {
      .set-field { grid-template-columns: minmax(0, 1fr); row-gap: 5px; }
      .set-field > label { justify-self: start; text-align: left; }
      .set-hint { grid-column: 1; }
    }
    .set-foot { margin: 6px 16px 4px; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
    .set-switch { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; margin: 4px 16px 8px; padding: 10px 12px;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); cursor: pointer; }
    .set-switch b { display: block; font-size: 13.5px; }
    .set-switch small { display: block; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .set-staff { padding: 4px 16px; }
    .set-num { display: grid; grid-template-columns: 150px minmax(0, 1.1fr) 110px minmax(0, 1fr); align-items: center; column-gap: 14px; padding: 7px 16px; border-top: 1px solid var(--line); font-size: 13px; }
    .set-num--head { min-height: 32px; padding-block: 0; border-top: 0; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .set-num > b { display: flex; align-items: center; gap: 6px; color: var(--ink-2); font-size: 13px; font-weight: 600; }
    .set-num--dirty > b::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
    .set-input--num { text-align: right; font-variant-numeric: tabular-nums; }
    .set-muted { color: var(--muted-2); }
    .set-preview { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; color: var(--ink-2); font: 500 13px var(--mono, ui-monospace, monospace); overflow-wrap: anywhere; }
    .set-preview .wk-pill { font-family: var(--font, inherit); }
    .set-num__warn { grid-column: 2 / -1; margin: 4px 0 0; color: var(--warn); font-size: 12px; }
    @container set-card (max-width: 640px) {
      .set-num { grid-template-columns: 110px minmax(0, 1fr) 90px; row-gap: 4px; }
      .set-num > .set-preview { grid-column: 2 / -1; }
      .set-num--head > span:last-child { display: none; }
    }
    .set-footers { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; padding: 4px 16px 6px; }
    @container set-card (max-width: 640px) { .set-footers { grid-template-columns: minmax(0, 1fr); } }
    .set-footer > label { display: block; margin-bottom: 5px; color: var(--ink-2); font-size: 13px; font-weight: 600; }
    .set-footer .set-hint { grid-column: auto; }
    .set-textarea { width: 100%; min-height: 96px; max-height: 200px; padding: 9px 11px; border: 1px solid var(--line-strong); border-radius: 9px;
      background: var(--surface); color: var(--ink); font: inherit; font-size: 14px; line-height: 1.5; resize: vertical; field-sizing: content; }
    .set-textarea--long { min-height: 220px; max-height: 60vh; margin-top: 8px; field-sizing: fixed; }
    .set-legal { margin: 0 16px 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; }
    .set-legal summary { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 650; cursor: pointer; }
    .set-company-phone { --ios-inset: 0px; }
    .set-company-phone .ios-banner { margin-inline: 0; }
    .set-text-btn { flex: none; min-height: 32px; padding: 0 4px; border: 0; background: none; color: var(--rose-dark); font: inherit; font-size: 15px; font-weight: 650; cursor: pointer; }
    .p-field { display: flex; flex-wrap: wrap; align-items: center; column-gap: 12px; min-height: 48px; padding: 6px 16px; background: var(--surface); cursor: text; }
    .p-field > span { flex: 0 0 40%; min-width: 0; color: var(--ink); font-size: 15px; }
    .p-field > input { flex: 1; min-width: 0; height: 36px; padding: 0; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 16px; text-align: right; outline: none; }
    .p-field--stack > span { flex-basis: 100%; margin-top: 4px; color: var(--muted); font-size: 13px; }
    .p-field--stack > input { flex-basis: 100%; text-align: left; }
    .p-field.dirty > span::before, .ios-cell.dirty .ios-cell__title::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--warn); vertical-align: 2px; }
    .p-field--error > span { color: var(--danger); }
    .p-req { margin-left: 2px; color: var(--danger); font-style: normal; }
    .p-sub { flex-basis: 100%; padding-bottom: 4px; color: var(--muted); font-size: 12.5px; line-height: 1.35; text-align: right; }
    .p-field--stack .p-sub { text-align: left; }
    .p-sub.mono { font-family: var(--mono, ui-monospace, monospace); }
    .p-sub--warn { color: var(--warn); }
    .p-sub--err { color: var(--danger); font-weight: 600; }
    .set-switch-cell { cursor: pointer; }
    .set-staff-phone { padding: 12px 16px; }
    .set-long { display: grid; gap: 8px; }
    .set-textarea--sheet { min-height: 40vh; max-height: none; font-size: 16px; field-sizing: fixed; }
    .set-long__foot { display: flex; justify-content: flex-end; gap: 8px; width: 100%; }
    .set-long__foot .btn { min-height: 44px; }
  `,
})
export class SettingsCompany implements SettingsEditor {
  readonly desktop = inject(DesktopViewport);
  readonly store = inject(CompanyStore);
  private readonly ui = inject(Ui);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly phones = viewChild(StaffContactPhones);

  readonly year = new Date().getFullYear();
  readonly groups: readonly FieldGroup[] = [
    { id: 'identity', title: 'Identiteit', fields: [
      { key: 'name', label: 'Handelsnaam', required: true },
      { key: 'legalName', label: 'Juridische naam', stacked: true },
      { key: 'vatNumber', label: 'BTW-nummer', required: true, mono: true },
      { key: 'registrationNumber', label: 'Ondernemingsnummer', phoneLabel: 'Ondernemingsnr.', mono: true },
    ] },
    { id: 'address', title: 'Adres', fields: [
      { key: 'addressLine', label: 'Adres', required: true, stacked: true },
      { key: 'postalCode', label: 'Postcode', required: true },
      { key: 'city', label: 'Stad', required: true },
      { key: 'countryCode', label: 'Land (ISO)', required: true, max: 2, upper: true, hint: 'Bepaalt mee welk btw-regime binnenland is.' },
    ] },
    { id: 'contact', title: 'Contact', fields: [
      { key: 'email', label: 'E-mail', type: 'email', stacked: true },
      { key: 'phone', label: 'Telefoon', type: 'tel' },
      { key: 'website', label: 'Website', stacked: true },
    ] },
    { id: 'bank', title: 'Bank', foot: 'Komt op offertes en facturen bij de betaalgegevens.', fields: [
      { key: 'iban', label: 'IBAN', mono: true },
      { key: 'bic', label: 'BIC', mono: true, upper: true },
    ] },
    { id: 'fiscal', title: 'Btw en douane',
      foot: `Komt op documenten van klanten die via deze vertegenwoordiger inklaren. Leeg = de standaard: ${COMPANY_DEFAULTS.fiscalRepresentativeName}, ${COMPANY_DEFAULTS.fiscalRepresentativeVat}.`,
      fields: [
        { key: 'fiscalRepresentativeName', label: 'Fiscaal vertegenwoordiger (NL)', phoneLabel: 'Vertegenwoordiger (NL)', stacked: true,
          placeholder: `Standaard: ${COMPANY_DEFAULTS.fiscalRepresentativeName}` },
        { key: 'fiscalRepresentativeVat', label: 'Btw-nummer vertegenwoordiger', phoneLabel: 'Btw-nummer vertegenwoordiger', mono: true, stacked: true,
          placeholder: `Standaard: ${COMPANY_DEFAULTS.fiscalRepresentativeVat}` },
      ] },
  ];
  readonly series: readonly SeriesRow[] = [
    { series: 'quote', label: 'Offertes', field: 'quoteNumberPrefix', max: 12 },
    { series: 'invoice', label: 'Facturen', field: 'invoiceNumberPrefix', max: 12 },
    { series: 'creditNote', label: 'Creditnota’s', field: 'creditNoteNumberPrefix', max: 12 },
    { series: 'partnerInvoice', label: 'Partnerfacturen', field: 'partnerInvoiceNumberPattern', next: 'partnerInvoiceNextNumber', max: 60 },
    { series: 'partnerQuote', label: 'Partneroffertes', field: 'partnerQuoteNumberPattern', next: 'partnerQuoteNextNumber', max: 60, isNew: true },
  ];
  readonly footerKeys: readonly LongField[] = ['documentFooter', 'documentFooterEn'];
  readonly legalKeys: readonly LongField[] = ['termsAndConditions', 'termsAndConditionsEn', 'privacyPolicy', 'privacyPolicyEn'];

  /** The saved profile the draft is based on. */
  private readonly base = signal<CompanyProfile | null>(null);
  readonly draft = signal<CompanyProfile | null>(null);
  readonly saving = signal(false);
  /** Required-field errors show once a save was tried, and then follow the typing. */
  private readonly showErrors = signal(false);
  readonly errors = computed<CompanyErrors>(() => {
    const draft = this.draft();
    return this.showErrors() && draft ? companyRequiredErrors(draft) : {};
  });
  readonly dirtyFields = computed(() => {
    const base = this.base();
    const draft = this.draft();
    return base && draft ? companyDirtyFields(base, draft) : [];
  });
  readonly dirtyCount = computed(() => this.dirtyFields().length + (this.phones()?.dirtyCount() ?? 0));
  readonly dirty = computed(() => this.dirtyCount() > 0);
  readonly statusText = computed(() => dirtyStatusText(this.dirtyCount()));
  readonly phoneHint = computed(() => belgianPhoneHint(this.draft()?.phone).hint);

  readonly longOpen = signal<LongField | null>(null);
  readonly longText = signal('');

  constructor() {
    void this.store.load();
    /* Another view saved (or the overview re-read): keep this draft's own edits, refresh the rest. */
    effect(() => {
      const fresh = this.store.saved();
      untracked(() => {
        if (!fresh || fresh === this.base()) return;
        const base = this.base();
        const draft = this.draft();
        this.draft.set(base && draft ? rebaseCompanyDraft(base, draft, fresh) : { ...fresh });
        this.base.set(fresh);
      });
    });
  }

  /** The field being typed in: the IBAN shows in groups of four only while it is not. */
  readonly focused = signal<CompanyField | null>(null);

  textOf(profile: CompanyProfile, key: CompanyField): string {
    const value = profile[key];
    const text = value === null || value === undefined ? '' : String(value);
    return key === 'iban' && this.focused() !== 'iban' ? ibanDisplay(text) : text;
  }

  defaultOf(key: CompanyField): string {
    return (COMPANY_DEFAULTS as Record<string, string>)[key] ?? '';
  }

  inputValue(event: Event, field: FieldDef): string {
    const value = (event.target as HTMLInputElement).value;
    return field.upper ? value.toUpperCase() : value;
  }

  set(key: CompanyField, value: string | boolean | number | null): void {
    this.draft.update((draft) => draft ? { ...draft, [key]: value } : draft);
  }

  setNumber(key: CompanyField, raw: string): void {
    const value = raw === '' ? null : Number(raw);
    this.set(key, value === null || Number.isFinite(value) ? value : null);
  }

  blurred(key: CompanyField): void {
    if (this.focused() === key) this.focused.set(null);
    const draft = this.draft();
    if (!draft) return;
    if (key === 'phone') {
      const display = belgianPhoneHint(draft.phone).display;
      if (display) this.set('phone', display);
    } else if (key === 'website') {
      const display = websiteDisplay(draft.website);
      if (display !== (draft.website ?? '')) this.set('website', display);
    }
  }

  isDirty(key: CompanyField): boolean {
    return this.dirtyFields().includes(key);
  }

  errorOf(key: CompanyField): string | null {
    return this.errors()[key] ?? null;
  }

  hintOf(key: CompanyField): string | null {
    return key === 'phone' ? this.phoneHint() : null;
  }

  preview(series: NumberSeries): { text: string; isDefault: boolean } {
    const draft = this.draft();
    return draft ? numberPreview(series, draft, this.year) : { text: '', isDefault: true };
  }

  warning(row: SeriesRow): string | null {
    if (row.series !== 'partnerInvoice' && row.series !== 'partnerQuote') return null;
    const draft = this.draft();
    return draft ? partnerPatternWarning(draft[row.field] as string | null, row.series) : null;
  }

  longLabel(key: LongField): string {
    return LONG_LABELS[key];
  }

  proposalFor(key: LongField): string {
    return key === 'documentFooterEn' ? FOOTER_PROPOSAL.en : FOOTER_PROPOSAL.nl;
  }

  propose(key: LongField): void {
    this.set(key, this.proposalFor(key));
  }

  openLong(key: LongField): void {
    const draft = this.draft();
    this.longText.set(draft ? this.textOf(draft, key) : '');
    this.longOpen.set(key);
  }

  /** Klaar: the text goes into the draft; Opslaan in the bar still saves. */
  applyLong(): void {
    const key = this.longOpen();
    if (key) this.set(key, this.longText());
    this.longOpen.set(null);
  }

  revert(): void {
    const base = this.base();
    if (base) this.draft.set({ ...base });
    this.showErrors.set(false);
    this.phones()?.revertAll();
  }

  async save(): Promise<boolean> {
    const draft = this.draft();
    if (!draft || this.saving()) return false;
    this.showErrors.set(true);
    const errors = companyRequiredErrors(draft);
    const first = Object.keys(errors)[0];
    if (first) {
      this.focusField(first);
      this.ui.toast('Vul eerst de verplichte velden in.', 'err');
      return false;
    }
    const phones = this.phones();
    const invalid = phones?.firstInvalid();
    if (phones && invalid) {
      phones.focus(invalid.username);
      this.ui.toast(`Controleer het telefoonnummer van ${invalid.displayName}.`, 'err');
      return false;
    }
    const fields = this.dirtyFields();
    this.saving.set(true);
    try {
      if (fields.length) {
        const result = await this.store.save(companyPatch(draft, fields));
        /* Edits typed while saving survive; the saved fields take the server's answer. */
        const current = this.draft() ?? draft;
        this.draft.set(rebaseCompanyDraft(draft, current, result));
        this.base.set(result);
      }
      const phonesSaved = phones && phones.dirtyCount() ? await phones.saveAll() : true;
      this.showErrors.set(false);
      if (!phonesSaved) {
        this.ui.toast('Een telefoonnummer is niet opgeslagen. Kijk bij Contactpersonen.', 'err');
        return false;
      }
      this.ui.toast('Bedrijfsgegevens opgeslagen');
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan is niet gelukt. Controleer de verbinding en probeer opnieuw.'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private focusField(key: string): void {
    const root = this.host.nativeElement;
    requestAnimationFrame(() => {
      root.querySelector<HTMLElement>(`#co-${key}, [data-co-field="${key}"]`)?.focus();
    });
  }
}
