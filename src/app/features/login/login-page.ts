import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import type { HostPageInput } from '../../core/platform/host-bridge';
import { HostPage } from '../../shared/host-page';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth, isPartnerUser } from '../../core/api/auth';
import { HostBridge } from '../../core/platform/host-bridge';
import { Icon } from '../../shared/icon';
import {
  forgetLastPartner, partnerUsername, readLastAccount, readLastPartner, rememberLastAccount, rememberLastPartner,
} from './last-account';

/** localStorage, or null where the browser blocks it. */
function deviceStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** A path inside the partner portal (where a partner may return to; staff never). */
function isPartnerPath(url: string): boolean {
  return url === '/partner' || url.startsWith('/partner/') || url.startsWith('/partner?');
}

/**
 * Aanmeldscherm voor de twee vaste Enrosed-medewerkers, en in partnermodus
 * voor het partnerportaal (Verhoeven): gebruikersnaam en wachtwoord. Partner
 * mode opens with ?partner=1 or when this device's last sign-in was a partner;
 * the native iOS app never offers it.
 */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, HostPage],
  template: `
    <main class="login" [hostPage]="hostPage">
      <picture class="login__art" aria-hidden="true">
        <source media="(max-width: 679px)" srcset="login/enrosed-login-mobile.webp" />
        <img src="login/enrosed-login-desktop.webp" alt="" fetchpriority="high" />
      </picture>
      <div class="login__shade" aria-hidden="true"></div>

      <form class="login__card" (ngSubmit)="submit()" [attr.aria-busy]="busy()">
        @if (partnerMode()) {
          <header class="login__head">
            <img class="login__logo" src="logo-ui.png" alt="Enrosed" />
            <span class="login__eyebrow">Enrosed</span>
            <h1>Partnerportaal</h1>
            <p>Meld je aan met je gebruikersnaam en wachtwoord.</p>
          </header>

          <div class="field">
            <label for="partner-username">Gebruikersnaam</label>
            <input #partnerField class="input" id="partner-username" name="partner-username" type="text"
                   autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required
                   [attr.aria-invalid]="submitted() && !partnerName().trim() ? 'true' : null"
                   [ngModel]="partnerName()" (ngModelChange)="partnerName.set($event)" />
          </div>
        } @else {
          <header class="login__head">
            <img class="login__logo" src="logo-ui.png" alt="Enrosed" />
            <span class="login__eyebrow">Sales &amp; Sourcing</span>
            <h1>Welkom terug</h1>
            <p>Kies je account en ga verder in de Enrosed-werkruimte.</p>
          </header>

          <div class="field">
            <label for="username">Account</label>
            <div class="login__select-wrap">
              @if (username()) {
                <span class="login__avatar" aria-hidden="true">{{ username() === 'emre' ? 'E' : 'B' }}</span>
              } @else {
                <span class="login__avatar login__avatar--empty" aria-hidden="true">•</span>
              }
              <select #accountField class="select login__select" id="username" name="username"
                      autocomplete="username" required
                      [attr.aria-invalid]="submitted() && !username() ? 'true' : null"
                      [ngModel]="username()" (ngModelChange)="pickAccount($event)">
                <option value="" disabled>Kies Emre of Berat</option>
                <option value="emre">Emre</option>
                <option value="berat">Berat</option>
                @if (!host.present) { <option value="partner">Partner…</option> }
              </select>
            </div>
          </div>
        }

        <div class="field">
          <label for="password">Wachtwoord</label>
          <div class="login__password">
            <input #passwordField class="input" id="password" name="password" [type]="showPassword() ? 'text' : 'password'"
                   autocomplete="current-password" required
                   [attr.aria-invalid]="error() ? 'true' : null"
                   [attr.aria-describedby]="error() ? 'login-error' : null"
                   [ngModel]="password()" (ngModelChange)="password.set($event)" />
            <!-- Shows what was typed; the focus stays in the field. -->
            <button class="login__eye" type="button" (mousedown)="$event.preventDefault()" (click)="togglePassword()"
                    [attr.aria-label]="showPassword() ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'"
                    [attr.aria-pressed]="showPassword()" aria-controls="password">
              <app-icon name="eye" [size]="20" />
            </button>
          </div>
        </div>

        @if (error()) {
          <div class="alert alert--danger login__error" id="login-error"
               role="alert" aria-live="assertive">
            <span class="alert__icon" aria-hidden="true">!</span>
            <div>{{ error() }}</div>
          </div>
        }

        <button class="btn btn--primary btn--block login__submit" type="submit" [disabled]="busy()">
          @if (busy()) { <span class="login__spinner" aria-hidden="true"></span> }
          {{ busy() ? 'Aanmelden…' : 'Aanmelden' }}
        </button>

        @if (partnerMode()) {
          <button class="login__other" type="button" (click)="otherAccount()">Ander account</button>
        } @else {
          <p class="login__private"><span aria-hidden="true">●</span> Privé werkruimte voor Emre en Berat</p>
        }
      </form>
    </main>
  `,
  styles: `
    :host{display:block;min-height:100dvh}.login{position:relative;display:flex;min-height:100dvh;align-items:center;justify-content:flex-start;padding:42px clamp(34px,8vw,132px);overflow:hidden;background:#1c1511}.login__art,.login__shade{position:absolute;inset:0}.login__art img{width:100%;height:100%;object-fit:cover;object-position:center}.login__shade{background:linear-gradient(90deg,rgb(20 13 10/.86) 0%,rgb(20 13 10/.42) 43%,rgb(20 13 10/.05) 72%),linear-gradient(180deg,rgb(0 0 0/.05),rgb(0 0 0/.28))}.login__card{position:relative;z-index:1;width:min(100%,420px);padding:34px 34px 27px;border:1px solid rgb(255 255 255/.55);border-radius:26px;background:rgb(255 252 249/.96);box-shadow:0 30px 80px rgb(0 0 0/.4);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.login__head{margin-bottom:24px}.login__logo{width:auto;height:27px;max-width:210px;margin-bottom:15px;object-fit:contain}.login__eyebrow{display:block;margin-bottom:4px;color:#8b3a43;font-size:9.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.login__head h1{font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:500;line-height:1.12;letter-spacing:-.02em}.login__head p{max-width:330px;margin-top:7px;color:var(--muted);font-size:12.5px;line-height:1.45}.login .field{margin-bottom:14px}.login .field label{font-size:12px}.login__select-wrap{position:relative}.login__avatar{position:absolute;z-index:1;top:50%;left:9px;display:grid;width:28px;height:28px;place-items:center;transform:translateY(-50%);border-radius:9px;background:var(--rose-soft);color:var(--rose-dark);font-size:11px;font-weight:800;pointer-events:none}.login__avatar--empty{color:var(--muted-2)}.login__select{padding-left:45px;font-weight:650}.login__error{margin:2px 0 14px;font-size:12px;line-height:1.4}.login__submit{min-height:48px;margin-top:3px;gap:8px}.login__spinner{width:15px;height:15px;border:2px solid rgb(255 255 255/.4);border-top-color:#fff;border-radius:50%;animation:login-spin .7s linear infinite}.login__private{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:16px;color:var(--muted);font-size:10.5px}.login__private span{color:#5c8d6d;font-size:7px}@keyframes login-spin{to{transform:rotate(360deg)}}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {:host{background:#17110e}.login{min-height:100dvh;align-items:flex-end;justify-content:center;padding:clamp(190px,39vh,320px) 12px calc(12px + env(safe-area-inset-bottom,0px));overflow:visible}.login__art img{object-position:center top}.login__shade{background:linear-gradient(180deg,rgb(15 10 8/.03) 0%,rgb(15 10 8/.05) 34%,rgb(15 10 8/.78) 67%,rgb(15 10 8/.96) 100%)}.login__card{width:100%;max-width:430px;padding:25px 20px 20px;border-radius:24px;background:rgb(255 252 249/.97);box-shadow:0 20px 55px rgb(0 0 0/.42)}.login__head{margin-bottom:19px}.login__logo{height:23px;margin-bottom:11px}.login__head h1{font-size:25px}.login__head p{margin-top:5px;font-size:11.5px}.login .field{margin-bottom:11px}.login__private{margin-top:13px}}
    .login__password{position:relative}.login__password .input{padding-right:48px}.login__eye{position:absolute;top:50%;right:2px;display:grid;width:44px;height:44px;place-items:center;padding:0;border:0;border-radius:10px;background:transparent;color:var(--muted);cursor:pointer;transform:translateY(-50%)}.login__eye:hover{color:var(--ink)}.login__eye[aria-pressed=true]{color:var(--rose)}.login__eye:focus-visible{outline:2px solid var(--rose);outline-offset:-2px}
    @media (max-width: 679.98px) and (max-height: 700px), (hover: none) and (max-width: 1023.98px) and (max-height: 700px) {.login{padding-top:clamp(120px,24vh,190px)}}
    @media (max-width: 679.98px) and (max-height: 650px), (hover: none) and (max-width: 1023.98px) and (max-height: 650px) {.login{align-items:flex-start;padding-top:145px}.login__card{padding-block:21px 17px}.login__head p{display:none}.login__head{margin-bottom:14px}.login__logo{margin-bottom:8px}.login__head h1{font-size:23px}}
    @media (min-width: 1024px) and (max-height: 650px), (min-width: 680px) and (hover: hover) and (max-height: 650px) {.login{align-items:flex-start;padding-block:24px}.login__card{padding-block:25px 21px}.login__head{margin-bottom:17px}.login__logo{margin-bottom:9px}.login__head p{margin-top:4px}}
    @media(prefers-reduced-motion:reduce){.login__spinner{animation-duration:1.4s}}
    .login__other{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;margin-top:8px;padding:0;border:0;background:none;color:var(--muted);font:inherit;font-size:12.5px;font-weight:600;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.login__other:hover{color:var(--ink)}
  `,
})
export class LoginPage {
  /** The native host draws no bars here: the dark artwork wants light status text, and the tab bar waits for the sign-in. */
  readonly hostPage: HostPageInput = { title: 'Aanmelden', chrome: false, tabBar: 'hidden', statusBar: 'light' };
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly host = inject(HostBridge);

