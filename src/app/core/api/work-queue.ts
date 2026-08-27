import { Injectable, computed, inject, signal } from '@angular/core';
import { SalesApi } from './sales-api';
import { AppNotification } from './models';
import { messageOf } from './errors';

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

  readonly items = signal<AppNotification[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private readonly dismissed = signal<Set<string>>(this.restore());
  private refreshVersion = 0;

  /** Everything not dismissed. */
  readonly visible = computed(() =>
    this.items().filter((item) => !this.dismissed().has(key(item))));

  /** What we must act on; that is the number on the tab and the bell. */
  readonly actionCount = computed(() =>
    this.visible().filter((item) => item.actionNeeded).length);

  readonly actions = computed(() => this.visible().filter((item) => item.actionNeeded));
  readonly news = computed(() => this.visible().filter((item) => !item.actionNeeded));

  async refresh(): Promise<void> {
    const version = ++this.refreshVersion;
    this.loading.set(true);
    this.error.set(null);
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
  return `${item.kind}|${item.orderNumber}|${item.detail ?? ''}`;
}
