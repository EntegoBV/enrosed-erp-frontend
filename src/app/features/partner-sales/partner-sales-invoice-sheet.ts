import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import {
  PartnerInvoicePreview, PartnerInvoicePreviewGroup, PartnerInvoiceResult, PartnerSalesApi, PartnerSalesPartnerSummary, isMissingEndpoint,
} from '../../core/api/partner-sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { count, euro, minusEuro, percent } from '../partner/partner-format';

/**
 * Factureren: everything of one partner that is not invoiced yet, as the
 * server would invoice it right now (one concept per container, one for our
 * own stock), with what waits and why. "Facturen maken (n)" sends exactly the
 * meldingen of this preview, so a melding that came in meanwhile is never
 * invoiced unseen. Afterwards the sheet lists the concepts it made.
 */
@Component({
  selector: 'app-partner-sales-invoice-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Segmented, Sheet, Skeleton],
  template: `
    <app-sheet title="Factureren" [wide]="desk.active()" [variant]="desk.active() ? 'default' : 'ios'" (closed)="closed.emit()">
      <div body class="vi" [class.vi--ios]="!desk.active()">
        @if (choices().length > 1 && !result()) {
          <div class="vi-partner">
            <span class="vi-label">Voor welke partner?</span>
            <app-segmented [variant]="desk.active() ? 'desk' : 'ios'" label="Partner" [options]="choiceOptions()"
                           [value]="customerId() ? '' + customerId() : ''" (changed)="pick(+$event)" />
          </div>
        }

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
        } @else if (error(); as message) {
          <p class="vi-bad" role="alert">{{ message }}</p>
          <button class="wk-btn wk-btn--sm" type="button" [disabled]="loading()" (click)="load()">Opnieuw proberen</button>
        } @else if (loading() || !preview()) {
          <app-skeleton [kind]="desk.active() ? 'table' : 'group'" [rows]="4" />
        } @else {
          @let p = preview()!;
          @if (!p.groups.length && !p.skipped.length) {
            <p class="vi-none">Niets meer te factureren voor deze partner.</p>
          }
          @for (group of p.groups; track groupKey(group)) {
            <section class="vi-group" [class.is-blocked]="!!group.blocked">
              <header class="vi-group__head">
                <b>{{ group.source === 'OWN' ? 'Eigen voorraad' : containerOf(group.purchaseOrderId, group.containerName) }}</b>
                <!-- A blocked group makes nothing: no document kind, no share; its figures were not computed. -->
                @if (!group.blocked) {
                  @if (group.source === 'CONTAINER') { <span class="wk-pill" [class.tone-blue]="group.finalSettlement">{{ group.finalSettlement ? 'Slotfactuur' : 'Deelfactuur' }}</span> }
                  @else { <span class="wk-pill">Factuur</span> }
                  @if (shareOf(group); as share) { <span class="vi-share">{{ share }} voor ons</span> }
                }
              </header>
              <div class="vi-lines" role="table" [attr.aria-label]="'Regels ' + (group.containerName || 'eigen voorraad')">
                <div class="vi-line vi-line--head" role="row">
                  <span role="columnheader">Product</span><span role="columnheader">Stuks</span>
                  <span role="columnheader">Netto</span><span role="columnheader" class="vi-hide">Kost</span><span role="columnheader">Ons deel</span>
                </div>
                @for (line of group.lines; track line.productId) {
                  <div class="vi-line" role="row">
                    <span class="vi-line__name" role="cell">{{ line.name }}@if (line.variant) { <small> · {{ line.variant }}</small> }
                      @if (line.buybackQuantity > 0) { <small class="vi-line__sub">{{ num(line.soldQuantity) }} verkocht − {{ num(line.buybackQuantity) }} terug</small> }</span>
                    <span role="cell">{{ num(line.quantity) }}</span>
                    <span role="cell">{{ eur(line.proceedsEur) }}</span>
                    <span role="cell" class="vi-hide">{{ money(line.costEur) }}</span>
                    <span role="cell" class="vi-strong">{{ money(line.valueEur) }}</span>
                  </div>
                }
              </div>
              @if (group.blocked) {
                <p class="vi-bad" role="alert">Wordt niet gemaakt: {{ group.blocked }}</p>
              } @else {
                <!-- The settlement credits every issued advance invoice, paid or not (open ones stay to be paid apart). -->
                <dl class="wk-equation vi-sum">
                  <div><dt>Ons deel</dt><dd>{{ money(group.valueEur) }}</dd></div>
                  @if ((group.advanceEur ?? 0) > 0) { <div class="is-sub"><dt>Voorschot verrekend</dt><dd>{{ minus(group.advanceEur!) }}</dd></div> }
                  <div class="is-total"><dt>Te factureren</dt><dd>{{ money(group.balanceEur) }}</dd></div>
                </dl>
              }
              @for (warning of group.warnings; track $index) { <p class="vi-warn">{{ warning }}</p> }
            </section>
          }
          @if (p.skipped.length) {
            <section class="vi-group vi-group--wait">
              <header class="vi-group__head"><b>Wacht nog</b></header>
              @for (skip of p.skipped; track $index) {
                <p class="vi-skip"><b>{{ skip.name }}</b> · {{ skip.source === 'OWN' ? 'eigen voorraad' : containerOf(skip.purchaseOrderId, skip.containerName) }}<br />{{ skip.reason }}</p>
              }
            </section>
          }
          <p class="vi-foot">{{ p.reportIds.length === 1 ? '1 melding' : p.reportIds.length + ' meldingen' }}</p>
        }
      </div>
      <div foot class="vi-actions">
        @if (result()) {
          <button class="btn btn--primary" type="button" (click)="closed.emit()">Klaar</button>
        } @else {
          <button class="btn" type="button" [disabled]="creating()" (click)="closed.emit()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="!makeable() || creating() || loading()" (click)="create()">
            {{ creating() ? 'Bezig…' : 'Facturen maken (' + makeable() + ')' }}</button>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .vi{display:grid;gap:14px;min-width:0}
    .vi--ios{padding:0 var(--ios-inset,16px)}
    .vi-partner{display:grid;gap:6px}
    .vi-label{color:var(--muted);font-size:12.5px;font-weight:650}
    .vi-group{display:grid;gap:8px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .vi-group.is-blocked{border-color:#efcdc9}
    .vi-group__head{display:flex;align-items:center;gap:8px;min-width:0}
    .vi-group__head b{min-width:0;overflow:hidden;font-size:14.5px;text-overflow:ellipsis;white-space:nowrap}
    .vi-share{flex:none;margin-left:auto;color:var(--muted);font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
    .vi-lines{display:grid}
    .vi-line{display:grid;grid-template-columns:minmax(0,1fr) 54px 88px 80px 88px;align-items:baseline;gap:8px;padding:6px 0;border-top:1px solid var(--line);font-size:13px;font-variant-numeric:tabular-nums}
    .vi-line>span:not(.vi-line__name){text-align:right;white-space:nowrap}
    .vi-line--head{border-top:0;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
    .vi-line__name{min-width:0;overflow-wrap:anywhere}
    .vi-line__name small{color:var(--muted);font-size:12px}
    .vi-line__sub{display:block}
    .vi-strong{font-weight:700}
    .vi-sum{max-width:320px;margin-left:auto;width:100%}
    .vi-sum>div{padding:3px 0}
    .vi-bad{margin:0;color:var(--danger);font-size:13px;font-weight:600;line-height:1.4}
    .vi-warn{margin:0;color:#7c450b;font-size:13px;line-height:1.4}
    .vi-skip{margin:0;color:var(--ink-2);font-size:13px;line-height:1.45}
    .vi-group--wait{background:var(--surface-2)}
    .vi-none,.vi-foot{margin:0;color:var(--muted);font-size:13px}
    .vi-wait{margin:0;color:var(--ink-2);font-size:13px;line-height:1.45}
    .vi-done{display:grid;gap:6px;padding:12px 14px;border-radius:14px;background:var(--ok-soft,#e8f3ec)}
    .vi-done__link{display:flex;align-items:center;min-height:36px;color:var(--rose-dark);font-weight:650;text-decoration:none}
    .vi-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;width:100%}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .vi-line{grid-template-columns:minmax(0,1fr) 44px 80px 84px;font-size:14px}
      .vi-hide{display:none}
      .vi-done__link{min-height:44px}
      .vi-actions .btn{flex:1;min-height:48px}
    }
  `,
})
export class PartnerSalesInvoiceSheet {
  private readonly api = inject(PartnerSalesApi);
  private readonly sourcing = inject(SourcingApi);
  readonly desk = inject(DesktopViewport);

