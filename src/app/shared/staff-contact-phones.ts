import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { messageOf } from '../core/api/errors';
import { StaffContact, StaffContactsApi } from '../core/api/staff-contacts-api';
import { normalizedStaffPhone, staffPhoneError } from './staff-contact-phone';

@Component({
  selector: 'app-staff-contact-phones',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <section class="contact-phones" [class.contact-phones--embedded]="embedded()" aria-label="Telefoonnummers van de accounts">
      @if (!embedded()) {
        <div class="contact-phones__head">
          <h2>Contactpersonen in de catalogus</h2>
          <p>Beide opgeslagen telefoonnummers komen automatisch met de accountnaam in de catalogus. Een leeg nummer wordt niet getoond.</p>
        </div>
      }
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
                <span>{{ account.displayName }}@if (!embedded()) { <small>· telefoonnummer</small>}</span>
                <input class="input" type="tel" inputmode="tel" autocomplete="tel" maxlength="50"
                       [attr.aria-label]="'Telefoonnummer ' + account.displayName"
                       [attr.aria-describedby]="'staff-phone-status-' + account.username"
                       [attr.aria-invalid]="validationError(account) ? 'true' : null"
                       [disabled]="disabled() || saving()[account.username]"
                       [attr.data-staff-phone]="account.username"
                       [ngModel]="drafts()[account.username]" (ngModelChange)="edit(account, $event)"
                       placeholder="+32 …" />
              </label>
              @if (!embedded()) {
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
              }
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
    /* Embedded in a settings group card: no own card, no per-row buttons (the page's Opslaan saves them). */
    .contact-phones--embedded { padding: 0; border: 0; border-radius: 0; background: none; }
    .contact-phones--embedded .contact-phone { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    .contact-phones--embedded .contact-phones__rows { gap: 10px; }
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover) {
      .contact-phones--embedded .contact-phone__field { grid-template-columns: 168px minmax(0, 1fr); align-items: center; column-gap: 14px; }
      .contact-phones--embedded .contact-phone__field > span { justify-self: end; color: var(--ink-2); font-size: 13px; font-weight: 600; text-align: right; }
      .contact-phones--embedded .contact-phone__field .input { min-height: 36px; height: 36px; border-radius: 9px; font-size: 14px; }
      .contact-phones--embedded .contact-phone__status { padding-left: 182px; }
      @container set-card (max-width: 479px) {
        .contact-phones--embedded .contact-phone__field { grid-template-columns: minmax(0, 1fr); row-gap: 5px; }
        .contact-phones--embedded .contact-phone__field > span { justify-self: start; text-align: left; }
        .contact-phones--embedded .contact-phone__status { padding-left: 0; }
      }
    }
    @media (max-width: 479px) {
      .contact-phones:not(.contact-phones--embedded) { padding: 18px; }
      .contact-phone { grid-template-columns: minmax(0, 1fr); }
      .contact-phone__actions { grid-row: 3; }
    }
  `,
})
export class StaffContactPhones {
  private readonly api = inject(StaffContactsApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly disabled = input(false);
  /**
   * Inside the Bedrijfsgegevens form: no card or heading of its own and no
   * per-row Opslaan; the page saves the rows with saveAll() and counts
   * dirtyCount() in its "n wijzigingen niet opgeslagen".
   */
  readonly embedded = input(false);
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

  /** How many rows differ from what is saved. */
  readonly dirtyCount = computed(() => this.accounts().filter((account) => this.dirty(account)).length);

  /** The first row whose number would be refused, for the page's save check. */
  firstInvalid(): StaffContact | null {
    return this.accounts().find((account) => this.dirty(account) && !!this.validationError(account)) ?? null;
  }

  focus(username: string): void {
    this.host.nativeElement.querySelector<HTMLInputElement>(`[data-staff-phone="${CSS.escape(username)}"]`)?.focus();
  }

  /**
   * Saves every changed row; true when all went through (a failed row keeps
   * its error and stays dirty). Each row is judged by save()'s own answer:
   * the account object collected here is the one from before the save, so
   * comparing the fresh draft with its old phone would call a saved row dirty.
   */
  async saveAll(): Promise<boolean> {
    let ok = true;
    for (const account of this.accounts().filter((row) => this.dirty(row))) {
      if (!(await this.save(account))) ok = false;
    }
    return ok;
  }

  revertAll(): void {
    for (const account of this.accounts()) {
      if (this.dirty(account)) this.edit(account, account.phone ?? '');
    }
  }

  /** Saves one row; true when the server took it (or there was nothing to save), false when it was refused or failed. */
  async save(account: StaffContact): Promise<boolean> {
    if (this.disabled() || this.saving()[account.username] || this.validationError(account)) return false;
    if (!this.dirty(account)) return true;
    this.saving.update(saving => ({ ...saving, [account.username]: true }));
    this.errors.update(errors => ({ ...errors, [account.username]: null }));
    try {
      const saved = await this.api.savePhone(account.username, normalizedStaffPhone(this.drafts()[account.username]));
      this.accounts.update(accounts => accounts.map(row => row.username === saved.username ? saved : row));
      this.drafts.update(drafts => ({ ...drafts, [saved.username]: saved.phone ?? '' }));
      return true;
    } catch (failure: unknown) {
      this.errors.update(errors => ({ ...errors, [account.username]: messageOf(failure, 'Telefoonnummer opslaan mislukt.') }));
      return false;
    } finally {
      this.saving.update(saving => ({ ...saving, [account.username]: false }));
    }
  }
}
