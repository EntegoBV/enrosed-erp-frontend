import { ChangeDetectionStrategy, Component, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { api } from '../../core/api/api.config';
import { messageOf } from '../../core/api/errors';
import { CompanyProfile } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, confirmLeave } from '../../shared/ui';
import { CompanyStore } from './company-store';
import { legalSaveValue, legalStatus, legalVersionLine, wordCountText } from './company-fields';
import { SettingsEditor } from './settings-editor';

export type LegalLanguage = 'nl' | 'en';
type LegalDoc = 'terms' | 'privacy';
type LegalField = 'termsAndConditions' | 'termsAndConditionsEn' | 'privacyPolicy' | 'privacyPolicyEn';

/** The texts customers read at /voorwaarden, the built-in proposal where nothing of our own is set. */
@Injectable({ providedIn: 'root' })
export class TermsApi {
  private readonly http = inject(HttpClient);
  get(lang: LegalLanguage): Promise<{ companyName: string; terms: string; privacy: string }> {
    return firstValueFrom(this.http.get<{ companyName: string; terms: string; privacy: string }>(api(`/api/public/terms?lang=${lang}`)));
  }
}

const FIELD: Record<LegalDoc, Record<LegalLanguage, LegalField>> = {
  terms: { nl: 'termsAndConditions', en: 'termsAndConditionsEn' },
  privacy: { nl: 'privacyPolicy', en: 'privacyPolicyEn' },
};
const TITLE: Record<LegalDoc, string> = { terms: 'Algemene voorwaarden', privacy: 'Privacyverklaring' };

export const LEGAL_LANGUAGES: readonly SegmentOption[] = [
  { id: 'nl', label: 'Nederlands', shortLabel: 'NL' },
  { id: 'en', label: 'English', shortLabel: 'EN' },
];

/**
 * Voorwaarden & privacy: the two legal texts as customers read them, per
 * language, with whether they are our own text or the built-in proposal.
 * Editing happens in a sheet that saves only that one text on top of the
 * page's CompanyStore, so Bedrijfsgegevens never undoes it (B2).
 */
