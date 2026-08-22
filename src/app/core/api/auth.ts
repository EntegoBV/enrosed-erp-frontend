import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

const STORAGE_KEY = 'enrosed.auth';
const USER_KEY = STORAGE_KEY + '.user';

/**
 * Login.
 *
 * The backend uses HTTP Basic, so the client keeps the key and attaches it
 * to every call. It lives in localStorage: you stay signed in across tabs,
 * reloads and restarts until you sign out yourself - a new tab asking for
 * the password again was the single most irritating thing in the app.
 * Tabs follow each other through the storage event: signing out in one
 * signs out all, signing in in one signs in all.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly credentials = signal<string | null>(this.restore(STORAGE_KEY));
  readonly username = signal<string | null>(this.restore(USER_KEY));

  readonly isLoggedIn = computed(() => this.credentials() !== null);

  constructor() {
    /* Older builds kept the key in sessionStorage; carry it over once so
       nobody has to sign in again because of the switch. */
    if (this.credentials() === null) {
      const legacy = this.restoreSession(STORAGE_KEY);
      if (legacy) {
        this.persist(legacy, this.restoreSession(USER_KEY) ?? '');
        this.credentials.set(legacy);
        this.username.set(this.restoreSession(USER_KEY));
      }
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch {
      /* Storage may be unavailable; nothing to clean then. */
    }

    const onStorage = (event: StorageEvent): void => {
      if (event.key !== STORAGE_KEY && event.key !== USER_KEY && event.key !== null) return;
      const wasLoggedIn = this.isLoggedIn();
      this.credentials.set(this.restore(STORAGE_KEY));
      this.username.set(this.restore(USER_KEY));
      /* Signed out in another tab: this one goes to the login page too,
         instead of sitting on a screen whose next call would fail. */
      if (wasLoggedIn && !this.isLoggedIn()) void this.router.navigate(['/login']);
    };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', onStorage));
  }

  /** Value for the Authorization header, or null while nobody is signed in. */
  header(): string | null {
    const value = this.credentials();
    return value === null ? null : 'Basic ' + value;
  }

  /**
   * Attempts to sign in. Credentials are only stored after the server
   * approves them, so a wrong key never sticks around.
   */
  async login(username: string, password: string): Promise<void> {
    const encoded = btoa(`${username}:${password}`);
    await firstValueFrom(
      this.http.get(api('/api/auth/me'), {
        headers: { Authorization: 'Basic ' + encoded },
      }),
    );
    this.persist(encoded, username);
    this.credentials.set(encoded);
    this.username.set(username);
  }

  logout(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* Nothing stored, nothing to remove. */
    }
    this.credentials.set(null);
    this.username.set(null);
  }

  private persist(encoded: string, username: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, encoded);
      localStorage.setItem(USER_KEY, username);
    } catch {
      /* Private mode without storage: the session then lasts this page. */
    }
  }

  private restore(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private restoreSession(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
}
