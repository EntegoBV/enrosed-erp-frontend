import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ProspectApi, Prospect, ProspectInput, ProspectDetail, ProspectEmailSummary, ProspectActivityInput, ProspectChannel, ProspectStatus } from '../../core/api/prospect-api';
import { messageOf } from '../../core/api/errors';
import { ISO_COUNTRIES, countryName } from '../../core/api/geo';
import { LANGUAGES } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { PROSPECT_STATUSES, PROSPECT_CHANNELS, ACTIVITY_STATUSES, ACTIVITY_TYPES, blankProspect, prospectStatusLabel, prospectWebLink, instagramLink, prospectPayload, prospectValidation, brusselsDate, localDateTime } from './prospect-state';
import { parseProspectImport, matchesProspectIdentity, recordImportedActivity, ProspectImportFile } from './prospect-import';

type ActivityDraft = Omit<ProspectActivityInput, 'occurredAt'> & { localTime: string };
const blankActivity = (): ActivityDraft => ({ channel: 'NOTE', type: 'NOTE', status: 'COMPLETED', subject: '', body: '', localTime: localDateTime(), externalId: 'manual:' + crypto.randomUUID(), attachmentName: '', sourceUrl: '' });

@Component({
  selector: 'app-prospects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Skeleton, Sheet],
  template: `
    <app-page-header title="Prospects" subtitle="Groothandels & contactopvolging">
      <button class="btn btn--primary btn--sm" type="button" (click)="openEditor()">+ Nieuw</button>
    </app-page-header>
    <div class="content prospect-page">
      <section class="card prospect-summary" aria-label="E-mails vandaag">
        <div><span class="prospect-eyebrow">E-mails vandaag</span>
          @if (summary(); as count) {
            <div class="prospect-count"><strong>{{ count.sent }}</strong><span>/ {{ count.limit }} verstuurd</span></div>
            <p>{{ count.scheduled }} ingepland · {{ count.reserved }} gereserveerd · {{ count.remaining }} beschikbaar</p>
          } @else if (summaryError()) {
            <p role="alert">{{ summaryError() }}</p>
          } @else { <app-skeleton kind="lines" [rows]="2" /> }
        </div>
        <div class="prospect-progress">
          <span>{{ summary()?.date || today() }} · Brussel</span>
          @if (summary(); as count) {
            <progress [value]="count.sent + count.reserved + count.scheduled" [max]="count.limit" aria-label="Verstuurde, ingeplande en gereserveerde e-mails"></progress>
            <small>Dagdoel: {{ count.limit }} e-mails. Ingepland en gereserveerd tellen mee.</small>
          }
          <button class="btn btn--sm" type="button" (click)="refresh()" [disabled]="loading() || summaryLoading()">Vernieuwen</button>
        </div>
      </section>

      <div class="prospect-layout" [class.prospect-layout--selected]="selectedId() !== null">
        <section class="card prospect-directory" aria-label="Prospectlijst">
          <div class="prospect-import-bar"><label class="btn btn--sm prospect-import-picker">Importeer contactlog<input type="file" accept=".json,application/json" aria-label="Contactlog kiezen" (change)="readImport($event)" [disabled]="importing()" /></label><span>JSON · acties & planning</span></div>
          <div class="prospect-filters">
            <label class="prospect-search" for="prospect-search">Zoeken
              <input id="prospect-search" class="input" type="search" placeholder="Bedrijf, e-mail of groep…"
                [ngModel]="search()" (ngModelChange)="searchChanged($event)" />
            </label>
            <label for="prospect-status-filter">Status
              <select id="prospect-status-filter" class="select" [ngModel]="statusFilter()" (ngModelChange)="filterChanged('status', $event)">
                <option value="">Alle statussen</option>
                @for (status of statuses; track status.value) { <option [value]="status.value">{{ status.label }}</option> }
              </select>
            </label>
            <label for="prospect-country-filter">Land
              <select id="prospect-country-filter" class="select" [ngModel]="countryFilter()" (ngModelChange)="filterChanged('countryCode', $event)">
                <option value="">Alle landen</option>
                @for (country of countries; track country.code) { <option [value]="country.code">{{ country.name }}</option> }
              </select>
            </label>
          </div>
          <div class="prospect-list-heading"><strong>{{ total() }} prospects</strong><span>Bedrijf / laatste contact</span></div>
          @if (listError()) {
            <div class="prospect-empty" role="alert"><p>{{ listError() }}</p><button class="btn" (click)="loadList()">Opnieuw proberen</button></div>
          } @else if (loading()) {
            <app-skeleton kind="list" [rows]="5" />
          } @else {
            <div class="prospect-list">
              @for (item of items(); track item.id) {
                <button class="prospect-row" [class.prospect-row--active]="selectedId() === item.id" type="button" (click)="select(item.id)" [attr.aria-current]="selectedId() === item.id ? 'true' : null">
                  <span class="prospect-avatar" aria-hidden="true">{{ item.businessName.slice(0, 1).toUpperCase() }}</span>
                  <span class="prospect-row-copy"><strong>{{ item.businessName }}</strong><span>{{ countryLabel(item.countryCode) }} · {{ item.language || 'Taal onbekend' }}</span>
                    <small>{{ item.email || (item.instagramHandle ? '@' + item.instagramHandle : 'Nog geen contactadres') }}</small></span>
                  <span class="prospect-row-meta"><span class="prospect-badge" [class.prospect-badge--stop]="item.status === 'DO_NOT_CONTACT'">{{ statusLabel(item.status) }}</span><small>{{ item.lastContactAt ? dateLabel(item.lastContactAt) : 'Nog niet benaderd' }}</small></span>
                </button>
              } @empty {
                <div class="prospect-empty"><h2>Geen prospects gevonden</h2><p>Pas je filters aan of voeg een nieuwe groothandel toe.</p><button class="btn" type="button" (click)="openEditor()">Prospect toevoegen</button></div>
              }
            </div>
          }
          <div class="prospect-pagination">
            <button class="btn btn--sm" type="button" [disabled]="page() === 0 || loading()" (click)="goPage(page() - 1)">Vorige</button>
            <span>Pagina {{ page() + 1 }} van {{ pageCount() }}</span>
            <button class="btn btn--sm" type="button" [disabled]="(page() + 1) * 50 >= total() || loading()" (click)="goPage(page() + 1)">Volgende</button>
          </div>
        </section>

        <section class="card prospect-detail" aria-label="Prospectgegevens">
          @if (selectedId() !== null) {
            <button class="btn btn--sm prospect-back" type="button" (click)="select(null)">‹ Alle prospects</button>
          }
          @if (detailLoading()) { <app-skeleton kind="card" [rows]="4" /> }
          @else if (detailError()) {
            <div class="prospect-empty" role="alert"><p>{{ detailError() }}</p><button class="btn" (click)="loadDetail(selectedId())">Opnieuw proberen</button></div>
          } @else if (detail(); as data) {
            <div class="prospect-detail-head">
              <span class="prospect-eyebrow">{{ countryLabel(data.prospect.countryCode) }} · {{ data.prospect.language || 'Taal onbekend' }}</span>
              <h2>{{ data.prospect.businessName }}</h2>
              <span class="prospect-badge" [class.prospect-badge--stop]="data.prospect.status === 'DO_NOT_CONTACT'">{{ statusLabel(data.prospect.status) }}</span>
              <div class="prospect-actions"><button class="btn btn--sm" type="button" (click)="openEditor(data.prospect)">Bewerken</button><button class="btn btn--primary btn--sm" type="button" (click)="openActivity()">+ Actie registreren</button></div>
            </div>
            @if (data.prospect.status === 'DO_NOT_CONTACT') {
              <div class="prospect-stop" role="status"><strong>Niet benaderen</strong><p>Dit bedrijf heeft een contactblokkade. Leg alleen relevante interne notities of ontvangen reacties vast.</p></div>
            }
            <dl class="prospect-facts">
              <div><dt>E-mail</dt><dd>{{ data.prospect.email || 'Niet ingevuld' }}</dd></div>
              <div><dt>Website</dt><dd>@if (webLink(data.prospect.website); as url) { <a [href]="url" target="_blank" rel="noopener noreferrer">{{ data.prospect.website }} ↗</a> } @else { Niet ingevuld }</dd></div>
              <div><dt>Instagram</dt><dd>@if (instagramUrl(data.prospect.instagramHandle); as url) { <a [href]="url" target="_blank" rel="noopener noreferrer">&#64;{{ data.prospect.instagramHandle }} ↗</a> } @else { Niet ingevuld }</dd></div>
              <div><dt>Groep / moederbedrijf</dt><dd>{{ data.prospect.groupKey || 'Geen groep gekoppeld' }}</dd></div>
              <div><dt>Bron</dt><dd>{{ data.prospect.sourceType || 'Niet ingevuld' }} @if (webLink(data.prospect.sourceUrl); as url) { <a [href]="url" target="_blank" rel="noopener noreferrer">Bron bekijken ↗</a> }</dd></div>
              <div><dt>Laatste contact</dt><dd>{{ data.prospect.lastContactAt ? dateLabel(data.prospect.lastContactAt) : 'Nog niet benaderd' }}</dd></div>
            </dl>
            @if (data.prospect.notes) { <div class="prospect-notes"><h3>Notities</h3><p>{{ data.prospect.notes }}</p></div> }
            <div class="prospect-timeline-head"><h3>Contactgeschiedenis</h3><span>{{ data.activities.length }} registraties</span></div>
            <ol class="prospect-timeline">
              @for (activity of data.activities; track activity.id) {
                <li><div class="prospect-activity-meta"><strong>{{ channelLabel(activity.channel) }} · {{ activityTypeLabel(activity.type) }}</strong><span class="prospect-badge">{{ activityStatusLabel(activity.status) }}</span></div>
                  <time [attr.datetime]="activity.occurredAt">{{ dateLabel(activity.occurredAt) }} · {{ activity.createdBy }}</time>
                  @if (activity.subject) { <h4>{{ activity.subject }}</h4> }
                  @if (activity.body) { <p>{{ activity.body }}</p> }
                  @if (activity.attachmentName) { <small>Bijlage: {{ activity.attachmentName }}</small> }
                  @if (webLink(activity.sourceUrl); as url) { <a [href]="url" target="_blank" rel="noopener noreferrer">Bewijs / bron ↗</a> }
                  @if (activity.externalId) { <details><summary>Registratiegegevens</summary><small>Referentie: {{ activity.externalId }}</small></details> }
                </li>
              } @empty { <li class="prospect-empty">Nog geen contactgeschiedenis. Registreer je eerste actie.</li> }
            </ol>
          } @else { <div class="prospect-empty prospect-welcome"><span aria-hidden="true">↗</span><h2>Van kennismaking naar contact</h2><p>Kies een prospect om bedrijfsgegevens en eerdere acties te bekijken.</p></div> }
        </section>
      </div>
    </div>

    @if (editing()) {
      <app-sheet [title]="editingId() ? 'Prospect bewerken' : 'Nieuwe prospect'" [wide]="true" (closed)="closeEditor()">
        <form body id="prospect-form" (ngSubmit)="saveProspect()">
          <fieldset [disabled]="saving()" class="prospect-fieldset form-grid">
            <div class="field span-2"><label for="pr-name" class="req">Bedrijfsnaam</label><input id="pr-name" name="businessName" class="input" required maxlength="200" [ngModel]="draft().businessName" (ngModelChange)="patchDraft({businessName: $event})" /></div>
            <div class="field"><label for="pr-country" class="req">Land</label><input id="pr-country" name="countryCode" class="input" required maxlength="2" list="prospect-countries" placeholder="Bijv. FR" [ngModel]="draft().countryCode" (ngModelChange)="patchDraft({countryCode: $event.toUpperCase()})" /><datalist id="prospect-countries">@for (country of countries; track country.code) { <option [value]="country.code">{{ country.name }}</option> }</datalist></div>
            <div class="field"><label for="pr-language">Taal</label><select id="pr-language" name="language" class="select" [ngModel]="draft().language" (ngModelChange)="patchDraft({language: $event})">@for (language of languages; track language.code) { <option [value]="language.code">{{ language.label }}</option> }</select></div>
            <div class="field"><label for="pr-email">E-mail</label><input id="pr-email" name="email" type="email" class="input" maxlength="254" [ngModel]="draft().email" (ngModelChange)="patchDraft({email: $event})" /></div>
            <div class="field"><label for="pr-instagram">Instagram-gebruikersnaam</label><input id="pr-instagram" name="instagramHandle" class="input" placeholder="bedrijfsnaam" maxlength="31" [ngModel]="draft().instagramHandle" (ngModelChange)="patchDraft({instagramHandle: $event})" /></div>
            <div class="field span-2"><label for="pr-website">Website</label><input id="pr-website" name="website" class="input" placeholder="https://…" maxlength="2000" [ngModel]="draft().website" (ngModelChange)="patchDraft({website: $event})" /></div>
            <div class="field"><label for="pr-group">Groep / moederbedrijf</label><input id="pr-group" name="groupKey" class="input" maxlength="200" [ngModel]="draft().groupKey" (ngModelChange)="patchDraft({groupKey: $event})" /><small class="hint">Gebruik dezelfde groepsnaam voor verbonden bedrijven.</small></div>
            <div class="field"><label for="pr-status">Status</label><select id="pr-status" name="status" class="select" [ngModel]="draft().status" (ngModelChange)="patchDraft({status: $event})">@for (status of statuses; track status.value) { <option [value]="status.value">{{ status.label }}</option> }</select></div>
            <div class="field"><label for="pr-source-type">Brontype</label><input id="pr-source-type" name="sourceType" class="input" maxlength="64" placeholder="Website, beurs, Instagram…" [ngModel]="draft().sourceType" (ngModelChange)="patchDraft({sourceType: $event})" /></div>
            <div class="field"><label for="pr-source">Bronlink</label><input id="pr-source" name="sourceUrl" class="input" maxlength="2000" placeholder="https://…" [ngModel]="draft().sourceUrl" (ngModelChange)="patchDraft({sourceUrl: $event})" /></div>
            <div class="field span-2"><label for="pr-notes">Notities</label><textarea id="pr-notes" name="notes" class="textarea" rows="4" [ngModel]="draft().notes" (ngModelChange)="patchDraft({notes: $event})"></textarea></div>
            <label class="prospect-optout span-2"><input type="checkbox" [checked]="draft().status === 'DO_NOT_CONTACT'" (change)="setOptOut($any($event.target).checked)" /><span><strong>Niet meer benaderen</strong><small>Blokkeer verdere uitgaande contactacties voor dit bedrijf.</small></span></label>
          </fieldset>
          @if (formError()) { <p class="prospect-error" role="alert">{{ formError() }}</p> }
        </form>
        <div foot class="prospect-sheet-foot"><button class="btn" type="button" [disabled]="saving()" (click)="closeEditor()">Annuleren</button><button class="btn btn--primary" type="submit" form="prospect-form" [disabled]="saving()">{{ saving() ? 'Opslaan…' : 'Opslaan' }}</button></div>
      </app-sheet>
    }

    @if (activityOpen()) {
      <app-sheet title="Actie registreren" [wide]="true" (closed)="closeActivity()">
        <form body id="prospect-activity-form" (ngSubmit)="saveActivity()">
          <p class="prospect-log-hint">Leg vast wat je hebt gedaan of ontvangen. Er wordt vanuit dit formulier geen bericht verstuurd.</p>
          <fieldset [disabled]="saving()" class="prospect-fieldset form-grid">
            <div class="field"><label for="pa-channel">Kanaal</label><select id="pa-channel" name="channel" class="select" [ngModel]="activityDraft().channel" (ngModelChange)="changeChannel($event)">@for (channel of channels; track channel.value) { <option [value]="channel.value">{{ channel.label }}</option> }</select></div>
            <div class="field"><label for="pa-type">Actie</label><select id="pa-type" name="type" class="select" [ngModel]="activityDraft().type" (ngModelChange)="patchActivity({type: $event})">@for (type of activityTypes; track type.value) { <option [value]="type.value">{{ type.label }}</option> }</select></div>
            <div class="field"><label for="pa-status">Resultaat</label><select id="pa-status" name="activityStatus" class="select" [ngModel]="activityDraft().status" (ngModelChange)="patchActivity({status: $event})">@for (status of manualStatuses; track status.value) { <option [value]="status.value">{{ status.label }}</option> }</select></div>
            <div class="field"><label for="pa-date">Tijdstip</label><input id="pa-date" name="occurredAt" class="input" type="datetime-local" required [ngModel]="activityDraft().localTime" (ngModelChange)="patchActivity({localTime: $event})" /><small class="hint">Lokale tijd van dit apparaat. De dagteller volgt Brussel.</small></div>
            <div class="field span-2"><label for="pa-subject">Onderwerp</label><input id="pa-subject" name="subject" class="input" maxlength="300" [ngModel]="activityDraft().subject" (ngModelChange)="patchActivity({subject: $event})" /></div>
            <div class="field span-2"><label for="pa-body">Bericht of notitie</label><textarea id="pa-body" name="body" class="textarea" rows="6" maxlength="100000" [ngModel]="activityDraft().body" (ngModelChange)="patchActivity({body: $event})"></textarea></div>
            <div class="field"><label for="pa-attachment">Naam bijlage</label><input id="pa-attachment" name="attachmentName" class="input" maxlength="255" placeholder="Bijv. ENROSED-catalogus.pdf" [ngModel]="activityDraft().attachmentName" (ngModelChange)="patchActivity({attachmentName: $event})" /></div>
            <div class="field"><label for="pa-source">Bewijs / bronlink</label><input id="pa-source" name="activitySourceUrl" class="input" maxlength="2000" placeholder="https://…" [ngModel]="activityDraft().sourceUrl" (ngModelChange)="patchActivity({sourceUrl: $event})" /></div>
          </fieldset>
          @if (formError()) { <p class="prospect-error" role="alert">{{ formError() }}</p> }
        </form>
        <div foot class="prospect-sheet-foot"><button class="btn" type="button" [disabled]="saving()" (click)="closeActivity()">Annuleren</button><button class="btn btn--primary" type="submit" form="prospect-activity-form" [disabled]="saving()">{{ saving() ? 'Opslaan…' : 'Registreren' }}</button></div>
      </app-sheet>
    }
    @if (importOpen()) {
      <app-sheet title="Contactlog importeren" [wide]="true" (closed)="closeImport()">
        <div body>
          @if (importData(); as data) {
            <p>{{ data.prospects.length }} prospects · {{ importActivityCount() }} activiteiten</p>
            <p class="prospect-log-hint">Bestaande bedrijven worden herkend aan e-mail of Instagram. Hun bedrijfsgegevens en notities blijven behouden. Vastgelegd contact kan de status Nieuw of Geselecteerd bijwerken naar Benaderd. Eerdere activiteiten met dezelfde referentie worden overgeslagen.</p>
            @if (importHasReserved()) { <p class="prospect-log-hint">Gereserveerde e-mails houden een plek vrij binnen het dagdoel op de opgegeven verzenddatum. Er wordt nog niets in Gmail ingepland of verstuurd. Registreer dezelfde referentie pas als ingepland nadat de Gmail-planning is bevestigd.</p> }
            @if (importHasScheduled()) { <p class="prospect-log-hint">Importeer alleen e-mails die al aantoonbaar in Gmail zijn ingepland. Per e-mail wordt de dagruimte gecontroleerd. Deze import verstuurt of annuleert niets in Gmail; controleer bij fouten de Gmail-planning.</p> }
          }
          @if (importing()) { <p role="status">{{ importProgress() }}</p> }
          @if (importResult()) { <p role="status">{{ importResult() }}</p> }
          @if (importError()) { <p class="prospect-error" role="alert">{{ importError() }}</p> }
          @if (importFailures().length) {
            <div class="prospect-import-errors"><h3>Niet geïmporteerd</h3><ul>@for (failure of importFailures(); track $index) { <li>{{ failure }}</li> }</ul></div>
          }
        </div>
        <div foot class="prospect-sheet-foot"><button class="btn" type="button" [disabled]="importing()" (click)="closeImport()">Sluiten</button>
          @if (importData() && !importResult()) { <button class="btn btn--primary" type="button" [disabled]="importing()" (click)="runImport()">{{ importing() ? 'Importeren…' : 'Import starten' }}</button> }
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .prospect-import-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px;border-bottom:1px solid var(--line)}.prospect-import-bar>span{font-size:11px;color:var(--muted)}.prospect-import-picker{position:relative;overflow:hidden;cursor:pointer}.prospect-import-picker input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}.prospect-import-picker:focus-within{outline:2px solid var(--rose);outline-offset:2px}.prospect-import-errors{max-height:250px;overflow:auto;font-size:12px;line-height:1.5}.prospect-import-errors li{margin:8px 0;overflow-wrap:anywhere}
    :host{display:block}.prospect-page{max-width:1500px;margin:auto}.prospect-summary{display:flex;justify-content:space-between;gap:24px;padding:24px;margin-bottom:20px}.prospect-eyebrow{text-transform:uppercase;letter-spacing:.1em;font-size:11px;font-weight:750;color:var(--muted)}.prospect-count{display:flex;align-items:baseline;gap:10px;margin-top:6px}.prospect-count strong{font-size:42px;line-height:1.1;letter-spacing:-2px}.prospect-count span,.prospect-summary p{color:var(--muted);font-size:13px}.prospect-summary p{margin:7px 0 0}.prospect-progress{display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:220px;font-size:12px;color:var(--muted)}progress{width:100%;height:7px;accent-color:var(--rose)}.prospect-layout{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(320px,1fr);gap:20px;align-items:start}.prospect-directory,.prospect-detail{overflow:hidden;min-width:0}.prospect-filters{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px;border-bottom:1px solid var(--line)}.prospect-filters label{font-size:11px;font-weight:650;color:var(--muted);display:grid;gap:6px}.prospect-search{grid-column:1/-1}.prospect-list-heading{display:flex;justify-content:space-between;gap:10px;padding:14px 20px;font-size:12px;color:var(--muted)}.prospect-list-heading strong{color:var(--ink)}.prospect-row{width:100%;display:flex;align-items:center;gap:12px;padding:17px 20px;border:0;border-top:1px solid var(--line);background:transparent;text-align:left;cursor:pointer;color:inherit;font:inherit}.prospect-row:hover,.prospect-row--active{background:var(--rose-soft)}.prospect-avatar{display:grid;place-items:center;flex-shrink:0;width:38px;height:38px;border-radius:13px;background:var(--surface-2);color:var(--rose);font-size:18px;font-weight:700}.prospect-row-copy{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.prospect-row-copy strong{font-size:14px;overflow-wrap:anywhere}.prospect-row-copy span,.prospect-row-copy small,.prospect-row-meta small{font-size:11px;color:var(--muted);overflow-wrap:anywhere}.prospect-row-meta{display:flex;flex-direction:column;gap:7px;align-items:flex-end;max-width:140px}.prospect-badge{display:inline-block;padding:4px 8px;border-radius:20px;background:var(--surface-2);font-size:10px;font-weight:700;white-space:nowrap}.prospect-badge--stop{color:#ad332e;background:#ad332e12}.prospect-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:15px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}.prospect-detail{padding:24px}.prospect-detail-head h2{font-size:25px;line-height:1.2;letter-spacing:-.6px;margin:10px 0;overflow-wrap:anywhere}.prospect-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.prospect-facts{margin:22px 0}.prospect-facts>div{display:grid;grid-template-columns:115px minmax(0,1fr);gap:14px;padding:11px 0;border-bottom:1px solid var(--line);font-size:12px}.prospect-facts dt{color:var(--muted)}.prospect-facts dd{margin:0;overflow-wrap:anywhere}.prospect-facts a,.prospect-timeline a{color:var(--rose);text-decoration:none}.prospect-facts dd>a+a{display:block}.prospect-notes h3,.prospect-timeline-head h3{font-size:14px;margin:0}.prospect-notes p,.prospect-timeline p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.6}.prospect-notes{padding-bottom:14px}.prospect-timeline-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-top:24px}.prospect-timeline-head span{font-size:11px;color:var(--muted)}.prospect-timeline{list-style:none;padding:0;margin:14px 0 0}.prospect-timeline li{border-top:1px solid var(--line);padding:17px 0}.prospect-activity-meta{display:flex;gap:10px;justify-content:space-between;align-items:center;font-size:12px}.prospect-timeline time{display:block;color:var(--muted);font-size:10px;margin-top:7px}.prospect-timeline h4{margin:14px 0 3px;font-size:13px}.prospect-timeline small,.prospect-timeline a{font-size:11px;display:block;overflow-wrap:anywhere;margin-top:6px}.prospect-timeline details{margin-top:12px;color:var(--muted);font-size:10px}.prospect-empty{padding:35px 24px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6}.prospect-empty h2{font-size:17px;color:var(--ink)}.prospect-welcome{padding:70px 14px}.prospect-welcome>span{font-size:42px;color:var(--rose)}.prospect-back{display:none;margin-bottom:18px}.prospect-stop{background:#ad332e0b;color:#ad332e;border:1px solid #ad332e22;border-radius:12px;padding:14px;margin-top:18px;font-size:12px}.prospect-stop p{margin:5px 0 0;line-height:1.5}.prospect-fieldset{border:0;padding:0;margin:0;min-width:0}.prospect-sheet-foot{display:flex;justify-content:flex-end;gap:10px;width:100%}.prospect-optout{display:flex;gap:12px;align-items:flex-start;padding:15px;border:1px solid var(--line);border-radius:12px;font-size:12px}.prospect-optout input{margin-top:2px;accent-color:var(--rose);width:18px;height:18px}.prospect-optout small{display:block;color:var(--muted);margin-top:4px}.prospect-error{color:#ad332e;background:#ad332e0b;padding:12px;border-radius:10px;font-size:13px}.prospect-log-hint{font-size:13px;line-height:1.6;color:var(--muted);margin:0 0 20px}.prospect-row:focus-visible{outline:2px solid var(--rose);outline-offset:-3px}.prospect-filters select{min-width:0}
    @media(max-width:1050px){.prospect-layout{grid-template-columns:minmax(0,1fr)}.prospect-detail{display:none}.prospect-layout--selected .prospect-directory{display:none}.prospect-layout--selected .prospect-detail{display:block}.prospect-back{display:inline-flex}}
    @media(max-width:520px){.prospect-summary{padding:18px;gap:14px}.prospect-progress{min-width:0;max-width:46%;align-items:flex-end}.prospect-progress small{font-size:10px;line-height:1.5;text-align:right}.prospect-count strong{font-size:34px}.prospect-count span{font-size:11px}.prospect-count{gap:6px}.prospect-filters{padding:15px;gap:10px}.prospect-row{padding:15px;gap:10px;flex-wrap:wrap}.prospect-row-meta{flex-basis:100%;max-width:none;flex-direction:row;align-items:center;justify-content:space-between;padding-left:48px}.prospect-detail{padding:18px}.prospect-facts>div{grid-template-columns:100px minmax(0,1fr)}.prospect-list-heading{padding:12px 15px}.prospect-list-heading span{display:none}.prospect-summary p{font-size:11px}.prospect-pagination{padding:12px}.prospect-pagination .btn{padding:8px 10px}.prospect-sheet-foot>.btn{flex:1}}
  `,
})
export class ProspectsPage {
  private readonly api = inject(ProspectApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  private readonly destroy = inject(DestroyRef);
  readonly statuses = PROSPECT_STATUSES;
  readonly channels = PROSPECT_CHANNELS;
  readonly activityTypes = ACTIVITY_TYPES;
  readonly manualStatuses = ACTIVITY_STATUSES.filter(s => s.value !== 'RESERVED' && s.value !== 'SCHEDULED');
  readonly countries = ISO_COUNTRIES;
  readonly languages = LANGUAGES;
  readonly countryLabel = countryName;
  readonly statusLabel = prospectStatusLabel;
  readonly webLink = prospectWebLink;
  readonly instagramUrl = instagramLink;
  readonly items = signal<Prospect[]>([]);
  readonly total = signal(0);
  readonly page = signal(0);
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / 50)));
  readonly search = signal('');
  readonly statusFilter = signal<ProspectStatus | ''>('');
  readonly countryFilter = signal('');
  readonly loading = signal(true);
  readonly listError = signal('');
  readonly selectedId = signal<number | null>(null);
  readonly detail = signal<ProspectDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');
  readonly summary = signal<ProspectEmailSummary | null>(null);
  readonly summaryError = signal('');
  readonly summaryLoading = signal(false);
  readonly today = signal(brusselsDate());
  readonly editing = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly draft = signal<ProspectInput>(blankProspect());
  readonly activityOpen = signal(false);
  readonly activityDraft = signal<ActivityDraft>(blankActivity());
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly importOpen = signal(false);
  readonly importData = signal<ProspectImportFile | null>(null);
  readonly importing = signal(false);
  readonly importError = signal('');
  readonly importProgress = signal('');
  readonly importResult = signal('');
  readonly importFailures = signal<string[]>([]);
  readonly importActivityCount = computed(() => this.importData()?.prospects.reduce((sum, row) => sum + row.activities.length, 0) ?? 0);
  readonly importHasReserved = computed(() => this.importData()?.prospects.some(row => row.activities.some(activity => activity.status === 'RESERVED')) ?? false);
  readonly importHasScheduled = computed(() => this.importData()?.prospects.some(row => row.activities.some(activity => activity.status === 'SCHEDULED')) ?? false);
  private originalDraft = '';
  private originalActivity = '';
  private priorOptOutStatus: ProspectStatus = 'NEW';
  private listRequest = 0;
  private detailRequest = 0;
  private summaryRequest = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.search.set(params.get('search') || '');
      const status = params.get('status') || '';
      this.statusFilter.set(PROSPECT_STATUSES.some(s => s.value === status) ? status as ProspectStatus : '');
      this.countryFilter.set(params.get('countryCode') || '');
      this.page.set(Math.max(0, Number.parseInt(params.get('page') || '0', 10) || 0));
      void this.loadList();
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const value = Number(params.get('id'));
      this.selectedId.set(Number.isSafeInteger(value) && value > 0 ? value : null);
      void this.loadDetail(this.selectedId());
    });
    void this.loadSummary();
    const dayTimer = setInterval(() => { if (brusselsDate() !== this.today()) void this.loadSummary(); }, 60_000);
    this.destroy.onDestroy(() => { clearInterval(dayTimer); clearTimeout(this.searchTimer); this.listRequest++; this.detailRequest++; this.summaryRequest++; });
  }
  channelLabel(value: string): string { return PROSPECT_CHANNELS.find(s => s.value === value)?.label ?? value; }
  activityStatusLabel(value: string): string { return ACTIVITY_STATUSES.find(s => s.value === value)?.label ?? value; }
  activityTypeLabel(value: string): string { return ACTIVITY_TYPES.find(s => s.value === value)?.label ?? (value === 'OUTREACH' ? 'Kennismaking' : value); }
  dateLabel(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Onbekend tijdstip' : new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }
  searchChanged(value: string): void {
    this.search.set(value); clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.updateFilters({ search: value || null, page: null }), 300);
  }
  filterChanged(key: string, value: string): void { this.updateFilters({ [key]: value || null, page: null }); }
  goPage(page: number): void { this.updateFilters({ page: page || null }); }
  private updateFilters(patch: Record<string, string | number | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true });
  }
  select(id: number | null): void {
    if (!this.canDeactivate()) return;
    void this.router.navigate(id === null ? ['/prospects'] : ['/prospects', id], { queryParamsHandling: 'preserve' });
  }
  async loadList(): Promise<void> {
    const request = ++this.listRequest; this.loading.set(true); this.listError.set('');
    try {
      const page = await this.api.list({ search: this.search(), status: this.statusFilter(), countryCode: this.countryFilter(), page: this.page(), size: 50 });
      if (request !== this.listRequest) return;
      this.items.set(page.items); this.total.set(page.total);
    } catch (failure) { if (request === this.listRequest) this.listError.set(messageOf(failure, 'Prospects laden mislukt.')); }
    finally { if (request === this.listRequest) this.loading.set(false); }
  }
  async loadDetail(id: number | null): Promise<void> {
    const request = ++this.detailRequest; this.detail.set(null); this.detailError.set(''); this.detailLoading.set(id !== null);
    if (id === null) return;
    try { const detail = await this.api.detail(id); if (request === this.detailRequest) this.detail.set(detail); }
    catch (failure) { if (request === this.detailRequest) this.detailError.set(messageOf(failure, 'Prospect laden mislukt.')); }
    finally { if (request === this.detailRequest) this.detailLoading.set(false); }
  }
  async loadSummary(): Promise<void> {
    const request = ++this.summaryRequest; this.today.set(brusselsDate()); this.summaryLoading.set(true); this.summaryError.set('');
    try { const summary = await this.api.emailSummary(this.today()); if (request === this.summaryRequest) this.summary.set(summary); }
    catch (failure) { if (request === this.summaryRequest) { this.summary.set(null); this.summaryError.set(messageOf(failure, 'Dagteller niet beschikbaar.')); } }
    finally { if (request === this.summaryRequest) this.summaryLoading.set(false); }
  }
  refresh(): void { void this.loadList(); void this.loadSummary(); void this.loadDetail(this.selectedId()); }
  openEditor(prospect?: Prospect): void {
    this.editingId.set(prospect?.id ?? null);
    this.draft.set(prospect ? prospectPayload(prospect) : blankProspect());
    this.priorOptOutStatus = prospect?.status === 'DO_NOT_CONTACT' ? 'NEW' : prospect?.status ?? 'NEW';
    this.originalDraft = JSON.stringify(this.draft()); this.formError.set(''); this.editing.set(true);
  }
  patchDraft(patch: Partial<ProspectInput>): void { this.draft.update(draft => ({ ...draft, ...patch })); }
  setOptOut(value: boolean): void {
    if (value) { this.priorOptOutStatus = this.draft().status; this.patchDraft({ status: 'DO_NOT_CONTACT' }); }
    else this.patchDraft({ status: this.priorOptOutStatus === 'DO_NOT_CONTACT' ? 'NEW' : this.priorOptOutStatus });
  }
  closeEditor(): void {
    if (this.saving()) return;
    if (JSON.stringify(this.draft()) !== this.originalDraft && !window.confirm('Wijzigingen niet opslaan en sluiten?')) return;
    this.editing.set(false);
  }
  async saveProspect(): Promise<void> {
    if (this.saving()) return;
    const validation = prospectValidation(this.draft());
    if (validation) { this.formError.set(validation); return; }
    this.saving.set(true); this.formError.set('');
    try {
      const id = this.editingId(); const payload = prospectPayload(this.draft());
      const saved = id === null ? await this.api.create(payload) : await this.api.update(id, payload);
      this.editing.set(false); this.ui.toast('Prospect opgeslagen');
      void this.loadList();
      if (this.selectedId() === saved.id) void this.loadDetail(saved.id);
      else { this.saving.set(false); void this.router.navigate(['/prospects', saved.id], { queryParamsHandling: 'preserve' }); }
    } catch (failure) { this.formError.set(messageOf(failure, 'Prospect opslaan mislukt.')); }
    finally { this.saving.set(false); }
  }
  openActivity(): void { this.activityDraft.set(blankActivity()); this.originalActivity = JSON.stringify(this.activityDraft()); this.formError.set(''); this.activityOpen.set(true); }
  patchActivity(patch: Partial<ActivityDraft>): void { this.activityDraft.update(draft => ({ ...draft, ...patch })); }
  changeChannel(channel: ProspectChannel): void { this.patchActivity({ channel, type: channel === 'NOTE' ? 'NOTE' : 'INTRODUCTION', status: channel === 'EMAIL' ? 'DRAFT' : 'COMPLETED' }); }
  closeActivity(): void {
    if (this.saving()) return;
    if (JSON.stringify(this.activityDraft()) !== this.originalActivity && !window.confirm('Actie niet opslaan en sluiten?')) return;
    this.activityOpen.set(false);
  }
  async saveActivity(): Promise<void> {
    const id = this.selectedId(); if (id === null || this.saving()) return;
    const { localTime, ...draft } = this.activityDraft(); const occurred = new Date(localTime);
    if (Number.isNaN(occurred.getTime())) { this.formError.set('Vul een geldig tijdstip in.'); return; }
    if (occurred.getTime() > Date.now() + 300_000) { this.formError.set('Registreer alleen acties die al hebben plaatsgevonden.'); return; }
    if (!draft.subject?.trim() && !draft.body?.trim()) { this.formError.set('Vul een onderwerp of notitie in.'); return; }
    if (draft.sourceUrl?.trim() && !prospectWebLink(draft.sourceUrl)) { this.formError.set('Controleer de bronlink.'); return; }
    this.saving.set(true); this.formError.set('');
    try {
      await this.api.record(id, { ...draft, occurredAt: occurred.toISOString(), sourceUrl: prospectWebLink(draft.sourceUrl) });
      this.activityOpen.set(false); this.ui.toast('Actie geregistreerd'); this.refresh();
    } catch (failure) { this.formError.set(messageOf(failure, 'Actie registreren mislukt.')); }
    finally { this.saving.set(false); }
  }
  async readImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file || this.importing()) return;
    this.importData.set(null); this.importError.set(''); this.importResult.set(''); this.importFailures.set([]); this.importOpen.set(true);
    try {
      if (file.size > 5_000_000) throw new Error('Het contactlog is te groot (maximaal 5 MB).');
      const data = parseProspectImport(await file.text());
      for (const entry of data.prospects) {
        const validation = prospectValidation(entry.prospect);
        if (validation) throw new Error(`${entry.prospect.businessName}: ${validation}`);
        if (!entry.prospect.email?.trim() && !entry.prospect.instagramHandle?.trim()) throw new Error(`${entry.prospect.businessName}: vul e-mail of Instagram in om dubbele import te voorkomen.`);
      }
      this.importData.set(data);
    } catch (failure) { this.importError.set(failure instanceof Error ? failure.message : 'Contactlog lezen mislukt.'); }
  }
  closeImport(): void { if (!this.importing()) this.importOpen.set(false); }
  private async findImportMatch(input: ProspectInput): Promise<Prospect | null> {
    const matches = new Map<number, Prospect>();
    const queries = [input.email, input.instagramHandle].filter((value): value is string => !!value?.trim());
    for (const search of queries) {
      let page = 0;
      while (true) {
        const result = await this.api.list({ search, page, size: 50 });
        for (const row of result.items) if (matchesProspectIdentity(row, input)) matches.set(row.id, row);
        if (!result.items.length || (page + 1) * result.size >= result.total) break;
        page++;
      }
    }
    if (matches.size > 1) throw new Error('E-mail en Instagram verwijzen naar verschillende bestaande prospects. Controleer de gegevens.');
    return [...matches.values()][0] ?? null;
  }
  async runImport(): Promise<void> {
    const data = this.importData(); if (!data || this.importing()) return;
    this.importing.set(true); this.importFailures.set([]);
    let created = 0, matched = 0, recorded = 0, skipped = 0;
    try {
      for (const [index, entry] of data.prospects.entries()) {
        this.importProgress.set(`${index + 1} / ${data.prospects.length} · ${entry.prospect.businessName}`);
        try {
          const payload = prospectPayload(entry.prospect);
          let prospect = await this.findImportMatch(payload);
          if (prospect) matched++;
          else { prospect = await this.api.create(payload); created++; }
          const existing = await this.api.detail(prospect.id);
          const seen = new Set(existing.activities.map(activity => activity.externalId).filter(Boolean));
          for (const activity of entry.activities) {
            try {
              await recordImportedActivity(this.api, prospect.id, activity, seen);
              if (seen.has(activity.externalId)) skipped++;
              else recorded++;
              seen.add(activity.externalId);
            }
            catch (failure) {
              const status = (failure as { status?: number })?.status;
              if (status === 0 || status === 401 || status === 403) throw failure;
              this.importFailures.update(rows => [...rows, `${entry.prospect.businessName} · ${activity.type}: ${messageOf(failure, 'Activiteit registreren mislukt.')}`]);
            }
          }
        } catch (failure) {
          const status = (failure as { status?: number })?.status;
          this.importFailures.update(rows => [...rows, `${entry.prospect.businessName}: ${failure instanceof Error && status === undefined ? failure.message : messageOf(failure, 'Prospect importeren mislukt.')}`]);
          if (status === 0 || status === 401 || status === 403) { this.importError.set('Import gestopt: verbinding of toegang ontbreekt. De overige regels zijn niet verwerkt; je kunt hetzelfde bestand later opnieuw importeren.'); break; }
        }
      }
      this.importResult.set(`${created} nieuw · ${matched} herkend · ${recorded} activiteiten toegevoegd · ${skipped} eerder geregistreerd · ${this.importFailures().length} fouten.`);
      this.refresh();
    } finally { this.importing.set(false); }
  }
  private dirty(): boolean {
    return (this.editing() && JSON.stringify(this.draft()) !== this.originalDraft)
      || (this.activityOpen() && JSON.stringify(this.activityDraft()) !== this.originalActivity);
  }
  canDeactivate(): boolean { return !this.saving() && !this.importing() && (!this.dirty() || window.confirm('Er zijn niet-opgeslagen wijzigingen. Dit scherm toch verlaten?')); }
  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void { if (this.saving() || this.importing() || this.dirty()) { event.preventDefault(); event.returnValue = ''; } }
}
