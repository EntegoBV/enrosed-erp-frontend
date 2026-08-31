import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { isRevisionConflict, messageOf } from '../../core/api/errors';
import {
  ContentTranslationGroup,
  ContentTranslationScope,
  ContentTranslationText,
  LanguageCode,
} from '../../core/api/models';
import { Ui, escapeHtml } from '../../shared/ui';
import { TRANSLATION_LANGUAGES } from '../products/product-translation-adapter';
import { WebsiteSyncStatus } from './website-sync-status';

const CONTENT_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

interface ContentPrefixOption {
  key: string;
  label: string;
  count: number;
}

interface LanguageCompletion {
  code: LanguageCode;
  label: string;
  complete: number;
  total: number;
}

const PREFIX_LABELS: Record<string, string> = {
  a11y: 'Toegankelijkheid',
  about: 'Over ons',
  categories: 'Categorieën',
  category: 'Categorieën',
  contact: 'Contact',
  customisation: 'Maatwerk',
  footer: 'Footer',
  header: 'Header',
  home: 'Home',
  homepage: 'Home',
  legal: 'Juridisch',
  meta: 'Meta & SEO',
  navigation: 'Navigatie',
  ordering: 'Bestellen',
  product: 'Producten',
  products: 'Producten',
};

@Component({
  selector: 'app-content-translation-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, WebsiteSyncStatus],
  template: `
    @if (visible()) {
    <section class="card content-translations" [class.content-translations--compact]="compact()"
             aria-labelledby="content-translations-title">
      <div class="card__head content-translations__head">
        <div>
          <h2 id="content-translations-title">{{ title() }}</h2>
          <p>{{ description() }}</p>
        </div>
        @if (!loading() && !loadError()) {
          <div class="overview-progress"
               [class.overview-progress--done]="scopeGroups().length > 0 && requiredMissing() === 0">
            <span><b>{{ completionPercent() }}%</b> compleet</span>
            <small>{{ !scopeGroups().length ? 'Geen teksten gevonden voor dit onderdeel'
              : requiredMissing() ? requiredMissing() + ' verplichte taalvelden ontbreken'
              : 'Alle verplichte teksten zijn ingevuld' }}</small>
            <span class="overview-progress__bar" role="progressbar" [attr.aria-label]="'Voortgang ' + title()"
                  aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="completionPercent()">
              <i [style.width.%]="completionPercent()"></i>
            </span>
          </div>
        }
      </div>

      <div class="card__body">
        @if (!compact()) {
          <app-website-sync-status [refreshKey]="websiteSyncRefreshKey()" />
        }

        @if (loadError()) {
          <div class="workspace-state workspace-state--error" role="alert">
            <div><b>Teksten konden niet worden geladen</b><small>{{ loadError() }}</small></div>
            <button class="btn btn--sm" type="button" [disabled]="loading()"
                    (click)="load()">Opnieuw proberen</button>
          </div>
        } @else if (loading()) {
          <div class="workspace-state" role="status">Teksten laden…</div>
        } @else {
          <div class="workspace-controls">
            <div class="workspace-toolbar">
              @if (!lockScope()) {
                <div class="scope-switch" role="group" aria-label="Soort algemene tekst">
                  <button type="button" [class.active]="scope() === 'WEBSITE'"
                          [attr.aria-pressed]="scope() === 'WEBSITE'"
                          [disabled]="hasPendingChanges() || busy()" (click)="changeScope('WEBSITE')">Websitepagina’s</button>
                  <button type="button" [class.active]="scope() === 'CATALOG'"
                          [attr.aria-pressed]="scope() === 'CATALOG'"
                          [disabled]="hasPendingChanges() || busy()" (click)="changeScope('CATALOG')">Cataloguslabels</button>
                </div>
              } @else {
                <span class="locked-scope">{{ scope() === 'WEBSITE' ? 'Websitepagina’s' : 'Cataloguslabels' }}</span>
              }
              @if (allowAdvanced()) {
                <button class="advanced-toggle" type="button" [attr.aria-expanded]="advancedOpen()"
                        [disabled]="busy()" (click)="advancedOpen.set(!advancedOpen())">
                  Geavanceerd <span aria-hidden="true">{{ advancedOpen() ? '−' : '+' }}</span>
                </button>
              }
            </div>

            <div class="scope-guide" role="note">
              <b>{{ scope() === 'WEBSITE' ? 'Websitepagina’s' : 'Cataloguslabels' }}</b>
              <span>{{ scope() === 'WEBSITE'
                ? 'Teksten voor homepage-onderdelen, navigatie, footer, juridische pagina’s en SEO per pagina.'
                : 'Algemene labels rond de collectie en productpagina’s. Productspecifieke tekst blijft bij Productvertalingen.' }}</span>
            </div>

            <div class="language-overview" aria-label="Voortgang verplichte teksten per taal">
              @for (item of languageCompletion(); track item.code) {
                <span [class.complete]="item.total > 0 && item.complete === item.total">
                  <b>{{ item.label }}</b>
                  <small>{{ item.total ? item.complete + ' van ' + item.total : 'Geen verplichte velden' }}</small>
                </span>
              }
            </div>

            <div class="filter-row">
              <label class="content-search">
                <span class="sr-only">Tekstgroep zoeken</span>
                <input class="input" type="search" [ngModel]="search()"
                       (ngModelChange)="search.set($event)"
                       placeholder="Zoek op naam of tekst…" />
              </label>
              <span class="result-count" aria-live="polite">
                {{ visibleGroups().length }} van {{ scopeGroups().length }} tekstgroepen
              </span>
            </div>

            @if (lockPrefix()) {
              <div class="locked-prefix" role="status">
                <span>Actieve filter</span><b>{{ prefixLabelForDisplay(prefix()) }}</b>
                <small>Deze SEO-werkplek toont alleen algemene meta- en paginatitels.</small>
              </div>
            } @else {
            <div class="prefix-filters" role="group" aria-label="Pagina of onderdeel filteren">
              <button type="button" [class.active]="prefix() === 'ALL'"
                      [attr.aria-pressed]="prefix() === 'ALL'" (click)="prefix.set('ALL')">
                Alles <small>{{ scopeGroups().length }}</small>
              </button>
              @for (option of prefixOptions(); track option.key) {
                <button type="button" [class.active]="prefix() === option.key"
                        [attr.aria-pressed]="prefix() === option.key"
                        (click)="prefix.set(option.key)">
                  {{ option.label }} <small>{{ option.count }}</small>
                </button>
              }
            </div>
            }
          </div>

          @if (advancedOpen()) {
            <section class="advanced-panel" aria-labelledby="advanced-content-title">
              <div class="advanced-panel__head">
                <div>
                  <h3 id="advanced-content-title">Geavanceerd beheer</h3>
                  <p>Technische sleutels, revisies en het aanmaken of verwijderen van tekstgroepen.</p>
                </div>
                <button class="btn" type="button" [disabled]="dirty() || busy() || creating()"
                        (click)="startCreate()">Nieuwe tekstgroep</button>
              </div>

              @if (creating()) {
                <div class="create-group">
                  <div class="field">
                    <label for="content-new-label">Naam in het dashboard</label>
                    <input class="input" id="content-new-label" [ngModel]="newLabel()"
                           (ngModelChange)="patchNewLabel($event)" placeholder="Bijv. Intro maatwerk" />
                  </div>
                  <div class="field">
                    <label for="content-new-key">Vaste sleutel</label>
                    <input class="input mono" id="content-new-key" [ngModel]="newKey()"
                           (ngModelChange)="patchNewKey($event)"
                           (blur)="normalizeNewKey()"
                           pattern="[a-z0-9]+(?:[.-][a-z0-9]+)*"
                           placeholder="customisation.intro" />
                  </div>
                  <p class="create-group__hint">
                    Een nieuwe sleutel start optioneel. Vul eerst alle acht talen in voordat u hem verplicht maakt.
                  </p>
                  @if (createError()) {
                    <p class="create-group__error" role="alert">{{ createError() }}</p>
                  }
                  <div class="create-group__actions">
                    <button class="btn" type="button" [disabled]="busy()"
                            (click)="cancelCreate()">Annuleren</button>
                    <button class="btn btn--primary" type="button"
                            [disabled]="busy() || !newLabel().trim() || !keyValid()"
                            (click)="createGroup()">Toevoegen</button>
                  </div>
                </div>
              }

              @if (draft(); as technicalGroup) {
                <div class="advanced-selected">
                  <label class="field advanced-selected__label">
                    <span>Naam in het dashboard</span>
                    <input class="input" [ngModel]="technicalGroup.label"
                           [readOnly]="technicalGroup.system"
                           (ngModelChange)="patchGroup({ label: $event })" />
                  </label>
                  <label class="required-toggle">
                    <input type="checkbox" [ngModel]="technicalGroup.required"
                           [disabled]="technicalGroup.system || (!technicalGroup.required && technicalGroup.missingLanguages.length > 0)"
                           [title]="!technicalGroup.required && technicalGroup.missingLanguages.length > 0
                             ? 'Vul eerst alle acht talen in'
                             : null"
                           (ngModelChange)="patchGroup({ required: $event })" />
                    Verplicht in alle talen
                  </label>
                  <dl class="technical-meta">
                    <div><dt>Sleutel</dt><dd class="mono">{{ technicalGroup.key }}</dd></div>
                    <div><dt>Revisie</dt><dd>{{ technicalGroup.revision }}</dd></div>
                    <div><dt>Type</dt><dd>{{ technicalGroup.system ? 'Vaste systeemtekst' : 'Eigen tekstgroep' }}</dd></div>
                  </dl>
                  @if (!technicalGroup.system) {
                    <button class="btn danger-link" type="button" [disabled]="dirty()"
                            (click)="deleteSelected()">Tekstgroep verwijderen</button>
                  }
                </div>
              }
            </section>
          }

          <div class="workspace-grid">
            <nav class="group-list" aria-label="Tekstgroepen">
              @for (group of visibleGroups(); track group.key) {
                <button type="button"
                        [class.active]="draft()?.key === group.key && draft()?.scope === group.scope"
                        [attr.aria-current]="draft()?.key === group.key && draft()?.scope === group.scope ? 'true' : null"
                        [disabled]="busy() || (hasPendingChanges() && draft()?.key !== group.key)"
                        (click)="select(group)">
                  <span>
                    <b>{{ group.label }}</b>
                    <small>{{ groupArea(group) }} · {{ completedLanguages(group) }} van {{ languages.length }} talen</small>
                  </span>
                  @if (group.required) {
                    <em [class.complete]="!group.missingLanguages.length">
                      {{ group.missingLanguages.length || '✓' }}
                    </em>
                  } @else {
                    <em class="optional">opt.</em>
                  }
                </button>
              } @empty {
                <div class="empty-groups">
                  {{ scopeGroups().length ? 'Geen tekstgroepen voor deze filters.' :
                    'Nog geen ' + (scope() === 'WEBSITE' ? 'website' : 'catalogus') + 'teksten.' }}
                </div>
              }
            </nav>

            @if (draft(); as group) {
              <fieldset class="group-editor" [disabled]="busy()" [attr.aria-busy]="busy()">
                <legend class="sr-only">{{ group.label }} vertalen</legend>
                <div class="group-editor__head">
                  <div>
                    <span class="eyebrow">{{ groupArea(group) }}</span>
                    <h3>{{ group.label }}</h3>
                    <small>{{ group.required
                      ? completedLanguages(group) + ' van ' + languages.length + ' verplichte talen ingevuld'
                      : 'Optionele tekstgroep' }}</small>
                  </div>
                  <div class="group-editor__head-actions">
                    <span class="group-status" [class.complete]="!group.missingLanguages.length">
                      {{ group.missingLanguages.length ? group.missingLanguages.length + ' talen ontbreken' : 'Compleet' }}
                    </span>
                    <button class="btn btn--sm btn--primary" type="button" (click)="copySelectedCodexBrief()">
                      Kopieer deze vertaalopdracht voor Codex
                    </button>
                  </div>
                </div>

                @if (legalReview()) {
                  <div class="legal-review" role="note">
                    <span aria-hidden="true">§</span>
                    <div><b>Juridisch nazicht nodig</b><small>Laat inhoudelijke wijzigingen controleren vóór publicatie.</small></div>
                  </div>
                }

                <div class="language-tabs" role="group" aria-label="Taal van algemene tekst">
                  @for (language of languages; track language.code) {
                    <button type="button"
                            [attr.aria-pressed]="selectedLanguage() === language.code"
                            [class.active]="selectedLanguage() === language.code"
                            [class.complete]="hasText(group, language.code)"
                            (click)="selectedLanguage.set(language.code)">
                      <b>{{ language.label }}</b>
                      <small>{{ hasText(group, language.code) ? 'Compleet' : (group.required ? 'Ontbreekt' : 'Nog leeg') }}</small>
                    </button>
                  }
                </div>
                <label class="mobile-language-picker">
                  <span>Taal kiezen</span>
                  <select class="select" [ngModel]="selectedLanguage()"
                          (ngModelChange)="selectedLanguage.set($any($event))">
                    @for (language of languages; track language.code) {
                      <option [ngValue]="language.code">
                        {{ language.label }} — {{ hasText(group, language.code)
                          ? 'compleet' : (group.required ? 'ontbreekt' : 'nog leeg') }}
                      </option>
                    }
                  </select>
                </label>

                <label class="translation-value">
                  <span>{{ selectedLanguageLabel() }}</span>
                  <textarea class="textarea" id="content-translation-value"
                            rows="7" [ngModel]="selectedValue()"
                            (ngModelChange)="patchValue($event)"
                            [placeholder]="group.required ? 'Verplichte vertaling' : 'Optionele vertaling'"></textarea>
                </label>
                @if (nextMissingLanguage(); as nextLanguage) {
                  <button class="next-language" type="button"
                          (click)="selectedLanguage.set(nextLanguage.code)">
                    Volgende ontbrekende taal: <b>{{ nextLanguage.label }}</b>
                    <span aria-hidden="true">›</span>
                  </button>
                }

                @if (conflict()) {
                  <div class="conflict" role="alert">
                    <div><b>Nieuwere versie beschikbaar</b><small>{{ saveError() }}</small></div>
                    <button class="btn btn--sm" type="button" (click)="reloadSelected()">
                      Laatste versie laden
                    </button>
                  </div>
                } @else if (saveError()) {
                  <div class="save-error" role="alert">{{ saveError() }}</div>
                } @else if (!group.label.trim()) {
                  <div class="save-error" role="alert">Vul een herkenbare naam voor deze tekstgroep in.</div>
                }

                <div class="group-editor__actions">
                  <span class="save-state" aria-live="polite">{{ dirty() ? 'Wijzigingen nog niet opgeslagen' : 'Tekst bijgewerkt' }}</span>
                  <button class="btn" type="button" [disabled]="!dirty()"
                          (click)="revertSelected()">Wijzigingen wissen</button>
                  <button class="btn btn--primary" type="button"
                          [disabled]="!dirty() || !draftValid()"
                          (click)="saveSelected()">{{ saving() ? 'Opslaan…' : 'Opslaan' }}</button>
                </div>
              </fieldset>
            } @else {
              <div class="workspace-state">Kies links een tekstgroep.</div>
            }
          </div>
        }
      </div>
    </section>
    }
  `,
  styles: `
    :host { display: block; }
    .content-translations__head { align-items: flex-start; gap: 20px; }
    .content-translations__head > div { min-width: 0; }
    .content-translations__head h2 { font-size: 24px; }
    .content-translations__head p {
      max-width: 72ch; margin-top: 5px; color: var(--muted); font-size: 16px; line-height: 1.55;
    }
    .overview-progress {
      display: grid; width: min(260px, 100%); flex: none; gap: 5px; padding: 12px 14px;
      border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--warn-soft); color: var(--ink-2);
    }
    .overview-progress span:first-child { display: flex; align-items: baseline; gap: 5px; font-size: 15px; }
    .overview-progress b { font-size: 20px; }
    .overview-progress small { color: var(--muted); font-size: 14px; line-height: 1.4; }
    .overview-progress__bar { display: block; height: 7px; overflow: hidden; border-radius: 999px; background: rgb(0 0 0 / 9%); }
    .overview-progress__bar i { display: block; height: 100%; border-radius: inherit; background: var(--warn); }
    .overview-progress--done { background: var(--ok-soft); color: var(--ok); }
    .overview-progress--done .overview-progress__bar i { background: var(--ok); }
    .workspace-state {
      display: flex; min-height: 140px; align-items: center; justify-content: center;
      gap: 12px; color: var(--muted); font-size: 16px; line-height: 1.5; text-align: center;
    }
    .workspace-state > div { display: grid; gap: 3px; }
    .workspace-state small { font-size: 15px; }
    .workspace-state--error { color: var(--danger); }
    .workspace-controls { display: grid; gap: 14px; }
    .workspace-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .scope-switch { display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: var(--surface-2); }
    .scope-switch button, .advanced-toggle {
      min-height: 48px; padding: 10px 16px; border: 1px solid transparent; border-radius: 9px;
      background: transparent; color: var(--muted); font-size: 15px; font-weight: 750; cursor: pointer;
    }
    .scope-switch button.active { border-color: var(--line); background: #fff; color: var(--rose-dark); box-shadow: var(--shadow-xs); }
    .locked-scope {
      display: inline-flex; min-height: 48px; align-items: center; padding: 10px 14px;
      border-radius: 10px; background: var(--rose-soft); color: var(--rose-dark);
      font-size: 15px; font-weight: 800;
    }
    .locked-prefix {
      display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center;
      gap: 8px; padding: 11px 13px; border: 1px solid var(--rose-line); border-radius: 10px;
      background: var(--rose-soft);
    }
    .locked-prefix > span { color: var(--muted); font-size: 12px; font-weight: 700; }
    .locked-prefix b { color: var(--rose-dark); font-size: 14px; }
    .locked-prefix small { justify-self: end; color: var(--muted); font-size: 13px; }
    .advanced-toggle { display: inline-flex; align-items: center; gap: 10px; border-color: var(--line); background: var(--surface); color: var(--ink-2); }
    .advanced-toggle span { font-size: 20px; line-height: 1; }
    .scope-guide { display: grid; gap: 3px; padding: 14px 16px; border-left: 4px solid var(--rose); background: var(--rose-soft); }
    .scope-guide b { font-size: 16px; }
    .scope-guide span { color: var(--muted); font-size: 16px; line-height: 1.5; }
    .language-overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .language-overview > span {
      display: grid; min-width: 0; min-height: 58px; align-content: center; gap: 2px; padding: 9px 11px;
      border: 1px solid transparent; border-radius: 10px; background: var(--warn-soft); color: var(--ink-2);
    }
    .language-overview > span.complete { border-color: color-mix(in srgb, var(--ok) 32%, transparent); background: var(--ok-soft); color: var(--ok); }
    .language-overview b { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
    .language-overview small { color: inherit; font-size: 13px; line-height: 1.3; }
    .filter-row { display: flex; align-items: center; gap: 12px; }
    .content-search { flex: 1; min-width: 0; }
    .content-search .input { min-height: 48px; font-size: 16px; }
    .result-count { flex: none; color: var(--muted); font-size: 14px; font-weight: 650; }
    .prefix-filters { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 5px; scrollbar-width: thin; }
    .prefix-filters button {
      display: inline-flex; flex: none; min-height: 48px; align-items: center; gap: 7px;
      padding: 9px 14px; border: 1px solid var(--line); border-radius: 999px;
      background: var(--surface-2); color: var(--muted); font-size: 15px; font-weight: 700; cursor: pointer;
    }
    .prefix-filters button.active { border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark); }
    .prefix-filters small { font-size: 13px; }
    .advanced-panel { margin-top: 16px; padding: 18px; border: 1px solid var(--line-strong); border-radius: var(--r); background: var(--surface-2); }
    .advanced-panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .advanced-panel__head h3 { font-size: 20px; }
    .advanced-panel__head p { margin-top: 4px; color: var(--muted); font-size: 16px; line-height: 1.45; }
    .advanced-panel .btn { min-height: 48px; font-size: 15px; }
    .create-group {
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px;
      padding: 16px; border: 1px solid var(--rose-line); border-radius: var(--r-sm); background: var(--rose-soft);
    }
    .create-group .field, .advanced-selected__label { display: grid; gap: 6px; }
    .create-group label, .advanced-selected__label > span { font-size: 16px; font-weight: 700; }
    .create-group .input, .advanced-selected .input { min-height: 48px; font-size: 16px; }
    .create-group__hint { align-self: end; color: var(--muted); font-size: 15px; line-height: 1.45; }
    .create-group__error { grid-column: 1 / -1; padding: 10px 12px; border-radius: 9px;
      background: var(--danger-soft); color: var(--danger); font-size: 14px; line-height: 1.45; }
    .create-group__actions { display: flex; justify-content: flex-end; gap: 8px; }
    .advanced-selected { display: grid; grid-template-columns: minmax(240px, 1fr) auto; align-items: end; gap: 14px 18px; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
    .required-toggle { display: flex; min-height: 48px; align-items: center; gap: 9px; font-size: 16px; font-weight: 700; }
    .required-toggle input { width: 22px; height: 22px; accent-color: var(--rose); }
    .technical-meta { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
    .technical-meta div { min-width: 0; padding: 10px 12px; border-radius: 9px; background: var(--surface); }
    .technical-meta dt { color: var(--muted); font-size: 13px; font-weight: 700; text-transform: uppercase; }
    .technical-meta dd { margin-top: 3px; overflow-wrap: anywhere; color: var(--ink-2); font-size: 15px; }
    .danger-link { justify-self: start; color: var(--danger); }
    .workspace-grid { display: grid; grid-template-columns: minmax(280px, .42fr) minmax(0, 1fr); gap: 16px; margin-top: 18px; }
    .group-list { display: grid; max-height: min(720px, calc(100vh - 180px)); align-content: start; gap: 8px; overflow-y: auto; padding-right: 4px; scrollbar-width: thin; }
    .group-list > button {
      display: flex; min-width: 0; min-height: 72px; align-items: center; justify-content: space-between;
      gap: 10px; padding: 12px 13px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--surface-2); color: var(--ink-2); text-align: left; cursor: pointer;
    }
    .group-list > button.active { border-color: var(--rose); background: var(--rose-soft); box-shadow: inset 3px 0 0 var(--rose); }
    .group-list > button > span { display: grid; min-width: 0; gap: 4px; }
    .group-list b, .group-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group-list b { font-size: 16px; }
    .group-list small { color: var(--muted); font-size: 14px; }
    .group-list em {
      display: grid; min-width: 30px; height: 30px; place-items: center; border-radius: 999px;
      background: var(--warn-soft); color: var(--warn); font-size: 13px; font-style: normal; font-weight: 800;
    }
    .group-list em.complete { background: var(--ok-soft); color: var(--ok); }
    .group-list em.optional { width: auto; padding-inline: 8px; background: var(--surface); color: var(--muted); }
    .empty-groups { padding: 24px 10px; color: var(--muted); font-size: 16px; line-height: 1.5; text-align: center; }
    .group-editor { min-inline-size: 0; margin: 0; padding: 20px; border: 1px solid var(--line); border-radius: var(--r-sm); }
    .group-editor__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .group-editor__head > div { display: grid; min-width: 0; gap: 4px; }
    .group-editor__head h3 { font-size: 22px; line-height: 1.25; }
    .eyebrow { color: var(--rose-dark); font-size: 14px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .group-editor__head small { color: var(--muted); font-size: 15px; line-height: 1.4; }
    .group-status { flex: none; padding: 8px 10px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); font-size: 14px; font-weight: 750; }
    .group-status.complete { background: var(--ok-soft); color: var(--ok); }
    .group-editor__head-actions { display: grid; justify-items: end; gap: 7px; }
    .group-editor__head-actions .btn { min-height: 44px; white-space: nowrap; }
    .legal-review { display: flex; gap: 11px; margin-top: 16px; padding: 13px 14px; border-radius: 10px; background: var(--warn-soft); color: var(--ink-2); }
    .legal-review > span { font-size: 22px; }
    .legal-review > div { display: grid; gap: 2px; }
    .legal-review b { font-size: 16px; }
    .legal-review small { color: var(--muted); font-size: 15px; line-height: 1.4; }
    .language-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 18px; }
    .language-tabs button {
      display: grid; min-width: 0; min-height: 58px; align-content: center; justify-items: start; gap: 2px;
      padding: 9px 11px; border: 1px solid var(--line); border-radius: 9px;
      background: var(--surface-2); color: var(--ink-2); text-align: left; cursor: pointer;
    }
    .language-tabs button.active { border-color: var(--rose); background: var(--rose-soft); box-shadow: inset 0 0 0 1px var(--rose); }
    .language-tabs b { overflow: hidden; width: 100%; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
    .language-tabs small { color: var(--warn); font-size: 13px; }
    .language-tabs button.complete small { color: var(--ok); }
    .mobile-language-picker { display: none; }
    .translation-value { display: grid; gap: 7px; margin-top: 18px; }
    .translation-value > span { font-size: 16px; font-weight: 700; }
    .translation-value .textarea { min-height: 210px; font-size: 16px; line-height: 1.55; }
    .next-language { display: flex; width: 100%; min-height: 48px; align-items: center; justify-content: flex-start; gap: 6px; margin-top: 10px; padding: 10px 13px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink-2); font-size: 15px; cursor: pointer; }
    .next-language span { margin-left: auto; color: var(--rose-dark); font-size: 22px; }
    .conflict, .save-error { margin-top: 14px; padding: 12px 13px; border-radius: 9px; background: var(--danger-soft); color: var(--danger); font-size: 15px; line-height: 1.45; }
    .conflict { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .conflict > div { display: grid; gap: 2px; }
    .conflict small { font-size: 14px; }
    .group-editor__actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
    .group-editor__actions .btn { min-height: 48px; font-size: 15px; }
    .content-translations--compact { border: 0; border-radius: 0; box-shadow: none; }
    .content-translations--compact > .card__head { padding: 18px 18px 14px; }
    .content-translations--compact > .card__body { padding: 0 18px 18px; }
    .content-translations--compact .workspace-toolbar,
    .content-translations--compact .scope-guide,
    .content-translations--compact .language-overview,
    .content-translations--compact .prefix-filters { display: none; }
    .content-translations--compact .workspace-controls { gap: 9px; }
    .content-translations--compact .workspace-grid { grid-template-columns: 1fr; gap: 12px; margin-top: 12px; }
    .content-translations--compact .group-list { display: flex; max-height: none; gap: 8px; overflow-x: auto; overflow-y: hidden; padding: 1px 1px 8px; scroll-padding-inline: 1px; scroll-snap-type: inline mandatory; scrollbar-width: thin; }
    .content-translations--compact .group-list > button { width: min(280px, 78vw); min-width: min(280px, 78vw); min-height: 74px; flex: 0 0 min(280px, 78vw); scroll-snap-align: start; }
    .content-translations--compact .group-list > button.active { box-shadow: inset 0 -3px 0 var(--rose); }
    .content-translations--compact .group-editor { padding: 17px; }
    .content-translations--compact .translation-value textarea { min-height: 150px; }
    .save-state { margin-right: auto; color: var(--muted); font-size: 15px; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid var(--rose); outline-offset: 2px; }

    @media (max-width: 820px) {
      .content-translations__head { align-items: stretch; flex-direction: column; }
      .content-translations__head h2 { font-size: 22px; }
      .overview-progress { width: 100%; }
      .workspace-toolbar { align-items: stretch; flex-direction: column; }
      .scope-switch { display: grid; grid-template-columns: 1fr 1fr; }
      .advanced-toggle { justify-content: space-between; }
      .language-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .filter-row { align-items: stretch; flex-direction: column; }
      .result-count { font-size: 15px; }
      .advanced-panel__head { align-items: stretch; flex-direction: column; }
      .advanced-panel__head .btn { width: 100%; }
      .create-group, .advanced-selected { grid-template-columns: 1fr; }
      .create-group__actions { display: grid; grid-template-columns: 1fr 1fr; }
      .technical-meta { grid-column: auto; grid-template-columns: 1fr; }
      .workspace-grid { grid-template-columns: 1fr; }
      .group-list { max-height: 340px; padding-right: 0; }
      .group-editor__head { align-items: stretch; flex-direction: column; }
      .group-editor__head-actions { justify-items: stretch; }
      .group-status { justify-self: start; }
      .group-editor__head-actions .btn { width: 100%; white-space: normal; }
      .language-tabs { display: none; }
      .mobile-language-picker { display: grid; gap: 7px; margin-top: 18px; }
      .mobile-language-picker > span { font-size: 16px; font-weight: 700; }
      .mobile-language-picker .select { min-height: 48px; font-size: 16px; }
      .conflict { align-items: stretch; flex-direction: column; }
      .group-editor__actions { display: grid; grid-template-columns: 1fr 1fr; }
      .save-state { grid-column: 1 / -1; margin: 0; }
    }

    @media (max-width: 480px) {
      .card__body { padding-inline: 14px; }
      .scope-switch { grid-template-columns: 1fr; }
      .scope-guide { padding-inline: 13px; }
      .language-overview { grid-template-columns: 1fr; }
      .language-overview > span { min-height: 54px; }
      .prefix-filters { margin-inline: -2px; }
      .advanced-panel, .group-editor { padding: 15px; }
      .group-editor__actions { grid-template-columns: 1fr; }
      .save-state { grid-column: auto; }
      .content-translations--compact > .card__head,
      .content-translations--compact > .card__body { padding-inline: 14px; }
      .content-translations--compact .filter-row { display: grid; }
      .content-translations--compact .group-list > button { width: 82vw; min-width: 82vw; flex-basis: 82vw; }
    }
  `,
})
export class ContentTranslationWorkspace {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly document = inject(DOCUMENT);
  private loadStarted = false;
  private focusedInitialKey: string | null = null;

