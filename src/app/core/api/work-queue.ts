import { Injectable, computed, inject, signal } from '@angular/core';
import { SalesApi } from './sales-api';
import { AppNotification } from './models';

const DISMISSED_KEY = 'enrosed.dismissedNotifications';

/**
 * Wat er op ons ligt te wachten, op één plaats.
 *
 * Het belletje rechtsboven, het bolletje op de tab Verkoop en de lijst bovenaan
 * de verkooporders tonen allemaal hetzelfde. Zonder gedeelde bron haalt elk van
 * die drie zijn eigen kopie op en lopen ze uit elkaar - dan staat er een 2 op de
 * tab terwijl de lijst er drie toont, en gelooft niemand het cijfer nog.
 *
 * Weggeklikte meldingen blijven lokaal bewaard. Dat is met opzet geen
 * serverinstelling: het is een persoonlijke "ik heb het gezien", niet iets wat
 * voor een collega ook moet gelden. Verandert de melding van inhoud, dan komt ze
 * terug - anders verstopt één klik een offerte die later opnieuw je aandacht
 * vraagt.
 */
@Injectable({ providedIn: 'root' })
export class WorkQueue {
  private readonly sales = inject(SalesApi);

  readonly items = signal<AppNotification[]>([]);
  private readonly dismissed = signal<Set<string>>(this.restore());

  /** Alles wat niet weggeklikt is. */
  readonly visible = computed(() =>
    this.items().filter((item) => !this.dismissed().has(key(item))));

  /** Wat wij moeten doen; dat is het cijfer op de tab en op het belletje. */
  readonly actionCount = computed(() =>
    this.visible().filter((item) => item.actionNeeded).length);

  readonly actions = computed(() => this.visible().filter((item) => item.actionNeeded));
  readonly news = computed(() => this.visible().filter((item) => !item.actionNeeded));

  async refresh(): Promise<void> {
    try {
      const feed = await this.sales.notifications();
      this.items.set(feed.items);
    } catch {
      /* Niet ingelogd of backend even weg: dan geen bolletje in plaats van een
         foutmelding over iets waar de gebruiker niets aan heeft. */
      this.items.set([]);
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

  /** Alles weer tonen. */
  clearDismissed(): void {
    this.dismissed.set(new Set());
    this.store();
  }

  private store(): void {
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...this.dismissed()]));
    } catch {
      /* privémodus: dan geldt het alleen voor deze sessie */
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
 * Sleutel van een melding.
 *
 * De detailtekst zit erin zodat een melding terugkomt zodra ze iets anders zegt:
 * "2× geopend" en "5× geopend" zijn niet hetzelfde bericht, en wie het eerste
 * weggeklikt heeft wil het tweede wel zien.
 */
function key(item: AppNotification): string {
  return `${item.kind}|${item.orderNumber}|${item.detail ?? ''}`;
}
