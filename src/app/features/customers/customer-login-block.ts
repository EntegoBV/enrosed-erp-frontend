import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { messageOf } from '../../core/api/errors';
import { CustomerLogin, LoginRequestApi } from '../../core/api/login-request-api';
import { Skeleton } from '../../shared/skeleton';
import { Ui, escapeHtml } from '../../shared/ui';
import { LoginAction, linkToast, loginActions, loginBadge, loginRowText } from './customer-login-state';

/**
 * The website login of one customer, on the customer sheet: its status, a
 * new one-time link, withdrawing it, and giving a login without a request.
 *
 * Every button acts at once and on its own; nothing here waits for the
 * sheet's Opslaan. The login keeps its own e-mail address, so the customer's
 * e-mail field only prefills the input for a first login.
 */
@Component({
  selector: 'app-customer-login-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton],
  template: `
    <div class="cl-head">
      <b>Websitelogin</b>
      <small>Met een login ziet de klant prijzen in het bestelscherm van de website, ook als die voor bezoekers
        verborgen zijn. Het e-mailadres van de login wijzigt niet mee wanneer je het e-mailadres van de klant
        aanpast.</small>
    </div>

    @if (loading()) {
      <app-skeleton kind="lines" [rows]="2" />
    } @else if (error()) {
      <div class="alert alert--danger cl-error" role="alert">
        <div>Loginstatus kon niet geladen worden.</div>
        <button class="btn btn--sm" type="button" (click)="reload()">Opnieuw proberen</button>
      </div>
    } @else {
      @for (login of logins(); track login.id) {
        <div class="cl-row">
          <div class="cl-row__main">
            <span class="cl-email">{{ login.email }}</span>
            <span class="badge" [class]="badge(login).css">{{ badge(login).label }}</span>
            <span class="cl-line">{{ rowText(login) }}</span>
          </div>
          @if (login.lastLinkError) {
            <div class="alert alert--warn">
              <span class="alert__icon">!</span>
              <div>De laatste mail is niet vertrokken: {{ login.lastLinkError }}</div>
            </div>
          }
          <div class="cl-actions">
            @for (action of actions(login); track action.key) {
              <button class="btn btn--sm" type="button" [class.btn--danger]="action.danger"
                      [disabled]="busy()" (click)="run(action, login)">{{ action.label }}</button>
            }
          </div>
          @for (action of actions(login); track action.key) {
            @if (action.hint) { <span class="hint">{{ action.hint }}</span> }
          }
        </div>
      } @empty {
        <p class="cl-none">Deze klant heeft geen login.</p>
        <div class="field cl-grant">
          <label for="c-login-email">E-mailadres</label>
          <input class="input" id="c-login-email" type="email" autocomplete="off" [ngModel]="email()"
                 (ngModelChange)="typed.set($event ?? '')" />
          @if (!grantEmail()) { <span class="hint">Vul eerst een e-mailadres in.</span> }
        </div>
        <div class="cl-actions">
          <button class="btn btn--sm btn--primary" type="button" [disabled]="busy() || !grantEmail()"
                  (click)="grant()">Login geven en link sturen</button>
        </div>
      }
    }
  `,
  styles: `
    :host { display: grid; gap: 10px; min-width: 0; }
    .cl-head { display: grid; gap: 2px; font-size: 13px; }
    .cl-head small { color: var(--ink-2); font-size: 12px; line-height: 1.4; }
    .cl-row { display: grid; gap: 8px; min-width: 0; padding-top: 10px; border-top: 1px solid var(--rose-line); }
    .cl-row__main { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; font-size: 13.5px; }
    .cl-email { min-width: 0; font-weight: 650; overflow-wrap: anywhere; }
    .cl-line { flex-basis: 100%; color: var(--ink-2); font-size: 12.5px; }
    .cl-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .cl-none { font-size: 13.5px; }
    .cl-grant { margin-bottom: 0; }
    .cl-error { align-items: center; justify-content: space-between; }
    .cl-error .btn { flex: none; }
    .hint { font-size: 12px; color: var(--muted); }
  `,
})
export class CustomerLoginBlock {
  private readonly api = inject(LoginRequestApi);
  private readonly ui = inject(Ui);