  readonly languages = TRANSLATION_LANGUAGES;
  readonly visible = input(true);
  readonly syncRefreshKey = input(0);
  readonly title = input('Website Content');
  readonly description = input(
    'Homepage, navigatie, footer, juridische pagina’s en algemene SEO-teksten. '
      + 'Productnamen en productbeschrijvingen beheert u per product.',
  );
  readonly initialScope = input<ContentTranslationScope>('WEBSITE');
  readonly initialPrefix = input('ALL');
  readonly initialLanguage = input<LanguageCode>('NL');
  readonly initialKey = input<string | null>(null);
  readonly keyPrefixes = input<readonly string[]>([]);
  readonly compact = input(false);
  readonly lockScope = input(false);
  readonly lockPrefix = input(false);
  readonly allowAdvanced = input(true);
  readonly dirtyChange = output<boolean>();
  readonly busyChange = output<boolean>();
  readonly contentSaved = output<void>();
  readonly scope = signal<ContentTranslationScope>('WEBSITE');
  readonly groups = signal<ContentTranslationGroup[]>([]);
  readonly draft = signal<ContentTranslationGroup | null>(null);
  private readonly saved = signal<ContentTranslationGroup | null>(null);
  readonly selectedLanguage = signal<LanguageCode>('NL');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly creating = signal(false);
  readonly creatingRequest = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly newKey = signal('');
  readonly newLabel = signal('');
  readonly createError = signal<string | null>(null);
  readonly websiteSyncRefresh = signal(0);
  readonly search = signal('');
  readonly prefix = signal('ALL');
  readonly advancedOpen = signal(false);

