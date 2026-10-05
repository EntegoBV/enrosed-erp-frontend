import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { messageOf } from '../../core/api/errors';
import { countryName } from '../../core/api/geo';
import {
  ApproveLoginRequest, CustomerLogin, LoginInvitation, LoginRequest, LoginRequestApi, LoginRequestDetail,
  LoginRequestLaterSubmission, LoginRequestMatch,
} from '../../core/api/login-request-api';
import { Country, Customer, LANGUAGES } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { WorkQueue } from '../../core/api/work-queue';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { PageHeader } from '../../shared/page-header';
import { DateNlPipe, DateTimeNlPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, escapeHtml } from '../../shared/ui';
import {
  LoginChoice, LoginRequestSegment, NewCustomerDraft, REJECT_NOTE_MAX, applicantEntries, canApprove, choiceLocked,
  choiceOf, dateText, defaultChoice, draftFromLater, draftFromRequest, existingAccountAlert, intakeFullTexts,
  linkLine, loginStatusLabel, matchLoginBadges, matchReasonLabel, mergePages, needsMismatchConfirm, newLinkAlert,
  newLinkMarker, olderCustomerPreselected, reconcileChoice, rejectMessage, rejectNote, rowContactParts,
  rowFactParts, segmentToStatus, sourceLabel, statusBadge, subtitle,
} from './login-request-state';

const SEGMENTS: SegmentOption[] = [
  { id: 'open', label: 'Open' },
  { id: 'goedgekeurd', label: 'Goedgekeurd' },
  { id: 'afgewezen', label: 'Afgewezen' },
];

const EMPTY_DRAFT: NewCustomerDraft = { company: '', vatNumber: '', countryCode: '', contact: '', phone: '', language: 'NL' };

/**
 * Website visitors ask for a login; nobody gets one without a decision here.
 *
 * Approving binds the login to a customer and mails a one-time link, so the
 * sheet shows everything that decision rests on: who asked, later versions
 * of the same request, an existing login and the customers that match.
 */
