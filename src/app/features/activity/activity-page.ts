import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ActivityApi } from '../../core/api/activity-api';
import { ActivityCategory, ActivityChange, ActivityEvent } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import {
  activityActionLabel,
  activityCategory,
  activityCategoryIcon,
  activityCategoryLabel,
  activityEntityLabel,
  activityRoute,
} from './activity-copy';

type CategoryFilter = 'ALL' | ActivityCategory;

interface ActivityDayGroup {
  key: string;
  label: string;
  events: ActivityEvent[];
}

@Component({
  selector: 'app-activity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, RouterLink, Icon, PageHeader],
  template: `
    <app-page-header title="Logboek" subtitle="Alle wijzigingen, duidelijk per onderdeel" />

    <main class="content activity-page" [attr.aria-busy]="loading() || loadingMore()">
      <section class="card activity-controls" aria-labelledby="activity-filter-title">
        <div class="activity-controls__head">
          <div>
            <span class="eyebrow">Overzicht</span>
            <h2 id="activity-filter-title">Wat wil je bekijken?</h2>
          </div>
          <div class="activity-actor" [class.activity-actor--on]="actor() !== 'ALL'">
            <span>Medewerker</span>
            <b>{{ actorLabel() }}</b>
            <select aria-label="Filter logboek op medewerker" [ngModel]="actor()"
                    (ngModelChange)="changeActor($event)">
              <option value="ALL">Iedereen</option>
              <option value="emre">Emre</option>
              <option value="berat">Berat</option>
            </select>
          </div>
        </div>

        <div class="category-grid" role="group" aria-label="Filter op categorie">
          @for (option of categoryOptions; track option.value) {
            <button type="button" class="category-filter"
                    [class.category-filter--active]="category() === option.value"
                    [attr.aria-pressed]="category() === option.value"
                    (click)="changeCategory(option.value)">
              <span class="category-filter__icon" aria-hidden="true">
                <app-icon [name]="option.icon" [size]="17" />
              </span>
              <span>{{ option.label }}</span>
            </button>
          }
        </div>
      </section>

      @if (loading()) {
        <div class="activity-loading" role="status" aria-live="polite">
          <span class="activity-loading__pulse" aria-hidden="true"></span>
          Logboek laden…
        </div>
      } @else if (error()) {
        <div class="card activity-error" role="alert">
          <div><b>Logboek niet beschikbaar</b><p>{{ error() }}</p></div>
          <button class="btn btn--sm" type="button" (click)="reload()">Opnieuw</button>
        </div>
      } @else {
        <div class="activity-result-head">
          <p><b>{{ items().length }}</b> {{ items().length === 1 ? 'activiteit' : 'activiteiten' }} geladen</p>
          <span>Nieuwste eerst</span>
        </div>

        <section class="activity-feed" aria-label="Activiteiten">
          @for (group of dayGroups(); track group.key) {
            <section class="activity-day" [attr.aria-labelledby]="'activity-day-' + group.key">
              <header class="activity-day__head">
                <h2 [id]="'activity-day-' + group.key">{{ group.label }}</h2>
                <span>{{ group.events.length }}</span>
              </header>

              <div class="activity-day__events">
                @for (event of group.events; track event.id) {
                  <article class="card activity-event" [attr.data-category]="categoryOf(event)">
                    <div class="activity-event__rail" aria-hidden="true">
                      <span class="activity-event__icon">
                        <app-icon [name]="categoryIcon(event)" [size]="18" />
                      </span>
                    </div>

                    <div class="activity-event__body">
                      <div class="activity-event__meta">
                        <span>{{ categoryName(event) }}</span>
                        <i aria-hidden="true"></i>
                        <span>{{ actionName(event.action) }}</span>
                        <time [attr.datetime]="event.at">{{ event.at | date:'HH:mm' }}</time>
                      </div>

                      <h3>{{ event.summary }}</h3>

                      @if (event.entityLabel) {
                        @if (routeOf(event); as target) {
                          <a class="activity-event__entity" [routerLink]="target">
                            <span>{{ entityKind(event) }}</span>
                            <b>{{ event.entityLabel }}</b>
                            <span class="activity-event__link-mark" aria-hidden="true"></span>
                          </a>
                        } @else {
                          <div class="activity-event__entity activity-event__entity--static">
                            <span>{{ entityKind(event) }}</span>
                            <b>{{ event.entityLabel }}</b>
                          </div>
                        }
                      }

                      @if (changesOf(event).length) {
                        <div class="activity-changes" [attr.aria-label]="changesOf(event).length + ' wijzigingen'">
                          <div class="activity-changes__title">
                            <b>Wat is gewijzigd</b>
                            <span>{{ changesOf(event).length }} {{ changesOf(event).length === 1 ? 'veld' : 'velden' }}</span>
                          </div>
                          <dl>
                            @for (change of visibleChanges(event); track change.field) {
                              <div class="activity-change">
                                <dt>{{ change.label }}</dt>
                                @if (change.beforeValue === null && change.afterValue === null) {
                                  <dd class="activity-change__private">Inhoud aangepast</dd>
                                } @else {
                                  <dd>
                                    <span><small>Van</small>{{ changeValue(change.beforeValue) }}</span>
                                    <span><small>Naar</small>{{ changeValue(change.afterValue) }}</span>
                                  </dd>
                                }
                              </div>
                            }
                          </dl>
                          @if (changesOf(event).length > detailLimit) {
                            <button type="button" class="activity-changes__more" (click)="toggleDetails(event.id)">
                              {{ detailsExpanded(event.id)
                                ? 'Minder tonen'
                                : (changesOf(event).length - detailLimit) + ' meer wijzigingen tonen' }}
                            </button>
                          }
                        </div>
                      }

                      <footer>
                        <span class="activity-event__avatar" aria-hidden="true">{{ actorInitial(event) }}</span>
                        <span>{{ actorName(event) }}</span>
                      </footer>
                    </div>
                  </article>
                }
              </div>
            </section>
          } @empty {
            <div class="empty activity-empty">
              <div class="empty__icon" aria-hidden="true">✓</div>
              <div class="empty__title">Geen activiteiten gevonden</div>
              <p>Pas de categorie of medewerker aan om andere gebeurtenissen te bekijken.</p>
            </div>
          }
        </section>

        @if (nextBefore() !== null) {
          <button class="btn activity-more" type="button" [disabled]="loadingMore()" (click)="loadMore()">
            {{ loadingMore() ? 'Laden…' : 'Meer laden' }}
          </button>
        }
      }
    </main>
  `,
  styles: `
    .activity-page{max-width:1040px;container:activity-page / inline-size}.activity-controls{display:grid;gap:16px;margin-bottom:20px;padding:17px}.activity-controls__head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.eyebrow{color:var(--rose);font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.activity-controls h2{margin-top:3px;font-size:18px}.activity-actor{position:relative;display:grid;min-width:142px;min-height:48px;align-content:center;padding:7px 34px 7px 12px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2)}.activity-actor>span{color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}.activity-actor>b{margin-top:1px;color:var(--ink-2);font-size:12.5px}.activity-actor--on{border-color:var(--rose-line);background:var(--rose-soft)}.activity-actor select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px}.activity-actor:after{content:'';position:absolute;right:14px;top:50%;width:7px;height:7px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:translateY(-70%) rotate(45deg)}
    .category-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.category-filter{display:flex;min-height:44px;align-items:center;gap:9px;padding:7px 11px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--muted);font:inherit;font-size:12px;font-weight:700;text-align:left;cursor:pointer;transition:border-color .16s ease,background .16s ease,color .16s ease,transform .16s ease}.category-filter:hover{border-color:var(--rose-line);color:var(--ink-2);transform:translateY(-1px)}.category-filter--active{border-color:var(--rose-line);background:var(--rose-soft);color:var(--rose-dark)}.category-filter__icon{display:grid;width:28px;height:28px;flex:0 0 auto;place-items:center;border:1px solid color-mix(in srgb,var(--line) 72%,transparent);border-radius:9px;background:var(--surface)}
    .activity-result-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 2px 10px;color:var(--muted);font-size:11.5px}.activity-result-head b{color:var(--ink-2)}.activity-feed{display:grid;gap:22px}.activity-day{display:grid;gap:9px}.activity-day__head{display:flex;align-items:center;gap:9px;padding:0 3px}.activity-day__head h2{color:var(--ink-2);font-size:13px;text-transform:capitalize}.activity-day__head span{display:grid;min-width:22px;height:22px;place-items:center;border-radius:7px;background:var(--surface-2);color:var(--muted);font-size:10px;font-weight:750}.activity-day__events{display:grid;gap:9px}
    .activity-event{--activity-accent:var(--rose);display:grid;grid-template-columns:44px minmax(0,1fr);gap:13px;padding:16px 17px;border-left:3px solid var(--activity-accent)}.activity-event[data-category=SALES]{--activity-accent:#b75b72}.activity-event[data-category=PURCHASING]{--activity-accent:#aa793d}.activity-event[data-category=CATALOGUE]{--activity-accent:#7970a8}.activity-event[data-category=RELATIONS]{--activity-accent:#4d8580}.activity-event[data-category=PLANNING]{--activity-accent:#5e789d}.activity-event[data-category=OTHER]{--activity-accent:#7c7c84}.activity-event__rail{display:flex;justify-content:center}.activity-event__icon{display:grid;width:40px;height:40px;place-items:center;border:1px solid color-mix(in srgb,var(--activity-accent) 24%,var(--line));border-radius:12px;background:color-mix(in srgb,var(--activity-accent) 8%,var(--surface));color:var(--activity-accent)}.activity-event__body{min-width:0}.activity-event__meta{display:flex;align-items:center;gap:7px;color:var(--activity-accent);font-size:9.5px;font-style:normal;font-weight:800;letter-spacing:.075em;text-transform:uppercase}.activity-event__meta i{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.45}.activity-event__meta time{margin-left:auto;color:var(--muted);font-weight:650;letter-spacing:0}.activity-event h3{margin-top:4px;font-size:15px;line-height:1.38}.activity-event__entity{display:inline-grid;grid-template-columns:auto minmax(0,auto) 10px;align-items:center;gap:7px;max-width:100%;margin-top:9px;padding:7px 9px;border:1px solid var(--line);border-radius:9px;background:var(--surface-2);color:var(--ink-2);font-size:11px;text-decoration:none}.activity-event__entity>span:first-child{color:var(--muted);font-weight:650}.activity-event__entity b{overflow:hidden;font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}.activity-event a.activity-event__entity:hover{border-color:var(--rose-line);color:var(--rose-dark)}.activity-event__link-mark{width:6px;height:6px;border-top:1.5px solid currentColor;border-right:1.5px solid currentColor;transform:rotate(45deg)}.activity-event__entity--static{grid-template-columns:auto minmax(0,auto)}
    .activity-changes{margin-top:12px;padding:11px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2)}.activity-changes__title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px}.activity-changes__title b{font-size:11.5px}.activity-changes__title span{color:var(--muted);font-size:10px}.activity-changes dl{display:grid}.activity-change{display:grid;grid-template-columns:minmax(110px,.7fr) minmax(0,1.3fr);gap:12px;padding:8px 0}.activity-change+.activity-change{border-top:1px solid var(--line)}.activity-change dt{color:var(--ink-2);font-size:11px;font-weight:700}.activity-change dd{display:grid;grid-template-columns:1fr 1fr;gap:7px;min-width:0;margin:0}.activity-change dd>span{min-width:0;color:var(--ink-2);font-size:11px;overflow-wrap:anywhere}.activity-change dd small{display:block;margin-bottom:2px;color:var(--muted);font-size:8px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.activity-change__private{display:block!important;color:var(--muted)!important;font-style:italic}.activity-changes__more{min-height:34px;margin-top:4px;padding:4px 0;border:0;background:transparent;color:var(--rose-dark);font:inherit;font-size:11px;font-weight:750;cursor:pointer}
    .activity-event footer{display:flex;align-items:center;gap:7px;margin-top:11px;color:var(--muted);font-size:10.5px}.activity-event__avatar{display:grid;width:24px;height:24px;place-items:center;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink-2);font-size:9px;font-weight:800;text-transform:uppercase}.activity-loading{display:flex;min-height:220px;align-items:center;justify-content:center;gap:9px;color:var(--muted);font-size:13px}.activity-loading__pulse{width:9px;height:9px;border-radius:50%;background:var(--rose);animation:activity-pulse 1s ease-in-out infinite}.activity-error{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px}.activity-error b{font-size:14px}.activity-error p{color:var(--muted);font-size:12px}.activity-empty{padding-block:56px}.activity-empty p{max-width:390px;margin:5px auto 0;color:var(--muted);font-size:12px;text-align:center}.activity-more{display:block;margin:20px auto 0}.activity-more:disabled{opacity:.55}@keyframes activity-pulse{50%{opacity:.35;transform:scale(.75)}}
    @container activity-page (min-width:700px){.category-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    @container activity-page (min-width:960px){.category-grid{grid-template-columns:repeat(7,minmax(0,1fr))}}
    @media(min-width:820px){.activity-event{grid-template-columns:50px minmax(0,1fr);padding:18px 20px}.activity-event__icon{width:44px;height:44px;border-radius:13px}.activity-event h3{font-size:16px}}
    @media(max-width:560px){.activity-controls{margin-inline:-2px;padding:14px}.activity-controls__head{align-items:stretch;flex-direction:column}.activity-actor{width:100%}.category-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.activity-event{grid-template-columns:34px minmax(0,1fr);gap:10px;padding:14px 12px}.activity-event__icon{width:32px;height:32px;border-radius:10px}.activity-event__meta{flex-wrap:wrap}.activity-event__meta time{margin-left:0}.activity-event h3{font-size:14px}.activity-change{grid-template-columns:1fr;gap:4px}.activity-event__entity{width:100%;grid-template-columns:auto minmax(0,1fr) 10px}.activity-result-head{align-items:flex-start}.activity-day__head{padding-inline:1px}}
    @media(max-width:340px){.category-grid{grid-template-columns:1fr}.activity-event{grid-template-columns:1fr}.activity-event__rail{justify-content:flex-start}.activity-event__meta time{width:100%}.activity-change dd{grid-template-columns:1fr}}
    @media(prefers-reduced-motion:reduce){.activity-loading__pulse{animation:none}.category-filter{transition:none}}
  `,
})
export class ActivityPage {
  private readonly api = inject(ActivityApi);

