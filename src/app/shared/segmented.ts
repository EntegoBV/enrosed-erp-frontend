import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { Icon } from './icon';

/** One segment. A label and an icon can go together; an icon alone needs an ariaLabel. */
export interface SegmentOption {
  id: string;
  label: string;
  /** Replaces the label on a desk when the toolbar is narrower than 900px. */
  shortLabel?: string;
  count?: number | null;
  dot?: 'warn' | 'danger' | null;
  icon?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * The segmented control of the workspace kit: equal segments with a thumb
 * that slides under the chosen one (pure CSS, driven by --seg-n and
 * --seg-i). 'desk' is the compact toolbar control, 'ios' the rounded
 * iOS 26 one. Semantics 'tabs' is for view switches, 'radio' for filters;
 * either way the arrow keys move the choice, Home and End jump to the ends.
 *
 *   <app-segmented label="Weergave" semantics="tabs" [options]="views"
 *                  [value]="view()" (changed)="view.set($event)" />
 */
@Component({
  selector: 'app-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    '[class.wk-seg]': "variant() === 'desk'",
    '[class.ios-seg]': "variant() === 'ios'",
    '[attr.role]': "tabs() ? 'tablist' : 'radiogroup'",
    '[attr.aria-label]': 'label()',
    '[style.--seg-n]': 'options().length',
    '[style.--seg-i]': 'selectedIndex()',
    '(keydown)': 'onKey($event)',
  },
  template: `
    @for (option of options(); track option.id; let i = $index) {
      <button type="button" [class.wk-seg__opt]="desk()" [class.ios-seg__opt]="!desk()"
              [attr.role]="tabs() ? 'tab' : 'radio'"
              [attr.aria-selected]="tabs() ? option.id === value() : null"
              [attr.aria-checked]="tabs() ? null : option.id === value()"
              [attr.aria-controls]="tabs() ? controls() : null"
              [attr.aria-label]="option.ariaLabel || null"
              [attr.tabindex]="i === selectedIndex() ? 0 : -1"
              [disabled]="!!option.disabled" (click)="pick(option)">
        @if (option.icon) { <app-icon [name]="option.icon" [size]="16" /> }
        @if (option.label) {
          <span [class.wk-seg__full]="desk()" [class.ios-seg__full]="!desk()">{{ option.label }}</span>
        }
        @if (option.shortLabel) {
          <span [class.wk-seg__short]="desk()" [class.ios-seg__short]="!desk()">{{ option.shortLabel }}</span>
        }
        @if (option.count != null) {
          <span [class.wk-seg__count]="desk()" [class.ios-seg__count]="!desk()">{{ option.count }}</span>
        }
        @if (option.dot) {
          <i [class.wk-seg__dot]="desk()" [class.ios-seg__dot]="!desk()"
             [class.is-danger]="option.dot === 'danger'" aria-hidden="true"></i>
        }
      </button>
    }
  `,
})
export class Segmented {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly options = input.required<readonly SegmentOption[]>();
  readonly value = input.required<string>();
  readonly variant = input<'desk' | 'ios'>('desk');
  /** The accessible name of the group. */
  readonly label = input.required<string>();
  readonly semantics = input<'radio' | 'tabs'>('radio');
  /** The id of the panel the tabs control (semantics 'tabs' only). */
  readonly controls = input<string | null>(null);
  readonly changed = output<string>();

  readonly desk = computed(() => this.variant() === 'desk');
  readonly tabs = computed(() => this.semantics() === 'tabs');
  readonly selectedIndex = computed(() =>
    Math.max(0, this.options().findIndex((option) => option.id === this.value())));

  pick(option: SegmentOption): void {
    if (option.disabled || option.id === this.value()) return;
    this.changed.emit(option.id);
  }

  onKey(event: KeyboardEvent): void {
    const options = this.options();
    const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
    if (!enabled.length) return;
    const current = this.selectedIndex();
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = this.step(options, current, 1); break;
      case 'ArrowLeft': next = this.step(options, current, -1); break;
      case 'Home': next = enabled[0]; break;
      case 'End': next = enabled[enabled.length - 1]; break;
      default: return;
    }
    event.preventDefault();
    if (next !== current) this.changed.emit(options[next].id);
    afterNextRender(() => {
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
    }, { injector: this.injector });
  }

  /** The next enabled option in a direction, wrapping around the ends. */
  private step(options: readonly SegmentOption[], from: number, direction: 1 | -1): number {
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (from + direction * offset + options.length) % options.length;
      if (!options[index].disabled) return index;
    }
    return from;
  }
}
