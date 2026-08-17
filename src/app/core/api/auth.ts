import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

const STORAGE_KEY = 'enrosed.auth';

/**
 * Aanmelding.
 *
 * De backend gebruikt HTTP Basic, dus de client bewaart de sleutel en zet hem
 * op elke oproep. Hij staat in sessionStorage en niet in localStorage: bij het
 * sluiten van het tabblad is de sessie voorbij, wat op een gedeelde
 * beurscomputer het verschil maakt.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);

  private readonly credentials = signal<string | null>(this.restore());
  readonly username = signal<string | null>(sessionStorage.getItem(STORAGE_KEY + '.user'));

  readonly isLoggedIn = computed(() => this.credentials() !== null);

  /** Waarde voor de Authorization-header, of null zolang er niemand aangemeld is. */
  header(): string | null {
    const value = this.credentials();
    return value === null ? null : 'Basic ' + value;
  }

  /**
   * Probeert aan te melden. De gegevens worden pas bewaard nadat de server ze
   * heeft goedgekeurd, zodat er nooit een verkeerde sleutel blijft plakken.
   */
  async login(username: string, password: string): Promise<void> {
    const encoded = btoa(`${username}:${password}`);
    await firstValueFrom(
      this.http.get(api('/api/auth/me'), {
        headers: { Authorization: 'Basic ' + encoded },
      }),
    );
    sessionStorage.setItem(STORAGE_KEY, encoded);
    sessionStorage.setItem(STORAGE_KEY + '.user', username);
    this.credentials.set(encoded);
    this.username.set(username);
  }

  logout(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY + '.user');
    this.credentials.set(null);
    this.username.set(null);
  }

  private restore(): string | null {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
