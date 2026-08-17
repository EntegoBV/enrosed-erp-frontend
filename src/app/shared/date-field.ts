import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, viewChild } from '@angular/core';

/**
 * Datumveld in Belgische vorm: 25/05/2026.
 *
 * Een gewone <input type="date"> toont de datum in de taal van de browser, niet
 * in die van de pagina. Op een toestel dat op Engels staat lees je dan
 * 05/25/2026 — precies de verwarring die je bij een offerte niet wil. Daarom
 * een tekstveld dat altijd dd/mm/jjjj toont, met daarnaast de echte
 * datumkiezer voor wie liever een kalender aanklikt.
 *
 * De waarde blijft naar buiten toe gewoon ISO (jjjj-mm-dd), zoals de backend
 * ze verwacht.
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
      <!-- De echte kiezer: onzichtbaar, enkel om de kalender op te roepen. -->
      <input #picker class="datefield__native" type="date" [value]="value() ?? ''"
             (change)="onPick($any($event.target).value)" tabindex="-1" aria-hidden="true" />
      <button class="datefield__btn" type="button" (click)="openPicker()" aria-label="Kalender openen">
        ▤
      </button>
    </div>
  `,
  styles: `
    .datefield { position: relative; display: flex; align-items: center; }
    .datefield__text { padding-right: 42px; font-variant-numeric: tabular-nums; }
    /* De kalenderknop staat over het veld; het veld zelf blijft volle breedte. */
    .datefield__btn {
      position: absolute;
      right: 4px;
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: var(--r-sm);
      background: transparent;
      color: var(--muted);
      font-size: 15px;
      cursor: pointer;
    }
    .datefield__btn:active { background: var(--surface-2); }
    /* Niet display:none - showPicker() werkt niet op een verborgen veld. */
    .datefield__native {
      position: absolute;
      right: 10px;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
      border: 0;
      padding: 0;
    }
  `,
})
export class DateField {
  /** ISO-datum jjjj-mm-dd, of leeg. */
  readonly value = model<string>('');
  readonly fieldId = input<string>('');

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');

  /** Wat er in het tekstveld staat terwijl er getypt wordt. */
  private typed: string | null = null;

  readonly display = computed(() => toBelgian(this.value()));

  onType(raw: string): void {
    this.typed = raw;
  }

  /** Bij verlaten of enter: lezen wat er staat, en pas dan de waarde zetten. */
  onCommit(field: HTMLInputElement): void {
    const raw = this.typed ?? field.value;
    this.typed = null;

    const iso = toIso(raw);
    if (iso === null) {
      /* Onleesbaar? Zet terug wat het was, dan gaat er geen datum verloren. */
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
    const input = this.picker().nativeElement;
    /* showPicker() bestaat niet overal; dan valt het terug op focussen. */
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  }
}

/** jjjj-mm-dd naar dd/mm/jjjj. */
function toBelgian(iso: string | null | undefined): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/**
 * Wat de gebruiker intikt naar ISO, of null als het niets voorstelt.
 *
 * Ruim opgevat: 25/05/2026, 1-3-2027, 25.5.26 en 25052026 komen allemaal aan.
 * Leeg mag ook - een datum is niet altijd verplicht.
 */
function toIso(raw: string): string | null {
  const text = raw.trim();
  if (!text) return '';

  let day: number;
  let month: number;
  let year: number;

  const parts = text.split(/[^\d]+/).filter(Boolean);
  if (parts.length === 3) {
    /* Met scheidingstekens mogen dag en maand ook uit één cijfer bestaan. */
    [day, month, year] = parts.map(Number);
  } else {
    const digits = text.replace(/\D/g, '');
    if (digits.length !== 8) return null;
    day = +digits.slice(0, 2);
    month = +digits.slice(2, 4);
    year = +digits.slice(4, 8);
  }

  /* Twee cijfers voor het jaar lezen we als deze eeuw; offertes gaan niet over 1926. */
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  /* Laatste controle op bestaan: 31/02 mag er niet door. */
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
