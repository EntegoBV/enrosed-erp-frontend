import { signal } from '@angular/core';
import type { WebsiteRebuildStatus } from '../../core/api/models';

export interface WebsiteSyncSource {
  websiteRebuildStatus(): Promise<WebsiteRebuildStatus>;
  retryWebsiteRebuild(): Promise<WebsiteRebuildStatus>;
}

/** messageOf, handed in: node-tested modules import nothing of the app at runtime. */
export type WebsiteSyncFailureText = (failure: unknown, fallback: string) => string;

const POLL_DELAY_MS = 8_000;
const MAX_POLL_WINDOW_MS = 5 * 60_000;

/**
 * The website rebuild status as every panel on screen sees it. One page can
 * show the panel more than once (settings: prices and categories); they share
 * this state, so a refresh or retry in one shows in the other and only one
 * poll runs. Plain class without Angular DI so node can test it.
 */
export class WebsiteSyncState {
  private readonly source: WebsiteSyncSource;
  private readonly failureText: WebsiteSyncFailureText;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshPending = false;
  private refreshQueued = false;
  private pollStartedAt: number | null = null;
  private watchers = 0;
  // Moves when the last panel leaves; an answer from before that is dropped.
  private epoch = 0;

  readonly status = signal<WebsiteRebuildStatus | null>(null);
  readonly loading = signal(false);
  readonly retrying = signal(false);
  readonly loadError = signal<string | null>(null);

  constructor(source: WebsiteSyncSource, failureText: WebsiteSyncFailureText) {
    this.source = source;
    this.failureText = failureText;
  }

  attach(): void {
    this.watchers++;
  }

  detach(): void {
    this.watchers = Math.max(0, this.watchers - 1);
    if (this.watchers > 0) return;
    this.epoch++;
    this.clearPoll();
    this.refreshPending = false;
    this.pollStartedAt = null;
    this.status.set(null);
    this.loading.set(false);
    this.retrying.set(false);
    this.loadError.set(null);
  }

  /** Panels that ask in the same turn (page load, shared counter) get one request. */
  refresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      if (this.watchers > 0) void this.load();
    });
  }

  async load(manual = true): Promise<void> {
    if (this.loading() || this.retrying()) {
      this.refreshPending = true;
      return;
    }
    if (manual) this.pollStartedAt = Date.now();
    const epoch = this.epoch;
    this.loading.set(true);
    this.loadError.set(null);
    this.clearPoll();
    try {
      const status = await this.source.websiteRebuildStatus();
      if (epoch !== this.epoch) return;
      this.status.set(status);
      this.schedulePoll(status);
    } catch (failure: unknown) {
      if (epoch === this.epoch) {
        this.loadError.set(this.failureText(failure, 'Controleer de verbinding en probeer opnieuw.'));
      }
    } finally {
      if (epoch === this.epoch) {
        this.loading.set(false);
        this.loadPending();
      }
    }
  }

  async retry(): Promise<void> {
    if (this.loading() || this.retrying()) return;
    const epoch = this.epoch;
    this.retrying.set(true);
    this.pollStartedAt = Date.now();
    this.loadError.set(null);
    this.clearPoll();
    try {
      const status = await this.source.retryWebsiteRebuild();
      if (epoch !== this.epoch) return;
      this.status.set(status);
      this.schedulePoll(status);
    } catch (failure: unknown) {
      if (epoch === this.epoch) {
        this.loadError.set(this.failureText(failure, 'Website-update opnieuw starten mislukt.'));
      }
    } finally {
      if (epoch === this.epoch) {
        this.retrying.set(false);
        this.loadPending();
      }
    }
  }

  private loadPending(): void {
    if (!this.refreshPending) return;
    this.refreshPending = false;
    void this.load();
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