  readonly detailLimit = 3;
  readonly categoryOptions: ReadonlyArray<{ value: CategoryFilter; label: string; icon: string }> = [
    { value: 'ALL', label: 'Alles', icon: 'activity' },
    { value: 'SALES', label: 'Verkoop', icon: 'sales' },
    { value: 'PURCHASING', label: 'Inkoop', icon: 'purchase' },
    { value: 'CATALOGUE', label: 'Producten', icon: 'products' },
    { value: 'RELATIONS', label: 'Relaties', icon: 'customers' },
    { value: 'PLANNING', label: 'Planning', icon: 'activity' },
    { value: 'OTHER', label: 'Overig', icon: 'more' },
  ];

  readonly actor = signal<'ALL' | 'emre' | 'berat'>('ALL');
  readonly category = signal<CategoryFilter>('ALL');
  readonly items = signal<ActivityEvent[]>([]);
  readonly nextBefore = signal<number | null>(null);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal('');
  readonly expandedDetails = signal<ReadonlySet<number>>(new Set());
  readonly dayGroups = computed(() => groupByDay(this.items()));
  private requestId = 0;

  constructor() {
    void this.load();
  }

  actorLabel(): string {
    return this.actor() === 'ALL' ? 'Iedereen' : this.actor() === 'emre' ? 'Emre' : 'Berat';
  }

