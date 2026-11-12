import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import {
  PartnerInvoicePreview, PartnerInvoicePreviewGroup, PartnerInvoiceResult, PartnerSalesApi, PartnerSalesConfirmTotals,
  PartnerSalesPartnerSummary, StaffPartnerReport, isMissingEndpoint,
} from '../../core/api/partner-sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { partnerShortName } from '../../shared/partner-short-name';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { count, euro } from '../partner/partner-format';
import { ChannelChoice, PeriodKind, channelOf, periodRange, reportState } from './partner-sales-filters';
import { PartnerSalesInvoicePick } from './partner-sales-invoice-pick';
import { PartnerSalesInvoicePreview } from './partner-sales-invoice-preview';

/** How long the ticks rest before the preview is asked again (each preview is a transaction per container). */
const PREVIEW_PAUSE_MS = 450;

export type InvoicePartner = PartnerSalesPartnerSummary & PartnerSalesConfirmTotals;

/** Factureren takes it: confirmed with an open part (a round-1 server knows no confirming: every open one). */
export function invoiceable(report: StaffPartnerReport): boolean {
  if (report.confirmed === undefined) return report.status === 'OPEN' || report.status === 'PARTLY_INVOICED';
  return reportState(report) === 'CONFIRMED';
}

/**
 * Factureren in two steps. 1 "Kies de meldingen": the partner's confirmed,
 * open meldingen with ticks (Soort, Periode, a whole day, Alles), ticked
 * from the page's selection (else all of them); meldingen of that selection
 * that are not confirmed yet are offered as "Eerst bevestigen (n)". 2
 * "Controleren": the server's preview of exactly those (asked again a moment
 * after the ticks rest), and "Facturen maken (n)", which sends the preview's
 * own meldingen, never more. One partner at a time.
 */
