import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { PlannerApi, PlannerStore } from '../../core/api/planner-api';
import { Icon } from '../../shared/icon';
import { Sheet, Ui } from '../../shared/ui';
import { weekdayDayMonth } from '../finance/cash-format';
import { HOME_ADD_ACTIONS, HomeAdd } from './home-add-actions';
import type { HomeAddAction } from './home-add-actions';
import { HomeData } from './home-data';
import { shortDate } from './home-figures';
import { defaultTaskDay, nextWorkday } from './home-priority';

type DayChip = 'today' | 'next' | 'after' | 'none';

/** "Ma 19": the chip's short day (weekday capitalised, day number). */
function chipDay(iso: string): string {
  const [weekday, day] = shortDate(iso).split(' ');
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}`;
}

/**
 * The phone's '+' sheet, "Toevoegen" (spec-home §2 row 8): a quick task
 * with its day (Vandaag · the next workday · the one after · Geen dag, the
 * planner's workday rule: "Morgen" when the next workday is tomorrow), then
 * the eight add actions of home-add-actions.ts - four tiles, camera first,
 * then rows. The sheet itself renders at page-host level; the camera input
 * and the planner's sheets are the page's, so "Bon of factuur" and
 * "Afspraak" go out through `picked` - the page clicks the camera input
 * inside this same tap (Safari only opens it from a user gesture).
 * No styles here: the rules live in styles/home-phone.scss.
 */
@Component({
  selector: 'app-home-add-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Icon],
  template: `
    <app-sheet variant="ios" title="Toevoegen" (closed)="closed.emit()">
      <div body class="home-add">
        <form class="home-add__quick" (submit)="save($event)">
          <app-icon class="home-add__quick-icon" name="check" [size]="20" />
          <input #field class="home-add__field" type="text" placeholder="Snelle taak…" aria-label="Snelle taak" autocomplete="off"
                 enterkeyhint="done" maxlength="200" [value]="title()" (input)="title.set(value($event))" />
          <button class="ios-capsule ios-capsule--accent ios-capsule--sm" type="submit" [disabled]="!title().trim() || saving()">Opslaan</button>
        </form>
        <div class="ios-chips home-add__days" role="group" aria-label="Dag van de taak">
          @for (chip of days(); track chip.id) {
            <button class="ios-chip" type="button" [attr.aria-pressed]="day() === chip.id" [attr.aria-label]="chip.aria" (click)="day.set(chip.id)">{{ chip.label }}</button>
          }
        </div>
        <div class="ios-widgets home-add__tiles">
          @for (action of tiles; track action.id) {
            <button class="ios-widget home-add__tile" type="button" [class.is-main]="action.id === 'photo'" (click)="pick(action)">
              <span class="ios-tile" [class.ios-tile--soft]="action.id !== 'photo'" [class]="'tone-' + action.tone" aria-hidden="true">
                <app-icon [name]="action.icon" [size]="18" /></span>
              <b>{{ action.label }}</b><small>{{ action.hint }}</small>
            </button>
          }
        </div>
        <div class="ios-group ios-group--icons home-add__rows">
          @for (action of rows; track action.id) {
            <button class="ios-cell" type="button" (click)="pick(action)">
              <span class="ios-tile ios-tile--soft ios-cell__lead" [class]="'tone-' + action.tone" aria-hidden="true"><app-icon [name]="action.icon" [size]="17" /></span>
              <span class="ios-cell__body"><span class="ios-cell__title">{{ action.label }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
            </button>
          }
        </div>
      </div>
    </app-sheet>
  `,
})
export class HomeAddSheet {
  private readonly data = inject(HomeData);
  private readonly api = inject(PlannerApi);
  private readonly store = inject(PlannerStore);
  private readonly ui = inject(Ui);
  private readonly add = inject(HomeAdd);

  /** The sheet is done (closed, or an action ran). */
  readonly closed = output<void>();
  /** An action the page runs: the camera input and the planner's new-appointment sheet are the page's. */
  readonly picked = output<'photo' | 'event'>();

  readonly tiles = HOME_ADD_ACTIONS.filter((action) => action.tile);
  readonly rows = HOME_ADD_ACTIONS.filter((action) => !action.tile);

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  readonly title = signal('');
  /** From 18:00 and at the weekend the next workday is preselected ("3 d te laat" on Monday otherwise); the sheet is made on each open. */
  readonly day = signal<DayChip>(defaultTaskDay(this.data.today(), new Date().getHours()));
  readonly saving = signal(false);

  /** Vandaag · the next workday ("Morgen" when that is tomorrow) · the workday after it · Geen dag. */
  readonly days = computed(() => {
    const today = this.data.today();
    const next = nextWorkday(today);
    const after = nextWorkday(next);
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    return [
      { id: 'today' as const, date: today, label: 'Vandaag', aria: 'Vandaag' },
      { id: 'next' as const, date: next, label: next === tomorrow ? 'Morgen' : chipDay(next), aria: weekdayDayMonth(next) },
      { id: 'after' as const, date: after, label: chipDay(after), aria: weekdayDayMonth(after) },
      { id: 'none' as const, date: null, label: 'Geen dag', aria: 'Geen dag' },
    ];
  });

  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  pick(action: HomeAddAction): void {
    if (action.id === 'task') {
      this.field().nativeElement.focus();
      return;
    }
    if (action.id === 'photo' || action.id === 'event') this.picked.emit(action.id);
    else this.add.go(action.id);
    this.closed.emit();
  }

  /** Opslaan: the task on the chosen day; on failure the text stays for another try. */
  async save(event: Event): Promise<void> {
    event.preventDefault();
    const title = this.title().trim();
    if (!title || this.saving()) return;
    const chip = this.days().find((row) => row.id === this.day()) ?? this.days()[0];
    this.saving.set(true);
    try {
      await this.api.create({ id: null, kind: 'TASK', title, onDate: chip.date, atTime: null, note: null, done: false });
      await this.store.reload(true);
      this.title.set('');
      this.ui.toast(chip.date ? `Taak bewaard voor ${chip.id === 'today' ? 'vandaag' : weekdayDayMonth(chip.date)}` : 'Taak bewaard zonder dag');
      this.closed.emit();
    } catch {
      this.ui.toast('Taak bewaren mislukt', 'err');
    } finally {
      this.saving.set(false);
    }
  }
}