  actorName(event: ActivityEvent): string {
    return event.actor?.displayName || 'Systeem';
  }

  actorInitial(event: ActivityEvent): string {
    return this.actorName(event).trim().charAt(0) || '•';
  }

  actionName(action: string): string {
    return activityActionLabel(action);
  }

  entityKind(event: ActivityEvent): string {
    return activityEntityLabel(event);
  }

  categoryOf(event: ActivityEvent): ActivityCategory {
    return activityCategory(event);
  }

  categoryName(event: ActivityEvent): string {
    return activityCategoryLabel(this.categoryOf(event));
  }

  categoryIcon(event: ActivityEvent): string {
    return activityCategoryIcon(this.categoryOf(event));
  }

  routeOf(event: ActivityEvent): string[] | null {
    return activityRoute(event);
  }

  /** Older entries could carry a value that "changed" into itself; those pairs say nothing. */
  changesOf(event: ActivityEvent): ActivityChange[] {
    return (event.changes ?? []).filter((change) => change.beforeValue !== change.afterValue
      || (change.beforeValue === null && change.afterValue === null));
  }

  visibleChanges(event: ActivityEvent): ActivityChange[] {
    const changes = this.changesOf(event);
    return this.detailsExpanded(event.id) ? changes : changes.slice(0, this.detailLimit);
  }

