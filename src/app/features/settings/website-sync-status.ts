import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { WebsiteRebuildStatus } from '../../core/api/models';
import { RouterLink } from '@angular/router';
import { WebsiteSyncStore } from './website-sync-store';
import { WEBSITE_SYNC_TECHNICAL, WebsiteSyncAction, isTranslationPending, websiteSyncCopy } from './website-sync-copy';

// A page can show the status more than once; each heading needs its own id.
let nextTitleId = 0;

/**
 * The website rebuild status, from the one WebsiteSyncStore of the app.
 * - card: Settings › Website · Prijzen and the quote settings (the full block);
 * - bar: the desk status bar of Website beheren ("● Live sinds 16/10 23:40 Vernieuwen");
 * - chip: the phone capsule under a large title, a link to Publicatie; it
 *   steps aside while the banner shows, so the state is said once;
 * - banner: the phone banner, rendered only while the website is not live.
 * The words come from website-sync-copy.ts, so the variants cannot disagree.
 */
@Component({
  selector: 'app-website-sync-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { '[class.ws-sync-host]': "variant() !== 'card'" },
  template: `
    @switch (variant()) {
      @case ('bar') {
        <span class="ws-sync" [class]="'ws-sync is-' + copy().tone" [attr.title]="copy().detail">
          <i aria-hidden="true"></i><b>{{ copy().label }}</b>
          @if (copy().moment; as moment) { <small>{{ moment }}</small> }
          @if (copy().action; as action) {
            @if (action === 'todo') {
              <a routerLink="/website" fragment="translation-work">{{ copy().actionLabel }}</a>
            } @else {
              <button type="button" [disabled]="loading() || retrying()" (click)="run(action)">{{ busyLabel(action) }}</button>
            }
          }
        </span>
      }
      @case ('chip') {
        @if (!copy().needsBanner) {
        <a class="ws-chip" [class]="'ws-chip is-' + copy().tone" routerLink="/website/publication"
           [attr.aria-label]="'Website: ' + copy().label + (copy().moment ? ', ' + copy().moment : '')">
          <i aria-hidden="true"></i><span>{{ copy().label }}@if (copy().moment; as moment) { · {{ moment }} }</span>
        </a>
        }
      }
      @case ('banner') {
        @if (copy().needsBanner) {
          <div class="ios-banner ws-sync-banner" [class.ios-banner--danger]="copy().tone === 'danger'"
               [class.ios-banner--info]="copy().tone === 'muted'" role="status">
            <span><b>{{ copy().label }}</b>@if (copy().moment; as moment) { · {{ moment }} }</span>
            @if (copy().action; as action) {
              @if (action === 'todo') {
                <a class="ios-capsule ios-capsule--sm ios-capsule--tinted" routerLink="/website" fragment="translation-work">{{ copy().actionLabel }}</a>
              } @else {
                <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button"
                        [disabled]="loading() || retrying()" (click)="run(action)">{{ busyLabel(action) }}</button>
              }
            }
          </div>
        }
      }
      @default {
        <section class="website-sync" [class.website-sync--compact]="compact()"
                 [attr.aria-labelledby]="titleId"
                 [attr.aria-busy]="loading() || retrying()">
          <div class="website-sync__heading">
            <div>
              <h3 [id]="titleId">Website synchronisatie</h3>
              <p>Opgeslagen betekent nog niet automatisch zichtbaar op de website.</p>
            </div>
            @if (status()) {
              <span class="sync-badge" [class]="'sync-badge sync-badge--' + badgeTone()">
                <i aria-hidden="true"></i>{{ copy().label }}
              </span>
            }
          </div>

          @if (loadError()) {
            <div class="sync-state sync-state--error" role="alert">
              <div><b>Status niet geladen</b><small>{{ loadError() }}</small></div>
              <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="load()">
                Opnieuw laden
              </button>
            </div>
          } @else if (loading() && !status()) {
            <div class="sync-state" role="status">Status ophalen…</div>
          } @else if (status(); as current) {
            <div class="sync-summary" aria-live="polite">
              <div>
                <b>{{ copy().detail }}</b>
                @if (statusMoment(current); as moment) {
                  <small>{{ moment.label }} · {{ formatDate(moment.value) }}</small>
                }
                @if (pollEnded() && (current.status === 'QUEUED' || current.status === 'TRIGGERED')) {
                  <small>Controle gestopt na 5 minuten · vernieuw de status om opnieuw te kijken</small>
                }
                @if (current.nextAttemptAt && current.status === 'FAILED_OR_STALE' && !translationPending()) {
                  <small>Volgende automatische poging · {{ formatDate(current.nextAttemptAt) }}</small>
                }
                @if (current.lastError && current.status === 'FAILED_OR_STALE' && !translationPending()) {
                  <small class="sync-error">{{ current.lastError }}</small>
                }
                @if (technical() && current.status === 'NOT_CONFIGURED') {
                  <details class="sync-technical">
                    <summary>Technische uitleg</summary>
                    <p>{{ technicalText }}</p>
                  </details>
                }
              </div>
              <div class="sync-actions">
                <button class="btn btn--sm" type="button" [disabled]="loading() || retrying()"
                        (click)="load()">Status vernieuwen</button>
                @if (translationPending()) {
                  <a class="btn btn--sm btn--primary" routerLink="/website" fragment="translation-work">
                    Naar Te doen
                  </a>
                } @else if (current.status === 'FAILED_OR_STALE') {
                  <button class="btn btn--sm btn--primary" type="button"
                          [disabled]="loading() || retrying()" (click)="retry()">
                    {{ retrying() ? 'Opnieuw starten…' : 'Opnieuw proberen' }}
                  </button>
                }
              </div>
            </div>
          }
        </section>
      }
    }
  `,
  styles: `
    :host { display: block; }
    :host(.ws-sync-host) { display: contents; }
    .website-sync {
      margin-bottom: 12px; padding: 14px; border: 1px solid var(--line);
      border-radius: var(--r-sm); background: var(--surface-2);
    }
    .website-sync__heading, .sync-summary, .sync-state {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .website-sync__heading > div, .sync-summary > div:first-child, .sync-state > div {
      display: grid; min-width: 0; gap: 2px;
    }
    .website-sync h3 { font-size: 17px; }
    .website-sync p, .sync-summary small, .sync-state small {
      color: var(--muted); font-size: 14px; line-height: 1.45;
    }
    .sync-badge {
      display: inline-flex; flex: none; min-height: 25px; align-items: center; gap: 5px;
      padding: 4px 8px; border-radius: 999px; background: var(--surface);
      color: var(--muted); font-size: 13px; font-weight: 750;
    }
    .sync-badge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .sync-badge--pending { background: var(--warn-soft); color: var(--warn); }
    .sync-badge--ok { background: var(--ok-soft); color: var(--ok); }
    .sync-badge--danger { background: var(--danger-soft); color: var(--danger); }
    .sync-summary, .sync-state { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--line); }
    .sync-summary b, .sync-state b { font-size: 15px; line-height: 1.4; }
    .sync-error { color: var(--danger) !important; }
    .sync-technical summary { color: var(--ink-2); font-size: 13px; font-weight: 650; cursor: pointer; }
    .sync-technical p { margin-top: 4px; font-size: 13px; }
    .sync-state { min-height: 48px; color: var(--muted); font-size: 14px; }
    .sync-state--error { color: var(--danger); }
    .sync-actions { display: flex; flex: none; gap: 6px; }
    .sync-actions .btn, .sync-state .btn { min-height: 48px; }
    .website-sync--compact { margin-bottom: 0; }
    .website-sync--compact h3 { font-size: 15px; }
    .website-sync--compact p, .website-sync--compact .sync-summary small,
    .website-sync--compact .sync-state small, .website-sync--compact .sync-state { font-size: 13px; }
    .website-sync--compact .sync-summary b, .website-sync--compact .sync-state b { font-size: 13px; }

    @media (max-width: 560px) {
      .website-sync__heading, .sync-summary, .sync-state { align-items: stretch; flex-direction: column; }
      .sync-badge { align-self: flex-start; }
      .sync-actions { display: grid; grid-template-columns: 1fr; width: 100%; }
      .sync-actions .btn, .sync-state .btn { width: 100%; }
    }
  `,
})
export class WebsiteSyncStatus {
  private readonly store = inject(WebsiteSyncStore);

