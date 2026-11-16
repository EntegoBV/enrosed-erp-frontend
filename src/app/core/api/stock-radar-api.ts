import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

/** One watched variant: "wit-256", "blauw-512", "ps5-pro". */
export interface StockRadarItem {
  key: string;
  /** The column head: "Wit 256 GB", "Blauw 512 GB", "PS5 Pro". */
  label: string;
  /** The maker's colour name ("Sterrenwit", "Nachthemel"), or null. */
  colour: string | null;
  product: string;
  /** Apple's part number, only for Apple products. */
  applePart: string | null;
  listPrice: number;
}

/** One shop the radar reads by itself. */
export interface StockRadarShop {
  key: string;
  name: string;
  shortName: string;
  kind: string;
}

/** One shop page for one item, as the backend last saw it. */
export interface StockRadarWatch {
  key: string;
  family: string;
  shop: string;
  item: string;
  url: string;
  orderUrl: string;
  /** How often this page is read: 60, or 60 per page for a shop whose pages take turns (Amazon: 240 for four pages). Coolblue: 60, its iPhone list holds all four. */
  rhythmSeconds: number;
  available: boolean | null;
  /** What the latest good read itself says (available waits a second read before "weer weg"). */
  readAvailable: boolean | null;
  inStock: boolean | null;
  statusText: string | null;
  deliveryBy: string | null;
  priceEur: number | null;
  /** Coolblue stores that had it at the last read, comma-separated. */
  places: string | null;
  checkedAt: string | null;
  /** The last read that gave an answer. */
  goodAt: string | null;
  changedAt: string | null;
  notifiedAt: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
  /** Failed reads in a row; a broken page says "Fout" from three on. */
  errorCount: number;
  /** The last failure was the shop saying no (Server Busy, 403, a robot check): calmer than a broken page. */
  refused: boolean;
  checkCount: number;
  lastPushStatus: number | null;
  lastMailStatus: number | null;
}

/** A shop that refuses automatic reads: a reason and a link, never asked. */
export interface StockRadarManualShop {
  key: string;
  family: string;
  name: string;
  reason: string;
  url: string;
}

/** One table on the screen: a product, its variants (columns), its shops (rows) and the shops that refuse. */
export interface StockRadarFamily {
  key: string;
  label: string;
  subtitle: string;
  items: StockRadarItem[];
  shops: StockRadarShop[];
  manual: StockRadarManualShop[];
}

export interface StockRadarFeed {
  enabled: boolean;
  pushEnabled: boolean;
  mailEnabled: boolean;
  notifyUser: string;
  mailTo: string;
  /** Extra addresses that get the radar's mails too (at most five), set on this screen; null when they could not be read. */
  extraMailTo: string[] | null;
  maxDeliveryDays: number;
  intervalSeconds: number;
  devices: number;
  lastTickAt: string | null;
  lastRoundAt: string | null;
  lastRoundMillis: number;
  now: string;
  families: StockRadarFamily[];
  watches: StockRadarWatch[];
}

/** What "Nu opnieuw proberen" did: pages asked now, and seconds until a page that waits its shop's turn comes (0 = none). */
export interface StockRadarCheck {
  started: number;
  queuedSeconds: number;
  feed: StockRadarFeed;
}

export interface StockRadarPushTest {
  devices: number;
  pushStatuses: number[];
  /** False while push is off for the whole ERP (test environment). */
  pushOn: boolean;
}

export interface StockRadarMailTest {
  /** The configured address's answer (Brevo status, 0 = local mailer or mock). */
  mailStatus: number;
  mailTo: string;
  detail: string | null;
  /** How many of all addresses got it. */
  sent: number;
  total: number;
  failed: string[];
  /** The mailer only logs (local, test): nothing left. */
  mock: boolean;
}

@Injectable({ providedIn: 'root' })
export class StockRadarApi {
  private readonly http = inject(HttpClient);

  feed(): Promise<StockRadarFeed> {
    return firstValueFrom(this.http.get<StockRadarFeed>(api('/api/stock-radar')));
  }

  /** One watch ("coolblue-be:blauw-256") or one shop ("coolblue-be"). */
  checkOne(key: string): Promise<StockRadarCheck> {
    return firstValueFrom(this.http.post<StockRadarCheck>(api(`/api/stock-radar/${encodeURIComponent(key)}/check`), {}));
  }

  /** Replaces the extra mail addresses; answers the feed with the list as saved. */
  setMailRecipients(emails: string[]): Promise<StockRadarFeed> {
    return firstValueFrom(this.http.put<StockRadarFeed>(api('/api/stock-radar/mail-recipients'), { emails }));
  }

  sendTestPush(): Promise<StockRadarPushTest> {
    return firstValueFrom(this.http.post<StockRadarPushTest>(api('/api/stock-radar/test-push'), {}));
  }

  sendTestMail(): Promise<StockRadarMailTest> {
    return firstValueFrom(this.http.post<StockRadarMailTest>(api('/api/stock-radar/test-mail'), {}));
  }
}
