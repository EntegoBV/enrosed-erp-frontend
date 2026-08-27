import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ActivityApi } from '../../core/api/activity-api';
import { ActivityEvent } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { DateTimeNlPipe } from '../../shared/pipes';
import { activityActionLabel, activityEntityLabel, activityRoute } from './activity-copy';

@Component({
  selector: 'app-activity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, DateTimeNlPipe],
  template: `
    <app-page-header title="Logboek" subtitle="Wie deed wat" />

    <main class="content activity-page" [attr.aria-busy]="loading() || loadingMore()">
      <div class="activity-toolbar">
        <div class="activity-filter" [class.activity-filter--on]="actor() !== 'ALL'">
          <span aria-hidden="true">●</span>
          <b>{{ actorLabel() }}</b>
          <select aria-label="Filter logboek op medewerker" [ngModel]="actor()"
                  (ngModelChange)="changeActor($event)">
            <option value="ALL">Iedereen</option>
            <option value="emre">Emre</option>
            <option value="berat">Berat</option>
          </select>
        </div>
        <span class="activity-toolbar__hint">Nieuwste eerst</span>
      </div>

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
        <section class="activity-feed" aria-label="Activiteiten">
          @for (event of items(); track event.id) {
            <article class="card activity-event">
              <div class="activity-event__avatar" aria-hidden="true">{{ actorInitial(event) }}</div>
              <div class="activity-event__body">
                <div class="activity-event__kicker">
                  {{ entityKind(event) }} · {{ actionName(event.action) }}
                </div>
                <h2>{{ event.summary }}</h2>
                <p>{{ event.at | dateTimeNl }} · {{ actorName(event) }}</p>
                @if (event.entityLabel) {
                  @if (routeOf(event); as target) {
                    <a class="activity-event__entity" [routerLink]="target">
                      {{ event.entityLabel }} <span aria-hidden="true">›</span>
                    </a>
                  } @else {
                    <span class="activity-event__entity">{{ event.entityLabel }}</span>
                  }
                }
              </div>
            </article>
          } @empty {
            <div class="empty activity-empty">
              <div class="empty__icon" aria-hidden="true">✓</div>
              <div class="empty__title">Nog niets in dit logboek</div>
              <p>{{ actor() === 'ALL' ? 'Nieuwe handelingen verschijnen hier automatisch.' : 'Voor deze medewerker zijn nog geen handelingen geregistreerd.' }}</p>
            </div>
          }
        </section>

        @if (nextBefore() !== null) {
          <button class="btn activity-more" type="button" [disabled]="loadingMore()"
                  (click)="loadMore()">
            {{ loadingMore() ? 'Laden…' : 'Meer laden' }}
          </button>
        }
      }
    </main>
  `,
  styles: `
    .activity-page{max-width:820px}.activity-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.activity-filter{position:relative;display:inline-flex;min-height:38px;align-items:center;gap:7px;padding:0 13px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink-2);font-size:12.5px}.activity-filter>span{color:var(--muted-2);font-size:8px}.activity-filter b{font-weight:700}.activity-filter--on{border-color:var(--rose-line);background:var(--rose-soft);color:var(--rose-dark)}.activity-filter--on>span{color:var(--rose)}.activity-filter select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px}.activity-toolbar__hint{color:var(--muted);font-size:11.5px}.activity-feed{display:grid;gap:10px}.activity-event{display:grid;grid-template-columns:38px minmax(0,1fr);gap:11px;padding:14px}.activity-event__avatar{display:grid;width:38px;height:38px;place-items:center;border:1px solid var(--rose-line);border-radius:12px;background:var(--rose-soft);color:var(--rose-dark);font-size:13px;font-weight:800;text-transform:uppercase}.activity-event__body{min-width:0}.activity-event__kicker{color:var(--rose);font-size:9.5px;font-weight:780;letter-spacing:.08em;text-transform:uppercase}.activity-event h2{margin-top:2px;font-size:14px;line-height:1.35}.activity-event p{margin-top:3px;color:var(--muted);font-size:11.5px}.activity-event__entity{display:inline-flex;align-items:center;gap:5px;max-width:100%;margin-top:8px;color:var(--ink-2);font-size:12px;font-weight:650;text-decoration:none}.activity-event a.activity-event__entity:hover{color:var(--rose-dark)}.activity-event__entity span{color:var(--rose);font-size:16px}.activity-loading{display:flex;min-height:180px;align-items:center;justify-content:center;gap:9px;color:var(--muted);font-size:13px}.activity-loading__pulse{width:9px;height:9px;border-radius:50%;background:var(--rose);animation:activity-pulse 1s ease-in-out infinite}.activity-error{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px}.activity-error b{font-size:14px}.activity-error p{color:var(--muted);font-size:12px}.activity-empty{padding-block:56px}.activity-empty p{max-width:330px;margin:5px auto 0;color:var(--muted);font-size:12px;text-align:center}.activity-more{display:block;margin:18px auto 0}.activity-more:disabled{opacity:.55}@keyframes activity-pulse{50%{opacity:.35;transform:scale(.75)}}
    @media(min-width:680px){.activity-event{grid-template-columns:44px minmax(0,1fr);padding:17px 18px}.activity-event__avatar{width:44px;height:44px;border-radius:14px}.activity-event h2{font-size:15px}}
    @media(prefers-reduced-motion:reduce){.activity-loading__pulse{animation:none}}
  `,
})
export class ActivityPage {
  private readonly api = inject(ActivityApi);
  readonly actor = signal<'ALL' | 'emre' | 'berat'>('ALL');
  readonly items = signal<ActivityEvent[]>([]);
  readonly nextBefore = signal<number | null>(null);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal('');
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

  routeOf(event: ActivityEvent): string[] | null {
    return activityRoute(event);
  }

  changeActor(value: 'ALL' | 'emre' | 'berat'): void {
    this.actor.set(value);
    void this.load();
  }

  reload(): void {
    void this.load();
  }

  async loadMore(): Promise<void> {
    const before = this.nextBefore();
    if (before === null || this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const page = await this.api.list({ actor: this.actor() === 'ALL' ? undefined : this.actor(),
        before, limit: 50 });
      this.items.update((current) => [...current, ...page.items]);
      this.nextBefore.set(page.nextBefore);
    } catch {
      this.error.set('Meer activiteiten laden is niet gelukt.');
    } finally {
      this.loadingMore.set(false);
    }
  }

  private async load(): Promise<void> {
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.api.list({ actor: this.actor() === 'ALL' ? undefined : this.actor(), limit: 50 });
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