@Component({
  selector: 'app-login-requests-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, Segmented, Skeleton, Sheet, DateNlPipe, DateTimeNlPipe],
  template: `
    <app-page-header title="Login-aanvragen" [subtitle]="subtitle()" />

    <div class="content">
      @if (work.loginIntakeFull()) {
        @for (text of intakeFull(); track text) {
          <div class="alert alert--danger" role="alert"><span class="alert__icon">!</span><div>{{ text }}</div></div>
        }
      }

      <div class="alert alert--info">
        <span class="alert__icon">ℹ</span>
        <div>
          Klanten vragen hier een login voor de website. Met een login zien ze prijzen in het
          bestelscherm, ook als die voor bezoekers verborgen zijn. Pas na jullie goedkeuring krijgen ze
          een mail met een link om zelf een wachtwoord te kiezen. Zonder goedkeuring krijgt niemand toegang.
        </div>
      </div>

      <app-segmented class="lr-segments mt-12" label="Status van de aanvragen" [variant]="desktop.active() ? 'desk' : 'ios'"
                     [options]="segments" [value]="segment()" (changed)="pickSegment($event)" />

      @if (error()) {
        <div class="alert alert--danger lr-error mt-12" role="alert">
          <span class="alert__icon">!</span>
          <div>Login-aanvragen konden niet geladen worden. Controleer de verbinding.</div>
          <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="reload()">Opnieuw proberen</button>
        </div>
      }

      @if (rows().length || !error()) {
        <div class="card mt-12">
          <div class="list">
            @for (row of rows(); track row.id) {
              <button class="list-item lr-row" type="button" (click)="open(row.id, row)">
                <div class="list-item__body">
                  <div class="list-item__title">{{ row.companyName }}</div>
                  <div class="list-item__meta list-item__meta--wrap lr-meta">
                    @for (part of contactParts(row); track $index) { <span>{{ part }}</span> }
                  </div>
                  <div class="list-item__meta list-item__meta--wrap lr-meta">
                    @for (part of factParts(row); track $index) { <span>{{ part }}</span> }
                  </div>
                  @if (row.hasExistingLogin && row.source !== 'NEW_LINK' || row.previouslyRejected
                    || applicants(row).length || marker(row)) {
                    <div class="lr-badges">
                      @if (row.hasExistingLogin && row.source !== 'NEW_LINK') { <span class="badge badge--blue">heeft al een login</span> }
                      @if (row.previouslyRejected) { <span class="badge badge--neutral">eerder afgewezen</span> }
                      @if (applicants(row).length) { <span class="badge badge--gold">andere gegevens</span> }
                      @if (marker(row)) { <span class="badge badge--blue">vraagt nieuwe link</span> }
                    </div>
                  }
                </div>
                <span class="badge" [class]="badge(row).css">{{ badge(row).label }}</span>
                <span class="list-item__chev">›</span>
              </button>
            } @empty {
              @if (loading()) {
                <app-skeleton kind="list" [rows]="4" />
              } @else {
                <div class="empty">
                  @switch (segment()) {
                    @case ('goedgekeurd') { <div class="empty__title">Nog geen goedgekeurde aanvragen</div> }
                    @case ('afgewezen') { <div class="empty__title">Geen afgewezen aanvragen</div> }
                    @default {
                      <div class="empty__title">Geen open login-aanvragen</div>
                      <div class="empty__text">
                        Nieuwe aanvragen van de website verschijnen hier. Bij een aanvraag via het loginformulier
                        krijg je een melding en een mail (hooguit 6 per uur en 20 per dag; wat daarboven komt,
                        staat hier wel maar zonder melding). Bij een offerteaanvraag staat het in de offertemail.
                      </div>
                    }
                  }
                </div>
              }
            }
          </div>
        </div>
      }

      @if (more() && rows().length) {
        <div class="lr-more">
          <button class="btn btn--ghost" type="button" [disabled]="loadingMore()" (click)="loadMore()">
            {{ loadingMore() ? 'Bezig…' : 'Meer laden' }}
          </button>
        </div>
      }
    </div>

    @if (openId() !== null) {
      <app-sheet [wide]="true" [title]="sheetTitle()" (closed)="close()">
        <div body>
          @if (detail(); as d) {
            <div class="section-title">Aanvrager</div>
            <dl class="lr-facts">
              <dt>Bedrijf</dt><dd>{{ d.request.companyName }}</dd>
              <dt>Contact</dt><dd>{{ d.request.contactName || '—' }}</dd>
              <dt>E-mail</dt><dd><a [href]="'mailto:' + d.request.email">{{ d.request.email }}</a></dd>
              <dt>Telefoon</dt>
              <dd>@if (d.request.phone) { <a [href]="'tel:' + d.request.phone">{{ d.request.phone }}</a> } @else { — }</dd>
              <dt>BTW-nummer</dt><dd>{{ d.request.vatNumber || '—' }}</dd>
              <dt>Land</dt><dd>{{ country(d.request.companyCountryCode) || '—' }}</dd>
              <dt>Taal</dt><dd>{{ language(d.request.language) }}</dd>
              <dt>Bron</dt>
              <dd>
                @if (d.request.source === 'QUOTE' && d.request.salesOrderId) {
                  <a [routerLink]="['/sales', d.request.salesOrderId]">Offerte {{ d.request.salesOrderNumber }} openen</a>
                } @else { {{ source(d.request) }} }
              </dd>
              <dt>Ontvangen</dt><dd>{{ d.request.createdAt | dateTimeNl }}</dd>
              @if (d.request.message) { <dt>Bericht</dt><dd class="lr-message">{{ d.request.message }}</dd> }
            </dl>

            @if (d.request.status === 'PENDING') {
              @if (applicants(d.request); as later) {
                @if (later.length) {
                  <div class="section-title">Later opnieuw aangevraagd met andere gegevens</div>
                  <div class="alert alert--warn">
                    <span class="alert__icon">!</span>
                    <div>Voor dit e-mailadres kwamen later nog aanvragen binnen met andere gegevens. De eerste
                      aanvraag is niet gewijzigd en geen enkele latere versie is overschreven. Vergelijk ze voor
                      je beslist.</div>
                  </div>
                  @for (entry of later; track $index) {
                    <div class="lr-later">
                      <h3>Aanvraag van {{ entry.at | dateTimeNl }}</h3>
                      <dl class="lr-facts">
                        @if (entry.companyName) { <dt>Bedrijf</dt><dd>{{ entry.companyName }}</dd> }
                        @if (entry.contactName) { <dt>Contact</dt><dd>{{ entry.contactName }}</dd> }
                        @if (entry.phone) { <dt>Telefoon</dt><dd>{{ entry.phone }}</dd> }
                        @if (entry.vatNumber) { <dt>BTW-nummer</dt><dd>{{ entry.vatNumber }}</dd> }
                        @if (entry.companyCountryCode) { <dt>Land</dt><dd>{{ country(entry.companyCountryCode) }}</dd> }
                        @if (entry.message) { <dt>Bericht</dt><dd class="lr-message">{{ entry.message }}</dd> }
                        <dt>Bron</dt>
                        <dd>
                          {{ source(entry) }}
                          @if (entry.source === 'QUOTE' && entry.salesOrderId) {
                            · <a [routerLink]="['/sales', entry.salesOrderId]">Offerte {{ entry.salesOrderNumber }} openen</a>
                          }
                        </dd>
                      </dl>
                      @if (d.request.source !== 'NEW_LINK') {
                        <button class="btn btn--sm" type="button" [disabled]="locked()" (click)="useLater(entry)">
                          Deze gegevens gebruiken voor een nieuwe klant
                        </button>
                      }
                    </div>
                  }
                  @if (d.request.laterSubmissionsFull) {
                    <div class="alert alert--warn mt-8">
                      <span class="alert__icon">!</span>
                      <div>Er kwamen meer aanvragen met andere gegevens binnen dan hier bewaard worden (hooguit
                        vijf). Neem bij twijfel contact op via {{ d.request.email }} voor je beslist.</div>
                    </div>
                  }
                }
              }

              @if (d.request.source === 'NEW_LINK') {
                <div class="alert mt-12" [class.alert--info]="linkAlert().tone === 'info'" [class.alert--warn]="linkAlert().tone === 'warn'">
                  <span class="alert__icon">{{ linkAlert().tone === 'info' ? 'ℹ' : '!' }}</span>
                  <div>{{ linkAlert().text }}</div>
                </div>
                <dl class="lr-facts mt-12">
                  <dt>Klant</dt><dd>{{ d.existingAccount?.customerCompany || d.request.customerCompany || d.request.companyName }}</dd>
                  <dt>Login</dt>
                  <dd class="lr-login">
                    <span>{{ d.existingAccount?.email || d.request.email }}</span>
                    @if (d.existingAccount; as account) {
                      <span class="badge" [class]="loginBadge(account)">{{ loginStatus(account) }}</span>
                    } @else {
                      <span class="badge badge--neutral">Ingetrokken</span>
                    }
                  </dd>
                </dl>
              } @else {
                @if (accountAlert(); as alert) {
                  <div class="alert alert--warn mt-12"><span class="alert__icon">!</span><div>{{ alert.text }}</div></div>
                  @if (locked() && marker(d.request); as asked) {
                    <div class="alert alert--info">
                      <span class="alert__icon">ℹ</span>
                      <div>Deze klant vroeg intussen ook een nieuwe link ({{ asked.at | dateNl }}). Goedkeuren stuurt die link.</div>
                    </div>
                  }
                }

                <div class="section-title">Koppelen aan klant</div>
                <div class="lr-choices" role="radiogroup" aria-label="Koppelen aan klant">
                  @for (match of matchRows(); track match.customerId) {
                    <label class="lr-choice" [class.lr-choice--on]="isChosen(match.customerId) && !searching()">
                      <input type="radio" name="lr-choice" [checked]="isChosen(match.customerId) && !searching()"
                             [disabled]="locked()" (change)="chooseMatch(match)" />
                      <span>
                        <b>{{ matchLine(match) }}</b>
                        <span class="lr-badges">
                          @for (reason of match.matchedOn; track reason) {
                            <span class="badge badge--neutral">{{ reasonLabel(reason) }}</span>
                          }
                          @for (login of loginBadges(match); track login.id) {
                            <span class="badge badge--blue">heeft al een login ({{ login.email }})</span>
                          }
                        </span>
                      </span>
                    </label>
                  }
                  @if (!locked()) {
                    <label class="lr-choice" [class.lr-choice--on]="searching()">
                      <input type="radio" name="lr-choice" [checked]="searching()" (change)="chooseSearch()" />
                      <span><b>Andere klant zoeken</b></span>
                    </label>
                    @if (searching()) {
                      <div class="lr-nested">
                        <input class="input" type="search" aria-label="Andere klant zoeken"
                               placeholder="Zoek op bedrijf, contact, stad of BTW-nummer…"
                               [ngModel]="query()" (ngModelChange)="setQuery($event ?? '')" />
                        @if (customersState() === 'failed') {
                          <div class="alert alert--danger lr-error" role="alert">
                            <span class="alert__icon">!</span>
                            <div>Klanten konden niet geladen worden. Controleer de verbinding.</div>
                            <button class="btn btn--sm" type="button" (click)="loadCustomers()">Opnieuw proberen</button>
                          </div>
                        } @else {
                          @for (customer of searchResults(); track customer.id) {
                            <label class="lr-choice" [class.lr-choice--on]="isChosen(customer.id)">
                              <input type="radio" name="lr-search" [checked]="isChosen(customer.id)" (change)="chooseCustomer(customer)" />
                              <span><b>{{ customerLine(customer) }}</b>
                                <small>{{ customer.email || 'geen e-mailadres' }}</small></span>
                            </label>
                          } @empty {
                            @if (query().trim()) {
                              <span class="hint" role="status">{{ customersState() === 'ready' ? 'Geen klant gevonden.' : 'Klanten laden…' }}</span>
                            }
                          }
                        }
                      </div>
                    }
                    <label class="lr-choice" [class.lr-choice--on]="choice()?.kind === 'new'">
                      <input type="radio" name="lr-choice" [checked]="choice()?.kind === 'new'" (change)="chooseNew()" />
                      <span><b>Nieuwe klant aanmaken</b></span>
                    </label>
                    @if (choice()?.kind === 'new') {
                      <div class="lr-nested form-grid">
                        <div class="field span-2"><label class="req" for="lr-company">Bedrijfsnaam</label>
                          <input class="input" id="lr-company" [ngModel]="draft().company"
                                 (ngModelChange)="patch({ company: $event })" /></div>
                        <div class="field"><label class="req" for="lr-vat">BTW-nummer</label>
                          <input class="input" id="lr-vat" [ngModel]="draft().vatNumber"
                                 (ngModelChange)="patch({ vatNumber: $event })" /></div>
                        <div class="field"><label class="req" for="lr-country">Land</label>
                          <select class="select" id="lr-country" [ngModel]="draft().countryCode"
                                  (ngModelChange)="patch({ countryCode: $event })">
                            @if (!draft().countryCode) { <option value="">Kies een land…</option> }
                            @for (option of countryOptions(); track option.code) {
                              <option [value]="option.code">{{ option.name }}</option>
                            }
                          </select></div>
                        <div class="field"><label for="lr-contact">Contactpersoon</label>
                          <input class="input" id="lr-contact" [ngModel]="draft().contact"
                                 (ngModelChange)="patch({ contact: $event })" /></div>
                        <div class="field"><label for="lr-phone">Telefoon</label>
                          <input class="input" id="lr-phone" type="tel" [ngModel]="draft().phone"
                                 (ngModelChange)="patch({ phone: $event })" /></div>
                        <div class="field"><label for="lr-language">Taal</label>
                          <select class="select" id="lr-language" [ngModel]="draft().language"
                                  (ngModelChange)="patch({ language: $event })">
                            @for (option of languages; track option.code) {
                              <option [value]="option.code">{{ option.label }}</option>
                            }
                          </select></div>
                      </div>
                    }
                  }
                </div>

                @if (olderPreselected()) {
                  <div class="alert alert--info mt-12">
                    <span class="alert__icon">ℹ</span>
                    <div>Er bestaat al een oudere klant met hetzelfde e-mailadres. Die is voorgeselecteerd om dubbels
                      te vermijden. De offerte zelf blijft op de klant uit de aanvraag staan.</div>
                  </div>
                }
                @if (mismatch(); as chosen) {
                  <div class="alert alert--warn mt-12">
                    <span class="alert__icon">!</span>
                    <div>Het e-mailadres van de aanvraag ({{ d.request.email }}) wijkt af van het e-mailadres van de
                      klant ({{ chosen.email || 'geen e-mailadres' }}). Wie deze login krijgt, ziet de bedrijfsgegevens
                      van deze klant en stuurt aanvragen in naam van deze klant.</div>
                  </div>
                }
                <p class="hint lr-hint">
                  Na goedkeuren krijgt {{ d.request.email }} een mail in het {{ language(d.request.language) }} met een
                  link om zelf een wachtwoord te kiezen. De link werkt één keer en is beperkt geldig; na het
                  versturen zie je tot wanneer. Jullie zien of typen nooit een wachtwoord.
                </p>
              }

              <div class="field lr-note">
                <label for="lr-note">Notitie bij afwijzen <span class="opt"></span></label>
                <input class="input" id="lr-note" type="text" autocomplete="off" [maxLength]="noteMax"
                       [ngModel]="note()" (ngModelChange)="note.set($event ?? '')" />
                <span class="hint">Alleen voor intern gebruik; staat daarna bij de afgewezen aanvraag. De aanvrager
                  krijgt geen bericht.</span>
              </div>
            } @else if (d.request.status === 'APPROVED') {
              <div class="section-title">Beslissing</div>
              <dl class="lr-facts">
                <dt>Status</dt>
                <dd>Goedgekeurd door {{ d.request.decidedBy || 'onbekend' }} op {{ d.request.decidedAt | dateNl }}</dd>
                @if (d.request.customerCompany; as company) {
                  <dt>Klant</dt>
                  <dd><a [routerLink]="['/customers']" [queryParams]="{ q: company }">Gekoppeld aan {{ company }}</a></dd>
                }
                @if (d.existingAccount; as account) {
                  <dt>Login</dt>
                  <dd class="lr-login">
                    <span>{{ account.email }}</span>
                    <span class="badge" [class]="loginBadge(account)">{{ loginStatus(account) }}</span>
                    @if (linkText(account); as line) { <span class="lr-line">{{ line }}</span> }
                  </dd>
                }
              </dl>
              @if (d.existingAccount; as account) {
                @if (account.lastLinkError) {
                  <div class="alert alert--warn mt-12">
                    <span class="alert__icon">!</span>
                    <div>De laatste mail is niet vertrokken: {{ account.lastLinkError }}</div>
                  </div>
                }
                @if (account.status === 'DISABLED') {
                  <p class="hint lr-hint">Deze login is ingetrokken. Geef de login opnieuw bij de klant (Klanten, blok Websitelogin).</p>
                }
              }
            } @else {
              <div class="section-title">Beslissing</div>
              <dl class="lr-facts">
                <dt>Status</dt>
                <dd>Afgewezen door {{ d.request.decidedBy || 'onbekend' }} op {{ d.request.decidedAt | dateNl }}</dd>
                @if (d.request.decisionNote) { <dt>Notitie</dt><dd class="lr-message">{{ d.request.decisionNote }}</dd> }
              </dl>
            }
          } @else if (detailError()) {
            <div class="alert alert--danger lr-error" role="alert">
              <span class="alert__icon">!</span>
              <div>{{ detailError() }}</div>
              <button class="btn btn--sm" type="button" (click)="reloadDetail()">Opnieuw proberen</button>
            </div>
          } @else {
            <app-skeleton kind="lines" [rows]="6" />
          }
        </div>
        <div foot class="lr-foot">
          @if (detail(); as d) {
            @if (d.request.status === 'PENDING') {
              <button class="btn btn--danger" type="button" [disabled]="busy()" (click)="reject(d)">Afwijzen</button>
              <span class="spacer"></span>
              <button class="btn" type="button" (click)="close()">Sluiten</button>
              @if (d.request.source === 'NEW_LINK') {
                <button class="btn btn--primary" type="button" [disabled]="busy() || !linkAlert().canSend" (click)="approve(d)">
                  {{ busyHere() ? 'Bezig…' : 'Nieuwe link sturen' }}
                </button>
              } @else {
                @if (!choice()) { <span class="hint lr-foot__hint" id="lr-approve-hint">Kies eerst een klant</span> }
                <button class="btn btn--primary lr-foot__main" type="button" [disabled]="busy() || !approvable()"
                        [attr.aria-describedby]="choice() ? null : 'lr-approve-hint'" (click)="approve(d)">
                  {{ busyHere() ? 'Bezig…' : 'Goedkeuren en link sturen' }}
                </button>
              }
            } @else {
              <span class="spacer"></span>
              <button class="btn" type="button" (click)="close()">Sluiten</button>
              @if (resendable(d)) {
                <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="sendLink(d)">
                  {{ busyHere() ? 'Bezig…' : 'Nieuwe link sturen' }}
                </button>
              }
            }
          } @else {
            <span class="spacer"></span>
            <button class="btn" type="button" (click)="close()">Sluiten</button>
          }
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .lr-segments { min-width: 300px; }
    .lr-row { width: 100%; border: 0; border-bottom: 1px solid var(--line); font: inherit; text-align: left; cursor: pointer; }
    .lr-row:last-child { border-bottom: 0; }
    .lr-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
    /* On a phone the row is too narrow for one line: the e-mail address and the date are what staff decide on. */
    .lr-meta span { display: inline-block; max-width: 100%; overflow-wrap: anywhere; vertical-align: top; }
    .lr-meta span:not(:last-child)::after { content: '·'; margin: 0 0.35em; }
    .lr-error { align-items: center; }
    .lr-error > div { flex: 1; min-width: 0; }
    .lr-error .btn { flex: none; }
    .lr-more { display: flex; justify-content: center; margin-top: 12px; }
    .lr-facts { display: grid; grid-template-columns: minmax(96px, max-content) minmax(0, 1fr); gap: 6px 14px; font-size: 13.5px; }
    .lr-facts dt { color: var(--muted); }
    .lr-facts dd { min-width: 0; overflow-wrap: anywhere; }
    .lr-login { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
    .lr-login > span:first-child { min-width: 0; }
    .lr-message { white-space: pre-line; }
    .lr-line { flex-basis: 100%; color: var(--ink-2); font-size: 12.5px; }
    .lr-later { display: grid; gap: 8px; justify-items: start; margin-top: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; }
    .lr-later h3 { font-size: 13.5px; font-weight: 650; }
    .lr-later .lr-facts { width: 100%; }
    .lr-later .btn { max-width: 100%; height: auto; white-space: normal; text-align: left; }
    .lr-choices { display: grid; gap: 8px; }
    .lr-choice { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: start; gap: 10px; padding: 10px 12px;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface); cursor: pointer; font-size: 13.5px; }
    .lr-choice--on { border-color: var(--rose); background: var(--rose-soft); }
    .lr-choice input { width: 18px; height: 18px; margin-top: 1px; accent-color: var(--rose); }
    .lr-choice > span { display: grid; min-width: 0; overflow-wrap: anywhere; }
    .lr-choice small { color: var(--ink-2); font-size: 12px; }
    .lr-nested { display: grid; gap: 8px; margin-left: 12px; padding-left: 12px; border-left: 2px solid var(--line); }
    .lr-nested.form-grid { gap: 0 12px; }
    .lr-foot { display: flex; flex: 1; flex-wrap: wrap; gap: 8px; min-width: 0; }
    /* Why the approve button is off, next to that button instead of somewhere in the scrolling body. */
    .lr-foot__hint { order: -1; flex-basis: 100%; text-align: right; font-size: 12.5px; color: var(--ink-2); }
    @media (max-width: 679px) {
      /* The long approve label gets a row of its own; three buttons side by side cut it off at 375 px. */
      .lr-foot__main { order: 2; flex-basis: 100%; }
      .lr-foot__hint { order: 1; text-align: center; }
      .lr-foot .spacer { display: none; }
    }
    .lr-hint { margin-top: 12px; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
    .lr-note { margin: 16px 0 0; }
  `,
})
export class LoginRequestsPage {
  private readonly api = inject(LoginRequestApi);
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly changes = inject(ChangeDetectorRef);
  readonly work = inject(WorkQueue);
  readonly desktop = inject(DesktopViewport);

