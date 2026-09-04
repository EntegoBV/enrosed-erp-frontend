/** The small sums behind the website report's headline cards. Pure, so the tests can read them. */
export interface Delta {
  pct: number;
  direction: 'up' | 'down' | 'flat';
}

/** Up or down against the period before; null when there is nothing to compare with. */
export function deltaOf(current: number, previous: number): Delta | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

/** "1 min 20 s", "45 s"; a dash when nothing was measured. */
export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}
