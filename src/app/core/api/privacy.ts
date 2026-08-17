import { Injectable, computed, effect, signal } from '@angular/core';

const STORAGE_KEY = 'enrosed.showPurchase';

/** Klas op <html> die de app rozerood kleurt zodra de inkoopcijfers zichtbaar zijn. */
const THEME_CLASS = 'theme-internal';

/**
 * Of inkoopcijfers zichtbaar zijn.
 *
 * Kostprijs en marge horen niet op het scherm wanneer er een klant meekijkt —
 * op een beurs staat hij letterlijk naast je. Eén schakelaar die overal geldt,
 * niet per scherm: anders zet je hem op de ene pagina uit en staat hij op de
 * volgende weer aan.
 *
 * De stand blijft bewaard in localStorage zodat hij een navigatie of een
 * herlaadbeurt overleeft. Standaard staat hij **uit**: liever een keer te veel
 * moeten aanzetten dan een keer te veel getoond.
 *
 * Staat hij aan, dan wordt de hele app rozerood in plaats van groen. Dat is met
 * één blik van de andere kant van een beursstand te zien - duidelijker dan een
 * omgekeerd logo, en je hoeft er niet voor op het scherm te turen. Rood is hier
 * een waarschuwing dat er cijfers staan die niemand hoort te zien.
 */
@Injectable({ providedIn: 'root' })
export class Privacy {
  private readonly visible = signal<boolean>(this.restore());

  readonly showPurchase = computed(() => this.visible());

  constructor() {
    /* De klas staat op <html> en niet op de app zelf, zodat ook overlays en
       vensters die buiten de component-boom hangen meekleuren. */
    effect(() => {
      const on = this.visible();
      try {
        document.documentElement.classList.toggle(THEME_CLASS, on);
      } catch {
        /* geen DOM (server-side render): dan valt er niets te kleuren */
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
      /* privémodus: dan geldt de stand alleen voor deze sessie */
    }
  }

  private restore(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }
}