@Component({
  selector: 'app-partner-sales-invoice-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PartnerSalesInvoicePick, PartnerSalesInvoicePreview, Segmented, Sheet, Skeleton],
  template: `
    <app-sheet title="Factureren" [wide]="desk.active()" [variant]="desk.active() ? 'default' : 'ios'" (closed)="close()">
      <div body class="vi" [class.vi--ios]="!desk.active()">
        @if (result(); as done) {
          <div class="vi-done" role="status">
            <b>{{ done.invoices.length === 1 ? '1 concept gemaakt' : done.invoices.length + ' concepten gemaakt' }}</b>
            @for (invoice of done.invoices; track invoice.id) {
              <a class="vi-done__link" [routerLink]="['/sales', invoice.id]" (click)="closed.emit()">
                {{ invoice.number || 'Concept' }} · {{ invoice.source === 'OWN' ? 'Eigen voorraad' : containerOf(invoice.purchaseOrderId) }} ›</a>
            }
          </div>
          @for (block of done.blocked; track $index) {
            <p class="vi-bad" role="alert"><b>{{ containerOf(block.purchaseOrderId, block.containerName) }}</b> · {{ block.message }}</p>
          }
          @if (done.skipped.length) {
            <p class="vi-wait">Wacht nog: @for (skip of done.skipped; track $index) { <span>{{ skip.name }} · {{ skip.source === 'OWN' ? 'eigen voorraad' : containerOf(skip.purchaseOrderId, skip.containerName) }} ({{ skip.reason }})@if (!$last) {, }</span> }</p>
          }
        } @else {
          <ol class="vi-steps" aria-label="Stappen">
            <li [class.is-on]="step() === 1"><button type="button" [disabled]="step() === 1" (click)="step.set(1)"><span>1</span>Kies de meldingen</button></li>
            <li [class.is-on]="step() === 2"><span class="vi-steps__n">2</span>Controleren</li>
          </ol>

          @if (choices().length > 1) {
            <div class="vi-partner">
              <span class="vi-label">{{ several() ? 'Je koos meldingen van meer partners. Voor welke partner?' : 'Voor welke partner?' }}</span>
              <app-segmented [variant]="desk.active() ? 'desk' : 'ios'" label="Partner" [options]="choiceOptions()"
                             [value]="customerId() ? '' + customerId() : ''" (changed)="pick(+$event)" />
            </div>
          }

          @if (step() === 1) {
            @if (waiting().length) {
              <div class="vi-confirm" role="status">
                <span>{{ waiting().length === 1 ? '1 gekozen melding is' : waiting().length + ' gekozen meldingen zijn' }} nog niet bevestigd: {{ waitingNumbers() }}.</span>
                <button class="wk-btn wk-btn--sm" type="button" [disabled]="confirming() || !canConfirm()" (click)="confirmFirst()">
                  {{ confirming() ? 'Bezig…' : 'Eerst bevestigen (' + waiting().length + ')' }}</button>
              </div>
            }
            @if (listError(); as message) {
              <p class="vi-bad" role="alert">{{ message }}</p>
              <button class="wk-btn wk-btn--sm" type="button" [disabled]="listLoading()" (click)="loadList()">Opnieuw proberen</button>
            } @else if (listLoading() && !candidates().length) {
              <app-skeleton [kind]="desk.active() ? 'table' : 'group'" [rows]="4" />
            } @else {
              <app-partner-sales-invoice-pick [shown]="shown()" [total]="candidates().length" [selected]="selected()" [today]="today()"
                                              [channel]="channel()" [period]="period()"
                                              (channelChange)="channel.set($event)" (periodChange)="period.set($event)"
                                              (selectedChange)="selected.set($event)" />
            }
          } @else {
            @if (previewError(); as message) {
              <p class="vi-bad" role="alert">{{ message }}</p>
              <button class="wk-btn wk-btn--sm" type="button" [disabled]="previewLoading()" (click)="askPreview(true)">Opnieuw proberen</button>
            } @else if (currentPreview(); as p) {
              <app-partner-sales-invoice-preview [preview]="p" [partner]="partnerWord()" [containerName]="containerNameFn" [shareFallback]="shareFn" />
              <p class="vi-foot">{{ chosenLine() }}</p>
            } @else {
              <app-skeleton [kind]="desk.active() ? 'table' : 'group'" [rows]="4" />
            }
          }
        }
      </div>
      <div foot class="vi-actions">
        @if (result()) {
          <button class="btn btn--primary" type="button" (click)="closed.emit()">Klaar</button>
        } @else if (step() === 1) {
          <span class="vi-actions__sum">{{ chosen().length ? chosenLine() : 'Niets gekozen' }}@if (aheadLine(); as ahead) {<small>{{ ahead }}</small>}</span>
          <button class="btn" type="button" (click)="close()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="!chosen().length" (click)="toCheck()">Controleren ({{ chosen().length }})</button>
        } @else {
          <button class="btn" type="button" [disabled]="creating()" (click)="step.set(1)">Terug</button>
          <button class="btn btn--primary" type="button" [disabled]="!makeable() || creating() || !currentPreview()" (click)="create()">
            {{ creating() ? 'Bezig…' : 'Facturen maken (' + makeable() + ')' }}</button>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .vi{display:grid;gap:14px;min-width:0}
    .vi--ios{padding:0 var(--ios-inset,16px)}
    .vi-steps{display:flex;gap:6px;margin:0;padding:0;list-style:none;font-size:13px;font-weight:650;color:var(--muted)}
    .vi-steps li{display:flex;align-items:center;gap:6px}
    .vi-steps li+li::before{content:'›';margin-right:2px;color:var(--muted-2)}
    .vi-steps button{display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer}
    .vi-steps button:disabled{cursor:default}
    .vi-steps span,.vi-steps__n{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--surface-2);color:var(--ink-2);font-size:11.5px}
    .vi-steps .is-on{color:var(--ink)}
    .vi-steps .is-on span,.vi-steps .is-on .vi-steps__n{background:var(--rose);color:#fff}
    .vi-partner{display:grid;gap:6px}
    .vi-label{color:var(--muted);font-size:12.5px;font-weight:650}
    .vi-confirm{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;padding:10px 12px;border:1px solid #f0dcbc;border-radius:12px;background:var(--warn-soft);color:#7c450b;font-size:13px}
    .vi-bad{margin:0;color:var(--danger);font-size:13px;font-weight:600;line-height:1.4}
    .vi-foot{margin:0;color:var(--muted);font-size:13px}
    .vi-wait{margin:0;color:var(--ink-2);font-size:13px;line-height:1.45}
    .vi-done{display:grid;gap:6px;padding:12px 14px;border-radius:14px;background:var(--ok-soft,#e8f3ec)}
    .vi-done__link{display:flex;align-items:center;min-height:36px;color:var(--rose-dark);font-weight:650;text-decoration:none}
    .vi-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;width:100%}
    .vi-actions__sum{display:grid;margin-right:auto;color:var(--ink-2);font-size:13px;font-weight:650;font-variant-numeric:tabular-nums}
    .vi-actions__sum small{color:var(--muted);font-size:12px;font-weight:500}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .vi-done__link{min-height:44px}
      .vi-actions .btn{flex:1;min-height:48px}
      .vi-actions__sum{flex:1 0 100%}
      .vi-steps{font-size:14px}
    }
  `,
})
export class PartnerSalesInvoiceSheet {
  private readonly api = inject(PartnerSalesApi);
  private readonly sourcing = inject(SourcingApi);
  readonly desk = inject(DesktopViewport);

