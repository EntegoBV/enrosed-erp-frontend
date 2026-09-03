import { Injectable, effect, signal } from '@angular/core';

const STORAGE_KEY = 'enrosed.theme';
const DEFAULT_THEME = 'green';

/** One accent palette; the rest of the app's colours stay the same. */
export interface ThemeOption {
  key: string;
  label: string;
  /** The main accent, shown as the swatch. */
  swatch: string;
}

export const THEMES: readonly ThemeOption[] = [
  { key: 'green', label: 'Groen', swatch: '#1f7a4d' },
  { key: 'brown', label: 'Bruin', swatch: '#5d4037' },
  { key: 'blue', label: 'Blauw', swatch: '#1f5e9e' },
  { key: 'plum', label: 'Paars', swatch: '#6f3c8f' },
  { key: 'terracotta', label: 'Terracotta', swatch: '#b8552e' },
  { key: 'rose', label: 'Rozerood', swatch: '#b01f3f' },
];

/**
 * The accent colour of the whole app, chosen under Instellingen.
 *
 * A class on <html> carries the palette (see styles.scss), so sheets and
 * toasts outside the component tree colour along. Green is the default;
 * the choice survives reloads through localStorage.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  readonly current = signal<string>(this.restore());

  constructor() {
    effect(() => {
      const key = this.current();
      try {
        const root = document.documentElement;
        for (const theme of THEMES) root.classList.toggle(`theme-${theme.key}`, theme.key === key && key !== DEFAULT_THEME);
      } catch {
        /* No DOM: nothing to paint. */
      }
    });
  }

  set(key: string): void {
    if (!THEMES.some((theme) => theme.key === key)) return;
    this.current.set(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* Private browsing: the choice then lasts for this session. */
    }
  }

  private restore(): string {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored && THEMES.some((theme) => theme.key === stored) ? stored : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }
}
