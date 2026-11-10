import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import { AuthSession, CurrentUser } from './models';

const STORAGE_KEY = 'enrosed.auth';
const USER_KEY = STORAGE_KEY + '.user';
const CREDENTIAL_KIND_KEY = STORAGE_KEY + '.kind';
const SESSION_EXPIRY_KEY = STORAGE_KEY + '.expiresAt';
const SESSION_CREDENTIAL_KIND = 'session-v1';

/** A partner (Verhoeven) login: the role 'partner' without 'admin'. Staff accounts always carry 'admin'. */
export function isPartnerUser(user: CurrentUser | null | undefined): boolean {
  return !!user && user.roles.includes('partner') && !user.roles.includes('admin');
}

/**
 * Login.
 *
 * The backend uses HTTP Basic as the transport, but the password is used only
 * once to obtain a signed, expiring session token. Only username + token are
 * kept in localStorage: you stay signed in across tabs, reloads and restarts
 * until you sign out or the token expires.
 * Tabs follow each other through the storage event: signing out in one
 * signs out all, signing in in one signs in all.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly credentials = signal<string | null>(this.restore(STORAGE_KEY));
  readonly user = signal<CurrentUser | null>(this.restoreUser());
  /** Display name kept under the old property name so existing chrome stays compatible. */
  readonly username = computed(() => this.user()?.displayName ?? null);

  readonly isLoggedIn = computed(() => this.credentials() !== null);
  /**
   * Signed in as a partner: the partner portal (/partner) instead of the staff
   * screens. False while only the credential is known and the identity is not
   * (the guards ask currentUser() first).
   */
  readonly isPartner = computed(() => isPartnerUser(this.user()));
  /** The one identity check under way, shared by the start, a storage event and the guards. */
  private resuming: Promise<void> | null = null;

  constructor() {
    /* Older builds kept the key in sessionStorage; carry it over once so
       nobody has to sign in again because of the switch. */
    if (this.credentials() === null) {
      const legacy = this.restoreSession(STORAGE_KEY);
      if (legacy) {
        this.persistCredentials(legacy);
        this.credentials.set(legacy);
      }
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch {
      /* Storage may be unavailable; nothing to clean then. */
    }

    const onStorage = (event: StorageEvent): void => {
      if (event.key !== STORAGE_KEY && event.key !== USER_KEY
          && event.key !== CREDENTIAL_KIND_KEY && event.key !== SESSION_EXPIRY_KEY
          && event.key !== null) return;
      this.recheckSession();
    };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', onStorage));

    /* Older builds persisted username:password. Verify that credential once,
       exchange it for a signed session token, then replace it in-place. */
    if (this.isLoggedIn()) queueMicrotask(() => void this.resume());
  }

  /**
   * Re-reads the shared storage: another tab's storage event, or the native
   * host's `sessionCheck` after one of its web views signed in or out (the
   * storage event may not cross WKWebViews).
   */
  recheckSession(): void {
    const wasLoggedIn = this.isLoggedIn();
    const wasPartner = this.isPartner();
    this.credentials.set(this.restore(STORAGE_KEY));
    this.user.set(this.restoreUser());
    /* Signed out in another tab: this one goes to the login page too,
       instead of sitting on a screen whose next call would fail. */
    if (wasLoggedIn && !this.isLoggedIn()) { void this.router.navigate(['/login']); return; }
    if (this.isLoggedIn() && !this.user()) {
      queueMicrotask(() => void this.resume().then(() => this.followRole(wasPartner)));
      return;
    }
    this.followRole(wasPartner);
  }

  /**
   * One browser holds one session: when another tab signed in with the other
   * kind of account (staff or partner), this tab leaves its screens, whose
   * every call would now be refused, for that account's home.
   */
  private followRole(wasPartner: boolean): void {
    if (!this.isLoggedIn() || !this.user() || this.isPartner() === wasPartner) return;
    void this.router.navigateByUrl(this.isPartner() ? '/partner' : '/dashboard', { replaceUrl: true });
  }

  /**
   * The signed-in user, asking the server first when only the credential is
   * stored (the guards never decide on a role that is not known yet). Null
   * when signed out; also null when the server could not be reached, and the
   * caller then lets the screen's own calls answer.
   */
  async currentUser(): Promise<CurrentUser | null> {
    if (!this.isLoggedIn()) return null;
    const known = this.user();
    if (known) return known;
    await this.resume();
    return this.isLoggedIn() ? this.user() : null;
  }

  private resume(): Promise<void> {
    if (!this.resuming) {
      const run = this.resumeAuthentication().finally(() => { if (this.resuming === run) this.resuming = null; });
      this.resuming = run;
    }
    return this.resuming;
  }

  /** Value for the Authorization header, or null while nobody is signed in. */
  header(): string | null {
    const value = this.credentials();
    return value === null ? null : 'Basic ' + value;
  }

  /** The stored credential's kind: 'session-v1' for a signed session token (read only; the native host's `session`). */
  credentialKind(): string | null {
    return this.restore(CREDENTIAL_KIND_KEY);
  }

  /** When the stored session token expires, an ISO instant (read only). */
  sessionExpiresAt(): string | null {
    return this.restore(SESSION_EXPIRY_KEY);
  }

  /**
   * Attempts to sign in. The raw password exists only in this request and is
   * never persisted: the successful response is exchanged for a session key.
   */
  async login(username: string, password: string): Promise<CurrentUser> {
    const passwordCredentials = this.encodeCredentials(username, password);
    const session = await firstValueFrom(
      this.http.post<AuthSession>(api('/api/auth/session'), null, {
        headers: { Authorization: 'Basic ' + passwordCredentials },
      }),
    );
    const user = this.userOf(session);
    const sessionCredentials = this.encodeCredentials(session.username, session.token);
    this.persistSession(sessionCredentials, session);
    this.credentials.set(sessionCredentials);
    this.user.set(user);
    return user;
  }

  logout(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(CREDENTIAL_KIND_KEY);
      localStorage.removeItem(SESSION_EXPIRY_KEY);
    } catch {
      /* Nothing stored, nothing to remove. */
    }
    this.credentials.set(null);
    this.user.set(null);
  }

  private persistSession(encoded: string, session: AuthSession): void {
    try {
      localStorage.setItem(STORAGE_KEY, encoded);
      localStorage.setItem(USER_KEY, JSON.stringify(this.userOf(session)));
      localStorage.setItem(CREDENTIAL_KIND_KEY, SESSION_CREDENTIAL_KIND);
      localStorage.setItem(SESSION_EXPIRY_KEY, session.expiresAt);
    } catch {
      /* Private mode without storage: the session then lasts this page. */
    }
  }

  private persistCredentials(encoded: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, encoded);
    } catch {
      /* Private mode without storage: the session then lasts this page. */
    }
  }

  private async resumeAuthentication(): Promise<void> {
    if (!this.isLoggedIn()) return;
    if (this.restore(CREDENTIAL_KIND_KEY) === SESSION_CREDENTIAL_KIND) {
      await this.refreshIdentity();
      return;
    }
    await this.exchangeLegacyCredentials();
  }

  private async exchangeLegacyCredentials(): Promise<void> {
    const encoded = this.credentials();
    if (!encoded) return;
    try {
      /* Confirm the old credential first. This also replaces the untrusted
         legacy display name with the server-owned identity. */
      const user = await firstValueFrom(this.http.get<CurrentUser>(api('/api/auth/me')));
      if (encoded !== this.credentials()) return;
      this.persistUser(user);
      this.user.set(user);

      const session = await firstValueFrom(
        this.http.post<AuthSession>(api('/api/auth/session'), null, {
          headers: { Authorization: 'Basic ' + encoded },
        }),
      );
      if (encoded !== this.credentials()) return;
      const sessionCredentials = this.encodeCredentials(session.username, session.token);
      this.persistSession(sessionCredentials, session);
      this.credentials.set(sessionCredentials);
      this.user.set(this.userOf(session));
    } catch (failure: unknown) {
      if ((failure as { status?: number }).status === 401) {
        this.logout();
        void this.router.navigate(['/login']);
      }
      /* A transient failure leaves the previously working credential alone.
         The next reload retries the one-time exchange. */
    }
  }

  private async refreshIdentity(): Promise<void> {
    try {
      const user = await firstValueFrom(this.http.get<CurrentUser>(api('/api/auth/me')));
      const encoded = this.credentials();
      if (!encoded) return;
      this.persistUser(user);
      this.user.set(user);
    } catch (failure: unknown) {
      if ((failure as { status?: number }).status === 401) {
        this.logout();
        void this.router.navigate(['/login']);
      }
    }
  }

  private persistUser(user: CurrentUser): void {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* Private mode without storage: the session then lasts this page. */
    }
  }

  private userOf(session: AuthSession): CurrentUser {
    return { username: session.username, displayName: session.displayName, roles: session.roles };
  }

  private encodeCredentials(username: string, secret: string): string {
    return btoa(`${username}:${secret}`);
  }

  private restoreUser(): CurrentUser | null {
    const stored = this.restore(USER_KEY);
    if (!stored) return null;
    try {
      const value = JSON.parse(stored) as Partial<CurrentUser>;
      if (typeof value.username !== 'string' || typeof value.displayName !== 'string'
          || !Array.isArray(value.roles)) return null;
      return { username: value.username, displayName: value.displayName,
        roles: value.roles.filter((role): role is string => typeof role === 'string') };
    } catch {
      return null;
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
