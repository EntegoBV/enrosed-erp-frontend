/** Monday-through-Friday arithmetic for automatic ERP planning. */
export function addBusinessDays(start: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError('Werkdagen moeten een positief geheel getal zijn');
  }

  const result = atLocalMidnight(start);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result)) remaining--;
  }
  return result;
}

/** Keeps weekdays unchanged and moves Saturday/Sunday to Monday. */
export function onOrNextBusinessDay(date: Date): Date {
  const result = atLocalMidnight(date);
  while (!isBusinessDay(result)) result.setDate(result.getDate() + 1);
  return result;
}

/** Planner shortcut: zero means today-or-Monday; positive values are working days ahead. */
export function plannedBusinessDay(now: Date, days: number): Date {
  return days === 0 ? onOrNextBusinessDay(now) : addBusinessDays(now, days);
}

export function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function atLocalMidnight(date: Date): Date {
  if (Number.isNaN(date.getTime())) throw new RangeError('Ongeldige datum');
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