  readonly segments = SEGMENTS;
  readonly languages = LANGUAGES;
  readonly noteMax = REJECT_NOTE_MAX;

  readonly segment = signal<LoginRequestSegment>('open');
  readonly rows = signal<LoginRequest[]>([]);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal(false);
  readonly more = signal(false);
  /** How many pages of the current segment are on screen. */
  private pages = 1;
  /** Drops the answer of a list call that a newer one has overtaken. */
  private listVersion = 0;

  readonly openId = signal<number | null>(null);
  /** The row the sheet was opened from: its title before the detail arrives. */
  private readonly openRow = signal<LoginRequest | null>(null);
  readonly detail = signal<LoginRequestDetail | null>(null);
  readonly detailError = signal<string | null>(null);
  private detailVersion = 0;
  /** True from opening a sheet until its first detail arrived: that load starts from the preselection. */
  private freshSheet = false;

  readonly choice = signal<LoginChoice | null>(null);
  readonly searching = signal(false);
  readonly query = signal('');
  readonly draft = signal<NewCustomerDraft>(EMPTY_DRAFT);
  /** The optional internal note for a rejection. */
  readonly note = signal('');
  private readonly customers = signal<Customer[]>([]);
  /** "Geen klant gevonden" is only true once the customers are there. */
  readonly customersState = signal<'idle' | 'loading' | 'failed' | 'ready'>('idle');
  private readonly countries = signal<Country[]>([]);
  /** The request an action runs on; guards a double tap. */
  private readonly busyId = signal<number | null>(null);
  readonly busy = computed(() => this.busyId() !== null);
  /** The running action belongs to the sheet that is open now. */
  readonly busyHere = computed(() => this.busyId() !== null && this.busyId() === this.openId());

