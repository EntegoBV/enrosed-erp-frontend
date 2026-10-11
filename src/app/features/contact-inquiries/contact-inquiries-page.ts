import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ContactInquiriesApi, ContactInquiry, ContactInquiryStatus } from '../../core/api/contact-inquiries-api';
import { messageOf } from '../../core/api/errors';
import { PageHeader } from '../../shared/page-header';
import { DateTimeNlPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';

const PAGE_SIZE = 50;
const STATUSES: { value: ContactInquiryStatus; label: string }[] = [
  { value: 'NEW', label: 'Nieuw' }, { value: 'READ', label: 'Gelezen' },
  { value: 'REPLIED', label: 'Beantwoord' }, { value: 'ARCHIVED', label: 'Gearchiveerd' },
  { value: 'SPAM', label: 'Spam' },
];

@Component({
  selector: 'app-contact-inquiries-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, DateTimeNlPipe, Sheet],
  template: `
    <app-page-header title="Contactaanvragen" subtitle="Berichten via het contactformulier van de website" />
    <div class="content contact-content">
      <div class="contact-toolbar">
        <label class="field"><span>Status</span>
          <select class="select" [ngModel]="filter()" (ngModelChange)="changeFilter($event)" [disabled]="saving()">
            @for (status of statuses; track status.value) { <option [value]="status.value">{{ status.label }}</option> }
            <option value="ALL">Alle aanvragen</option>
          </select>
        </label>
        <button class="btn" type="button" [disabled]="loading() || saving()" (click)="reload()">Vernieuwen</button>
      </div>
      @if (listError(); as error) {
        <div class="alert alert--danger" role="alert"><span>{{ error }}</span>
          <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="loadPage(nextPage() === 0)">Opnieuw proberen</button>
        </div>
      }
      <section class="card contact-list" aria-label="Contactaanvragen" [attr.aria-busy]="loading()">
        @for (row of rows(); track row.id) {
          <button class="contact-row" type="button" (click)="open(row.id)">
            <span class="contact-row__copy">
              <b>{{ row.companyName || row.contactName }}</b>
              <span>{{ row.contactName }} · {{ row.email }}</span>
              <small>{{ topicLabel(row.topic) }} · {{ row.reference }} · {{ row.createdAt | dateTimeNl }}</small>
              <span class="contact-row__message">{{ row.message }}</span>
            </span>
            <span class="badge" [class.badge--gold]="row.status === 'NEW'">{{ statusLabel(row.status) }}</span>
            <span aria-hidden="true">›</span>
          </button>
        } @empty {
          @if (!loading() && !listError()) {
            <div class="empty"><div class="empty__title">Geen contactaanvragen in deze selectie</div>
              <p class="empty__text">Nieuwe berichten van het contactformulier verschijnen hier.</p></div>
          }
        }
        @if (loading()) { <p class="contact-notice" role="status">Contactaanvragen laden…</p> }
      </section>
      @if (hasMore() && !loading()) {
        <button class="btn btn--block mt-12" type="button" (click)="loadPage(false)">Meer aanvragen laden</button>
      }
    </div>

    @if (openId() !== null) {
      <app-sheet title="Contactaanvraag" [wide]="true" (closed)="close()">
        <div body>
          @if (detailLoading()) { <p role="status">Bericht laden…</p> }
          @if (detailError(); as error) {
            <div class="alert alert--danger" role="alert"><span>{{ error }}</span>
              <button class="btn btn--sm" type="button" [disabled]="detailLoading()" (click)="loadDetail(openId()!)">Opnieuw proberen</button>
            </div>
          }
          @if (detail(); as row) {
            <div class="contact-detail__head"><div><h2>{{ row.companyName || row.contactName }}</h2>
              <p>{{ row.reference }} · {{ row.createdAt | dateTimeNl }}</p></div>
              <span class="badge" [class.badge--gold]="row.status === 'NEW'">{{ statusLabel(row.status) }}</span>
            </div>
            <dl class="contact-facts">
              <dt>Contactpersoon</dt><dd>{{ row.contactName }}</dd>
              @if (row.companyName) { <dt>Bedrijf</dt><dd>{{ row.companyName }}</dd> }
              <dt>E-mail</dt><dd><a [href]="replyUrl(row)">{{ row.email }}</a></dd>
              @if (row.phone) { <dt>Telefoon</dt><dd><a [href]="phoneUrl(row.phone)">{{ row.phone }}</a></dd> }
              <dt>Onderwerp</dt><dd>{{ topicLabel(row.topic) }}</dd>
              <dt>Taal</dt><dd>{{ row.language }}</dd>
            </dl>
            <div class="contact-message"><h3>Bericht</h3><p>{{ row.message }}</p></div>
            <div class="contact-status-actions" aria-label="Status wijzigen">
              <b>Markeren als</b>
              <div>@for (status of statuses; track status.value) {
                <button class="btn btn--sm" type="button" [disabled]="saving() || detailLoading() || row.status === status.value"
                        [attr.aria-pressed]="row.status === status.value" (click)="setStatus(status.value)">{{ status.label }}</button>
              }</div>
              <small>De status wijzigen verstuurt geen e-mail.</small>
              @if (saving()) { <p role="status">Status opslaan…</p> }
              @if (saveError(); as error) { <p class="contact-error" role="alert">{{ error }}</p> }
            </div>
          }
        </div>
        <div foot class="contact-sheet-actions">
          <button class="btn" type="button" (click)="close()">Sluiten</button>
          @if (detail(); as row) { <a class="btn btn--primary" [href]="replyUrl(row)">Beantwoorden via e-mail</a> }
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .contact-content { max-width: 1100px; }
    .contact-toolbar { display: flex; align-items: end; gap: 12px; margin-bottom: 16px; }
    .contact-toolbar .field { flex: 1; max-width: 300px; margin: 0; }
    .contact-list { overflow: hidden; }
    .contact-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 18px; border: 0; border-bottom: 1px solid var(--line); background: var(--surface); color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
    .contact-row:last-child { border-bottom: 0; }
    .contact-row:hover, .contact-row:focus-visible { background: var(--surface-2); }
    .contact-row__copy { display: grid; min-width: 0; flex: 1; gap: 5px; }
    .contact-row__copy > span, .contact-row__copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 13px; }
    .contact-row__copy .contact-row__message { color: var(--ink-2); }
    .contact-notice { padding: 18px; color: var(--muted); font-size: 14px; }
    .contact-detail__head { display: flex; align-items: start; justify-content: space-between; gap: 14px; }
    .contact-detail__head h2 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
    .contact-detail__head p { margin: 8px 0 18px; color: var(--muted); font-size: 13px; }
    .contact-facts { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px 16px; margin: 0 0 22px; font-size: 14px; }
    .contact-facts dt { color: var(--muted); }
    .contact-facts dd { margin: 0; overflow-wrap: anywhere; }
    .contact-message { padding: 18px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface-2); }
    .contact-message h3 { margin: 0 0 10px; font-size: 14px; }
    .contact-message p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
    .contact-status-actions { display: grid; gap: 10px; margin-top: 22px; }
    .contact-status-actions > div { display: flex; flex-wrap: wrap; gap: 8px; }
    .contact-status-actions small { color: var(--muted); }
    .contact-status-actions p { margin: 0; font-size: 13px; }
    .contact-error { color: var(--danger); }
    .contact-sheet-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
    @media (max-width: 479px) {
      .contact-row { flex-wrap: wrap; padding: 16px; }
      .contact-row__copy { flex-basis: 100%; }
      .contact-facts { grid-template-columns: 100px minmax(0, 1fr); gap: 10px; }
      .contact-sheet-actions .btn { flex: 1; }
    }
  `,
})
export class ContactInquiriesPage {
  private readonly api = inject(ContactInquiriesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly statuses = STATUSES;
  readonly filter = signal<ContactInquiryStatus | 'ALL'>('NEW');
  readonly rows = signal<ContactInquiry[]>([]);
  readonly loading = signal(false);
  readonly nextPage = signal(0);
  readonly hasMore = signal(false);
  readonly listError = signal<string | null>(null);
  readonly openId = signal<number | null>(null);
  readonly detail = signal<ContactInquiry | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  private listVersion = 0;
  private detailVersion = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.listVersion++; this.detailVersion++; });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const requested = params.get('status');
      const status = requested === 'ALL' ? 'ALL' : STATUSES.find(row => row.value === requested)?.value ?? 'NEW';
      if (status !== this.filter() || this.listVersion === 0) {
        this.filter.set(status);
        void this.loadPage(true);
      }
      const value = Number(params.get('open'));
      const id = Number.isSafeInteger(value) && value > 0 ? value : null;
      if (id !== this.openId()) {
        this.openId.set(id);
        this.detail.set(null);
        this.detailError.set(null);
        this.saveError.set(null);
        this.detailVersion++;
        if (id !== null) void this.loadDetail(id);
      }
    });
  }

  changeFilter(status: ContactInquiryStatus | 'ALL'): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { status, open: null }, queryParamsHandling: 'merge' });
  }

  open(id: number): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { open: id }, queryParamsHandling: 'merge' });
  }

  close(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  reload(): void {
    void this.loadPage(true);
    const id = this.openId();
    if (id !== null && !this.saving()) void this.loadDetail(id);
  }

  async loadPage(reset: boolean): Promise<void> {
    if (!reset && (this.loading() || !this.hasMore())) return;
    const version = ++this.listVersion;
    const page = reset ? 0 : this.nextPage();
    if (reset) { this.rows.set([]); this.nextPage.set(0); this.hasMore.set(false); }
    this.loading.set(true);
    this.listError.set(null);
    try {
      const batch = await this.api.list(this.filter() === 'ALL' ? null : this.filter() as ContactInquiryStatus, page, PAGE_SIZE);
      if (version !== this.listVersion) return;
      this.rows.update(rows => [...new Map([...rows, ...batch].map(row => [row.id, row])).values()]);
      this.nextPage.set(page + 1);
      this.hasMore.set(batch.length === PAGE_SIZE);
    } catch (failure: unknown) {
      if (version === this.listVersion) this.listError.set(messageOf(failure, 'Contactaanvragen laden mislukt.'));
    } finally {
      if (version === this.listVersion) this.loading.set(false);
    }
  }

  async loadDetail(id: number): Promise<void> {
    const version = ++this.detailVersion;
    this.detailLoading.set(true);
    this.detailError.set(null);
    try {
      const row = await this.api.get(id);
      if (version === this.detailVersion && this.openId() === id) this.detail.set(row);
    } catch (failure: unknown) {
      if (version === this.detailVersion) this.detailError.set(messageOf(failure, 'Contactaanvraag laden mislukt.'));
    } finally {
      if (version === this.detailVersion) this.detailLoading.set(false);
    }
  }

  async setStatus(status: ContactInquiryStatus): Promise<void> {
    const row = this.detail();
    if (!row || this.saving() || this.detailLoading() || row.status === status) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const saved = await this.api.setStatus(row.id, status);
      if (this.destroyed) return;
      if (this.openId() === row.id) this.detail.set(saved);
      // Reset paging after a status change so removing a row cannot skip the next page's first item.
      await this.loadPage(true);
    } catch (failure: unknown) {
      if (this.openId() === row.id) this.saveError.set(messageOf(failure, 'Status opslaan mislukt.'));
    } finally {
      this.saving.set(false);
    }
  }

  statusLabel(status: ContactInquiryStatus): string { return STATUSES.find(row => row.value === status)?.label ?? status; }
  topicLabel(topic: string): string {
    return ({ GENERAL: 'Algemene vraag', PRODUCT: 'Productvraag', ORDER_DELIVERY: 'Bestelling of levering',
      PARTNERSHIP: 'Samenwerking', OTHER: 'Overig' } as Record<string, string>)[topic] ?? topic;
  }
  replyUrl(row: ContactInquiry): string {
    return `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent('Re: ' + row.reference)}`;
  }
  phoneUrl(phone: string): string { return 'tel:' + phone.replace(/[^+\d]/g, ''); }
}
