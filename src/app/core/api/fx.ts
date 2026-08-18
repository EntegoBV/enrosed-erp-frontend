import { Injectable, signal } from '@angular/core';

/**
 * Daily exchange rates, straight from the browser.
 *
 * Frankfurter serves the ECB reference rates - free, no key, CORS open.
 * They refresh once per working day around 16:00 CET, which is exactly the
 * cadence purchasing decisions run on. When the call fails (offline stand,
 * API down) the dashboard simply hides the card: stale-but-labeled beats
 * wrong, absent beats stale.
 */
export interface FxSeries {
  /** Oldest to newest, roughly the past month of working days. */
  usd: number[];
  cny: number[];
  latestUsd: number;
  latestCny: number;
  /** Percentage change over the window; positive = euro buys more. */
  usdChangePct: number;
  cnyChangePct: number;
  asOf: string;
}

@Injectable({ providedIn: 'root' })
export class Fx {
  readonly series = signal<FxSeries | null>(null);
  readonly failed = signal(false);

  async load(): Promise<void> {
    try {
      const from = new Date();
      from.setDate(from.getDate() - 31);
      const start = from.toISOString().slice(0, 10);
      const response = await fetch(
        `https://api.frankfurter.dev/v1/${start}..?base=EUR&symbols=USD,CNY`);
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json() as
          { rates: Record<string, { USD: number; CNY: number }> };
      const days = Object.keys(data.rates).sort();
      if (days.length < 2) throw new Error('empty');
      const usd = days.map((day) => data.rates[day].USD);
      const cny = days.map((day) => data.rates[day].CNY);
      this.series.set({
        usd, cny,
        latestUsd: usd[usd.length - 1],
        latestCny: cny[cny.length - 1],
        usdChangePct: ((usd[usd.length - 1] - usd[0]) / usd[0]) * 100,
        cnyChangePct: ((cny[cny.length - 1] - cny[0]) / cny[0]) * 100,
        asOf: days[days.length - 1],
      });
    } catch {
      this.failed.set(true);
    }
  }
}
