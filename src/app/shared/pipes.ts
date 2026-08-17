/** Opmaak in Belgisch Nederlands: punt als duizendtal, komma als decimaal. */

import { Pipe, PipeTransform } from '@angular/core';
import { Currency } from '../core/api/models';

const LOCALE = 'nl-BE';

const money = (value: number, currency: string, decimals: number): string =>
  new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value) || 0);

/** Bedragen in euro, standaard op 2 decimalen. */
@Pipe({ name: 'eur' })
export class EurPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 2): string {
    return money(value ?? 0, 'EUR', decimals);
  }
}

/** Bedragen in willekeurige munt — inkoopprijzen staan in USD of CNY. */
@Pipe({ name: 'cur' })
export class CurPipe implements PipeTransform {
  transform(value: number | null | undefined, currency: Currency = 'EUR', decimals = 2): string {
    return money(value ?? 0, currency, decimals);
  }
}

@Pipe({ name: 'num' })
export class NumPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 0): string {
    return new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(value) || 0);
  }
}

@Pipe({ name: 'pct' })
export class PctPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 1): string {
    return new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(value) || 0) + ' %';
  }
}

@Pipe({ name: 'cbm' })
export class CbmPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 3): string {
    return new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(value) || 0) + ' m³';
  }
}

/** Belgische datumnotatie: 25/05/2026. */
@Pipe({ name: 'dateNl' })
export class DateNlPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat(LOCALE, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  }
}

/** Datum met tijd, voor een geschiedenis: 17/08/2026 14:32. */
@Pipe({ name: 'dateTimeNl' })
export class DateTimeNlPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat(LOCALE, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  }
}

/**
 * ISO-week leesbaar maken: 2026-W42 wordt "week 42 (12/10 - 18/10/2026)".
 *
 * De klant moet niet zelf gaan opzoeken wanneer week 42 valt, en intern
 * voorkomt het misverstanden rond het jaareinde.
 */
@Pipe({ name: 'weekNl' })
export class WeekNlPipe implements PipeTransform {
  transform(value: string | null | undefined, style: 'long' | 'short' = 'long'): string {
    const match = /^(\d{4})-W(\d{1,2})$/.exec((value ?? '').trim());
    if (!match) return value || '—';

    const year = +match[1];
    const number = +match[2];
    if (style === 'short') return `week ${number}`;

    /* ISO-week 1 is de week met 4 januari erin. */
    const fourth = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(fourth);
    monday.setUTCDate(fourth.getUTCDate() - ((fourth.getUTCDay() + 6) % 7) + (number - 1) * 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const dm = (d: Date) =>
      `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return `week ${number} (${dm(monday)} - ${dm(sunday)}/${sunday.getUTCFullYear()})`;
  }
}

export const FORMAT_PIPES = [EurPipe, CurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe,
                             DateTimeNlPipe, WeekNlPipe] as const;