  readonly customerId = input.required<number>();
  readonly customerEmail = input<string | null>(null);

  readonly logins = signal<CustomerLogin[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly busy = signal(false);
  /** What staff typed for a first login; until then the customer's e-mail shows. */
  readonly typed = signal<string | null>(null);
  readonly email = computed(() => this.typed() ?? this.customerEmail() ?? '');
  readonly grantEmail = computed(() => this.email().trim());
  /** Drops the answer of a load that a newer one has overtaken. */
  private version = 0;

  constructor() {
    effect(() => {
      const customerId = this.customerId();
      this.typed.set(null);
      void this.load(customerId);
    });
  }

  badge(login: CustomerLogin): { label: string; css: string } {
    return loginBadge(login.status);
  }

  rowText(login: CustomerLogin): string {
    return loginRowText(login, new Date());
  }

  actions(login: CustomerLogin): LoginAction[] {
    return loginActions(login.status);
  }

  reload(): void {
    void this.load(this.customerId());
  }

  private async load(customerId: number): Promise<void> {
    const version = ++this.version;
    this.loading.set(true);
    this.error.set(false);
    try {
      const logins = await this.api.logins(customerId);
      if (version !== this.version) return;
      this.logins.set(logins);
    } catch {
      if (version !== this.version) return;
      this.logins.set([]);
      this.error.set(true);
    } finally {
      if (version === this.version) this.loading.set(false);
    }
  }

  grant(): void {
    const email = this.grantEmail();
    if (!email || this.busy()) return;
    this.ui.confirm({
      title: 'Login geven',
      message: 'Er gaat een mail naar <b>' + escapeHtml(email) + '</b> met een link om zelf een wachtwoord te kiezen.',
      confirmLabel: 'Login geven',
    }, () => void this.act(() => this.api.grantLogin(this.customerId(), email), 'Login geven mislukt'));
  }

  run(action: LoginAction, login: CustomerLogin): void {
    if (this.busy()) return;
    if (action.key === 'send') {
      void this.act(() => this.api.sendLink(login.id), 'Link sturen mislukt');
      return;
    }
    this.ui.confirm({
      title: 'Login intrekken',
      message: '<b>' + escapeHtml(login.email) + '</b> wordt meteen uitgelogd en kan niet meer inloggen. '
        + 'Je kunt later opnieuw een login geven.',
      confirmLabel: 'Intrekken',
      danger: true,
    }, () => void this.withdraw(login));
  }

  /** S7 and S8 answer alike: the login as it is now and what happened to the mail. */
  private async act(
    call: () => Promise<{ account: CustomerLogin; invitation: { sent: boolean; expiresAt: string | null } }>,
    fallback: string,
  ): Promise<void> {
    if (this.busy()) return;
    const customerId = this.customerId();
    this.busy.set(true);
    try {
      const result = await call();
      this.adopt(customerId, result.account);
      const toast = linkToast(result.account.email, result.invitation);
      this.ui.toast(toast.text, toast.kind);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, fallback), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  private async withdraw(login: CustomerLogin): Promise<void> {
    if (this.busy()) return;
    const customerId = this.customerId();
    this.busy.set(true);
    try {
      this.adopt(customerId, await this.api.withdraw(login.id));
      this.ui.toast('Login ingetrokken');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Intrekken mislukt'), 'err');
      /* A 409 means someone else withdrew it meanwhile: show what the server has now. */
      if (customerId === this.customerId()) this.reload();
    } finally {
      this.busy.set(false);
    }
  }

  /** Puts the server's answer in the list, unless the sheet moved on to another customer. */
  private adopt(customerId: number, account: CustomerLogin): void {
    if (customerId !== this.customerId()) return;
    this.typed.set(null);
    this.logins.update((list) => list.some((login) => login.id === account.id)
      ? list.map((login) => login.id === account.id ? account : login)
      : [...list, account]);
  }
}