  readonly subtitle = computed(() => subtitle(this.work.loginRequestCount()));
  readonly intakeFull = computed(() => intakeFullTexts(this.work.loginIntakeFullSources()));
  readonly sheetTitle = computed(() =>
    ('Login-aanvraag ' + (this.detail()?.request.reference ?? this.openRow()?.reference ?? '')).trim());

  readonly locked = computed(() => { const detail = this.detail(); return !!detail && choiceLocked(detail); });
  readonly accountAlert = computed(() => existingAccountAlert(this.detail()?.existingAccount));
  readonly linkAlert = computed(() => newLinkAlert(this.detail()?.existingAccount?.status ?? null));
  readonly approvable = computed(() => canApprove(this.choice(), this.draft()));

  /** The matches, with the holder of the login in front even when the server left it out. */
  readonly matchRows = computed<LoginRequestMatch[]>(() => {
    const detail = this.detail();
    if (!detail) return [];
    const fixed = this.locked() ? defaultChoice(detail) : null;
    if (fixed?.kind !== 'customer' || detail.matches.some((match) => match.customerId === fixed.customerId)) {
      return detail.matches;
    }
    return [{
      customerId: fixed.customerId, company: fixed.company, contact: null, email: fixed.email, vatNumber: null,
      countryCode: null, city: null, matchedOn: ['LOGIN'], logins: [],
    }, ...detail.matches];
  });