  /** The partners with open meldingen (the summary's); the sheet asks which one when there are several. */
  readonly partners = input.required<readonly PartnerSalesPartnerSummary[]>();
  /** The partner to start with (the page's filter), else the first. */
  readonly initialCustomerId = input<number | null>(null);
  readonly closed = output<void>();
  readonly created = output<PartnerInvoiceResult>();

  readonly customerId = signal<number | null>(null);
  readonly preview = signal<PartnerInvoicePreview | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly creating = signal(false);
  readonly result = signal<PartnerInvoiceResult | null>(null);
  private run = 0;

  readonly choices = computed(() => this.partners().filter((partner) => partner.openReports > 0));
  readonly choiceOptions = computed<SegmentOption[]>(() => this.choices().map((partner) => ({
    id: String(partner.customerId), label: partner.customerName, count: partner.openReports,
  })));

  /** The concepts "Facturen maken" would make: the groups the server would not refuse. */
  readonly makeable = computed(() => this.preview()?.groups.filter((group) => !group.blocked).length ?? 0);

  private containerNames = computed(() => new Map((this.preview()?.groups ?? [])
    .filter((group) => group.purchaseOrderId != null)
    .map((group) => [group.purchaseOrderId!, group.containerName ?? ''])));

  /**
   * Containers read for what the preview leaves out: the name of a container that has no group (only a waiting
   * buyback on it), and a container group's share when the server does not send it (it uses the container's own
   * share, partnerSharePct or 50, never the customer's). Each container is read once per sheet.
   */
  private readonly containers = signal<ReadonlyMap<number, { name: string; sharePct: number }>>(new Map());
  private readonly asked = new Set<number>();