  detailsExpanded(eventId: number): boolean {
    return this.expandedDetails().has(eventId);
  }

  toggleDetails(eventId: number): void {
    const next = new Set(this.expandedDetails());
    next.has(eventId) ? next.delete(eventId) : next.add(eventId);
    this.expandedDetails.set(next);
  }

  changeValue(value: string | null): string {
    return value === null || value.trim() === '' ? 'Niet ingevuld' : value;
  }

  changeActor(value: 'ALL' | 'emre' | 'berat'): void {
    this.actor.set(value);
    void this.load();
  }

  changeCategory(value: CategoryFilter): void {
    if (value === this.category()) return;
    this.category.set(value);
    void this.load();
  }

  reload(): void {
    void this.load();
  }

  async loadMore(): Promise<void> {
    const before = this.nextBefore();
    if (before === null || this.loadingMore()) return;
    const requestId = this.requestId;
    const filters = this.filters();
    this.loadingMore.set(true);
    try {
      const page = await this.api.list({ ...filters, before, limit: 50 });
      if (requestId !== this.requestId) return;
      this.items.update((current) => [...current, ...page.items]);
      this.nextBefore.set(page.nextBefore);
    } catch {
      if (requestId !== this.requestId) return;
      this.error.set('Meer activiteiten laden is niet gelukt.');
    } finally {
      if (requestId === this.requestId) this.loadingMore.set(false);
    }
  }

