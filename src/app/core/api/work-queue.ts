import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SalesApi } from './sales-api';
import { Auth } from './auth';
import { api } from './api.config';
/* Type only: the rest of the partner sales client stays in the lazy screens, out of the first load. */
import type { PartnerSalesSummary } from './partner-sales-api';
import { AppNotification } from './models';
import { messageOf } from './errors';
import { QUEUE_INTERVAL_MS, reusesQueueRefresh, shouldRefreshQueue } from './work-queue-refresh';

const DISMISSED_KEY = 'enrosed.dismissedNotifications';

/**
 * What is waiting on us, in one place.
 *
 * The bell top right, the dot on the Verkoop tab and the list atop the
 * sales orders all show the same thing. Without a shared source each of
 * the three fetches its own copy and they drift - a 2 on the tab while the
 * list shows three, and nobody trusts the number anymore.
 *
 * Dismissed notifications are kept locally. Deliberately not a server
 * setting: it is a personal "seen it", not something that should hold for
 * a colleague too. When a notification changes content it comes back -
 * otherwise one click hides a quote that later needs attention again.
 */
@Injectable({ providedIn: 'root' })
export class WorkQueue {
  private readonly sales = inject(SalesApi);
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);

  readonly items = signal<AppNotification[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Website login requests waiting for approval, and whether an intake list is full. */
  readonly loginRequestCount = signal(0);
  readonly loginIntakeFull = signal(false);
  readonly loginIntakeFullSources = signal<string[]>([]);
  /**
   * Veilingverkopen: the partner's meldingen not invoiced yet (GET /api/partner-sales/summary). null while unknown or
   * on a backend without the portal. The nav count, the home card and the Te doen task all read this one signal.
   */
  readonly partnerSales = signal<PartnerSalesSummary | null>(null);
  /**
   * Round 2: Factureren takes only meldingen staff confirmed. A round-1 backend sends no confirmed figures; then every
   * open melding counts as before (and nothing waits on a confirmation).
   */
  readonly partnerSalesConfirming = computed(() => this.partnerSales()?.confirmedOpenReports != null);
  /** Meldingen waiting for Bevestigen (0 on a round-1 backend). */
  readonly partnerSalesUnconfirmed = computed(() => Math.max(0, this.partnerSales()?.unconfirmedReports ?? 0));
  /**
   * Something can be invoiced now: a confirmed sale is open (round 1: any open sale). A buyback alone is open too, but
   * Factureren can only net it against the next sale of that product, so it asks nobody to act.
   */
  readonly partnerSalesInvoiceable = computed(() => {
    const summary = this.partnerSales();
    if (!summary) return false;
    return (this.partnerSalesConfirming() ? summary.confirmedOpenSaleQuantity ?? 0 : summary.openSaleQuantity) > 0;
  });
  /**
   * What Factureren can take now: meldingen, the sale in sales units (quantity: is a sale open at all), in pieces
   * (null when the server does not say them: never print sales units as stuks) and netto (confirmed and open; round 1:
   * every open one).
   */
  readonly partnerSalesToInvoice = computed(() => {
    const summary = this.partnerSales();
    if (!summary) return null;
    return this.partnerSalesConfirming()
      ? { reports: summary.confirmedOpenReports ?? 0, quantity: summary.confirmedOpenSaleQuantity ?? 0,
        pieces: summary.confirmedOpenSalePieces ?? null, netEur: summary.confirmedOpenNetEur ?? 0 }
      : { reports: summary.openReports, quantity: summary.openSaleQuantity, pieces: summary.openSalePieces ?? null, netEur: summary.openNetEur };
  });
  /** The count on Veilingverkopen in the nav and the host: to confirm, plus confirmed ones Factureren can take (a NavCountKey). */
  readonly partnerSalesOpen = computed(() =>
    this.partnerSalesUnconfirmed() + (this.partnerSalesInvoiceable() ? this.partnerSalesToInvoice()?.reports ?? 0 : 0));
  private readonly dismissed = signal<Set<string>>(this.restore());
  private refreshVersion = 0;
  private refreshPromise: Promise<void> | null = null;
  /** When the last fetch started (ms), for the automatic refresh's throttle. */
  private lastRefreshAt: number | null = null;

  /** Everything not dismissed. */
  readonly visible = computed(() =>
    this.items().filter((item) => !this.dismissed().has(key(item))));

  /** What we must act on; that is the number on the tab and the bell. */
  readonly actionCount = computed(() =>
    this.actions().length);

  /** The Wijzigingen page lists all pending proposals, even dismissed alerts. */
  readonly revisionCount = computed(() =>
    this.items().filter((item) => item.kind === 'VOORSTEL' && item.actionNeeded).length);

  readonly actions = computed(() => this.visible().filter((item) => item.actionNeeded && !ownBucket(item)));
  readonly news = computed(() => this.visible().filter((item) => !item.actionNeeded && !ownBucket(item)));
  /** Purchase alerts must never become customer work or a sales-order link. */
  readonly arrivals = computed(() => this.visible().filter((item) => item.kind === 'CONTAINER_AANKOMST'));
  /** The partner's meldingen of the last 14 days: their own bell section, never customer work or a sales-order link. */
  readonly partnerSaleItems = computed(() => this.visible().filter((item) => item.kind === 'PARTNER_VERKOOP'));
  /** Customers the partner made in the portal, until staff mark them Nagekeken: their own bell rows, links to the sheet. */
  readonly partnerCustomerItems = computed(() => this.visible().filter((item) => item.kind === 'PARTNER_KLANT'));

  /**
   * Fetches the queue. Not forced, it shares a fetch that is under way, and
   * one that answered without an error a few seconds ago (QUEUE_REUSE_MS):
   * the shell's refresh on start and the screen that opens a moment later
   * (the home, a bell, Meer) are one page load. After a change of our own,
   * callers force it.
   */
  refresh(force = false): Promise<void> {
    /* A partner (Verhoeven) has no staff queue: this one choke point keeps the auto refresh, the bell, the push
       listener and the native host from calling staff endpoints for a partner session. */
    if (this.auth.isPartner()) return Promise.resolve();
    if (!force && this.refreshPromise) return this.refreshPromise;
    if (!force && !this.error() && reusesQueueRefresh(this.lastRefreshAt, Date.now())) return Promise.resolve();
    this.lastRefreshAt = Date.now();
    const request = this.fetch();
    this.refreshPromise = request;
    void request.finally(() => {
      if (this.refreshPromise === request) this.refreshPromise = null;
    });
    return request;
  }

  private async fetch(): Promise<void> {
    const version = ++this.refreshVersion;
    this.loading.set(true);
    this.error.set(null);
    /* Asked beside the feed, never after it: the summary is cheap and must not wait for the feed's answer. */
    const partnerSales = firstValueFrom(this.http.get<PartnerSalesSummary>(api('/api/partner-sales/summary'))).then(
      (summary) => ({ summary, failure: null as unknown }),
      (failure: unknown) => ({ summary: null, failure }));
    try {
      const feed = await this.sales.notifications();
      if (version !== this.refreshVersion) return;
      this.items.set(feed.items);
    } catch (failure: unknown) {
      if (version !== this.refreshVersion) return;
      /* Keep the last known queue visible. A transient network failure must
         not make open work appear completed. */
      this.error.set(messageOf(
        failure,
        'Meldingen konden niet worden vernieuwd. Controleer de verbinding en probeer opnieuw.',
      ));
    } finally {
      if (version === this.refreshVersion) this.loading.set(false);
    }
    /* Separate from the feed on purpose: neither call may hide or reset the other. */
    try {
      const summary = await this.sales.loginRequestSummary();
      if (version === this.refreshVersion) {
        this.loginRequestCount.set(summary.pending);
        this.loginIntakeFull.set(summary.intakeFull === true);
        this.loginIntakeFullSources.set(Array.isArray(summary.intakeFullSources) ? summary.intakeFullSources : []);
      }
    } catch { /* older backend, missing stub method or network: keep the last values */ }
    const answer = await partnerSales;
    if (version !== this.refreshVersion) return;
    /* A backend without the portal answers 404: nothing to count. A network failure keeps the last values. */
    if (answer.summary) this.partnerSales.set(answer.summary);
    else if ((answer.failure as { status?: number } | null)?.status === 404) this.partnerSales.set(null);
  }

  /**
   * Keeps the counts current without anyone opening the bell: a refresh
   * when the app comes back into view or gets the focus (unless the last one
   * is under a minute old) and every five minutes while it is visible.
   * The App shell starts it while someone is logged in; the returned
   * function stops it.
   */
  startAutoRefresh(win: Window = window): () => void {
    const doc = win.document;
    const maybeRefresh = () => {
      if (shouldRefreshQueue(this.lastRefreshAt, Date.now(), doc.visibilityState === 'visible')) void this.refresh();
    };
    win.addEventListener('focus', maybeRefresh);
    doc.addEventListener('visibilitychange', maybeRefresh);
    const timer = win.setInterval(maybeRefresh, QUEUE_INTERVAL_MS);
    maybeRefresh();
    return () => {
      win.removeEventListener('focus', maybeRefresh);
      doc.removeEventListener('visibilitychange', maybeRefresh);
      win.clearInterval(timer);
    };
  }

  dismiss(item: AppNotification): void {
    this.dismissed.update((set) => {
      const next = new Set(set);
      next.add(key(item));
      return next;
    });
    this.store();
  }

  /** Show everything again. */
  clearDismissed(): void {
    this.dismissed.set(new Set());
    this.store();
  }

  private store(): void {
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...this.dismissed()]));
    } catch {
      /* private mode: then it only lasts this session */
    }
  }

  private restore(): Set<string> {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }
}

/**
 * Key of a notification.
 *
 * The detail text is part of it so a notification returns once it says
 * something new: "opened 2×" and "opened 5×" are not the same message, and
 * whoever dismissed the first does want to see the second.
 */
function key(item: AppNotification): string {
  /* These have no order: their own id. A melding's id carries its revision ("partner-sale:12:<editToken>"), so an
     edited melding comes back after a dismiss; a partner-made customer is "partner-customer:<id>". */
  if (ownBucket(item) && item.notificationId)
    return `${item.kind}|${item.notificationId}|${item.detail ?? ''}`;
  return `${item.kind}|${item.orderNumber}|${item.detail ?? ''}`;
}

/** Kinds with a bell section of their own: never in "Wij zijn aan zet" or "Van de klant". */
function ownBucket(item: AppNotification): boolean {
  return item.kind === 'CONTAINER_AANKOMST' || item.kind === 'PARTNER_VERKOOP' || item.kind === 'PARTNER_KLANT';
}
