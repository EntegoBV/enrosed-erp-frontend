import { Injectable, computed, effect, signal } from '@angular/core';

const STORAGE_KEY = 'enrosed.showPurchase';

/** Class on <html> that paints the app red while purchase figures are visible. */
const THEME_CLASS = 'theme-internal';

/**
 * Whether purchase figures (cost, margin) are visible.
 *
 * One switch that applies everywhere, not per screen: otherwise you hide them
 * on one page and they are back on the next.
 *
 * The default is **visible** — red theme. This is our own working tool, and
 * margins are what we work with all day. Double-tapping the logo hides them
 * and turns the whole app green: that is the customer-safe mode for when
 * someone is standing next to you at a fair. The colour is readable from the
 * other side of a booth, which an inverted logo never was.
 *
 * The state survives navigation and reloads via localStorage.
 */
@Injectable({ providedIn: 'root' })
export class Privacy {
  private readonly visible = signal<boolean>(this.restore());

  readonly showPurchase = computed(() => this.visible());

  constructor() {
    /* The class lives on <html>, not on the app component, so overlays that
       sit outside the component tree change colour too. */
    effect(() => {
      const on = this.visible();
      try {
        document.documentElement.classList.toggle(THEME_CLASS, on);
      } catch {
        /* No DOM (server-side render): nothing to paint. */
      }
    });
  }

  toggle(): void {
    this.set(!this.visible());
  }

  set(value: boolean): void {
    this.visible.set(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* Private browsing: the state then only lasts for this session. */
    }
  }

  private restore(): boolean {
    try {
      /* No stored preference means visible: red is the normal working mode,
         green is deliberately chosen when a customer can watch. */
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  }
}