  private filters(): { actor?: string; category?: ActivityCategory } {
    const category = this.category();
    return {
      actor: this.actor() === 'ALL' ? undefined : this.actor(),
      category: category === 'ALL' ? undefined : category,
    };
  }

  private async load(): Promise<void> {
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.loadingMore.set(false);
    this.error.set('');
    this.expandedDetails.set(new Set());
    try {
      const page = await this.api.list({ ...this.filters(), limit: 50 });
      if (requestId !== this.requestId) return;
      this.items.set(page.items);
      this.nextBefore.set(page.nextBefore);
    } catch {
      if (requestId !== this.requestId) return;
      this.items.set([]);
      this.nextBefore.set(null);
      this.error.set('Controleer je verbinding en probeer opnieuw.');
    } finally {
      if (requestId === this.requestId) this.loading.set(false);
    }
  }
}

function groupByDay(events: ActivityEvent[]): ActivityDayGroup[] {
  const groups = new Map<string, ActivityDayGroup>();
  for (const event of events) {
    const at = new Date(event.at);
    const key = Number.isNaN(at.getTime()) ? 'unknown' : localDayKey(at);
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(event);
    } else {
      groups.set(key, { key, label: dayLabel(at), events: [event] });
    }
  }
  return [...groups.values()];
}

function localDayKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

function dayLabel(date: Date): string {
  if (Number.isNaN(date.getTime())) return 'Datum onbekend';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = localDayKey(date);
  if (key === localDayKey(today)) return 'Vandaag';
  if (key === localDayKey(yesterday)) return 'Gisteren';
  const label = new Intl.DateTimeFormat('nl-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
