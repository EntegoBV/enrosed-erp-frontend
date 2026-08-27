import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../core/api/auth';

/** Aanmeldscherm voor de twee vaste Enrosed-medewerkers. */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <main class="login">
      <picture class="login__art" aria-hidden="true">
        <source media="(max-width: 679px)" srcset="login/enrosed-login-mobile.webp" />
        <img src="login/enrosed-login-desktop.webp" alt="" fetchpriority="high" />
      </picture>
      <div class="login__shade" aria-hidden="true"></div>

      <form class="login__card" (ngSubmit)="submit()" [attr.aria-busy]="busy()">
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
            <select class="select login__select" id="username" name="username"
                    autocomplete="username" required
                    [attr.aria-invalid]="submitted() && !username() ? 'true' : null"
                    [ngModel]="username()" (ngModelChange)="username.set($event)">
              <option value="" disabled>Kies Emre of Berat</option>
              <option value="emre">Emre</option>
              <option value="berat">Berat</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label for="password">Wachtwoord</label>
          <input class="input" id="password" name="password" type="password"
                 autocomplete="current-password" required
                 [attr.aria-invalid]="error() ? 'true' : null"
                 [attr.aria-describedby]="error() ? 'login-error' : null"
                 [ngModel]="password()" (ngModelChange)="password.set($event)" />
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

        <p class="login__private"><span aria-hidden="true">●</span> Privé werkruimte voor Emre en Berat</p>
      </form>
    </main>
  `,
  styles: `
    :host{display:block;min-height:100dvh}.login{position:relative;display:flex;min-height:100dvh;align-items:center;justify-content:flex-start;padding:42px clamp(34px,8vw,132px);overflow:hidden;background:#1c1511}.login__art,.login__shade{position:absolute;inset:0}.login__art img{width:100%;height:100%;object-fit:cover;object-position:center}.login__shade{background:linear-gradient(90deg,rgb(20 13 10/.86) 0%,rgb(20 13 10/.42) 43%,rgb(20 13 10/.05) 72%),linear-gradient(180deg,rgb(0 0 0/.05),rgb(0 0 0/.28))}.login__card{position:relative;z-index:1;width:min(100%,420px);padding:34px 34px 27px;border:1px solid rgb(255 255 255/.55);border-radius:26px;background:rgb(255 252 249/.96);box-shadow:0 30px 80px rgb(0 0 0/.4);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.login__head{margin-bottom:24px}.login__logo{width:auto;height:27px;max-width:210px;margin-bottom:15px;object-fit:contain}.login__eyebrow{display:block;margin-bottom:4px;color:#8b3a43;font-size:9.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.login__head h1{font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:500;line-height:1.12;letter-spacing:-.02em}.login__head p{max-width:330px;margin-top:7px;color:var(--muted);font-size:12.5px;line-height:1.45}.login .field{margin-bottom:14px}.login .field label{font-size:12px}.login__select-wrap{position:relative}.login__avatar{position:absolute;z-index:1;top:50%;left:9px;display:grid;width:28px;height:28px;place-items:center;transform:translateY(-50%);border-radius:9px;background:var(--rose-soft);color:var(--rose-dark);font-size:11px;font-weight:800;pointer-events:none}.login__avatar--empty{color:var(--muted-2)}.login__select{padding-left:45px;font-weight:650}.login__error{margin:2px 0 14px;font-size:12px;line-height:1.4}.login__submit{min-height:48px;margin-top:3px;gap:8px}.login__spinner{width:15px;height:15px;border:2px solid rgb(255 255 255/.4);border-top-color:#fff;border-radius:50%;animation:login-spin .7s linear infinite}.login__private{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:16px;color:var(--muted);font-size:10.5px}.login__private span{color:#5c8d6d;font-size:7px}@keyframes login-spin{to{transform:rotate(360deg)}}
    @media(max-width:679px){:host{background:#17110e}.login{min-height:100dvh;align-items:flex-end;justify-content:center;padding:clamp(190px,39vh,320px) 12px calc(12px + env(safe-area-inset-bottom,0px));overflow:visible}.login__art img{object-position:center top}.login__shade{background:linear-gradient(180deg,rgb(15 10 8/.03) 0%,rgb(15 10 8/.05) 34%,rgb(15 10 8/.78) 67%,rgb(15 10 8/.96) 100%)}.login__card{width:100%;max-width:430px;padding:25px 20px 20px;border-radius:24px;background:rgb(255 252 249/.97);box-shadow:0 20px 55px rgb(0 0 0/.42)}.login__head{margin-bottom:19px}.login__logo{height:23px;margin-bottom:11px}.login__head h1{font-size:25px}.login__head p{margin-top:5px;font-size:11.5px}.login .field{margin-bottom:11px}.login__private{margin-top:13px}}
    @media(max-width:679px) and (max-height:650px){.login{align-items:flex-start;padding-top:145px}.login__card{padding-block:21px 17px}.login__head p{display:none}.login__head{margin-bottom:14px}.login__logo{margin-bottom:8px}.login__head h1{font-size:23px}}
    @media(min-width:680px) and (max-height:650px){.login{align-items:flex-start;padding-block:24px}.login__card{padding-block:25px 21px}.login__head{margin-bottom:17px}.login__logo{margin-bottom:9px}.login__head p{margin-top:4px}}
    @media(prefers-reduced-motion:reduce){.login__spinner{animation-duration:1.4s}}
  `,
})
export class LoginPage {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly username = signal<'emre' | 'berat' | ''>('');
  readonly password = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly submitted = signal(false);

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.submitted.set(true);
    if (!this.username() || !this.password()) {
      this.error.set('Kies je account en vul je wachtwoord in.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.login(this.username(), this.password());
      const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
      await this.router.navigateByUrl(returnTo ?? '/dashboard');
    } catch (failure: unknown) {
      const status = (failure as { status?: number }).status;
      this.error.set(status === 401
        ? 'Account of wachtwoord klopt niet.'
        : status === 0
          ? 'Geen verbinding met Enrosed. Controleer je internetverbinding en probeer opnieuw.'
          : 'Aanmelden lukt momenteel niet. Probeer het straks opnieuw.');
    } finally {
      this.busy.set(false);
    }
  }
}
