import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, input, linkedSignal, output, signal, viewChild,
} from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { rankParties } from './party-suggestions';
import type { PartyCandidate } from './party-suggestions';

let nextId = 0;

/**
 * The "Aan wie" combobox: a plain text field that offers the known names
 * while typing (ranked by party-suggestions.ts) and still takes any name.
 * The host renders as `display: contents`, so the input and the list are
 * direct flex children of the surrounding .fin-field: on a phone the inset
 * group rule lays them out, and the list runs in flow under the row, full
 * group width; on a desk it floats under the field.
 *
 *   <div class="fin-field fin-field--combo"><span><label for="k-party">Aan wie</label></span>
 *     <app-party-field fieldId="k-party" [value]="draft().party ?? ''" [candidates]="state.partySuggestions()"
 *                      (valueChange)="patch({ party: $event })" (picked)="applyParty()" (committed)="applyParty()" /></div>
 */
@Component({
  selector: 'app-party-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    style: 'display: contents',
    '(document:pointerdown)': 'outside($event)',
  },
  template: `
    <input #field class="input" type="text" role="combobox" autocomplete="off" spellcheck="false" aria-autocomplete="list"
           [id]="fieldId()" [placeholder]="placeholder()" [attr.maxlength]="maxlength()" [value]="value()"
           [attr.aria-expanded]="listed()" [attr.aria-controls]="listed() ? listId : null"
           [attr.aria-activedescendant]="listed() && active() >= 0 ? listId + '-' + active() : null"
           (input)="type($any($event.target).value)" (focus)="show()" (blur)="commit()" (keydown)="onKey($event)" />
    @if (listed()) {
      <ul class="fin-combo__list" role="listbox" [id]="listId" aria-label="Suggesties">
        @for (candidate of ranked(); track candidate.name; let i = $index) {
          <li role="presentation">
            <!-- pointerdown is prevented so the input keeps focus and the blur does not swallow the tap; the pick happens on click. -->
            <button class="fin-combo__option" type="button" role="option" tabindex="-1" [id]="listId + '-' + i"
                    [attr.aria-selected]="i === active()" (pointerdown)="$event.preventDefault()" (click)="pick(candidate)">
              <b>{{ candidate.name }}</b>@if (candidate.detail) { <small>{{ candidate.detail }}</small> }
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class PartyField {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly desk = inject(DesktopViewport).active;
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  readonly value = input<string>('');
  readonly placeholder = input<string>('');
  readonly candidates = input<readonly PartyCandidate[]>([]);
  readonly fieldId = input<string>('');
  /** 300 on a bank line, 200 on a cost. */
  readonly maxlength = input<number>(200);
  /** Every keystroke. */
  readonly valueChange = output<string>();
  /** A suggestion was chosen; the value has been emitted already. */
  readonly picked = output<PartyCandidate>();
  /** The field was left or Enter pressed without a choice: the name stands as typed. */
  readonly committed = output<void>();

  readonly listId = `party-list-${++nextId}`;
  readonly open = signal(false);
  /** Four rows under a phone keyboard, six on a desk. */
  readonly ranked = computed(() => (this.open() ? rankParties(this.value(), this.candidates(), this.desk() ? 6 : 4) : []));
  readonly listed = computed(() => this.open() && this.ranked().length > 0);
  /** The row the arrow keys are on; a new list starts without one. */
  readonly active = linkedSignal<PartyCandidate[], number>({ source: this.ranked, computation: () => -1 });

  /** The keyboard settled or the viewport changed while the list is open: keep the field centred. */
  private readonly onViewport = (): void => {
    if (this.open()) this.field().nativeElement.scrollIntoView({ block: 'center' });
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.unwatch());
  }

  type(text: string): void {
    this.valueChange.emit(text);
    if (!this.open()) this.show();
  }

  /** Opens on focus too: an empty query offers the stored names first. */
  show(): void {
    if (this.open()) return;
    this.open.set(true);
    if (this.desk()) return;
    /* The keyboard just took half the screen: keep the field and its rows in view, now and when the viewport settles. */
    this.reveal();
    globalThis.visualViewport?.addEventListener('resize', this.onViewport);
  }

  hide(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.unwatch();
  }

  pick(candidate: PartyCandidate): void {
    this.valueChange.emit(candidate.name);
    this.hide();
    this.picked.emit(candidate);
  }

  commit(): void {
    this.hide();
    this.committed.emit();
  }

  onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!this.open()) this.show();
        const rows = this.ranked().length;
        if (!rows) return;
        event.preventDefault();
        const current = this.active();
        this.active.set(event.key === 'ArrowDown' ? (current + 1 >= rows ? 0 : current + 1) : (current <= 0 ? rows - 1 : current - 1));
        return;
      }
      case 'Enter': {
        const chosen = this.ranked()[this.active()];
        if (this.listed()) event.preventDefault();
        if (chosen) this.pick(chosen);
        else this.commit();
        return;
      }
      case 'Escape':
        if (!this.open()) return;
        event.stopPropagation();
        this.hide();
        return;
      default:
        return;
    }
  }

  /** A pointer down anywhere but on the field or its list closes it. */
  outside(event: Event): void {
    if (!this.open() || this.host.nativeElement.contains(event.target as Node)) return;
    this.hide();
  }

  private reveal(): void {
    afterNextRender(() => {
      if (this.open()) this.field().nativeElement.scrollIntoView({ block: 'center' });
    }, { injector: this.injector });
  }

  private unwatch(): void {
    globalThis.visualViewport?.removeEventListener('resize', this.onViewport);
  }
}
