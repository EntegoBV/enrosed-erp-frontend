import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, viewChild } from '@angular/core';

/**
 * Leverweek kiezen met een kalender.
 *
 * <input type="week"> lijkt de voor de hand liggende keuze, maar Safari en
 * Firefox kennen die niet en tonen dan een kaal tekstvak zonder kalender. Op
 * een telefoon is dat net het geval. Daarom kiest men hier een dag in een
 * gewone datumkiezer en rekenen wij de ISO-week uit; eronder staat welke week
 * dat is en van wanneer tot wanneer ze loopt.
 *
 * De waarde blijft naar buiten toe de ISO-weeknotatie (2026-W42), zoals de
 * backend en de offerte ze gebruiken.
 */
@Component({
  selector: 'app-week-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="weekfield">
      <div class="weekfield__pickwrap">
        <span class="weekfield__pick" [id]="fieldId()">
          @if (label(); as text) {
            <span class="weekfield__label">{{ text }}</span>
          } @else {
            <span class="weekfield__label weekfield__label--empty">Kies een week…</span>
          }
          <span class="weekfield__icon">▤</span>
        </span>
        <!-- De echte kiezer ligt onzichtbaar over de hele knop: op iOS opent
             alleen een rechtstreekse tik op het veld zelf de kalender. -->
        <input #picker class="weekfield__native" type="date" [value]="anchor()"
               (click)="openPicker()" (change)="onPick($any($event.target).value)"
               aria-label="Leverweek kiezen" />
      </div>
      @if (value()) {
        <button class="weekfield__clear" type="button" (click)="clear()">Wissen</button>
      }
    </div>
    @if (range(); as span) {
      <span class="hint">{{ span }}</span>
    }
  `,
  styles: `
    .weekfield { display: flex; align-items: center; gap: 8px; }
    .weekfield__pickwrap { position: relative; flex: 1; display: flex; }
    .weekfield__pick {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 40px;
      padding: 8px 12px;
      border: 1px solid var(--line-strong);
      border-radius: var(--r-sm);
      background: var(--surface);
      font: inherit;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
    }
    .weekfield__pick:active { background: var(--surface-2); }
    .weekfield__label--empty { color: var(--muted); }
    .weekfield__icon { color: var(--muted); }
    .weekfield__clear {
      border: 0;
      background: transparent;
      color: var(--muted);
      font-size: 12.5px;
      text-decoration: underline;
      cursor: pointer;
      padding: 4px;
    }
    .weekfield__native {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
      border: 0;
      padding: 0;
      /* 16px voorkomt dat iOS inzoomt zodra het veld focus krijgt. */
      font-size: 16px;
    }
    .weekfield__native:active ~ .weekfield__pick { background: var(--surface-2); }
  `,
})
export class WeekField {
  /** ISO-week, bijvoorbeeld 2026-W42. Leeg mag: de leverweek is niet verplicht. */
  readonly value = model<string>('');
  readonly fieldId = input<string>('');

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');

  /** De maandag van de gekozen week; die staat open als de kalender verschijnt. */
  readonly anchor = computed(() => {
    const monday = mondayOf(this.value());
    return monday ? toIso(monday) : '';
  });

  readonly label = computed(() => {
    const parsed = parseWeek(this.value());
    return parsed ? `Week ${parsed.week} · ${parsed.year}` : '';
  });

  readonly range = computed(() => {
    const monday = mondayOf(this.value());
    if (!monday) return '';
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    return `van ${toBelgian(monday)} tot ${toBelgian(sunday)}`;
  });

  onPick(iso: string): void {
    if (!iso) {
      this.value.set('');
      return;
    }
    const [year, month, day] = iso.split('-').map(Number);
    this.value.set(isoWeekOf(new Date(Date.UTC(year, month - 1, day))));
  }

  clear(): void {
    this.value.set('');
  }

  openPicker(): void {
    /* Desktopbrowsers openen de kalender pas met showPicker(); iOS doet het
       zelf zodra de tik het veld raakt en kan hier een fout gooien. */
    try {
      this.picker().nativeElement.showPicker?.();
    } catch {
      /* De tik zelf heeft de kiezer dan al geopend. */
    }
  }
}

function parseWeek(value: string | null | undefined): { year: number; week: number } | null {
  const match = /^(\d{4})-W(\d{1,2})$/.exec((value ?? '').trim());
  if (!match) return null;
  const week = +match[2];
  return week >= 1 && week <= 53 ? { year: +match[1], week } : null;
}

/**
 * De maandag van een ISO-week.
 *
 * ISO-week 1 is de week met de eerste donderdag van het jaar. Vandaar de omweg
 * via 4 januari: die dag zit altijd in week 1.
 */
function mondayOf(value: string | null | undefined): Date | null {
  const parsed = parseWeek(value);
  if (!parsed) return null;

  const fourth = new Date(Date.UTC(parsed.year, 0, 4));
  const shift = (fourth.getUTCDay() + 6) % 7; // maandag = 0
  const monday = new Date(fourth);
  monday.setUTCDate(fourth.getUTCDate() - shift + (parsed.week - 1) * 7);
  return monday;
}

/** De ISO-week waar een dag in valt, als 2026-W42. */
function isoWeekOf(date: Date): string {
  /* Naar de donderdag van die week: het jaar van die donderdag is het weekjaar. */
  const thursday = new Date(date);
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));

  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7),
  );

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toBelgian(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}