  readonly searchResults = computed(() => {
    const needle = this.query().toLowerCase().trim();
    if (!needle) return [];
    const matched = new Set(this.matchRows().map((match) => match.customerId));
    return this.customers()
      .filter((customer) => customer.id !== null && !matched.has(customer.id)
        && [customer.company, customer.contact, customer.city, customer.vatNumber]
          .join(' ').toLowerCase().includes(needle))
      .slice(0, 8);
  });

  /** The configured countries, plus the applicant's own when it is not one of them. */
  readonly countryOptions = computed(() => {
    const options = this.countries().map((country) => ({ code: country.code, name: country.name }));
    const code = this.draft().countryCode;
    if (code && !options.some((option) => option.code === code)) options.push({ code, name: countryName(code) });
    return options;
  });

  readonly olderPreselected = computed(() => {
    const detail = this.detail();
    const choice = this.choice();
    if (!detail || choice?.kind !== 'customer' || this.searching() || !olderCustomerPreselected(detail)) return false;
    const preset = defaultChoice(detail);
    return preset?.kind === 'customer' && preset.customerId === choice.customerId;
  });

  /** The chosen customer when binding the login to it needs an explicit yes. */
  readonly mismatch = computed(() => {
    const detail = this.detail();
    const choice = this.choice();
    return detail && choice?.kind === 'customer' && needsMismatchConfirm(detail, choice) ? choice : null;
  });

