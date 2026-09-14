import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Icon } from '../../shared/icon';
import type { TodayAgendaEntry } from './dashboard-today-state';

@Component({
  selector: 'app-dashboard-today',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <section class="today-agenda" aria-labelledby="home-today-title" [attr.aria-busy]="loading()">
      <header class="today-agenda__head">
        <div>
          <app-icon name="activity" [size]="15" />
          <h3 id="home-today-title">Vandaag in de agenda</h3>
          @if (!loading() && !error() && entries().length) {
            <span class="today-agenda__count" [attr.aria-label]="entries().length + ' items vandaag'">{{ entries().length }}</span>
          }
        </div>
        <button class="today-agenda__agenda" type="button" (click)="openAgenda.emit()">Agenda <span aria-hidden="true">›</span></button>
      </header>

      @if (loading()) {
        <p class="today-agenda__state" role="status">Agenda ophalen…</p>
      } @else {
        @if (error(); as failure) {
          <div class="today-agenda__state today-agenda__state--error" role="status">
            <div><b>{{ entries().length ? 'Agenda niet volledig bijgewerkt' : 'Agenda niet beschikbaar' }}</b><p>{{ failure }}</p></div>
            <button type="button" (click)="retry.emit()">Opnieuw</button>
          </div>
        }

        @if (entries().length) {
          <ul class="today-agenda__list" id="home-today-list">
            @for (entry of visibleEntries(); track entry.id) {
              <li>
                <button class="today-agenda__row" type="button"
                        [class.today-agenda__row--arrival]="entry.kind === 'EXPECTED_ARRIVAL'"
                        [attr.data-today-entry]="entry.id" (click)="openEntry.emit(entry)">
                  <span class="today-agenda__when">
                    @if (entry.atTime) {
                      <b>{{ entry.atTime.slice(0, 5) }}</b>
                    } @else {
                      @if (entry.milestone) { <app-icon name="purchase" [size]="15" /> }
                      <small>Hele dag</small>
                    }
                  </span>
                  <span class="today-agenda__copy">
                    <b>{{ entry.title }}</b>
                    @if (entry.kind === 'TASK' || entry.sub) {
                      <small>
                        @if (entry.kind === 'TASK') { <span class="today-agenda__task">{{ entry.item?.done ? 'Afgerond' : 'Open taak' }}</span> }
                        @if (entry.kind === 'TASK' && entry.sub) { <span aria-hidden="true"> · </span> }
                        {{ entry.sub }}
                      </small>
                    }
                  </span>
                  <span class="today-agenda__action">{{ entry.actionLabel }} <span aria-hidden="true">›</span></span>
                </button>
              </li>
            }
          </ul>
          @if (entries().length > 3) {
            <button class="today-agenda__more" type="button" [attr.aria-expanded]="expanded()"
                    aria-controls="home-today-list" (click)="expanded.set(!expanded())">
              {{ expanded() ? 'Minder tonen' : 'Nog ' + (entries().length - 3) + ' vandaag' }}
              <span aria-hidden="true">{{ expanded() ? '−' : '+' }}</span>
            </button>
          }
        } @else if (!error()) {
          <p class="today-agenda__state">Geen afspraken, taken of containermomenten voor vandaag.</p>
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .today-agenda { min-width: 0; border-bottom: 1px solid var(--line); padding: 0 16px 7px; }
    .today-agenda__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 48px; }
    .today-agenda__head > div { display: flex; align-items: center; min-width: 0; gap: 7px; }
    .today-agenda__head app-icon { flex: none; color: var(--muted); }
    .today-agenda__head h3 { margin: 0; color: var(--ink-2); font-size: 12px; font-weight: 750; line-height: 1.35; }
    .today-agenda__count { display: grid; min-width: 19px; height: 19px; flex: none; place-items: center; padding-inline: 4px; border-radius: 6px; background: var(--surface-2); color: var(--muted); font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .today-agenda :where(button) { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .today-agenda__agenda { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; flex: none; padding: 6px 0 6px 8px; border: 0; background: transparent; color: var(--rose-dark); font-size: 11px; font-weight: 700; }
    .today-agenda__agenda > span { font-size: 17px; font-weight: 400; }
    .today-agenda__list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
    .today-agenda__list > li { min-width: 0; }
    .today-agenda__row { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 9px; width: 100%; min-height: 56px; padding: 7px 5px; border: 0; border-radius: 9px; background: transparent; color: var(--ink); text-align: left; }
    .today-agenda__when { display: grid; min-height: 36px; align-content: center; justify-items: center; gap: 2px; align-self: center; color: var(--muted); font-variant-numeric: tabular-nums; }
    .today-agenda__when b { color: var(--ink-2); font-size: 11px; font-weight: 700; }
    .today-agenda__when small { font-size: 9px; line-height: 1.3; white-space: nowrap; }
    .today-agenda__copy { display: grid; min-width: 0; gap: 2px; }
    .today-agenda__copy > b { font-size: 12px; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
    .today-agenda__copy > small { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--muted); font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; }
    .today-agenda__task { font-weight: 650; }
    .today-agenda__action { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; max-width: 145px; color: var(--rose-dark); font-size: 10.5px; font-weight: 650; line-height: 1.4; }
    .today-agenda__action > span { flex: none; font-size: 17px; font-weight: 400; }
    .today-agenda__row--arrival .today-agenda__when { border-radius: 8px; color: #b46c30; background: color-mix(in srgb, #b46c30 10%, var(--surface)); }
    .today-agenda__row--arrival .today-agenda__when :is(b, small) { color: #a05b23; }
    .today-agenda__row--arrival .today-agenda__action { color: #a05b23; }
    .today-agenda__more { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 44px; padding: 8px 5px 5px 62px; border: 0; background: transparent; color: var(--muted); font-size: 10.5px; }
    .today-agenda__more > span { padding-right: 2px; font-size: 15px; }
    .today-agenda__state { margin: 0; padding: 0 0 9px; color: var(--muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
    .today-agenda__state--error { display: flex; align-items: center; justify-content: space-between; gap: 9px; }
    .today-agenda__state--error b { color: var(--ink-2); font-size: 11px; font-weight: 650; }
    .today-agenda__state--error p { margin: 3px 0 0; }
    .today-agenda__state--error button { min-height: 44px; flex: none; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink-2); font-size: 10.5px; }
    .today-agenda button:focus-visible { outline: 2px solid var(--rose); outline-offset: -2px; }
    @media (hover: hover) {
      .today-agenda__row:hover { background: var(--surface-2); }
      .today-agenda__agenda:hover, .today-agenda__more:hover { color: var(--rose-dark); text-decoration: underline; }
    }
    @media (max-width: 540px) {
      .today-agenda { padding-inline: 12px; }
      .today-agenda__head > div { gap: 5px; }
      .today-agenda__head h3 { font-size: 11.5px; }
      .today-agenda__row { grid-template-columns: 43px minmax(0, 1fr); gap: 2px 8px; padding-block: 8px; }
      .today-agenda__when { grid-row: span 2; }
      .today-agenda__action { grid-column: 2; justify-content: flex-start; max-width: none; padding-top: 2px; }
      .today-agenda__more { padding-left: 56px; }
    }
  `,
})
export class DashboardToday {
  readonly entries = input<TodayAgendaEntry[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly openEntry = output<TodayAgendaEntry>();
  readonly openAgenda = output<void>();
  readonly retry = output<void>();
  readonly expanded = signal(false);
  readonly visibleEntries = computed(() => this.expanded() ? this.entries() : this.entries().slice(0, 3));
}
