import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { PartnerInvoicePreview, PartnerInvoicePreviewGroup, PartnerSalesApi, StaffPartnerReport } from '../../core/api/partner-sales-api';
import { partnerShortName } from '../../shared/partner-short-name';
import { FigureRow, profitRows } from './partner-sales-figures';
import { invoicesOf } from './partner-sales-format';

interface ProfitState {
  key: string;
  status: 'loading' | 'ready' | 'error';
  preview: PartnerInvoicePreview | null;
  message: string | null;
}

interface ProfitGroup {
  key: string;
  title: string;
  blocked: string | null;
  rows: FigureRow[];
}

/**
 * Inkoop en winst of one melding on Veilingverkopen (owner's answer 1: "alleen in de ERP (Veilingverkopen,
 * Factureren, factuur)"): per source (a partner container, our own stock) Netto opbrengst − Inkoopkost (→ Verhoeven
 * x %, → Enrosed y %: who paid it) = Winst → Enrosed z % / → Verhoeven, the same rows as Factureren step 2
 * (partner-sales-figures.ts). The figures are the server's Factureren preview of this melding's open parts alone
 * (asked when it opens, again after an edit); a part already on a document points to that document's margin, which
 * shows the same split. Staff only: never in the partner's portal.
 */
@Component({
  selector: 'app-partner-sales-profit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (shown()) {
      @if (variant() === 'desk') {
        <section class="vpf" aria-label="Inkoop en winst">
          <p class="vpf-head">Inkoop en winst <small>{{ headNote() }}</small></p>
          @if (hasOpen()) {
            @switch (state()?.status) {
              @case ('ready') {
                @if (groups().length) {
                  <div class="vpf-groups">
                    @for (group of groups(); track group.key) {
                      <div class="vpf-group">
                        <span class="vpf-group__head">{{ group.title }}</span>
                        @if (group.blocked) { <p class="vpf-note">{{ group.blocked }}</p> }
                        @else {
                          <dl class="wk-equation vpf-sum">
                            @for (row of group.rows; track row.key) {
                              <div [class.is-sub]="row.kind === 'sub'" [class.vpf-mid]="row.kind === 'mid'">
                                <dt>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</dt><dd [class.vpf-neg]="row.negative">{{ row.value }}</dd></div>
                            }
                          </dl>
                        }
                      </div>
                    }
                  </div>
                }
                @for (line of waiting(); track $index) { <p class="vpf-note">{{ line }}</p> }
              }
              @case ('error') { <p class="vpf-note">{{ state()?.message }}</p> }
              @default { <p class="vpf-note" role="status">Laden…</p> }
            }
          }
          @if (invoices().length) {
            <p class="vpf-note">{{ hasOpen() ? 'Het gefactureerde deel' : 'Gefactureerd' }}: de opbouw staat bij de marge van
              @for (invoice of invoices(); track invoice.id) { <a class="wk-link" [routerLink]="['/sales', invoice.id]">{{ invoice.number }}</a>@if (!$last) {, } }.</p>
          }
        </section>
      } @else {
        <section class="ios-section" aria-label="Inkoop en winst">
          <div class="ios-section__head"><h2>Inkoop en winst</h2></div>
          @if (hasOpen()) {
            @switch (state()?.status) {
              @case ('ready') {
                @for (group of groups(); track group.key) {
                  <p class="vpf-caption">{{ group.title }}</p>
                  <div class="ios-group">
                    @if (group.blocked) {
                      <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">{{ group.blocked }}</span></span></div>
                    } @else {
                      @for (row of group.rows; track row.key) {
                        <div class="ios-cell vpf-cell" [class.vpf-cell--sub]="row.kind === 'sub'">
                          <span class="ios-cell__body"><span class="ios-cell__title" [class.vpf-strong]="row.kind === 'mid'">{{ row.label }}</span>
                            @if (row.hint) { <span class="ios-cell__sub">{{ row.hint }}</span> }</span>
                          <span class="ios-cell__value" [class.vpf-strong]="row.kind === 'mid'" [class.vpf-neg]="row.negative">{{ row.value }}</span>
                        </div>
                      }
                    }
                  </div>
                }
                @for (line of waiting(); track $index) { <p class="vpf-foot">{{ line }}</p> }
              }
              @case ('error') { <p class="vpf-foot">{{ state()?.message }}</p> }
              @default { <p class="vpf-foot" role="status">Laden…</p> }
            }
          }
          @if (invoices().length) {
            <p class="vpf-foot">{{ hasOpen() ? 'Het gefactureerde deel' : 'Gefactureerd' }}: de opbouw staat bij de marge van
              @for (invoice of invoices(); track invoice.id) { <a [routerLink]="['/sales', invoice.id]">{{ invoice.number }}</a>@if (!$last) {, } }.</p>
          } @else if (hasOpen()) {
            <p class="vpf-foot">{{ headNote() }}</p>
          }
        </section>
      }
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .vpf{display:grid;gap:6px}
    .vpf-head{margin:0;color:var(--ink-2);font-size:12px;font-weight:700}
    .vpf-head small{margin-left:6px;color:var(--muted);font-weight:500}
    .vpf-groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
    .vpf-group{display:grid;align-content:start;gap:2px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
    .vpf-group__head{color:var(--ink-2);font-size:12px;font-weight:700}
    .vpf-sum>div{padding:3px 0;font-size:12.5px}
    .vpf-sum>.is-sub{font-size:12px}
    .vpf-sum dt small{display:block;color:var(--muted);font-size:11px;font-weight:500}
    .vpf-mid{border-top:1px solid var(--line);font-weight:650}
    .vpf-sum dd.vpf-neg,.vpf-neg{color:var(--danger)}
    .vpf-note{margin:0;color:var(--muted);font-size:12.5px;line-height:1.45}
    .vpf-caption{margin:10px calc(var(--ios-inset,16px) + 4px) 6px;color:var(--muted);font-size:13px;font-weight:600}
    .vpf-cell{min-height:44px}
    .vpf-cell--sub .ios-cell__title{padding-left:14px;color:var(--ink-2);font-size:15px}
    .vpf-strong{font-weight:700}
    .vpf-foot{margin:6px calc(var(--ios-inset,16px) + 4px) 0;color:var(--muted);font-size:13px;line-height:1.4}
  `,
})
export class PartnerSalesProfit {
  private readonly api = inject(PartnerSalesApi);

  readonly report = input.required<StaffPartnerReport>();
  readonly variant = input<'desk' | 'ios'>('desk');

  readonly state = signal<ProfitState | null>(null);
  private run = 0;

  /** Only a live melding (not withdrawn, not an old version) has inkoop and winst. */
  readonly shown = computed(() => {
    const r = this.report();
    return r.status !== 'VOIDED' && !r.revisionOf && (this.hasOpen() || this.invoices().length > 0);
  });
  /** Parts Factureren can still take (an older server without parts: an open melding). */
  readonly hasOpen = computed(() => {
    const r = this.report();
    if (r.status === 'VOIDED' || r.status === 'INVOICED') return false;
    return r.parts?.length ? r.parts.some((part) => part.open) : r.status === 'OPEN' || r.status === 'PARTLY_INVOICED';
  });
  readonly invoices = computed(() => invoicesOf(this.report()));
  readonly headNote = computed(() => (this.invoices().length && this.hasOpen() ? 'van het open deel, zoals Factureren rekent' : 'zoals Factureren rekent'));
  private readonly partner = computed(() => partnerShortName(this.report().customerName));

  readonly groups = computed<ProfitGroup[]>(() => {
    const preview = this.state()?.status === 'ready' ? this.state()!.preview : null;
    if (!preview) return [];
    return preview.groups.map((group) => ({
      key: group.purchaseOrderId == null ? 'own' : `po-${group.purchaseOrderId}`,
      title: this.title(group),
      blocked: group.blocked,
      rows: profitRows(group, this.partner(), group.profitSharePct ?? (group.source === 'OWN' ? preview.profitSharePct : null)),
    })).map((group) => (group.blocked || group.rows.length ? group
      : { ...group, blocked: 'De server rekent inkoop en winst pas sinds ronde 2; zie Factureren.' }));
  });
  /** A buyback that waits for a next sale, a warning of the server. */
  readonly waiting = computed(() => {
    const preview = this.state()?.status === 'ready' ? this.state()!.preview : null;
    if (!preview) return [];
    return [
      ...preview.skipped.map((skip) => `Wacht nog: ${skip.name} · ${skip.source === 'OWN' ? 'eigen voorraad' : skip.containerName || 'container'}: ${skip.reason}`),
      ...(preview.warnings ?? []),
    ];
  });

  constructor() {
    effect(() => {
      const r = this.report();
      const open = this.hasOpen() && r.status !== 'VOIDED' && !r.revisionOf;
      const key = `${r.id}:${r.editToken ?? ''}:${(r.parts ?? []).filter((part) => part.open).length}:${r.confirmed ? 1 : 0}`;
      untracked(() => {
        if (!open) { this.state.set(null); return; }
        if (this.state()?.key === key && this.state()?.status !== 'error') return;
        void this.load(r, key);
      });
    });
    inject(DestroyRef).onDestroy(() => this.run++);
  }

  private async load(report: StaffPartnerReport, key: string): Promise<void> {
    const run = ++this.run;
    this.state.set({ key, status: 'loading', preview: this.state()?.preview ?? null, message: null });
    try {
      const preview = await this.api.reportFigures(report.customerId, report.id);
      if (run !== this.run) return;
      this.state.set({ key, status: 'ready', preview, message: null });
    } catch (failure: unknown) {
      if (run !== this.run) return;
      const message = messageOf(failure, 'Inkoop en winst konden niet worden berekend.');
      /* A server that takes only confirmed meldingen in the preview: say when it will show. */
      const later = /nog niet bevestigd/i.test(message) ? 'Inkoop en winst staan hier zodra de melding bevestigd is.' : message;
      this.state.set({ key, status: 'error', preview: null, message: later });
    }
  }

  private title(group: PartnerInvoicePreviewGroup): string {
    if (group.source === 'OWN') return 'Eigen voorraad';
    const part = (this.report().parts ?? []).find((candidate) => candidate.purchaseOrderId === group.purchaseOrderId);
    return group.containerName?.trim() || part?.containerName || `Inkoop #${group.purchaseOrderId}`;
  }
}