  /** The partners Factureren can take now (confirmed and open). */
  readonly partners = input.required<readonly InvoicePartner[]>();
  /** The partner to start with (the page's filter or the selection's), else the first. */
  readonly initialCustomerId = input<number | null>(null);
  /** The page's ticked meldingen that Factureren can take; null = no selection (then all of them are ticked). */
  readonly preselect = input<readonly number[] | null>(null);
  /** The page's ticked meldingen that still wait for Bevestigen. */
  readonly unconfirmed = input<readonly StaffPartnerReport[]>([]);
  /** The page's ticks spanned more than one partner. */
  readonly several = input(false);
  /** A round-2 server (Bevestigen can be sent). */
  readonly canConfirm = input(true);
  readonly today = input.required<string>();
  readonly closed = output<void>();
  readonly created = output<PartnerInvoiceResult>();
  /** "Eerst bevestigen" confirmed meldingen: the page reads its list again. */
  readonly confirmedSome = output<StaffPartnerReport[]>();

  readonly step = signal<1 | 2>(1);
  readonly customerId = signal<number | null>(null);
  readonly candidates = signal<StaffPartnerReport[]>([]);
  readonly listLoading = signal(false);
  readonly listError = signal<string | null>(null);
  readonly selected = signal<ReadonlySet<number>>(new Set());
  readonly channel = signal<ChannelChoice>('alle');
  readonly period = signal<Exclude<PeriodKind, 'van-tot'>>('alles');
  readonly preview = signal<{ key: string; preview: PartnerInvoicePreview } | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly creating = signal(false);
  readonly confirming = signal(false);
  readonly result = signal<PartnerInvoiceResult | null>(null);
  /** The page's unconfirmed ticks still waiting (they leave once confirmed here). */
  private readonly waitingIds = signal<ReadonlySet<number> | null>(null);
  private listRun = 0;
  private previewRun = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The partners whose list was read once (the page's ticks apply the first time only). */
  private readonly seen = new Set<number>();

  readonly choices = computed(() => this.partners());
  readonly choiceOptions = computed<SegmentOption[]>(() => this.choices().map((partner) => ({
    id: String(partner.customerId), label: partner.customerName, count: partner.confirmedOpenReports ?? partner.openReports,
  })));
  readonly partnerWord = computed(() => partnerShortName(this.choices().find((p) => p.customerId === this.customerId())?.customerName ?? '') || 'partner');

  readonly shown = computed(() => {
    const channel = channelOf(this.channel());
    const range = periodRange({ kind: this.period() }, this.today());
    return this.candidates().filter((r) => (!channel || r.channel === channel)
      && (!range.from || r.soldOn >= range.from) && (!range.to || r.soldOn <= range.to));
  });
  /** What is ticked and shown: only these are previewed and invoiced. */
  readonly chosen = computed(() => this.shown().filter((r) => this.selected().has(r.id)));
  private readonly chosenKey = computed(() => this.chosen().map((r) => r.id).sort((a, b) => a - b).join(','));
  readonly chosenLine = computed(() => {
    const list = this.chosen();
    const cents = list.reduce((sum, r) => sum + Math.round((r.totals.netEur || 0) * 100), 0);
    return `${list.length === 1 ? '1 melding' : count(list.length) + ' meldingen'} · netto ${euro(cents / 100)}`;
  });
  /** The preview of exactly what is chosen now (a stale one is never shown). */
  readonly currentPreview = computed(() => {
    const p = this.preview();
    return p && p.key === this.chosenKey() ? p.preview : null;
  });
  readonly makeable = computed(() => this.currentPreview()?.groups.filter((group) => !group.blocked).length ?? 0);
  /** Step 1's footer, once the preview of the ticks is in: what step 2 will make. */
  readonly aheadLine = computed(() => {
    const p = this.currentPreview();
    if (!p) return this.previewLoading() && this.chosen().length ? 'overzicht wordt berekend…' : null;
    const groups = p.groups.filter((group) => !group.blocked);
    const cents = groups.reduce((sum, group) => sum + Math.round((group.balanceEur ?? 0) * 100), 0);
    if (!groups.length) return p.groups.length ? 'niets kan gemaakt worden' : 'niets te factureren';
    return `${groups.length === 1 ? '1 concept' : groups.length + ' concepten'} · te factureren ${euro(cents / 100)}`;
  });

  readonly waiting = computed(() => {
    const ids = this.waitingIds();
    return this.unconfirmed().filter((r) => r.customerId === this.customerId() && (!ids || ids.has(r.id)));
  });
  readonly waitingNumbers = computed(() => this.waiting().map((r) => r.number).join(', '));

  private containerNames = computed(() => new Map((this.currentPreview()?.groups ?? [])
    .filter((group) => group.purchaseOrderId != null)
    .map((group) => [group.purchaseOrderId!, group.containerName ?? ''])));
  private readonly containers = signal<ReadonlyMap<number, { name: string; sharePct: number }>>(new Map());
  private readonly asked = new Set<number>();

  readonly containerNameFn = (id: number): string | null => this.containerNames().get(id) || this.containers().get(id)?.name || null;
  readonly shareFn = (group: PartnerInvoicePreviewGroup): number | null =>
    group.purchaseOrderId != null ? this.containers().get(group.purchaseOrderId)?.sharePct ?? null : null;

  constructor() {
    effect(() => {
      const choices = this.choices();
      const wanted = this.initialCustomerId();
      untracked(() => {
        if (this.customerId() != null) return;
        const first = choices.find((partner) => partner.customerId === wanted) ?? choices[0];
        if (first) this.pick(first.customerId);
      });
    });
    /* The ticks rest: ask the preview of what is chosen (both steps; step 2 then opens on it at once). */
    effect(() => {
      const key = this.chosenKey();
      const customerId = this.customerId();
      untracked(() => {
        if (this.timer) clearTimeout(this.timer);
        if (!key || customerId == null || this.result()) return;
        if (this.preview()?.key === key) return;
        this.timer = setTimeout(() => this.askPreview(), PREVIEW_PAUSE_MS);
      });
    });
    /* Names and shares a preview leaves out (an older server): read each container once. */
    effect(() => {
      const preview = this.currentPreview();
      const result = this.result();
      untracked(() => {
        for (const group of preview?.groups ?? []) {
          if (group.source === 'CONTAINER' && group.purchaseOrderId != null && group.profitSharePct == null) void this.readContainer(group.purchaseOrderId);
        }
        for (const item of [...(preview?.skipped ?? []), ...(result?.skipped ?? []), ...(result?.blocked ?? [])]) {
          if (item.purchaseOrderId != null && !item.containerName?.trim() && !this.containerNames().get(item.purchaseOrderId)) void this.readContainer(item.purchaseOrderId);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => { if (this.timer) clearTimeout(this.timer); this.listRun++; this.previewRun++; });
  }

  pick(customerId: number): void {
    if (!Number.isSafeInteger(customerId) || customerId === this.customerId()) return;
    this.customerId.set(customerId);
    this.step.set(1);
    this.preview.set(null);
    this.previewError.set(null);
    void this.loadList();
  }

  /** The partner's confirmed, open meldingen; the first time ticked from the page's selection, else all. */
  async loadList(keep: ReadonlySet<number> | null = null): Promise<void> {
    const customerId = this.customerId();
    if (customerId == null) return;
    const run = ++this.listRun;
    this.listLoading.set(true);
    this.listError.set(null);
    try {
      const page = await this.api.list({ customerId, state: 'CONFIRMED', limit: 1000 });
      if (run !== this.listRun) return;
      const list = page.reports.filter((r) => r.customerId === customerId && invoiceable(r));
      this.candidates.set(list);
      const ids = new Set(list.map((r) => r.id));
      const pre = this.preselect();
      const first = !this.seen.has(customerId);
      const initial = this.seen.size === 0;
      this.seen.add(customerId);
      let next: Set<number>;
      if (keep) next = new Set([...keep].filter((id) => ids.has(id)));
      else if (first && pre && pre.some((id) => ids.has(id))) next = new Set(pre.filter((id) => ids.has(id)));
      /* Ticks that were all still to confirm: nothing ticked yet (the banner offers them); another partner: all. */
      else if (first && pre && initial) next = new Set();
      else next = ids;
      this.selected.set(next);
    } catch (failure: unknown) {
      if (run !== this.listRun) return;
      this.listError.set(isMissingEndpoint(failure) ? 'Factureren kent de server nog niet.' : messageOf(failure, 'De meldingen konden niet worden geladen.'));
    } finally {
      if (run === this.listRun) this.listLoading.set(false);
    }
  }

  async askPreview(force = false): Promise<void> {
    const customerId = this.customerId();
    const ids = this.chosen().map((r) => r.id).sort((a, b) => a - b);
    const key = ids.join(',');
    if (customerId == null || !ids.length) return;
    if (!force && this.preview()?.key === key) return;
    const run = ++this.previewRun;
    this.previewLoading.set(true);
    this.previewError.set(null);
    try {
      const preview = await this.api.invoicePreview(customerId, ids);
      if (run === this.previewRun) this.preview.set({ key, preview });
    } catch (failure: unknown) {
      if (run === this.previewRun) {
        this.previewError.set(isMissingEndpoint(failure) ? 'Factureren kent de server nog niet.' : messageOf(failure, 'Het overzicht kon niet worden geladen.'));
      }
    } finally {
      if (run === this.previewRun) this.previewLoading.set(false);
    }
  }

  toCheck(): void {
    if (!this.chosen().length) return;
    this.step.set(2);
    if (this.timer) clearTimeout(this.timer);
    if (!this.currentPreview()) void this.askPreview();
  }

  /** The page's unconfirmed ticks: confirm them (with the tokens the page showed), then tick them here. */
  async confirmFirst(): Promise<void> {
    const list = this.waiting();
    if (!list.length || this.confirming() || !this.canConfirm()) return;
    this.confirming.set(true);
    this.listError.set(null);
    try {
      const answer = await this.api.confirmReports(list.filter((r) => r.editToken).map((r) => ({ id: r.id, token: r.editToken! })));
      const done = new Set(list.map((r) => r.id));
      this.waitingIds.set(new Set(this.waiting().map((r) => r.id).filter((id) => !done.has(id))));
      this.confirmedSome.emit(answer.reports ?? []);
      await this.loadList(new Set([...this.selected(), ...done]));
    } catch (failure: unknown) {
      this.listError.set(messageOf(failure, 'Bevestigen lukt nu niet.'));
    } finally {
      this.confirming.set(false);
    }
  }

  async create(): Promise<void> {
    const customerId = this.customerId();
    const preview = this.currentPreview();
    if (customerId == null || !preview || !this.makeable() || this.creating()) return;
    this.creating.set(true);
    this.previewError.set(null);
    try {
      const result = await this.api.invoice(customerId, preview.reportIds);
      this.result.set(result);
      this.created.emit(result);
    } catch (failure: unknown) {
      this.previewError.set(messageOf(failure, 'De facturen konden niet worden gemaakt.'));
    } finally {
      this.creating.set(false);
    }
  }

  close(): void {
    if (this.creating() || this.confirming()) return;
    this.closed.emit();
  }

  containerOf(purchaseOrderId: number | null, name?: string | null): string {
    if (purchaseOrderId == null) return 'Eigen voorraad';
    return name?.trim() || this.containerNameFn(purchaseOrderId) || `Inkoop #${purchaseOrderId}`;
  }

  private async readContainer(id: number): Promise<void> {
    if (this.asked.has(id)) return;
    this.asked.add(id);
    try {
      const { order } = await this.sourcing.purchaseOrder(id);
      const name = order.alias?.trim() || order.number?.trim() || `Inkoop #${id}`;
      this.containers.update((map) => new Map(map).set(id, { name, sharePct: order.partnerSharePct ?? 50 }));
    } catch { /* the name stays "Inkoop #id" and the share is left out */ }
  }
}
