import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, viewChild } from '@angular/core';

/**
 * Date field in Belgian form: 25/05/2026.
 *
 * A plain <input type="date"> shows the date in the browser's language, not
 * the page's. On a device set to English that reads 05/25/2026 — exactly
 * the confusion a quote cannot afford. Hence a text field that always shows
 * dd/mm/yyyy, with the real date picker next to it for whoever prefers
 * tapping a calendar.
 *
 * The outward value stays plain ISO (yyyy-mm-dd), as the backend expects.
 */
@Component({
  selector: 'app-date-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="datefield">
      <input
        class="input datefield__text"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        placeholder="dd/mm/jjjj"
        maxlength="10"
        [id]="fieldId()"
        [value]="display()"
        (input)="onType($any($event.target).value)"
        (blur)="onCommit($any($event.target))"
        (keydown.enter)="onCommit($any($event.target))"
      />
      <span class="datefield__btn" aria-hidden="true">▤</span>
      <!-- The real picker lies invisibly OVER the button: on iOS only a
           direct tap on the field itself opens the calendar. -->
      <input #picker class="datefield__native" type="date" [value]="value() ?? ''"
             (click)="openPicker()" (change)="onPick($any($event.target).value)"
             aria-label="Kalender openen" />
    </div>
  `,
  styles: `
    .datefield { position: relative; display: flex; align-items: center; }
    .datefield__text { padding-right: 42px; font-variant-numeric: tabular-nums; }
    /* The calendar button overlays the field; the field stays full width. */
    .datefield__btn {
      position: absolute;
      right: 4px;
      width: 34px;
      height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--r-sm);
      color: var(--muted);
      font-size: 15px;
    }
    .datefield__native {
      position: absolute;
      right: 4px;
      width: 34px;
      height: 34px;
      opacity: 0;
      cursor: pointer;
      border: 0;
      padding: 0;
      /* 16px stops iOS from zooming in the moment the field gains focus. */
      font-size: 16px;
    }
    .datefield__native:active + .datefield__btn { background: var(--surface-2); }
  `,
})
export class DateField {
  /** ISO-datum jjjj-mm-dd, of leeg. */
  readonly value = model<string>('');
  readonly fieldId = input<string>('');

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');

  /** What the text field holds while typing is going on. */
  private typed: string | null = null;

  readonly display = computed(() => toBelgian(this.value()));

  onType(raw: string): void {
    this.typed = raw;
  }

  /** On blur or enter: read what is there, and only then set the value. */
  onCommit(field: HTMLInputElement): void {
    const raw = this.typed ?? field.value;
    this.typed = null;

    const iso = toIso(raw);
    if (iso === null) {
      /* Unreadable? Put back what it was, so no date gets lost. */
      field.value = this.display();
      return;
    }
    this.value.set(iso);
    field.value = toBelgian(iso);
  }

  onPick(iso: string): void {
    this.typed = null;
    this.value.set(iso);
  }

  openPicker(): void {
    /* Desktop browsers only open the calendar via showPicker(); iOS does it
       itself the moment the tap hits the field, and may throw here. */
    try {
      this.picker().nativeElement.showPicker?.();
    } catch {
      /* The tap itself has opened the picker by then. */
    }
  }
}

/** yyyy-mm-dd to dd/mm/yyyy. */
function toBelgian(iso: string | null | undefined): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/**
 * What the user types, to ISO - or null when it amounts to nothing.
 *
 * Interpreted generously: 25/05/2026, 1-3-2027, 25.5.26 and 25052026 all
 * arrive. Empty is fine too - a date is not always required.
 */
function toIso(raw: string): string | null {
  const text = raw.trim();
  if (!text) return '';

  let day: number;
  let month: number;
  let year: number;

  const parts = text.split(/[^\d]+/).filter(Boolean);
  if (parts.length === 3) {
    /* With separators, day and month may be single digits too. */
    [day, month, year] = parts.map(Number);
  } else {
    const digits = text.replace(/\D/g, '');
    if (digits.length !== 8) return null;
    day = +digits.slice(0, 2);
    month = +digits.slice(2, 4);
    year = +digits.slice(4, 8);
  }

  /* Two-digit years read as this century; quotes are not about 1926. */
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  /* Final existence check: 31/02 must not get through. */
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
