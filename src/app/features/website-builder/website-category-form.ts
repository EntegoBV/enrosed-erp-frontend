import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Category, LanguageCode } from '../../core/api/models';
import { CategoryTranslationEditor } from '../settings/category-translation-editor';
import { categoryCodeTaken, categoryCodeValid, featuredChoiceText } from './website-categories-view';

/** One choice of the "Uitgelicht product" list, prepared by the page. */
export interface CategoryFeaturedChoice {
  id: number;
  label: string;
  disabled: boolean;
}

/**
 * The fields of one category in Categorieën: the names the website menu
 * uses, the fixed URL code, the uitgelicht product, the description and the
 * translations (CategoryTranslationEditor, unchanged). Holds no state: the
 * page keeps the draft and saves it. On the desk the fields stack in the
 * inspector; on the phone they sit in inset groups inside the sheet.
 * The "Volgorde" number of the settings form is not here: the order changes
 * with ↑ ↓ only, and the position shows above the form.
 */
@Component({
  selector: 'app-website-category-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: block' },
  imports: [CategoryTranslationEditor, FormsModule, NgTemplateOutlet],
  template: `
    <ng-template #namesPart>
      <div class="field">
        <label class="req" [attr.for]="id('name')">Naam</label>
        <input class="input" [id]="id('name')" autocomplete="off" [ngModel]="draft().name"
               (ngModelChange)="patch.emit({ name: $event })" placeholder="Bijv. Geurkaarsen" />
      </div>
      <div class="field">
        <label [attr.for]="id('navigation-name')">Korte navigatienaam (desktop) <span class="opt"></span></label>
        <input class="input" [id]="id('navigation-name')" maxlength="40" [ngModel]="draft().navigationName"
               (ngModelChange)="patch.emit({ navigationName: $event })" placeholder="Bijv. Kaarsen" />
        <span class="hint">Alleen gebruikt in de hoofdnavigatie van de website op desktop.</span>
      </div>
      <div class="field">
        <label [attr.for]="id('mobile-name')">Korte mobiele naam <span class="opt"></span></label>
        <input class="input" [id]="id('mobile-name')" maxlength="40" [ngModel]="draft().mobileName"
               (ngModelChange)="patch.emit({ mobileName: $event })" placeholder="Bijv. Kaarsen" />
        <span class="hint">Alleen gebruikt waar de volledige naam niet netjes past.</span>
      </div>
    </ng-template>

    <ng-template #websitePart>
      <div class="field">
        <label [attr.for]="id('footer-name')">Naam in websitefooter <span class="opt"></span></label>
        <input class="input" [id]="id('footer-name')" [ngModel]="draft().footerName"
               (ngModelChange)="patch.emit({ footerName: $event })" placeholder="Bijv. Geurkaarsen" />
        <span class="hint">Leeg gebruikt de gewone categorienaam in de websitefooter.</span>
      </div>
      <div class="field">
        <label [attr.for]="id('eyebrow')">Bovenregel website <span class="opt"></span></label>
        <input class="input" [id]="id('eyebrow')" [ngModel]="draft().eyebrow"
               (ngModelChange)="patch.emit({ eyebrow: $event })" placeholder="Bijv. Onze signatuur" />
        <span class="hint">Korte tekst boven de categorietitel op de website; leeg betekent geen bovenregel.</span>
      </div>
      <div class="field">
        <label class="req" [attr.for]="id('code')">Vaste URL-code</label>
        <input class="input mono" [id]="id('code')" autocomplete="off" autocapitalize="none" spellcheck="false"
               [ngModel]="draft().code" [readOnly]="draft().id !== null" placeholder="display-roses"
               (ngModelChange)="patch.emit({ code: $event })" (blur)="codeBlur.emit()" />
        <span class="hint">
          @if (draft().id === null) {
            Kies deze vaste sleutel één keer bij het aanmaken. De categorienaam en de vertalingen kunnen later wel veranderen.
          } @else {
            Vast na aanmaak: deze sleutel houdt collectie- en menulinks stabiel. Voor een andere URL is een aparte doorverwijzing nodig.
          }
        </span>
        @if (codeTaken()) {
          <span class="ws-cf__error" role="alert">Deze code bestaat al. Kies een unieke code.</span>
        } @else if (draft().code.trim() && !codeValid()) {
          <span class="ws-cf__error" role="alert">Vul minstens één letter of cijfer in voor de URL-code.</span>
        }
      </div>
    </ng-template>

    <ng-template #featuredPart>
      <div class="field">
        <label [attr.for]="id('featured-product')">Uitgelicht product <span class="opt"></span></label>
        <select class="select ws-cf__featured" [id]="id('featured-product')" [ngModel]="draft().featuredProductId ?? null"
                [attr.title]="featuredText() || null" [disabled]="draft().id === null || dependencyMissing()"
                (ngModelChange)="patch.emit({ featuredProductId: numberOrNull($event) })">
          <option [ngValue]="null">Geen uitgelicht product</option>
          @for (choice of choices(); track choice.id) {
            <option [ngValue]="choice.id" [disabled]="choice.disabled">{{ choice.label }}</option>
          }
          @if (dependencyMissing() && draft().featuredProductId !== null) {
            <option [ngValue]="draft().featuredProductId" disabled>Huidige keuze #{{ draft().featuredProductId }} · productgegevens niet geladen</option>
          } @else if (missingFeaturedId() !== null) {
            <option [ngValue]="missingFeaturedId()" disabled>Product #{{ missingFeaturedId() }} · geen publieke foto</option>
          }
        </select>
        <span class="hint">
          @if (draft().id === null) {
            Sla de categorie eerst op en koppel daarna producten.
          } @else if (dependencyMissing()) {
            Laad de productgegevens opnieuw voordat je het uitgelichte product wijzigt.
          } @else {
            Actief product met een publieke foto dat deze collectie in beeld brengt.
          }
        </span>
      </div>
    </ng-template>

    <ng-template #descriptionPart>
      <div class="field">
        <label [attr.for]="id('description')">Beschrijving <span class="opt"></span></label>
        <textarea class="textarea" [id]="id('description')" rows="3" [ngModel]="draft().description"
                  (ngModelChange)="patch.emit({ description: $event })"
                  placeholder="Korte omschrijving voor catalogus, bestelapp en website…"></textarea>
      </div>
    </ng-template>

    <ng-template #translationsPart>
      <app-category-translation-editor [category]="draft()" [busy]="busy()" [saveError]="saveError()"
                                       [initialLanguage]="initialLanguage()" [focusField]="focusField()"
                                       (categoryChange)="translations.emit($event)" />
    </ng-template>

    @if (variant() === 'phone') {
      <div class="ws-cf ws-cf--phone">
        <section class="ios-section"><div class="ios-section__head"><h2>Namen</h2></div>
          <div class="ios-card ws-cf__card"><ng-container [ngTemplateOutlet]="namesPart" /></div></section>
        <section class="ios-section"><div class="ios-section__head"><h2>Website</h2></div>
          <div class="ios-card ws-cf__card"><ng-container [ngTemplateOutlet]="websitePart" /></div></section>
        <section class="ios-section"><div class="ios-section__head"><h2>Uitgelicht</h2></div>
          <div class="ios-card ws-cf__card"><ng-container [ngTemplateOutlet]="featuredPart" /></div></section>
        <section class="ios-section"><div class="ios-section__head"><h2>Beschrijving</h2></div>
          <div class="ios-card ws-cf__card"><ng-container [ngTemplateOutlet]="descriptionPart" /></div></section>
        <section class="ios-section"><div class="ios-section__head"><h2>Vertalingen</h2></div>
          <div class="ws-cf__tr"><ng-container [ngTemplateOutlet]="translationsPart" /></div></section>
      </div>
    } @else {
      <div class="ws-cf">
        <ng-container [ngTemplateOutlet]="namesPart" />
        <ng-container [ngTemplateOutlet]="websitePart" />
        <ng-container [ngTemplateOutlet]="featuredPart" />
        <ng-container [ngTemplateOutlet]="descriptionPart" />
        <ng-container [ngTemplateOutlet]="translationsPart" />
      </div>
    }
  `,
})
export class WebsiteCategoryForm {
  readonly draft = input.required<Category>();
  /** Every category, for the "code already taken" check. */
  readonly categories = input<readonly Category[]>([]);
  readonly choices = input<readonly CategoryFeaturedChoice[]>([]);
  /** The stored uitgelicht product that is no longer in the product list. */
  readonly missingFeaturedId = input<number | null>(null);
  /** Products or reeksen did not load: the uitgelicht list is incomplete and locked. */
  readonly dependencyMissing = input(false);
  readonly busy = input(false);
  readonly saveError = input<string | null>(null);
  readonly initialLanguage = input<LanguageCode>('NL');
  readonly focusField = input<string | null>(null);
  readonly variant = input<'desk' | 'phone'>('desk');

  readonly patch = output<Partial<Category>>();
  readonly translations = output<Category>();
  readonly codeBlur = output<void>();

  readonly codeTaken = computed(() => categoryCodeTaken(this.categories(), this.draft()));
  readonly codeValid = computed(() => categoryCodeValid(this.draft().code));
  /** The chosen uitgelicht product in full, for the select's title (the inspector cuts it). */
  readonly featuredText = computed(() => featuredChoiceText(this.choices(), this.draft().featuredProductId ?? null,
    this.dependencyMissing(), this.missingFeaturedId()));

  /** Desk and phone forms can be in the page at once (drawer, sheet): ids stay unique per variant. */
  id(field: string): string {
    return `ws-category-${this.variant()}-${field}`;
  }

  numberOrNull(value: number | string | null): number | null {
    return value === null || value === '' ? null : Number(value);
  }
}