  /** The account that signed in last on this device, preselected (only the name is kept). */
  readonly username = signal<'emre' | 'berat' | ''>(readLastAccount(deviceStore()));
  /** The partner who signed in last on this device: the login opens in partner mode with the name filled in. */
  private readonly lastPartner = this.host.present ? '' : readLastPartner(deviceStore());
  readonly partnerMode = signal(!this.host.present
    && (this.route.snapshot.queryParamMap.get('partner') === '1' || this.lastPartner !== ''));
  readonly partnerName = signal(this.lastPartner);
  readonly showPassword = signal(false);
  private readonly accountField = viewChild<ElementRef<HTMLSelectElement>>('accountField');
  private readonly partnerField = viewChild<ElementRef<HTMLInputElement>>('partnerField');
  private readonly passwordField = viewChild<ElementRef<HTMLInputElement>>('passwordField');

  constructor() {
    /* Straight to the password when the account is known; otherwise the account first. */
    afterNextRender(() => {
      const field = this.partnerMode()
        ? (this.partnerName() ? this.passwordField() : this.partnerField())
        : (this.username() ? this.passwordField() : this.accountField());
      field?.nativeElement.focus({ preventScroll: true });
    });
  }

  /** The account select; its last option "Partner…" switches to partner mode. */
  pickAccount(value: string): void {
    if (value === 'partner') {
      const select = this.accountField()?.nativeElement;
      if (select) select.value = this.username();
      this.error.set('');
      this.submitted.set(false);
      this.partnerName.set('');
      this.partnerMode.set(true);
      setTimeout(() => this.partnerField()?.nativeElement.focus({ preventScroll: true }));
      return;
    }
    this.username.set(value === 'emre' || value === 'berat' ? value : '');
  }

