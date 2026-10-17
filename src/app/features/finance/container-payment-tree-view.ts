import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { PurchaseOrderView } from '../../core/api/models';
import { EurPipe } from '../../shared/pipes';
import { emptyBranch, type PayeeBranch, type PaymentNode } from './container-payment-tree';
import { PAYEE_TONES } from './finance-format';
import { FinanceState } from './finance-state';

/**
 * One container's money as invoices → terms → payments, the same in Uitgaven ›
 * Containers (unfolded row) and in the inspector: per payee its head and
 * figures, its invoices against the Afspraak with their file, invoice files
 * without data, the supplier's terms with their payments, and every payment
 * with where it stands on the bank; the transfers of a payment paid in parts
 * indented under it. Styles: styles/finance-workspace.scss (.fin-tree).
 */
@Component({
  selector: 'app-container-payment-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, EurPipe],
  template: `
    @let data = view();
    @for (branch of branches(); track branch.payee) {
      @if (emptyBranch(branch)) {
        <!-- A payee with nothing agreed, paid or invoiced: one quiet line, not three € 0,00. -->
        <div class="fin-stream fin-tree fin-stream--none"><div class="fin-stream__head"><span [class]="'wk-dot tone-' + tone(branch.payee)"></span><span class="wk-amount--muted">{{ branch.label }} · geen</span></div></div>
      } @else {
      <div class="fin-stream fin-tree">
        <div class="fin-stream__head"><span [class]="'wk-dot tone-' + tone(branch.payee)"></span><b>{{ branch.label }}</b><span class="wk-amount--muted">{{ branch.status }}</span></div>
        <dl class="fin-stream__figures"><div><dt>Afspraak</dt><dd>{{ branch.plannedEur | eur }}</dd></div><div><dt>Betaald</dt><dd>{{ branch.paidEur | eur }}</dd></div><div><dt>Open</dt><dd>{{ branch.remainingEur | eur }}</dd></div></dl>
        @for (invoice of branch.invoices; track invoice.id) {
          <div class="fin-tree__invoice"><span>{{ invoice.text }}@if (invoice.comparison) { · {{ invoice.comparison }} }</span>
            @if (invoice.documentId != null) { <button class="wk-link" type="button" (click)="open(data, invoice.documentId, invoice.name)">Bestand ↗</button> }</div>
          @if (invoice.coverage) { <p class="fin-tree__note">{{ invoice.coverage }}</p> }
        }
        @for (file of branch.invoiceFiles; track file.documentId) {
          <div class="fin-tree__invoice fin-tree__invoice--file"><span>{{ file.text }}</span>
            <button class="wk-link" type="button" (click)="open(data, file.documentId, file.name)">Bestand ↗</button></div>
        }
        @if (branch.payee === 'SUPPLIER' && noInvoice()) { <p class="fin-tree__note">Nog geen factuur bij deze container</p> }
        @if (branch.viaSupplier) { <p class="fin-tree__note">{{ branch.viaSupplier }}</p> }
        @for (term of branch.terms; track term.due) {
          <div class="fin-tree__term"><span>{{ term.label }}</span><span>{{ term.paidEur | eur }} van {{ term.plannedEur | eur }}</span></div>
          @for (node of term.payments; track node.id) { <ng-container *ngTemplateOutlet="payment; context: { $implicit: node, nested: true }" /> }
        }
        @for (node of branch.payments; track node.id) { <ng-container *ngTemplateOutlet="payment; context: { $implicit: node, nested: false }" /> }
      </div>
      }
    }
    <ng-template #payment let-node let-nested="nested">
      <div class="fin-tree__payment" [class.fin-tree__payment--nested]="nested">{{ head(node) }}<ng-container *ngTemplateOutlet="bank; context: { $implicit: node }" />{{ node.firstPaidOn ? ' · eerste ' + day(node.firstPaidOn) : '' }}</div>
      @if (node.adjusted) { <div class="fin-tree__adjusted" [class.fin-tree__payment--nested]="nested">{{ node.adjusted }}</div> }
      @if (node.sharedWith) { <div class="fin-tree__adjusted" [class.fin-tree__payment--nested]="nested">{{ node.sharedWith }}</div> }
      @for (part of node.parts; track part.id) {
        <div class="fin-tree__payment fin-tree__part" [class.fin-tree__payment--nested]="nested">{{ day(part.paidOn) }} · {{ part.amountEur | eur }}<ng-container *ngTemplateOutlet="bank; context: { $implicit: part }" /></div>
        @if (part.adjusted) { <div class="fin-tree__adjusted fin-tree__part" [class.fin-tree__payment--nested]="nested">{{ part.adjusted }}</div> }
        @if (part.sharedWith) { <div class="fin-tree__adjusted fin-tree__part" [class.fin-tree__payment--nested]="nested">{{ part.sharedWith }}</div> }
      }
    </ng-template>
    <!-- Where a payment stands on the bank; on a transaction it opens that transaction (line=). -->
    <ng-template #bank let-item>
      @if (item.bank) {
        <span aria-hidden="true"> · </span>
        @if (item.lineId != null && item.bank.startsWith('op de bank')) {
          <button class="wk-link fin-tree__bank" type="button" (click)="state.openLine(item.lineId)">{{ item.bank }} ›</button>
        } @else { <span>{{ item.bank }}</span> }
      }
    </ng-template>
  `,
  // The payee blocks are the items of the host's grid (the unfolded row lays them out side by side).
  styles: `:host { display: contents; }`,
})
export class ContainerPaymentTreeView {
  readonly state = inject(FinanceState);
  readonly view = input.required<PurchaseOrderView>();
  readonly branches = computed<PayeeBranch[]>(() => this.state.containerTree(this.view()));
  /** A server with this round that has neither invoices nor invoice files for the container. */
  readonly noInvoice = computed(() => { const view = this.view(); return view.invoices !== undefined && !view.invoices.length && !(view.invoiceFiles ?? []).length; });

  tone(payee: string): string { return PAYEE_TONES[payee] ?? 'grey'; }
  readonly emptyBranch = emptyBranch;
  /** '02/08', as the order screens write a payment's day. */
  day(date: string): string { return date.slice(8, 10) + '/' + date.slice(5, 7); }
  /**
   * '24/09 · Saldo 70% · 2 transacties · € 21.733,63' (a payment in parts: its newest transfer's day, as in Betalingen);
   * where it stands on the bank ('op de bank · KBC · 14 okt ›') and 'eerste 10/09' follow it.
   */
  head(node: PaymentNode): string {
    const amount = node.amountEur.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' });
    return [this.day(node.paidOn), node.label, amount].filter(Boolean).join(' · ');
  }
  open(view: PurchaseOrderView, documentId: number, name: string): void {
    void this.state.openPurchaseFile(view.order.id, documentId, name);
  }
}
