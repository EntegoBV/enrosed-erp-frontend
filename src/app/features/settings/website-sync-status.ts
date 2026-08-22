import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { WebsiteRebuildState, WebsiteRebuildStatus } from '../../core/api/models';

interface WebsiteRebuildCopy {
  label: string;
  detail: string;
  tone: 'muted' | 'pending' | 'ok' | 'danger';
}

const POLL_DELAY_MS = 8_000;
const MAX_POLL_WINDOW_MS = 5 * 60_000;

@Component({
  selector: 'app-website-sync-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="website-sync" aria-labelledby="website-sync-title"
             [attr.aria-busy]="loading() || retrying()">
      <div class="website-sync__heading">
        <div>
          <h3 id="website-sync-title">Website synchronisatie</h3>
          <p>Opgeslagen betekent nog niet automatisch zichtbaar op de website.</p>
        </div>
        @if (status(); as current) {
          <span class="sync-badge" [class]="'sync-badge sync-badge--' + copy().tone">
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
        <div class="sync-state" role="status">Synchronisatiestatus laden…</div>
      } @else if (status(); as current) {
        <div class="sync-summary" aria-live="polite">
          <div>
            <b>{{ copy().detail }}</b>
            @if (statusMoment(current); as moment) {
              <small>{{ moment.label }} · {{ formatDate(moment.value) }}</small>
            }
            @if (current.nextAttemptAt && current.status === 'FAILED_OR_STALE') {
              <small>Volgende automatische poging · {{ formatDate(current.nextAttemptAt) }}</small>
            }
            @if (current.lastError && current.status === 'FAILED_OR_STALE') {
              <small class="sync-error">{{ current.lastError }}</small>
            }
          </div>
          <div class="sync-actions">
            <button class="btn btn--sm" type="button" [disabled]="loading() || retrying()"
                    (click)="load()">Status vernieuwen</button>
            @if (current.status === 'FAILED_OR_STALE') {
              <button class="btn btn--sm btn--primary" type="button"
                      [disabled]="loading() || retrying()" (click)="retry()">
                {{ retrying() ? 'Opnieuw starten…' : 'Opnieuw proberen' }}
              </button>
            }
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .website-sync {
      margin-bottom: 12px; padding: 11px 12px; border: 1px solid var(--line);
      border-radius: var(--r-sm); background: var(--surface-2);
    }
    .website-sync__heading, .sync-summary, .sync-state {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .website-sync__heading > div, .sync-summary > div:first-child, .sync-state > div {
      display: grid; min-width: 0; gap: 2px;
    }
    .website-sync h3 { font-size: 12px; }
    .website-sync p, .sync-summary small, .sync-state small {
      color: var(--muted); font-size: 9.5px; line-height: 1.4;
    }
    .sync-badge {
      display: inline-flex; flex: none; min-height: 25px; align-items: center; gap: 5px;
      padding: 4px 8px; border-radius: 999px; background: var(--surface);
      color: var(--muted); font-size: 8.5px; font-weight: 750;
    }
    .sync-badge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .sync-badge--pending { background: var(--warn-soft); color: var(--warn); }
    .sync-badge--ok { background: var(--ok-soft); color: var(--ok); }
    .sync-badge--danger { background: var(--danger-soft); color: var(--danger); }
    .sync-summary, .sync-state { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--line); }
    .sync-summary b, .sync-state b { font-size: 10px; }
    .sync-error { color: var(--danger) !important; }
    .sync-state { min-height: 43px; color: var(--muted); font-size: 10px; }
    .sync-state--error { color: var(--danger); }
    .sync-actions { display: flex; flex: none; gap: 6px; }
  `,
})
export class WebsiteSyncStatus {
  private readonly catalog = inject(CatalogApi);
  private readonly destroyRef = inject(DestroyRef);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshPending = false;
  private pollStartedAt: number | null = null;

  readonly refreshKey = input(0);
  readonly status = signal<WebsiteRebuildStatus | null>(null);
  readonly loading = signal(false);
  readonly retrying = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly copy = computed(() => this.statusCopy(this.status()?.status));

  private readonly dateFormatter = new Intl.DateTimeFormat('nl-BE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  constructor() {
    effect(() => {
      this.refreshKey();
      untracked(() => void this.load());
    });
    this.destroyRef.onDestroy(() => this.clearPoll());
  }

  async load(manual = true): Promise<void> {
    if (this.loading() || this.retrying()) {
      this.refreshPending = true;
      return;
    }
    if (manual) this.pollStartedAt = Date.now();
    this.loading.set(true);
    this.loadError.set(null);
    this.clearPoll();
    try {
      const status = await this.catalog.websiteRebuildStatus();
      if (this.destroyRef.destroyed) return;
      this.status.set(status);
      this.schedulePoll(status);
    } catch (failure: unknown) {
      if (!this.destroyRef.destroyed) {
        this.loadError.set(messageOf(failure, 'Controleer de verbinding en probeer opnieuw.'));
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.loading.set(false);
        if (this.refreshPending) {
          this.refreshPending = false;
          void this.load();
        }
      }
    }
  }

  async retry(): Promise<void> {
    if (this.loading() || this.retrying()) return;
    this.retrying.set(true);
    this.pollStartedAt = Date.now();
    this.loadError.set(null);
    this.clearPoll();
    try {
      const status = await this.catalog.retryWebsiteRebuild();
      if (this.destroyRef.destroyed) return;
      this.status.set(status);
      this.schedulePoll(status);
    } catch (failure: unknown) {
      if (!this.destroyRef.destroyed) {
        this.loadError.set(messageOf(failure, 'Website-update opnieuw starten mislukt.'));
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.retrying.set(false);
        if (this.refreshPending) {
          this.refreshPending = false;
          void this.load();
        }
      }
    }
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

  private statusCopy(status?: WebsiteRebuildState): WebsiteRebuildCopy {
    switch (status) {
      case 'NOT_CONFIGURED':
        return {
          label: 'Niet ingesteld',
          detail: 'De backend kent nog geen Vercel Deploy Hook van de website. Maak er een '
            + 'aan in Vercel (project enrosed-website-frontend → Settings → Git → Deploy '
            + 'Hooks) en zet de URL op Railway als VERCEL_WEBSITE_DEPLOY_HOOK_URL. Daarna '
            + 'bouwt de website zichzelf opnieuw na elke opgeslagen wijziging.',
          tone: 'muted',
        };
      case 'QUEUED':
        return {
          label: 'In wachtrij',
          detail: 'De wijziging staat klaar om de website opnieuw op te bouwen.',
          tone: 'pending',
        };
      case 'TRIGGERED':
        return {
          label: 'Wordt bijgewerkt',
          detail: 'De update is geaccepteerd, maar staat nog niet live.',
          tone: 'pending',
        };
      case 'LIVE':
        return {
          label: 'Live',
          detail: 'De website gebruikt de nieuwste gepubliceerde revisie.',
          tone: 'ok',
        };
      case 'FAILED_OR_STALE':
        return {
          label: 'Actie nodig',
          detail: 'De website kon niet worden bijgewerkt of loopt achter.',
          tone: 'danger',
        };
      default:
        return { label: 'Status laden', detail: 'Status wordt gecontroleerd.', tone: 'muted' };
    }
  }

  private schedulePoll(status: WebsiteRebuildStatus): void {
    // Hook acceptance is not the same as a live website. Keep polling while
    // Vercel builds so the badge can move from TRIGGERED to LIVE without a
    // manual refresh; the five-minute window still bounds background work.
    const pollable = status.status === 'QUEUED'
      || status.status === 'TRIGGERED'
      || !!status.nextAttemptAt;
    if (!pollable) {
      this.pollStartedAt = null;
      return;
    }
    this.pollStartedAt ??= Date.now();
    if (Date.now() - this.pollStartedAt >= MAX_POLL_WINDOW_MS) return;
    const nextAttempt = status.nextAttemptAt ? Date.parse(status.nextAttemptAt) : Number.NaN;
    const delay = Number.isNaN(nextAttempt)
      ? POLL_DELAY_MS
      : Math.min(60_000, Math.max(2_000, nextAttempt - Date.now() + 1_000));
    this.pollTimer = setTimeout(() => void this.load(false), delay);
  }

  private clearPoll(): void {
    if (this.pollTimer === null) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
