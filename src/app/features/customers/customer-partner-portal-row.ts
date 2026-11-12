import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PartnerPortalAdminRow, PartnerSalesApi } from '../../core/api/partner-sales-api';
import { Icon } from '../../shared/icon';
import { loginLine } from '../settings/partner-portal-fields';

/**
 * The partner customer's short line on the customer sheet: "Partnerportaal ·
 * verhoeven · actief", a link to Instellingen › Partnerportaal (that
 * partner's card). Nothing shows while it loads, on a backend without the
 * portal, or for a customer the portal does not list (not saved as partner).
 */
@Component({
  selector: 'app-customer-partner-portal-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    @if (row(); as r) {
      <a class="cpp" routerLink="/settings" [queryParams]="{ sectie: 'partner-portal', klant: r.customerId }">
        <span class="cpp__label">Partnerportaal</span>
        <span class="cpp__value" [class.is-warn]="!r.login">{{ line(r) }}</span>
        <app-icon name="chevron-right" [size]="14" />
      </a>
    }
  `,
  styles: `
    :host { display: block; }
    .cpp { display: flex; align-items: center; gap: 10px; min-height: 40px; margin-top: 10px; padding: 6px 12px; border: 1px solid var(--line);
      border-radius: 10px; background: var(--surface); color: var(--ink); font-size: 13.5px; text-decoration: none; }
    .cpp:hover { background: var(--surface-2); }
    .cpp:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    .cpp__label { font-weight: 650; }
    .cpp__value { flex: 1; min-width: 0; overflow: hidden; color: var(--muted); text-align: right; text-overflow: ellipsis; white-space: nowrap; }
    .cpp__value.is-warn { color: var(--warn); font-weight: 600; }
    .cpp > app-icon { flex: none; color: var(--muted-2); }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) { .cpp { min-height: 48px; font-size: 15px; } }
  `,
})
export class CustomerPartnerPortalRow {
  private readonly api = inject(PartnerSalesApi);

  readonly customerId = input.required<number>();
  private readonly rows = signal<PartnerPortalAdminRow[]>([]);
  readonly row = computed(() => this.rows().find((row) => row.customerId === this.customerId()) ?? null);
  private run = 0;

  constructor() {
    effect(() => {
      this.customerId();
      untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    const run = ++this.run;
    try {
      const rows = await this.api.adminRows();
      if (run === this.run) this.rows.set(rows);
    } catch {
      /* An older backend (404) or no connection: the sheet simply shows no line. */
      if (run === this.run) this.rows.set([]);
    }
  }

  line(row: PartnerPortalAdminRow): string {
    return row.partner ? loginLine(row) : `${loginLine(row)} · geen partner meer`;
  }
}