  readonly titleId = `website-sync-title-${nextTitleId++}`;
  readonly refreshKey = input(0);
  readonly variant = input<'card' | 'bar' | 'chip' | 'banner'>('card');
  /** Smaller type and no bottom margin, for use inside another setting. */
  readonly compact = input(false, { transform: booleanAttribute });
  /** The card on Publicatie explains the Vercel/Railway set-up when the link is missing. */
  readonly technical = input(false, { transform: booleanAttribute });
  readonly technicalText = WEBSITE_SYNC_TECHNICAL;
  // Shared with every other panel on screen, so they cannot disagree.
  readonly status = this.store.status;
  readonly loading = this.store.loading;
  readonly retrying = this.store.retrying;
  readonly loadError = this.store.loadError;
  readonly pollEnded = this.store.pollEnded;
  readonly translationPending = computed(() => isTranslationPending(this.status()));
  readonly copy = computed(() => websiteSyncCopy({
    status: this.status(), loading: this.loading(), loadError: this.loadError(), pollEnded: this.pollEnded(),
  }));
  readonly badgeTone = computed(() => {
    const tone = this.copy().tone;
    return tone === 'warn' ? 'pending' : tone;
  });

  private readonly dateFormatter = new Intl.DateTimeFormat('nl-BE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  constructor() {
    this.store.attach();
    effect(() => {
      this.refreshKey();
      untracked(() => this.store.refresh());
    });
    inject(DestroyRef).onDestroy(() => this.store.detach());
  }

  load(): Promise<void> {
    return this.store.load();
  }

  retry(): Promise<void> {
    return this.store.retry();
  }

  run(action: WebsiteSyncAction): void {
    if (action === 'retry') void this.retry();
    else void this.load();
  }

  busyLabel(action: WebsiteSyncAction): string {
    if (action === 'retry' && this.retrying()) return 'Opnieuw starten…';
    if (action !== 'retry' && this.loading()) return 'Bezig…';
    return this.copy().actionLabel ?? '';
  }

  statusMoment(current: WebsiteRebuildStatus): { label: string; value: string } | null {
    if (current.status === 'LIVE' && current.liveAt) {
      return { label: 'Live sinds', value: current.liveAt };
    }
    if (current.status === 'TRIGGERED' && current.hookAcceptedAt) {
      return { label: 'Update geaccepteerd', value: current.hookAcceptedAt };
    }
    if (current.status === 'QUEUED' && current.queuedAt) {
      return { label: 'In wachtrij sinds', value: current.queuedAt };
    }
    if (current.lastAttemptAt) return { label: 'Laatste poging', value: current.lastAttemptAt };
    return null;
  }

  formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'tijdstip onbekend' : this.dateFormatter.format(date);
  }
}