  /** "Ander account": back to the staff form; this device no longer opens in partner mode. */
  otherAccount(): void {
    forgetLastPartner(deviceStore());
    this.error.set('');
    this.submitted.set(false);
    this.partnerMode.set(false);
    if (this.route.snapshot.queryParamMap.get('partner') !== null) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { partner: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    setTimeout(() => this.accountField()?.nativeElement.focus({ preventScroll: true }));
  }

  togglePassword(): void {
    this.showPassword.update((shown) => !shown);
    this.passwordField()?.nativeElement.focus({ preventScroll: true });
  }
  readonly password = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly submitted = signal(false);

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.submitted.set(true);
    const partner = this.partnerMode();
    const name = partner ? partnerUsername(this.partnerName()) : this.username();
    if (!name || !this.password()) {
      this.error.set(partner ? 'Vul je gebruikersnaam en wachtwoord in.' : 'Kies je account en vul je wachtwoord in.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    try {
      const user = await this.auth.login(name, this.password());
      const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
      let target: string;
      if (isPartnerUser(user)) {
        /* A partner only ever returns into the portal. */
        rememberLastPartner(deviceStore(), user.username);
        target = returnTo && isPartnerPath(returnTo) ? returnTo : '/partner';
      } else {
        forgetLastPartner(deviceStore());
        rememberLastAccount(deviceStore(), user.username);
        target = returnTo && !isPartnerPath(returnTo) ? returnTo : '/dashboard';
      }
      /* The screen takes the login form's place in the history: back never shows the form to a signed-in user. */
      await this.router.navigateByUrl(target, { replaceUrl: true });
    } catch (failure: unknown) {
      const status = (failure as { status?: number }).status;
      this.error.set(status === 401
        ? (partner ? 'Gebruikersnaam of wachtwoord klopt niet.' : 'Account of wachtwoord klopt niet.')
        : status === 0
          ? 'Geen verbinding met Enrosed. Controleer je internetverbinding en probeer opnieuw.'
          : 'Aanmelden lukt momenteel niet. Probeer het straks opnieuw.');
    } finally {
      this.busy.set(false);
    }
  }
}
