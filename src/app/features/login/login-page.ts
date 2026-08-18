import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../core/api/auth';

/** Aanmeldscherm. */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="login">
      <form class="login__card" (ngSubmit)="submit()">
        <img class="login__logo" src="logo.png" alt="Enrosed" />
        <div class="login__sub">Sales &amp; Sourcing</div>

        <div class="field">
          <label for="username">Gebruikersnaam</label>
          <input class="input" id="username" name="username" autocomplete="username"
                 autocapitalize="none" spellcheck="false"
                 [ngModel]="username()" (ngModelChange)="username.set($event)" />
        </div>

        <div class="field">
          <label for="password">Wachtwoord</label>
          <input class="input" id="password" name="password" type="password"
                 autocomplete="current-password"
                 [ngModel]="password()" (ngModelChange)="password.set($event)" />
        </div>

        @if (error()) {
          <div class="alert alert--danger" style="margin-bottom:14px">
            <span class="alert__icon">!</span>
            <div>{{ error() }}</div>
          </div>
        }

        <button class="btn btn--primary btn--block" type="submit" [disabled]="busy()">
          {{ busy() ? 'Bezig…' : 'Aanmelden' }}
        </button>
      </form>
    </div>
  `,
  styles: `
    .login {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      background: linear-gradient(160deg, #1f1815, #2c211c);
    }
    .login__card {
      width: 100%;
      max-width: 360px;
      background: var(--surface);
      border-radius: var(--r-lg);
      padding: 28px 22px 24px;
      box-shadow: 0 20px 60px rgb(0 0 0 / 35%);
    }
    /* The card is light, so the black logo can stay as it is. */
    .login__logo {
      display: block;
      height: 30px;
      width: auto;
      max-width: 220px;
      object-fit: contain;
      margin: 0 auto;
    }
    .login__sub {
      text-align: center;
      font-size: 10.5px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
      margin: 4px 0 24px;
    }
  `,
})
export class LoginPage {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly username = signal('');
  readonly password = signal('');
  readonly error = signal('');
  readonly busy = signal(false);

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.login(this.username().trim(), this.password());
      const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
      await this.router.navigateByUrl(returnTo ?? '/dashboard');
    } catch (failure: unknown) {
      const status = (failure as { status?: number }).status;
      this.error.set(
        status === 401
          ? 'Gebruikersnaam of wachtwoord klopt niet.'
          : 'Geen verbinding met de server. Draait de backend op localhost:8080?',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
