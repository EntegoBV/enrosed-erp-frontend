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

interface WebsiteRebuildCopy {
  label: string;
  detail: string;
  tone: 'muted' | 'pending' | 'ok' | 'danger';
}

// A page can show the status more than once; each heading needs its own id.
let nextTitleId = 0;

@Component({
  selector: 'app-website-sync-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="website-sync" [class.website-sync--compact]="compact()"
             [attr.aria-labelledby]="titleId"
             [attr.aria-busy]="loading() || retrying()">
      <div class="website-sync__heading">
        <div>
          <h3 [id]="titleId">Website synchronisatie</h3>
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
            @if (current.nextAttemptAt && current.status === 'FAILED_OR_STALE' && !translationPending()) {
              <small>Volgende automatische poging · {{ formatDate(current.nextAttemptAt) }}</small>
            }
            @if (current.lastError && current.status === 'FAILED_OR_STALE' && !translationPending()) {
              <small class="sync-error">{{ current.lastError }}</small>
            }
          </div>
          <div class="sync-actions">
            <button class="btn btn--sm" type="button" [disabled]="loading() || retrying()"
                    (click)="load()">Status vernieuwen</button>
            @if (translationPending()) {
              <a class="btn btn--sm btn--primary" routerLink="/website" fragment="translation-work">
                Open vertaalwerk
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
  `,
  styles: `
    :host { display: block; }
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
  /** Smaller type and no bottom margin, for use inside another setting. */
  readonly compact = input(false, { transform: booleanAttribute });
  // Shared with every other panel on screen, so they cannot disagree.
  readonly status = this.store.status;
  readonly loading = this.store.loading;
  readonly retrying = this.store.retrying;
  readonly loadError = this.store.loadError;
  readonly translationPending = computed(() => this.isTranslationPending(this.status()));
  readonly copy = computed(() => this.statusCopy(this.status()));

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

  private statusCopy(current: WebsiteRebuildStatus | null): WebsiteRebuildCopy {
    const status = current?.status;
    if (this.isTranslationPending(current)) {
      return {
        label: 'Wacht op vertalingen',
        detail: 'Opgeslagen; de website wacht nog op verplichte vertalingen. De invoer is niet verloren.',
        tone: 'pending',
      };
    }
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

  private isTranslationPending(current: WebsiteRebuildStatus | null): boolean {
    if (current?.status !== 'FAILED_OR_STALE' || !current.lastError) return false;
    return /missing required translation|translation entry|invalid public website copy|vertal|ontbrekende?\s+taal/i
      .test(current.lastError);
  }
}
