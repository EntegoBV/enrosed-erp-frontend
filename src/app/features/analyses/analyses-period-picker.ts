import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { PERIOD_PRESETS, customPeriod, periodLabel, periodRange, presetLabel } from './analyses-period';
import type { PeriodChoice, PeriodPreset } from './analyses-period';

/**
 * The period of an Analyses tab on the desk (design §2.4): a button with the
 * period's name that opens a popover with the five presets and two dates.
 * A preset applies and closes; a date applies at once and keeps the popover
 * open; Esc and a click outside close it and return focus to the button.
 * The phone shows a tinted capsule instead (in the page) that opens the
 * "Periode" sheet with AnPeriodSheet below, at page level (critique N5).
 */
@Component({
  selector: 'app-an-period',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateField, Icon],
  host: {
    class: 'wk-popover-anchor an-period',
    '(document:pointerdown)': 'outside($event)',
    '(document:keydown.escape)': 'escape()',
  },
  template: `
    <button #button class="wk-btn an-pick" type="button" aria-haspopup="dialog" [attr.aria-expanded]="open()"
            [attr.aria-label]="'Periode: ' + label()" (click)="open.set(!open())">
      <app-icon name="calendar" [size]="15" /><span>{{ label() }}</span><app-icon class="an-pick__chev" name="chevron-down" [size]="13" />
    </button>
    @if (open()) {
      <div class="wk-popover an-pop" role="dialog" aria-label="Periode">
        <div class="an-pop__list" role="radiogroup" aria-label="Vaste periodes">
          @for (preset of presets; track preset) {
            <button class="an-pop__opt" type="button" role="radio" [attr.aria-checked]="isOn(preset)" [class.is-on]="isOn(preset)" (click)="pick(preset)">
              <span>{{ presetName(preset) }}</span>
              @if (isOn(preset)) { <app-icon name="tick" [size]="15" /> }
            </button>
          }
        </div>
        <div class="an-pop__dates" role="group" aria-label="Eigen periode">
          <p class="an-pop__head">Eigen periode</p>
          <label><span>Van</span><app-date-field [fieldId]="idPrefix() + '-van'" [value]="range().from" (valueChange)="setFrom($event)" /></label>
          <label><span>Tot en met</span><app-date-field [fieldId]="idPrefix() + '-tot'" [value]="range().to" (valueChange)="setTo($event)" /></label>
        </div>
        @if (note()) { <p class="an-pop__note">{{ note() }}</p> }
      </div>
    }
  `,
})
export class AnPeriodPicker {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('button');

  readonly value = input.required<PeriodChoice>();
  readonly today = input.required<string>();
  readonly note = input('');
  readonly idPrefix = input('an-period');
  readonly changed = output<PeriodChoice>();

  readonly presets = PERIOD_PRESETS;
  readonly open = signal(false);
  readonly label = computed(() => periodLabel(this.value(), this.today()));
  readonly range = computed(() => periodRange(this.value(), this.today()));

  presetName(preset: PeriodPreset): string { return presetLabel(preset, this.today()); }
  isOn(preset: PeriodPreset): boolean { const value = this.value(); return 'preset' in value && value.preset === preset; }

  pick(preset: PeriodPreset): void {
    this.changed.emit({ preset });
    this.close(true);
  }

  setFrom(day: string): void { this.changed.emit(customPeriod(day, this.range().to)); }
  setTo(day: string): void { this.changed.emit(customPeriod(this.range().from, day)); }

  outside(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  escape(): void {
    if (this.open()) this.close(true);
  }

  private close(focus: boolean): void {
    this.open.set(false);
    if (focus) this.button().nativeElement.focus();
  }
}

/**
 * The body of the phone "Periode" sheet: the five presets with a tick on the
 * current one, "Eigen periode" with Van and Tot en met, and the note. The
 * page renders it inside its own app-sheet at page level and closes the
 * sheet on (picked).
 */
@Component({
  selector: 'app-an-period-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="ios-group">
      @for (preset of presets; track preset) {
        <button class="ios-cell" type="button" role="radio" [attr.aria-checked]="isOn(preset)" (click)="picked.emit({ preset })">
          <span class="ios-cell__body"><span class="ios-cell__title">{{ presetName(preset) }}</span></span>
          @if (isOn(preset)) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
        </button>
      }
    </div>
    <div class="ios-section an-sheet-dates">
      <div class="ios-section__head"><h3 class="ios-section__title">Eigen periode</h3></div>
      <div class="ios-group">
        <label class="ios-cell an-date-cell"><span class="ios-cell__body"><span class="ios-cell__title">Van</span></span>
          <input class="an-date" type="date" [value]="range().from" (change)="setFrom($any($event.target).value)" /></label>
        <label class="ios-cell an-date-cell"><span class="ios-cell__body"><span class="ios-cell__title">Tot en met</span></span>
          <input class="an-date" type="date" [value]="range().to" (change)="setTo($any($event.target).value)" /></label>
      </div>
      @if (note()) { <p class="ios-section__foot">{{ note() }}</p> }
    </div>
  `,
})
export class AnPeriodSheet {
  readonly value = input.required<PeriodChoice>();
  readonly today = input.required<string>();
  readonly note = input('');
  /** A preset: apply and close. */
  readonly picked = output<PeriodChoice>();
  /** A date: apply and keep the sheet open. */
  readonly changed = output<PeriodChoice>();

  readonly presets = PERIOD_PRESETS;
  readonly range = computed(() => periodRange(this.value(), this.today()));

  presetName(preset: PeriodPreset): string { return presetLabel(preset, this.today()); }
  isOn(preset: PeriodPreset): boolean { const value = this.value(); return 'preset' in value && value.preset === preset; }
  setFrom(day: string): void { this.changed.emit(customPeriod(day, this.range().to)); }
  setTo(day: string): void { this.changed.emit(customPeriod(this.range().from, day)); }
}