@Component({
  selector: 'app-settings-legal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, RouterLink, Segmented, Sheet, Skeleton],
  template: `
    @if (store.error() && !store.saved()) {
      <app-load-error title="Dit scherm kon niet worden geladen" [message]="store.error()" [busy]="store.loading()" (retry)="store.load(true)" />
    } @else if (desktop.active()) {
      <div class="legal">
        <div class="wk-banner wk-banner--inset" role="note"><app-icon name="info" [size]="16" />
          <span class="wk-banner__text">Voorstel voor Enrosed BV: laat deze teksten nakijken door je boekhouder of jurist. Documenten in een andere taal dan Nederlands verwijzen naar de Engelse versie.</span></div>
        <div class="legal__grid">
          @for (doc of docs; track doc) {
            <section class="wk-card legal__card" [attr.aria-labelledby]="'legal-' + doc">
              <header class="legal__head">
                <h2 [id]="'legal-' + doc">{{ title(doc) }}</h2>
                @if (store.saved()) { <span class="wk-pill" [class.tone-accent]="custom(doc)">{{ custom(doc) ? 'Eigen tekst' : 'Ingebouwd voorstel' }}</span> }
              </header>
              <p class="legal__meta">{{ meta(doc) }}</p>
              <div class="legal__read" tabindex="0" [attr.aria-label]="title(doc)">
                @if (publicError(); as error) {
                  <p class="legal__fail">De tekst kon niet worden geladen.</p>
                  <button class="wk-btn wk-btn--sm" type="button" (click)="loadPublic(language(), true)">Opnieuw proberen</button>
                } @else if (publicText(doc) !== null) {
                  {{ publicText(doc) }}
                } @else {
                  <app-skeleton kind="lines" [rows]="6" />
                }
              </div>
              <footer class="legal__foot">
                <button class="btn" type="button" [disabled]="!store.saved()" (click)="edit(doc)">Bewerken</button>
                @if (custom(doc)) {
                  <button class="btn set-ghost" type="button" (click)="reset(doc)">Ingebouwd voorstel terugzetten</button>
                }
                <a class="wk-link legal__view" routerLink="/voorwaarden" [queryParams]="language() === 'en' ? { lang: 'en' } : null">Bekijk zoals klanten ›</a>
              </footer>
            </section>
          }
        </div>
      </div>
    } @else {
      <div class="legal-phone">
        <app-segmented class="legal-phone__seg" variant="ios" label="Taal" [options]="languages" [value]="language()" (changed)="setLanguage($event)" />
        @for (doc of docs; track doc) {
          <section class="ios-section">
            <div class="ios-group">
              <div class="ios-cell ios-cell--tall">
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--strong">{{ title(doc) }}</span>
                  <span class="ios-cell__sub ios-cell__sub--2">{{ meta(doc) }}</span>
                </span>
                @if (store.saved()) { <span class="ios-cell__trail"><span class="wk-pill" [class.tone-accent]="custom(doc)">{{ custom(doc) ? 'Eigen tekst' : 'Ingebouwd' }}</span></span> }
              </div>
              <button class="ios-cell" type="button" [disabled]="publicText(doc) === null" (click)="reading.set(doc)">
                <span class="ios-cell__body"><span class="ios-cell__title">Lezen</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
              <button class="ios-cell ios-cell--action" type="button" [disabled]="!store.saved()" (click)="edit(doc)">
                <span class="ios-cell__body">Bewerken</span>
              </button>
              @if (custom(doc)) {
                <button class="ios-cell ios-cell--danger" type="button" (click)="reset(doc)">Ingebouwd voorstel terugzetten</button>
              }
            </div>
          </section>
        }
        <section class="ios-section">
          <div class="ios-group">
            <a class="ios-cell" routerLink="/voorwaarden" [queryParams]="language() === 'en' ? { lang: 'en' } : null">
              <span class="ios-cell__lead"><span class="ios-tile tone-plum" aria-hidden="true"><app-icon name="eye" [size]="17" /></span></span>
              <span class="ios-cell__body"><span class="ios-cell__title">Bekijk zoals klanten</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
          </div>
          <p class="ios-section__foot">Voorstel voor Enrosed BV: laat deze teksten nakijken door je boekhouder of jurist. Documenten in een andere taal dan Nederlands verwijzen naar de Engelse versie.</p>
          @if (publicError()) {
            <p class="ios-section__foot legal__fail">De tekst kon niet worden geladen. <button class="wk-link" type="button" (click)="loadPublic(language(), true)">Opnieuw proberen</button></p>
          }
        </section>
      </div>
    }

    <!-- Sheets at host level (trap rule) -->
    @if (reading(); as doc) {
      <app-sheet [title]="title(doc) + ' (' + language().toUpperCase() + ')'" variant="ios" (closed)="reading.set(null)">
        <div body class="legal__read legal__read--sheet">{{ publicText(doc) }}</div>
      </app-sheet>
    }
    @if (editing(); as doc) {
      <app-sheet [title]="title(doc) + ' (' + language().toUpperCase() + ')'" [wide]="true" [variant]="desktop.active() ? 'default' : 'ios'" (closed)="closeEdit()">
        <div body class="legal__edit">
          <textarea class="legal__textarea" [attr.aria-label]="title(doc)" [value]="editText()" (input)="editText.set($any($event.target).value)"></textarea>
          <p class="legal__hint">Leeg laten = het ingebouwde voorstel.
            @if (!editText().trim() && builtIn() !== null) {
              <button class="wk-link" type="button" (click)="editText.set(builtIn()!)">Begin met het ingebouwde voorstel</button>
            }
          </p>
        </div>
        <div foot class="legal__sheet-foot">
          <button class="btn" type="button" [disabled]="saving()" (click)="closeEdit()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="saving() || !dirty()" (click)="save()">{{ saving() ? 'Opslaan…' : 'Opslaan' }}</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display: block; }
    :host([hidden]) { display: none !important; }
    .legal { container: set-legal / inline-size; }
    .legal .wk-banner { margin-bottom: 16px; }
    .legal__grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: stretch; }
    @container set-legal (min-width: 900px) { .legal__grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
    .legal__card { display: flex; flex-direction: column; margin: 0; padding: 0 0 12px; }
    .legal__card + .legal__card { margin-top: 0; }
    .legal__head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 2px; }
    .legal__head h2 { margin: 0; font-size: 15px; font-weight: 700; }
    .legal__meta { margin: 2px 16px 10px; color: var(--muted); font-size: 12.5px; }
    .legal__read { flex: 1; max-height: 520px; margin: 0 16px; padding: 14px 16px; overflow: auto; border-radius: 12px; background: var(--surface-2);
      color: var(--ink); font-size: 13.5px; line-height: 1.65; white-space: pre-line; overflow-wrap: anywhere; }
    @container set-legal (max-width: 899px) { .legal__read { max-height: 360px; } }
    .legal__read--sheet { max-height: none; margin: 0; background: none; padding: 0; font-size: 15px; }
    .legal__fail { margin: 0 0 8px; color: var(--danger); font-weight: 600; white-space: normal; }
    .legal__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px 0; }
    .legal__view { margin-left: auto; }
    .btn.set-ghost { border-color: transparent; background: transparent; }
    .legal-phone { --ios-inset: 0px; }
    .legal-phone__seg { display: grid; margin: 0 0 18px; }
    .legal__edit { display: grid; gap: 8px; }
    .legal__textarea { width: 100%; min-height: 60vh; padding: 12px 14px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--surface);
      color: var(--ink); font: inherit; font-size: 14px; line-height: 1.6; resize: vertical; }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) { .legal__textarea { font-size: 16px; min-height: 50vh; } }
    .legal__hint { margin: 0; color: var(--muted); font-size: 12.5px; }
    .legal__sheet-foot { display: flex; justify-content: flex-end; gap: 8px; width: 100%; }
    .legal__sheet-foot .btn { min-height: 44px; }
    /* The phone sheet body has no side padding (it expects inset groups): reading text and the editor bring their own 16 px gutter. */
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) { .legal__read--sheet, .legal__edit { padding-inline: 16px; } }
  `,
})
export class SettingsLegal implements SettingsEditor {
  readonly desktop = inject(DesktopViewport);
  readonly store = inject(CompanyStore);
  private readonly terms = inject(TermsApi);
  private readonly ui = inject(Ui);

