/** TICA days and wall-clock sales times use Brussels, independent of the viewing device. */
export function ticaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function validTicaDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function ticaRangeError(from: string, to: string): string | null {
  if (!validTicaDay(from) || !validTicaDay(to)) return 'Vul een geldige begin- en einddatum in.';
  if (from > to) return 'De begindatum moet op of vóór de einddatum liggen.';
  const days = (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000 + 1;
  return days > 366 ? 'Kies een periode van maximaal 366 dagen.' : null;
}

export function ticaPreset(preset: 'today' | 'week' | 'month', today = ticaToday()): { from: string; to: string } {
  const date = new Date(today + 'T12:00:00Z');
  if (preset === 'week') date.setUTCDate(date.getUTCDate() - 6);
  if (preset === 'month') date.setUTCDate(1);
  return { from: date.toISOString().slice(0, 10), to: today };
}

export function ticaDate(value: string): string {
  return validTicaDay(value) ? value.split('-').reverse().join('-') : '—';
}

export function ticaMoment(value: string | null): string {
  if (!value) return 'Nog niet opgehaald';
  // The portal's LocalDateTime is already a Brussels wall-clock time. Do not
  // interpret it in the browser's timezone; instants have an explicit offset.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) {
    return `${ticaDate(value.slice(0, 10))} · ${value.slice(11, 16)}`;
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return 'Onbekend tijdstip';
  return new Intl.DateTimeFormat('nl-BE', {
    timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(instant);
}
