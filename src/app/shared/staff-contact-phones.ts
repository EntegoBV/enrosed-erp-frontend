import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { messageOf } from '../core/api/errors';
import { StaffContact, StaffContactsApi } from '../core/api/staff-contacts-api';
import { normalizedStaffPhone, staffPhoneError } from './staff-contact-phone';

@Component({
  selector: 'app-staff-contact-phones',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <section class="contact-phones" aria-label="Telefoonnummers van de accounts">
      <div class="contact-phones__head">
        <h2>Contactpersonen in de catalogus</h2>
        <p>Beide opgeslagen telefoonnummers komen automatisch met de accountnaam in de catalogus. Een leeg nummer wordt niet getoond.</p>
      </div>
      @if (loading()) {
        <p class="contact-phones__notice" role="status">Accounts laden…</p>
      } @else if (loadError(); as error) {
        <div class="contact-phones__notice contact-phones__error" role="alert">
          <span>{{ error }}</span>
          <button class="btn btn--sm" type="button" [disabled]="disabled()" (click)="load()">Opnieuw laden</button>
        </div>
      } @else {
        <div class="contact-phones__rows">
          @for (account of accounts(); track account.username) {
            <div class="contact-phone" [attr.aria-busy]="saving()[account.username] || false">
              <label class="contact-phone__field">
                <span>{{ account.displayName }} <small>· telefoonnummer</small></span>
                <input class="input" type="tel" inputmode="tel" autocomplete="tel" maxlength="50"
                       [attr.aria-label]="'Telefoonnummer ' + account.displayName"
                       [attr.aria-describedby]="'staff-phone-status-' + account.username"
                       [attr.aria-invalid]="validationError(account) ? 'true' : null"
                       [disabled]="disabled() || saving()[account.username]"
                       [ngModel]="drafts()[account.username]" (ngModelChange)="edit(account, $event)"
                       placeholder="+32 …" />
              </label>
              <div class="contact-phone__actions">
                <button class="btn btn--sm btn--primary" type="button"
                        [attr.aria-label]="'Telefoonnummer ' + account.displayName + ' opslaan'"
                        [disabled]="disabled() || saving()[account.username] || !dirty(account) || !!validationError(account)"
                        (click)="save(account)">{{ saving()[account.username] ? 'Opslaan…' : 'Opslaan' }}</button>
                @if (dirty(account)) {
                  <button class="btn btn--sm" type="button" [disabled]="disabled() || saving()[account.username]"
                          [attr.aria-label]="'Wijziging telefoonnummer ' + account.displayName + ' herstellen'"
                          (click)="edit(account, account.phone ?? '')">Herstellen</button>
                }
              </div>
              <p class="contact-phone__status" [id]="'staff-phone-status-' + account.username"
                 [class.contact-phones__error]="validationError(account) || errors()[account.username]"
                 role="status">{{ validationError(account) || errors()[account.username] || status(account) }}</p>
            </div>
          } @empty {
            <p class="contact-phones__notice">Er zijn geen accounts beschikbaar.</p>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .contact-phones { padding: 20px 22px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); }
    .contact-phones__head h2 { margin: 0; color: var(--ink); font-size: 18px; line-height: 1.3; }
    .contact-phones__head p { margin: 7px 0 18px; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .contact-phones__rows { display: grid; gap: 16px; }
    .contact-phone { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; align-items: end; }
    .contact-phone__field { display: grid; min-width: 0; gap: 6px; }
    .contact-phone__field > span { color: var(--ink-2); font-size: 14px; font-weight: 700; }
    .contact-phone__field small { color: var(--muted); font-size: 12px; font-weight: 400; }
    .contact-phone__field .input { min-height: 44px; font-size: 16px; }
    .contact-phone__actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .contact-phone__actions .btn { min-height: 44px; }
    .contact-phone__status { grid-column: 1 / -1; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .contact-phones__notice { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 0; color: var(--muted); font-size: 13px; }
    .contact-phones__error { color: var(--danger); }
    @media (max-width: 479px) {
      .contact-phones { padding: 18px; }
      .contact-phone { grid-template-columns: minmax(0, 1fr); }
      .contact-phone__actions { grid-row: 3; }
    }
  `,
})
export class StaffContactPhones {
  private readonly api = inject(StaffContactsApi);
  readonly disabled = input(false);
  /** Prevent a download while a visible edit has not yet reached the server. */
  readonly pendingChange = output<boolean>();
  readonly accounts = signal<StaffContact[]>([]);
  readonly drafts = signal<Record<string, string>>({});
  readonly saving = signal<Record<string, boolean>>({});
  readonly errors = signal<Record<string, string | null>>({});
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  private readonly pending = computed(() => this.accounts().some(account =>
    this.dirty(account) || this.saving()[account.username]));

  constructor() {
    effect(() => this.pendingChange.emit(this.pending()));
    void this.load();
  }

  async load(): Promise<void> {
    if (this.disabled()) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const accounts = await this.api.accounts();
      this.accounts.set(accounts);
      this.drafts.set(Object.fromEntries(accounts.map(account => [account.username, account.phone ?? ''])));
      this.errors.set({});
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'De telefoonnummers konden niet worden geladen.'));
    } finally {
      this.loading.set(false);
    }
  }

  edit(account: StaffContact, value: string): void {
    if (this.disabled() || this.saving()[account.username]) return;
    this.drafts.update(drafts => ({ ...drafts, [account.username]: value }));
    this.errors.update(errors => ({ ...errors, [account.username]: null }));
  }

  dirty(account: StaffContact): boolean {
    return normalizedStaffPhone(this.drafts()[account.username]) !== normalizedStaffPhone(account.phone);
  }

  validationError(account: StaffContact): string | null {
    return staffPhoneError(this.drafts()[account.username] ?? '');
  }

  status(account: StaffContact): string {
    if (this.saving()[account.username]) return 'Telefoonnummer wordt opgeslagen…';
    if (this.dirty(account)) return 'Gewijzigd · nog niet opgeslagen.';
    return account.phone ? 'Opgeslagen · wordt met de accountnaam in de catalogus getoond.' : 'Geen nummer ingesteld.';
  }

  async save(account: StaffContact): Promise<void> {
    if (this.disabled() || this.saving()[account.username] || !this.dirty(account) || this.validationError(account)) return;
    this.saving.update(saving => ({ ...saving, [account.username]: true }));
    this.errors.update(errors => ({ ...errors, [account.username]: null }));
    try {
      const saved = await this.api.savePhone(account.username, normalizedStaffPhone(this.drafts()[account.username]));
      this.accounts.update(accounts => accounts.map(row => row.username === saved.username ? saved : row));
      this.drafts.update(drafts => ({ ...drafts, [saved.username]: saved.phone ?? '' }));
    } catch (failure: unknown) {
      this.errors.update(errors => ({ ...errors, [account.username]: messageOf(failure, 'Telefoonnummer opslaan mislukt.') }));
    } finally {
      this.saving.update(saving => ({ ...saving, [account.username]: false }));
    }
  }
}
