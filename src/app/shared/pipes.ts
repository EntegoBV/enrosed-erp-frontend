/** Opmaak in Belgisch Nederlands: punt als duizendtal, komma als decimaal. */

import { Pipe, PipeTransform } from '@angular/core';
import { Currency } from '../core/api/models';

const LOCALE = 'nl-BE';

const money = (value: number, currency: string, decimals: number, locale = LOCALE): string =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value) || 0);

/** Bedragen in euro, standaard op 2 decimalen. */
@Pipe({ name: 'eur' })
export class EurPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 2, locale = LOCALE): string {
    return money(value ?? 0, 'EUR', decimals, locale);
  }
}

/** Bedragen in willekeurige munt — inkoopprijzen staan in USD of CNY. */
@Pipe({ name: 'cur' })
export class CurPipe implements PipeTransform {
  transform(
    value: number | null | undefined,
    currency: Currency = 'EUR',
    decimals = 2,
    locale = LOCALE,
  ): string {
    return money(value ?? 0, currency, decimals, locale);
  }
}

@Pipe({ name: 'num' })
export class NumPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 0, locale = LOCALE): string {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(value) || 0);
  }
}

@Pipe({ name: 'pct' })
export class PctPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 1, locale = LOCALE): string {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(value) || 0) + ' %';
  }
}

@Pipe({ name: 'cbm' })
export class CbmPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 3, locale = LOCALE): string {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(value) || 0) + ' m³';
  }
}

/** Belgische datumnotatie: 25/05/2026. */
@Pipe({ name: 'dateNl' })
export class DateNlPipe implements PipeTransform {
  transform(value: string | null | undefined, locale = LOCALE): string {
    if (!value) return '—';
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const d = dateOnly
      ? new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]))
      : new Date(value);
    if (isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      ...(dateOnly ? { timeZone: 'UTC' } : {}),
    }).format(d);
  }
}

/** Date with time, for a history: 17/08/2026 14:32. */
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
 * Making an ISO week readable: 2026-W42 becomes "week 42 (12/10 - 18/10/2026)".
 *
 * The customer should not have to look up when week 42 falls, and
 * internally it prevents year-end misunderstandings.
 */
@Pipe({ name: 'weekNl' })
export class WeekNlPipe implements PipeTransform {
  transform(
    value: string | null | undefined,
    style: 'long' | 'short' = 'long',
    locale = LOCALE,
  ): string {
    const match = /^(\d{4})-W(\d{1,2})$/.exec((value ?? '').trim());
    if (!match) return value || '—';

    const year = +match[1];
    const number = +match[2];
    const weekWords: Record<string, string> = {
      nl: 'week', fr: 'semaine', en: 'week', de: 'Woche', es: 'semana',
      pl: 'tydzień', pt: 'semana', tr: 'hafta',
    };
    const word = weekWords[locale.toLowerCase().split('-')[0]] ?? 'week';
    if (style === 'short') return `${word} ${number}`;

    /* ISO-week 1 is de week met 4 januari erin. */
    const fourth = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(fourth);
    monday.setUTCDate(fourth.getUTCDate() - ((fourth.getUTCDay() + 6) % 7) + (number - 1) * 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const formatter = new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    });
    return `${word} ${number} (${formatter.format(monday)} – ${formatter.format(sunday)})`;
  }
}