  constructor() {
    effect(() => {
      const preview = this.preview();
      const result = this.result();
      untracked(() => {
        const named = (id: number | null, name: string | null | undefined) => id == null || !!name?.trim() || !!this.containerNames().get(id);
        for (const group of preview?.groups ?? []) {
          if (group.source === 'CONTAINER' && group.purchaseOrderId != null && group.profitSharePct == null) void this.readContainer(group.purchaseOrderId);
        }
        for (const item of [...(preview?.skipped ?? []), ...(result?.skipped ?? []), ...(result?.blocked ?? [])]) {
          if (!named(item.purchaseOrderId, item.containerName)) void this.readContainer(item.purchaseOrderId!);
        }
      });
    });
    effect(() => {
      const choices = this.choices();
      const wanted = this.initialCustomerId();
      untracked(() => {
        if (this.customerId() != null) return;
        const first = choices.find((partner) => partner.customerId === wanted) ?? choices[0];
        if (first) this.pick(first.customerId);
      });
    });
  }

  pick(customerId: number): void {
    if (!Number.isSafeInteger(customerId) || customerId === this.customerId()) return;
    this.customerId.set(customerId);
    void this.load();
  }

  async load(): Promise<void> {
    const customerId = this.customerId();
    if (customerId == null) return;
    const id = ++this.run;
    this.loading.set(true);
    this.error.set(null);
    this.preview.set(null);
    try {
      const preview = await this.api.invoicePreview(customerId);
      if (id === this.run) this.preview.set(preview);
    } catch (failure: unknown) {
      if (id === this.run) {
        this.error.set(isMissingEndpoint(failure) ? 'Factureren kent de server nog niet.' : messageOf(failure, 'Het overzicht kon niet worden geladen.'));
      }
    } finally {
      if (id === this.run) this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    const customerId = this.customerId();
    const preview = this.preview();
    if (customerId == null || !preview || !this.makeable() || this.creating()) return;
    this.creating.set(true);
    this.error.set(null);
    try {
      const result = await this.api.invoice(customerId, preview.reportIds);
      this.result.set(result);
      this.created.emit(result);
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'De facturen konden niet worden gemaakt.'));
    } finally {
      this.creating.set(false);
    }
  }

  groupKey(group: PartnerInvoicePreviewGroup): string {
    return group.purchaseOrderId == null ? 'own' : `po-${group.purchaseOrderId}`;
  }

  /** The container as sales names it (alias, else number, else "Inkoop #id"), from the server's name or the read order. */
  containerOf(purchaseOrderId: number | null, name?: string | null): string {
    if (purchaseOrderId == null) return 'Eigen voorraad';
    return name?.trim() || this.containerNames().get(purchaseOrderId) || this.containers().get(purchaseOrderId)?.name
      || `Inkoop #${purchaseOrderId}`;
  }

  /** "50 %", "52,5 %": the share this group's Ons deel was computed with, when known. */
  shareOf(group: PartnerInvoicePreviewGroup): string | null {
    const pct = group.profitSharePct
      ?? (group.source === 'OWN' ? this.preview()?.profitSharePct
        : group.purchaseOrderId != null ? this.containers().get(group.purchaseOrderId)?.sharePct : null);
    return pct == null ? null : percent(pct);
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

  eur(value: number): string { return euro(value); }
  /** A figure of the preview; "—" where the server computed none (a blocked group). */
  money(value: number | null | undefined): string { return value == null ? '—' : euro(value); }
  minus(value: number): string { return minusEuro(value); }
  num(value: number): string { return count(value); }
}