  readonly busy = computed(() => this.saving() || this.deleting() || this.creatingRequest());
  readonly hasPendingChanges = computed(() => this.dirty()
    || (this.creating() && (
      !!this.newKey().trim() || !!this.newLabel().trim()
    )));
  readonly websiteSyncRefreshKey = computed(() =>
    this.websiteSyncRefresh() + this.syncRefreshKey());
  readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));
  readonly scopeGroups = computed(() => this.groups()
    .filter((group) => group.scope === this.scope())
    .filter((group) => this.inSelectedKeys(group)));
  readonly completionGroups = computed(() => this.lockPrefix()
    ? this.scopeGroups().filter((group) => this.groupPrefix(group.key) === this.prefix())
    : this.scopeGroups());
  readonly prefixOptions = computed<ContentPrefixOption[]>(() => {
    const counts = new Map<string, number>();
    for (const group of this.scopeGroups()) {
      const prefix = this.groupPrefix(group.key);
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count, label: this.prefixLabel(key) }))
      .sort((left, right) => left.label.localeCompare(right.label, 'nl'));
  });
  readonly visibleGroups = computed(() => {
    const query = this.searchTerm(this.search());
    const prefix = this.prefix();
    return this.scopeGroups()
      .filter((group) => prefix === 'ALL' || this.groupPrefix(group.key) === prefix)
      .filter((group) => !query || this.searchTerm([
        group.label,
        group.key,
        ...group.texts.map((text) => text.value ?? ''),
      ].join(' ')).includes(query))
      .sort((left, right) => left.label.localeCompare(right.label, 'nl'));
  });
  readonly languageCompletion = computed<LanguageCompletion[]>(() => {
    const required = this.completionGroups().filter((group) => group.required);
    return this.languages.map((language) => ({
      code: language.code,
      label: language.label,
      total: required.length,
      complete: required.filter(
        (group) => !group.missingLanguages.includes(language.code),
      ).length,
    }));
  });
  readonly requiredMissing = computed(() => this.completionGroups()
    .filter((group) => group.required)
    .reduce((total, group) => total + group.missingLanguages.length, 0),
  );
  readonly requiredFieldCount = computed(() => this.completionGroups()
    .filter((group) => group.required).length * this.languages.length);
  readonly requiredComplete = computed(() =>
    this.requiredFieldCount() - this.requiredMissing());
  readonly completionPercent = computed(() => {
    const total = this.requiredFieldCount();
    if (total) return Math.round((this.requiredComplete() / total) * 100);
    return !this.scopeGroups().length
      && this.keyPrefixes().some((key) => key.trim().length > 0) ? 0 : 100;
  });
  readonly selectedLanguageLabel = computed(() =>
    this.languages.find((item) => item.code === this.selectedLanguage())?.label
      ?? this.selectedLanguage(),
  );
  readonly selectedValue = computed(() => this.draft()?.texts.find(
    (text) => text.language === this.selectedLanguage(),
  )?.value ?? '');
  readonly nextMissingLanguage = computed(() => {
    const group = this.draft();
    if (!group?.required) return null;
    const currentIndex = this.languages.findIndex(
      (language) => language.code === this.selectedLanguage(),
    );
    for (let offset = 1; offset < this.languages.length; offset += 1) {
      const candidate = this.languages[(currentIndex + offset) % this.languages.length];
      if (!this.hasText(group, candidate.code)) return candidate;
    }
    return null;
  });
  readonly legalReview = computed(() => {
    const group = this.draft();
    return !!group && /(?:legal|terms|conditions|privacy|voorwaarden|jurid)/i
      .test(`${group.key} ${group.label}`);
  });
  readonly keyValid = computed(() => CONTENT_KEY_PATTERN.test(this.newKey()));
  readonly draftValid = computed(() => {
    const group = this.draft();
    return !!group?.label.trim() && (!group.required || group.missingLanguages.length === 0);
  });

  constructor() {
    effect(() => {
      if (!this.visible() || this.loadStarted) return;
      this.loadStarted = true;
      untracked(() => {
        this.scope.set(this.initialScope());
        this.prefix.set(this.initialPrefix());
        this.selectedLanguage.set(this.initialLanguage());
        void this.load();
      });
    });
    effect(() => {
      const initialKey = this.initialKey()?.trim();
      const group = this.draft();
      if (!initialKey || group?.key !== initialKey || this.loading()) return;
      if (this.focusedInitialKey === initialKey) return;
      this.focusedInitialKey = initialKey;
      queueMicrotask(() => this.focusInitialTranslation());
    });
    effect(() => this.dirtyChange.emit(this.hasPendingChanges()));
    effect(() => this.busyChange.emit(this.busy()));
  }

  async load(): Promise<void> {
    if (this.loading() && this.groups().length) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const scopes: ContentTranslationScope[] = this.lockScope()
        ? [this.initialScope()]
        : ['WEBSITE', 'CATALOG'];
      const overviews = await Promise.all(scopes.map((scope) =>
        this.catalog.contentTranslations(scope)));
      const groups = overviews.flatMap((overview) => overview.groups);
      this.groups.set(groups);
      const current = this.draft();
      const initialKey = this.initialKey()?.trim();
      const wantedPrefix = this.initialPrefix();
      const candidates = groups.filter((group) => group.scope === this.scope())
        .filter((group) => this.inSelectedKeys(group))
        .filter((group) => wantedPrefix === 'ALL' || this.groupPrefix(group.key) === wantedPrefix)
        .sort((left, right) => left.label.localeCompare(right.label, 'nl'));
      if (wantedPrefix !== 'ALL' && !candidates.length && !this.lockPrefix()) {
        this.prefix.set('ALL');
      }
      const hasSelectedKeyFilter = this.keyPrefixes().some((key) => key.trim().length > 0);
      const selected = groups.find((group) =>
        !!initialKey && group.scope === this.scope() && group.key === initialKey)
        ?? candidates.find((group) =>
        !!current && group.scope === current.scope && group.key === current.key)
        ?? candidates[0]
        ?? (this.lockPrefix() || hasSelectedKeyFilter
          ? null
          : groups.find((group) => group.scope === this.scope()) ?? groups[0]);
      this.setSelected(selected ?? null);
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'Controleer de verbinding en probeer opnieuw.'));
    } finally {
      this.loading.set(false);
    }
  }

  select(group: ContentTranslationGroup): void {
    if (this.busy() || (this.hasPendingChanges() && this.draft()?.key !== group.key)) return;
    this.advancedOpen.set(false);
    this.setSelected(group);
  }

  changeScope(scope: ContentTranslationScope): void {
    if (this.lockScope() || this.busy() || this.hasPendingChanges() || scope === this.scope()) return;
    this.scope.set(scope);
    this.search.set('');
    this.prefix.set('ALL');
    this.advancedOpen.set(false);
    this.creating.set(false);
    this.setSelected(this.groups().find((group) => group.scope === scope) ?? null);
  }

  patchGroup(changes: Partial<ContentTranslationGroup>): void {
    if (this.busy()) return;
    const current = this.draft();
    if (current?.system && ('label' in changes || 'required' in changes)) return;
    this.saveError.set(null);
    this.conflict.set(false);
    this.draft.update((group) => group ? { ...group, ...changes } : group);
  }

  patchValue(value: string): void {
    const group = this.draft();
    if (!group || this.busy()) return;
    const language = this.selectedLanguage();
    const text: ContentTranslationText = { language, value };
    const texts = group.texts.some((item) => item.language === language)
      ? group.texts.map((item) => item.language === language ? text : item)
      : [...group.texts, text];
    this.patchGroup({ texts, missingLanguages: this.missingLanguages({ ...group, texts }) });
  }

  async copySelectedCodexBrief(): Promise<void> {
    const group = this.draft();
    if (!group) return;
    const lines = [
      'ENROSED websitetekstvertaling voor Codex',
      '',
      'Vertaal of hercontroleer deze ene publieke websitecopy-groep naar alle doeltalen. Wijzig scope, contentKey, revision en placeholders zoals {name} nooit. Behoud betekenis en merktoon; juridische copy moet na vertaling handmatig worden nagekeken.',
      '',
      `scope: ${group.scope}`,
      `contentKey: ${group.key}`,
      `revision: ${group.revision}`,
      `dashboardlabel: ${JSON.stringify(group.label)}`,
      `verplicht: ${group.required ? 'ja' : 'nee'}`,
      `doeltalen: ${this.languages.map((language) => language.code).join(', ')}`,
      '',
    ];
    for (const language of this.languages) {
      const value = group.texts.find((text) => text.language === language.code)?.value;
      lines.push(
        `## ${language.code} — ${language.label}`,
        `tekst: ${JSON.stringify(value?.trim() ?? '')}`,
        '',
      );
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      this.ui.toast('Veilige websitevertaalopdracht gekopieerd');
    } catch {
      this.ui.toast('Kopiëren is niet gelukt. Controleer de browsertoestemming.', 'err');
    }
  }

  hasText(group: ContentTranslationGroup, language: LanguageCode): boolean {
    return !!group.texts.find((text) => text.language === language)?.value?.trim();
  }

  completedLanguages(group: ContentTranslationGroup): number {
    return this.languages.length - group.missingLanguages.length;
  }

  groupArea(group: ContentTranslationGroup): string {
    return this.prefixLabel(this.groupPrefix(group.key));
  }

  async saveSelected(): Promise<void> {
    const group = this.draft();
    if (!group || !this.dirty() || !this.draftValid() || this.busy()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.conflict.set(false);
    try {
      const saved = await this.catalog.updateContentTranslation(group.scope, group.key, {
        revision: group.revision,
        label: group.label.trim(),
        required: group.required,
        texts: group.texts.map((text) => ({
          language: text.language,
          value: text.value?.trim() || null,
        })),
      });
      this.replaceGroup(saved);
      this.setSelected(saved);
      this.websiteSyncRefresh.update((value) => value + 1);
      this.contentSaved.emit();
      this.ui.toast('Tekstvertalingen opgeslagen');
    } catch (failure: unknown) {
      const conflict = isRevisionConflict(failure);
      this.conflict.set(conflict);
      this.saveError.set(conflict
        ? 'Iemand heeft deze tekst intussen gewijzigd. Laad de laatste versie en controleer je aanpassing opnieuw.'
        : messageOf(failure, 'Tekstvertalingen opslaan mislukt.'));
    } finally {
      this.saving.set(false);
    }
  }

  async reloadSelected(): Promise<void> {
    const group = this.draft();
    if (!group || this.busy()) return;
    this.loading.set(true);
    try {
      const latest = await this.catalog.contentTranslation(group.scope, group.key);
      this.replaceGroup(latest);
      this.setSelected(latest);
    } catch (failure: unknown) {
      this.saveError.set(messageOf(failure, 'Laatste versie laden mislukt.'));
    } finally {
      this.loading.set(false);
    }
  }

  revertSelected(): void {
    const saved = this.saved();
    if (this.busy() || !this.dirty()) return;
    this.ui.confirm({
      title: 'Tekstwijzigingen wissen',
      message: 'De niet-opgeslagen wijzigingen in deze tekstgroep gaan verloren.',
      confirmLabel: 'Wijzigingen wissen',
      danger: true,
    }, () => {
      this.draft.set(saved ? this.copy(saved) : null);
      this.saveError.set(null);
      this.conflict.set(false);
    });
  }

  startCreate(): void {
    if (!this.allowAdvanced()) return;
    this.search.set('');
    this.prefix.set('ALL');
    this.newKey.set('');
    this.newLabel.set('');
    this.createError.set(null);
    this.creating.set(true);
  }

  cancelCreate(): void {
    if (!this.creatingRequest()) {
      this.creating.set(false);
      this.createError.set(null);
    }
  }

  patchNewLabel(value: string): void {
    this.newLabel.set(value);
    this.createError.set(null);
  }

  patchNewKey(value: string): void {
    this.newKey.set(value.toLowerCase());
    this.createError.set(null);
  }

  normalizeKey(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/[.-]+/g, (separators) => separators.includes('.') ? '.' : '-')
      .replace(/^[.-]+|[.-]+$/g, '');
  }

  normalizeNewKey(): void {
    this.newKey.set(this.normalizeKey(this.newKey()));
  }

  async createGroup(): Promise<void> {
    if (!this.keyValid() || !this.newLabel().trim() || this.busy()) return;
    this.creatingRequest.set(true);
    this.createError.set(null);
    try {
      const created = await this.catalog.createContentTranslation({
        scope: this.scope(),
        key: this.newKey(),
        label: this.newLabel().trim(),
        required: false,
        texts: [],
      });
      this.groups.update((groups) => [...groups, created]);
      this.creating.set(false);
      this.setSelected(created);
      this.websiteSyncRefresh.update((value) => value + 1);
      this.contentSaved.emit();
      this.ui.toast('Tekstgroep toegevoegd');
    } catch (failure: unknown) {
      const message = messageOf(
        failure,
        'Tekstgroep toevoegen mislukt. Controleer de invoer en probeer opnieuw.',
      );
      this.createError.set(message);
      this.ui.toast(message, 'err');
    } finally {
      this.creatingRequest.set(false);
    }
  }

  deleteSelected(): void {
    const group = this.draft();
    if (!group || group.system || this.dirty() || this.busy()) return;
    this.ui.confirm({
      title: 'Tekstgroep verwijderen',
      message: `<b>${escapeHtml(group.label)}</b> verwijderen?`,
      confirmLabel: 'Verwijderen',
      danger: true,
    }, async () => {
      this.deleting.set(true);
      try {
        await this.catalog.deleteContentTranslation(group.scope, group.key, group.revision);
        this.groups.update((groups) => groups.filter(
          (item) => item.scope !== group.scope || item.key !== group.key,
        ));
        this.setSelected(this.visibleGroups()[0] ?? null);
        this.websiteSyncRefresh.update((value) => value + 1);
        this.contentSaved.emit();
        this.ui.toast('Tekstgroep verwijderd');
      } catch (failure: unknown) {
        const conflict = isRevisionConflict(failure);
        this.conflict.set(conflict);
        this.saveError.set(conflict
          ? 'Deze tekstgroep is intussen gewijzigd. Laad de laatste versie.'
          : messageOf(failure, 'Tekstgroep verwijderen mislukt.'));
      } finally {
        this.deleting.set(false);
      }
    });
  }

  private setSelected(group: ContentTranslationGroup | null): void {
    if (group) this.scope.set(group.scope);
    const copy = group ? this.copy(group) : null;
    this.saved.set(copy ? this.copy(copy) : null);
    this.draft.set(copy);
    this.saveError.set(null);
    this.conflict.set(false);
  }

  private focusInitialTranslation(attempt = 0): void {
    const view = this.document.defaultView;
    const target = this.document.getElementById('content-translation-value');
    if (!view) return;
    if (!target && attempt < 3) {
      view.requestAnimationFrame(() => this.focusInitialTranslation(attempt + 1));
      return;
    }
    if (!(target instanceof HTMLTextAreaElement)) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  }

  private replaceGroup(group: ContentTranslationGroup): void {
    this.groups.update((groups) => [
      ...groups.filter((item) => item.scope !== group.scope || item.key !== group.key),
      group,
    ]);
  }

  private missingLanguages(group: ContentTranslationGroup): LanguageCode[] {
    return this.languages
      .map((language) => language.code)
      .filter((language) => !this.hasText(group, language));
  }

  private copy(group: ContentTranslationGroup): ContentTranslationGroup {
    return { ...group, texts: group.texts.map((text) => ({ ...text })),
      missingLanguages: [...group.missingLanguages] };
  }

  private groupPrefix(key: string): string {
    const parts = key.toLowerCase().split(/[._:/-]+/).filter(Boolean);
    return parts.find((part) => PREFIX_LABELS[part]) ?? parts[0] ?? 'other';
  }

  private inSelectedKeys(group: ContentTranslationGroup): boolean {
    const roots = this.keyPrefixes()
      .map((root) => root.trim().toLowerCase())
      .filter(Boolean);
    if (!roots.length) return true;
    const key = group.key.toLowerCase();
    return roots.some((root) => key === root
      || key.startsWith(root.endsWith('.') ? root : `${root}.`));
  }

  private prefixLabel(prefix: string): string {
    return PREFIX_LABELS[prefix]
      ?? prefix.charAt(0).toUpperCase() + prefix.slice(1).replaceAll('-', ' ');
  }

  prefixLabelForDisplay(prefix: string): string {
    return this.prefixLabel(prefix);
  }

  private searchTerm(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
}