  constructor() {
    void this.work.refresh();
    void this.sales.countries().then((countries) => this.countries.set(countries), () => undefined);
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const status = params.get('status');
      const segment: LoginRequestSegment = status === 'goedgekeurd' || status === 'afgewezen' ? status : 'open';
      if (segment !== this.segment() || this.listVersion === 0) {
        this.segment.set(segment);
        this.rows.set([]);
        void this.reload();
      }
      /* The team mail links to ?open=<id>; the sheet loads its own row, so it
         also opens a request that is not on the loaded page. */
      const id = Number(params.get('open'));
      if (Number.isInteger(id) && id > 0 && id !== this.openId()) this.open(id, null);
    });
  }

  pickSegment(segment: string): void {
    void this.router.navigate([], {
      relativeTo: this.route, queryParams: { status: segment === 'open' ? null : segment },
      queryParamsHandling: 'merge',
    });
  }

  /** Back to the first page of the current segment. */
  reload(): Promise<void> {
    return this.loadPages(1, false);
  }

  loadMore(): Promise<void> {
    if (this.loadingMore() || this.loading()) return Promise.resolve();
    return this.loadPages(this.pages + 1, true);
  }

  /**
   * Loads the list from page 0 up to the given number of pages and replaces
   * the rows. Also for Meer laden and after an action: the open list
   * shrinks while requests are decided, so the next page by offset alone
   * would skip waiting requests and leave decided rows on screen.
   */
  private async loadPages(count: number, appending: boolean): Promise<void> {
    const version = ++this.listVersion;
    (appending ? this.loadingMore : this.loading).set(true);
    this.error.set(false);
    try {
      const status = segmentToStatus(this.segment());
      const merged = mergePages(await Promise.all(
        Array.from({ length: Math.max(count, 1) }, (_, page) => this.api.list(status, page))));
      if (version !== this.listVersion) return;
      this.pages = merged.pages;
      this.rows.set(merged.rows);
      this.more.set(merged.more);
    } catch {
      if (version === this.listVersion) this.error.set(true);
    } finally {
      if (version === this.listVersion) {
        this.loading.set(false);
        this.loadingMore.set(false);
      }
    }
  }

  /* ---------------------------------------------------------------- sheet */

  open(id: number, row: LoginRequest | null): void {
    this.openId.set(id);
    this.openRow.set(row);
    this.detail.set(null);
    /* A sheet never starts from what was chosen or typed in another request's sheet. */
    this.choice.set(null);
    this.searching.set(false);
    this.query.set('');
    this.draft.set(EMPTY_DRAFT);
    this.note.set('');
    this.freshSheet = true;
    void this.loadDetail(true);
  }

  close(): void {
    this.detailVersion++;
    this.openId.set(null);
    this.openRow.set(null);
    this.detail.set(null);
    this.detailError.set(null);
    if (this.route.snapshot.queryParamMap.has('open')) {
      void this.router.navigate([], {
        relativeTo: this.route, queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true,
      });
    }
  }

  reloadDetail(): void {
    void this.loadDetail(true);
  }

  /** @param reset true when the sheet opens: the choice starts from the preselection again. */
  private async loadDetail(reset: boolean): Promise<void> {
    const id = this.openId();
    if (id === null) return;
    const version = ++this.detailVersion;
    this.detailError.set(null);
    try {
      const detail = await this.api.detail(id);
      if (version !== this.detailVersion) return;
      this.detail.set(detail);
      if (reset || this.freshSheet || detail.request.status !== 'PENDING') {
        this.freshSheet = false;
        this.choice.set(defaultChoice(detail));
        this.searching.set(false);
        this.query.set('');
        this.draft.set(draftFromRequest(detail.request));
      } else {
        /* Same sheet, fresh facts: a choice the new detail no longer allows must not stay behind unseen. */
        this.choice.set(reconcileChoice(detail, this.choice(), this.searching()));
        if (choiceLocked(detail)) {
          this.searching.set(false);
          this.query.set('');
        }
      }
    } catch (failure) {
      if (version !== this.detailVersion) return;
      this.detail.set(null);
      this.detailError.set(messageOf(failure, 'De login-aanvraag kon niet geladen worden. Controleer de verbinding.'));
    }
  }

  isChosen(customerId: number | null): boolean {
    const choice = this.choice();
    return choice?.kind === 'customer' && choice.customerId === customerId;
  }

  chooseMatch(match: LoginRequestMatch): void {
    this.searching.set(false);
    this.choice.set(choiceOf(match));
  }

  chooseSearch(): void {
    this.searching.set(true);
    this.choice.set(null);
    void this.loadCustomers();
  }

  async loadCustomers(): Promise<void> {
    if (this.customersState() === 'loading' || this.customersState() === 'ready') return;
    this.customersState.set('loading');
    try {
      this.customers.set(await this.sales.customers());
      this.customersState.set('ready');
    } catch {
      this.customersState.set('failed');
    }
  }

  /** A searched customer that the new query no longer shows is no longer the choice. */
  setQuery(query: string): void {
    this.query.set(query);
    const choice = this.choice();
    if (this.searching() && choice?.kind === 'customer'
      && !this.searchResults().some((customer) => customer.id === choice.customerId)) {
      this.choice.set(null);
    }
  }

  chooseCustomer(customer: Customer): void {
    if (customer.id === null) return;
    this.choice.set({ kind: 'customer', customerId: customer.id, company: customer.company, email: customer.email || null });
  }

  chooseNew(): void {
    this.searching.set(false);
    this.choice.set({ kind: 'new' });
  }

  /** Make the new customer from one later version instead of from the first request. */
  useLater(entry: LoginRequestLaterSubmission): void {
    this.draft.set(draftFromLater(entry));
    this.chooseNew();
  }

  patch(changes: Partial<NewCustomerDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  /* -------------------------------------------------------------- actions */

  approve(detail: LoginRequestDetail): void {
    if (this.busy()) return;
    const request = detail.request;
    if (request.source === 'NEW_LINK') {
      if (!this.linkAlert().canSend) return;
      void this.sendApproval(request, { customerId: null, newCustomer: null, confirmEmailMismatch: false });
      return;
    }
    const choice = this.choice();
    if (!choice || !this.approvable()) return;
    if (choice.kind === 'new') {
      void this.sendApproval(request, { customerId: null, newCustomer: { ...this.draft() }, confirmEmailMismatch: false });
      return;
    }
    if (!needsMismatchConfirm(detail, choice)) {
      void this.sendApproval(request, { customerId: choice.customerId, newCustomer: null, confirmEmailMismatch: false });
      return;
    }
    this.ui.confirm({
      title: 'Afwijkend e-mailadres',
      message: 'Het e-mailadres <b>' + escapeHtml(request.email) + '</b> staat niet bij klant <b>'
        + escapeHtml(choice.company) + '</b>. Hoort deze persoon zeker bij deze klant?',
      confirmLabel: 'Ja, login geven', danger: true,
    }, () => void this.sendApproval(request, { customerId: choice.customerId, newCustomer: null, confirmEmailMismatch: true }));
  }

  /**
   * The answer of an action belongs to the request it was started for. Staff
   * may have closed that sheet and opened another one meanwhile, so the sheet
   * is only closed or loaded again when it still shows that request.
   */
  private async sendApproval(request: LoginRequest, body: ApproveLoginRequest): Promise<void> {
    if (this.busy()) return;
    this.busyId.set(request.id);
    const index = this.rowIndex(request.id);
    let closed = false;
    try {
      const result = await this.api.approve(request.id, body);
      if (result.invitation.sent) {
        this.ui.toast(request.source === 'NEW_LINK'
          ? this.linkSentText(result.account, result.invitation)
          : 'Goedgekeurd. De link is verstuurd naar ' + result.account.email + ' en geldig tot '
            + dateText(result.invitation.expiresAt));
        closed = this.closeIfOpen(request.id);
      } else {
        /* The approval stands; the sheet stays open in its decided state, which has the retry button. */
        this.ui.toast('Goedgekeurd, maar de mail is niet vertrokken. Stuur de link opnieuw met Nieuwe link sturen.', 'err');
        await this.reloadIfOpen(request.id);
      }
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Goedkeuren mislukt'), 'err');
      await this.reloadIfOpen(request.id);
    } finally {
      this.busyId.set(null);
      await this.afterAction();
      if (closed) this.focusList(index);
    }
  }

  reject(detail: LoginRequestDetail): void {
    if (this.busy()) return;
    const request = detail.request;
    this.ui.confirm({
      title: 'Aanvraag afwijzen', message: rejectMessage(request.companyName, request.repeatCount),
      confirmLabel: 'Afwijzen', danger: true,
    }, () => {
      if (this.openId() === request.id) void this.sendReject(request, rejectNote(this.note()));
    });
  }

  private async sendReject(request: LoginRequest, note: string | null): Promise<void> {
    if (this.busy()) return;
    this.busyId.set(request.id);
    const index = this.rowIndex(request.id);
    let closed = false;
    try {
      await this.api.reject(request.id, note);
      this.ui.toast('Aanvraag afgewezen');
      closed = this.closeIfOpen(request.id);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Afwijzen mislukt'), 'err');
      await this.reloadIfOpen(request.id);
    } finally {
      this.busyId.set(null);
      await this.afterAction();
      if (closed) this.focusList(index);
    }
  }

  /** A decided request: send the link of its login again, for instance after a failed mail. */
  async sendLink(detail: LoginRequestDetail): Promise<void> {
    const accountId = detail.request.accountId;
    if (this.busy() || accountId === null) return;
    this.busyId.set(detail.request.id);
    try {
      const result = await this.api.sendLink(accountId);
      if (result.invitation.sent) this.ui.toast(this.linkSentText(result.account, result.invitation));
      else this.ui.toast('De mail is niet vertrokken. Probeer het opnieuw met Nieuwe link sturen.', 'err');
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Link sturen mislukt'), 'err');
    } finally {
      this.busyId.set(null);
      await this.reloadIfOpen(detail.request.id);
      await this.afterAction();
    }
  }

  private closeIfOpen(requestId: number): boolean {
    if (this.openId() !== requestId) return false;
    this.close();
    return true;
  }

  private async reloadIfOpen(requestId: number): Promise<void> {
    if (this.openId() === requestId) await this.loadDetail(false);
  }

  private rowIndex(requestId: number): number {
    return Math.max(this.rows().findIndex((row) => row.id === requestId), 0);
  }

  /**
   * A decided row leaves the list, and the keyboard focus the sheet handed
   * back to it would fall to the top of the document. It goes to the row
   * that took its place, or to the segments when the list is empty.
   */
  private focusList(index: number): void {
    if (this.openId() !== null) return;
    this.changes.detectChanges();
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const host = this.host.nativeElement;
    const rows = host.querySelectorAll<HTMLElement>('.lr-row');
    (rows[Math.min(index, rows.length - 1)] ?? host.querySelector<HTMLElement>('app-segmented button'))?.focus();
  }

  private linkSentText(account: CustomerLogin, invitation: LoginInvitation): string {
    return 'Nieuwe link verstuurd naar ' + account.email + ', geldig tot ' + dateText(invitation.expiresAt);
  }

  /** Every action moves the count and the lists; the pages that were loaded stay loaded. */
  private async afterAction(): Promise<void> {
    await Promise.all([this.work.refresh(true), this.loadPages(this.pages, false)]);
  }

  /** The decided sheet offers a new link while its login is not withdrawn. */
  resendable(detail: LoginRequestDetail): boolean {
    return detail.request.status === 'APPROVED' && detail.request.accountId !== null
      && !!detail.existingAccount && detail.existingAccount.status !== 'DISABLED';
  }

  contactParts(row: LoginRequest): string[] {
    return rowContactParts(row);
  }

  factParts(row: LoginRequest): string[] {
    return rowFactParts(row, countryName(row.companyCountryCode));
  }

  loginBadges(match: LoginRequestMatch): LoginRequestMatch['logins'] {
    return matchLoginBadges(match, this.detail()?.existingAccount?.id);
  }

  /* ---------------------------------------------------------------- texts */

  source(entry: { source: LoginRequest['source']; salesOrderNumber?: string | null }): string {
    return sourceLabel(entry);
  }

  badge(row: LoginRequest): { label: string; css: string } {
    return statusBadge(row.status);
  }

  applicants(request: LoginRequest): LoginRequestLaterSubmission[] {
    return applicantEntries(request);
  }

  marker(request: LoginRequest): LoginRequestLaterSubmission | null {
    return newLinkMarker(request);
  }

  reasonLabel(reason: LoginRequestMatch['matchedOn'][number]): string {
    return matchReasonLabel(reason);
  }

  country(code: string | null): string {
    return countryName(code);
  }

  language(code: string | null): string {
    return LANGUAGES.find((option) => option.code === (code ?? '').toUpperCase())?.label ?? code ?? '';
  }

  matchLine(match: LoginRequestMatch): string {
    return [match.company, match.city, countryName(match.countryCode)].filter(Boolean).join(' · ');
  }

  customerLine(customer: Customer): string {
    return [customer.company, customer.city, countryName(customer.countryCode)].filter(Boolean).join(' · ');
  }

  loginStatus(account: CustomerLogin): string {
    return loginStatusLabel(account.status);
  }

  loginBadge(account: CustomerLogin): string {
    return account.status === 'ACTIVE' ? 'badge--ok' : account.status === 'INVITED' ? 'badge--gold' : 'badge--neutral';
  }

  linkText(account: CustomerLogin): string | null {
    return linkLine(account, new Date());
  }
}