  readonly docs: readonly LegalDoc[] = ['terms', 'privacy'];
  readonly languages = LEGAL_LANGUAGES;
  /** NL | EN drives both texts (the page puts the switch in the desk toolbar). */
  readonly language = signal<LegalLanguage>('nl');
  private readonly publicTexts = signal<Partial<Record<LegalLanguage, { terms: string; privacy: string }>>>({});
  private readonly publicErrors = signal<Partial<Record<LegalLanguage, string>>>({});
  readonly publicError = computed(() => this.publicErrors()[this.language()] ?? null);

  readonly reading = signal<LegalDoc | null>(null);
  readonly editing = signal<LegalDoc | null>(null);
  readonly editText = signal('');
  /** The built-in text an edit started from (null when the text was already our own). */
  readonly builtIn = signal<string | null>(null);
  private editStart = '';
  readonly saving = signal(false);
  readonly dirty = computed(() => this.editing() !== null && this.editText() !== this.editStart);
  readonly dirtyCount = computed(() => this.dirty() ? 1 : 0);

  constructor() {
    void this.store.load();
    effect(() => {
      const language = this.language();
      untracked(() => void this.loadPublic(language));
    });
  }

  setLanguage(value: string): void {
    this.language.set(value === 'en' ? 'en' : 'nl');
  }

  title(doc: LegalDoc): string {
    return TITLE[doc];
  }

  private field(doc: LegalDoc): LegalField {
    return FIELD[doc][this.language()];
  }

  custom(doc: LegalDoc): boolean {
    const saved = this.store.saved();
    return !!saved && legalStatus(saved[this.field(doc)]) === 'custom';
  }

  publicText(doc: LegalDoc): string | null {
    return this.publicTexts()[this.language()]?.[doc] ?? null;
  }

  meta(doc: LegalDoc): string {
    const text = this.publicText(doc);
    if (text === null) return this.publicError() ? 'Niet geladen' : 'Laden…';
    return [legalVersionLine(text), wordCountText(text)].filter(Boolean).join(' · ');
  }

  async loadPublic(language: LegalLanguage, force = false): Promise<void> {
    if (this.publicTexts()[language] && !force) return;
    this.publicErrors.update((errors) => ({ ...errors, [language]: undefined }));
    try {
      const result = await this.terms.get(language);
      this.publicTexts.update((texts) => ({ ...texts, [language]: { terms: result.terms ?? '', privacy: result.privacy ?? '' } }));
    } catch (failure: unknown) {
      this.publicErrors.update((errors) => ({ ...errors, [language]: messageOf(failure, 'De tekst kon niet worden geladen.') }));
    }
  }

  edit(doc: LegalDoc): void {
    const saved = this.store.saved();
    if (!saved) return;
    const own = saved[this.field(doc)] ?? '';
    this.editStart = own;
    this.editText.set(own);
    this.builtIn.set(legalStatus(own) === 'builtin' ? this.publicText(doc) : null);
    this.editing.set(doc);
  }

  /** Closing with a changed text asks first (Opslaan / Niet opslaan / Annuleren). */
  async closeEdit(): Promise<void> {
    if (this.saving()) return;
    if (!this.dirty()) { this.editing.set(null); return; }
    if (await confirmLeave(this.ui, () => this.save())) this.editing.set(null);
  }

  revert(): void {
    this.editing.set(null);
  }

  /** Saves only this one text; the built-in text unchanged stays null (Ingebouwd voorstel). */
  async save(): Promise<boolean> {
    const doc = this.editing();
    if (!doc || this.saving()) return false;
    const field = this.field(doc);
    const language = this.language();
    this.saving.set(true);
    try {
      await this.store.save({ [field]: legalSaveValue(this.editText(), this.builtIn()) } as Partial<CompanyProfile>);
      this.editing.set(null);
      this.ui.toast(`${TITLE[doc]} (${language.toUpperCase()}) opgeslagen`);
      void this.loadPublic(language, true);
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan is niet gelukt. Controleer de verbinding en probeer opnieuw.'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  reset(doc: LegalDoc): void {
    const field = this.field(doc);
    const language = this.language();
    this.ui.confirm({
      title: 'Ingebouwd voorstel terugzetten?',
      message: 'De eigen tekst wordt gewist. Klanten lezen weer het ingebouwde voorstel.',
      confirmLabel: 'Terugzetten',
      danger: true,
    }, async () => {
      try {
        await this.store.save({ [field]: null } as Partial<CompanyProfile>);
        this.ui.toast('Ingebouwd voorstel teruggezet');
        void this.loadPublic(language, true);
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Terugzetten is niet gelukt.'), 'err');
      }
    });
  }
}
