import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivityCategory, ActivityChange, ActivityEvent } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import {
  activityActionLabel, activityCategory, activityCategoryColor, activityCategoryLabel, activityEntityLabel, activityQueryParams, activityRecordPhrase, activityRoute,
} from './activity-copy';
import {
  ActivityContext, ActivityOverview, ActivityRow, activityEntitySub, activityEntityText, activityRows, activitySummaryText, activityValue,
  changePreview, changesOf, isPrivateChange, longDateTime, relatedRows, rowTime,
} from './activity-format';

/**
 * The detail of one Logboek row (an event or a burst): what changed, field
 * by field, on which record, with the other loaded events of that record.
 * With no row it shows the overview of the loaded events (docked only).
 * Presentational: the page owns selection, filters and the lookups.
 */
@Component({
  selector: 'app-activity-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <!-- Keyed by the row: a new selection builds the detail afresh, so it fades in every time (§3.9). -->
    @for (r of shown(); track r.key) {
      <div class="ai mo-fade" [style.--cat]="color()">
        <header class="ai-head">
          <div class="ai-head__text">
            <div class="ai-kicker">{{ categoryLabel() }} · {{ actionLabel() }}</div>
            <h2>{{ summary() }}@if (r.events.length > 1) { <span class="ai-muted"> · {{ r.events.length }}×</span> }</h2>
            <p>{{ actor() }} · {{ r.events.length > 1 ? when() : longDate() }}</p>
          </div>
          @if (layout() === 'drawer') {
            <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Sluiten" (click)="closed.emit()"><app-icon name="close" [size]="16" /></button>
          }
        </header>
        @if (entityName()) {
          <div class="ai-rec">
            <div><small>{{ kind() }}</small><b>{{ entityName() }}</b>@if (entitySub()) { <span>{{ entitySub() }}</span> }</div>
            @if (route(); as target) { <a class="wk-btn wk-btn--sm" [routerLink]="target" [queryParams]="query()">Openen ›</a> }
          </div>
        }
        @for (event of r.events; track event.id) {
          @if (r.events.length > 1) { <h3 class="ai-time">{{ timeOf(event.at) }}</h3> }
          @if (changes(event).length) {
            <section class="ai-ch" [attr.aria-label]="'Wat is gewijzigd om ' + timeOf(event.at)">
              @if (r.events.length === 1) { <h3>Wat is gewijzigd <span>{{ changes(event).length }} {{ changes(event).length === 1 ? 'veld' : 'velden' }}</span></h3> }
              <dl>
                @for (change of changes(event); track $index) {
                  <div>
                    <dt [attr.title]="change.label">{{ change.label }}</dt>
                    <dd>
                      @if (isPrivate(change)) {
                        <i>Inhoud aangepast</i>
                      } @else {
                        <s>{{ value(change, change.beforeValue, event) }}</s><span class="ai-arrow" aria-label="naar">→</span><b>{{ value(change, change.afterValue, event) }}</b>
                      }
                    </dd>
                  </div>
                }
              </dl>
            </section>
          } @else if (r.events.length === 1) {
            <p class="ai-none">Geen veldwijzigingen vastgelegd.</p>
          }
        }
        @if (related().length) {
          <section class="ai-more ai-more--rows">
            <h3>Meer aan dit record <span>{{ related().length }} geladen</span></h3>
            @for (other of related(); track other.key) {
              <button class="ai-mini" type="button" (click)="selectEvent.emit(other.key)">
                <time>{{ rowTimeOf(other) }}</time><span [attr.title]="miniText(other)">{{ miniText(other) }}</span><small>{{ other.events[0].actor?.displayName || 'Systeem' }}</small>
              </button>
            }
          </section>
        }
        @if (r.events[0].entityId) {
          <footer class="ai-foot">
            <button class="wk-link" type="button" (click)="filterEntity.emit(r.events[0])">Alle wijzigingen aan {{ recordPhrase() }} ›</button>
          </footer>
        }
      </div>
    } @empty {
      @if (overview(); as o) {
        <div class="ai ai--overview mo-fade">
          <header class="ai-head"><div class="ai-head__text"><div class="ai-kicker ai-kicker--plain">Overzicht</div>
            <h2>{{ o.total }} activiteiten@if (o.span) { · {{ o.span }} }</h2><p>Kies een regel voor de details.</p></div></header>
          <section class="ai-ch"><h3>Per persoon</h3>
            @for (person of o.people; track person.name) {
              <div class="ai-bar"><span>{{ person.name }}</span><b>{{ person.count }}</b><div class="wk-meter tone-accent"><i [style.width.%]="share(person.count, o.total)"></i></div></div>
            }
          </section>
          <section class="ai-ch"><h3>Per onderdeel</h3>
            @for (part of o.categories; track part.category) {
              <div class="ai-bar" [style.--cat]="colorOf(part.category)"><span><i class="ai-dot"></i>{{ labelOf(part.category) }}</span><b>{{ part.count }}</b>
                <div class="wk-meter"><i class="ai-meter-cat" [style.width.%]="share(part.count, o.total)"></i></div></div>
            }
          </section>
          @if (o.records.length) {
            <section class="ai-more"><h3>Meest gewijzigd</h3>
              @for (record of o.records; track record.entityType + record.entityId) {
                <button class="ai-mini ai-mini--record" type="button" (click)="filterEntity.emit(record.sample)">
                  <span>{{ recordName(record.sample) }}@if (recordSub(record.sample); as sub) { <small> · {{ sub }}</small> }</span><b>{{ record.count }}</b>
                </button>
              }
            </section>
          }
        </div>
      }
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .ai { --cat: var(--muted); display: grid; align-content: start; }
    .ai-head { display: flex; align-items: flex-start; gap: 10px; padding: 16px 18px 12px; border-bottom: 1px solid var(--line); }
    .ai-head__text { flex: 1; min-width: 0; }
    .ai-kicker { color: var(--cat); font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .ai-kicker--plain { color: var(--muted); }
    .ai-head h2 { margin: 4px 0; font-size: 17px; font-weight: 650; letter-spacing: -.01em; line-height: 1.3; overflow-wrap: anywhere; }
    .ai-head p { margin: 0; color: var(--muted); font-size: 12.5px; }
    .ai-muted { color: var(--muted); }
    .ai-rec { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; margin: 14px 18px 4px; padding: 10px 12px;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); }
    .ai-rec small { display: block; color: var(--muted); font-size: 11px; font-weight: 650; }
    .ai-rec b { display: block; font-size: 14px; overflow-wrap: anywhere; }
    .ai-rec span { display: block; color: var(--muted); font: 500 12px var(--mono, ui-monospace, monospace); }
    .ai-time { margin: 12px 18px 0; color: var(--ink-2); font: 600 12px var(--mono, ui-monospace, monospace); }
    .ai-ch { padding: 10px 18px 4px; }
    .ai-ch h3, .ai-more h3 { display: flex; justify-content: space-between; margin: 0 0 4px; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .ai-ch h3 span, .ai-more h3 span { font-weight: 650; letter-spacing: 0; text-transform: none; }
    .ai-ch dl { margin: 0; }
    .ai-ch dl > div { padding: 8px 0; border-top: 1px solid var(--line); }
    .ai-ch dt { color: var(--ink-2); font-size: 12px; font-weight: 650; overflow-wrap: anywhere; }
    .ai-ch dd { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin: 2px 0 0; font-size: 13.5px; overflow-wrap: anywhere; }
    .ai-ch dd s { color: var(--muted); text-decoration-color: color-mix(in srgb, var(--muted) 60%, transparent); }
    .ai-ch dd i { color: var(--muted); }
    .ai-ch dd b { font-weight: 650; }
    .ai-arrow { color: var(--muted-2); }
    .ai-none { margin: 12px 18px; color: var(--muted); font-size: 13px; }
    .ai-more { padding: 12px 18px 6px; }
    .ai-mini { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: baseline; gap: 8px; width: 100%; padding: 7px 0;
      border: 0; border-top: 1px dashed var(--line); background: none; color: var(--ink-2); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
    .ai-mini:hover span { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
    .ai-mini time { color: var(--muted); font: 500 12px var(--mono, ui-monospace, monospace); }
    .ai-mini span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ai-mini small { color: var(--muted); font-size: 12px; }
    .ai-mini--record { grid-template-columns: minmax(0, 1fr) auto; }
    /* Related rows share one time column, as wide as the widest time ("10:42–10:47" for a burst). */
    .ai-more--rows { display: grid; grid-template-columns: max-content minmax(0, 1fr) max-content; column-gap: 8px; }
    .ai-more--rows > h3 { grid-column: 1 / -1; }
    .ai-more--rows > .ai-mini { grid-column: 1 / -1; grid-template-columns: subgrid; }
    .ai-mini time { white-space: nowrap; }
    .ai-foot { padding: 10px 18px 14px; border-top: 1px solid var(--line); }
    .ai-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 6px 0; font-size: 13px; }
    .ai-bar > .wk-meter { grid-column: 1 / -1; }
    .ai-bar b { font-variant-numeric: tabular-nums; }
    .ai-dot { display: inline-block; width: 8px; height: 8px; margin-right: 7px; border-radius: 50%; background: var(--cat); }
    .ai-meter-cat { background: var(--cat) !important; }
  `,
})
export class ActivityInspector {
  readonly row = input<ActivityRow | null>(null);
  /** Every loaded event, for "Meer aan dit record". */
  readonly events = input<readonly ActivityEvent[]>([]);
  readonly ctx = input<ActivityContext>({});
  readonly layout = input<'dock' | 'drawer' | 'sheet'>('drawer');
  /** Shown when no row is selected (docked only). */
  readonly overview = input<ActivityOverview | null>(null);
  readonly selectEvent = output<number>();
  readonly filterEntity = output<ActivityEvent>();
  readonly closed = output<void>();

  private readonly first = computed(() => this.row()?.events[0] ?? null);
  readonly category = computed<ActivityCategory>(() => { const e = this.first(); return e ? activityCategory(e) : 'OTHER'; });
  readonly color = computed(() => activityCategoryColor(this.category()));
  readonly categoryLabel = computed(() => activityCategoryLabel(this.category()));
  readonly actionLabel = computed(() => { const e = this.first(); return e ? activityActionLabel(e.action) : ''; });
  readonly summary = computed(() => { const e = this.first(); return e ? activitySummaryText(e.summary) : ''; });
  readonly actor = computed(() => this.first()?.actor?.displayName || 'Systeem');
  readonly longDate = computed(() => { const e = this.first(); return e ? longDateTime(e.at) : ''; });
  readonly when = computed(() => { const r = this.row(); return r ? rowTime(r) : ''; });
  readonly kind = computed(() => { const e = this.first(); return e ? activityEntityLabel(e) : ''; });
  /** "deze inkooporder", "dit product": the foot link's words. */
  readonly recordPhrase = computed(() => { const e = this.first(); return e ? activityRecordPhrase(e) : ''; });
  readonly entityName = computed(() => { const e = this.first(); return e ? activityEntityText(e, this.ctx()) : ''; });
  readonly entitySub = computed(() => { const e = this.first(); return e ? activityEntitySub(e, this.ctx()) : null; });
  readonly route = computed(() => { const e = this.first(); return e ? activityRoute(e) : null; });
  readonly query = computed(() => { const e = this.first(); return e ? activityQueryParams(e) : null; });
  /** The selected row as a one-item list, keyed in the template so each selection fades in. */
  readonly shown = computed(() => { const row = this.row(); return row ? [row] : []; });
  /** The loaded events as the list shows them (a burst is one row). */
  private readonly rows = computed(() => activityRows(this.events()));
  /** The other loaded rows of this record (up to five); a burst is one line. */
  readonly related = computed(() => relatedRows(this.rows(), this.row()));

  changes(event: ActivityEvent): ActivityChange[] { return changesOf(event); }
  isPrivate(change: ActivityChange): boolean { return isPrivateChange(change); }
  value(change: ActivityChange, value: string | null, event: ActivityEvent): string { return activityValue(change, value, event, this.ctx()); }
  preview(event: ActivityEvent): string { return changePreview(event, this.ctx()); }
  summaryOf(event: ActivityEvent): string { return activitySummaryText(event.summary); }
  rowTimeOf(row: ActivityRow): string { return rowTime(row); }
  /** A burst: "Inkooporder bijgewerkt · 5×"; one event: its change preview, else its summary. */
  miniText(row: ActivityRow): string {
    const event = row.events[0];
    return row.events.length > 1 ? `${this.summaryOf(event)} · ${row.events.length}×` : this.preview(event) || this.summaryOf(event);
  }
  recordName(event: ActivityEvent): string { return activityEntityText(event, this.ctx()) || activityEntityLabel(event); }
  recordSub(event: ActivityEvent): string | null { return activityEntitySub(event, this.ctx()); }
  colorOf(category: ActivityCategory): string { return activityCategoryColor(category); }
  labelOf(category: ActivityCategory): string { return activityCategoryLabel(category); }
  share(count: number, total: number): number { return total ? Math.round((count / total) * 100) : 0; }
  timeOf(at: string): string {
    const date = new Date(at);
    return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}
